-- 57D7C7-T2-B: Optional invoice-level item breakdown for JIMS PV.
-- Feature-branch migration ONLY. Review/UAT on separate staging before any production promotion.
-- Existing PV invoice rows and invoice attachments remain authoritative.
-- Existing approval/payment/partial-payment functions are not replaced.

CREATE TABLE IF NOT EXISTS public.pv_invoice_item_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id uuid NOT NULL REFERENCES public.pv_line_items(id) ON DELETE CASCADE,
  item_no integer NOT NULL CHECK (item_no > 0),
  item_description text NOT NULL CHECK (length(btrim(item_description)) BETWEEN 1 AND 500),
  category text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 120),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(16,4) NOT NULL CHECK (unit_price >= 0),
  total_amount numeric(18,2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED,
  gl_code text NULL CHECK (gl_code IS NULL OR length(btrim(gl_code)) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_item_id, item_no)
);

CREATE INDEX IF NOT EXISTS pv_invoice_item_details_line_idx
  ON public.pv_invoice_item_details(line_item_id);

-- Mirror the visible-parent principle; do not expose invoice data publicly.
ALTER TABLE public.pv_invoice_item_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pv_invoice_item_details FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pv_invoice_item_details TO authenticated;

CREATE POLICY "Read breakdown for visible authorised PV"
ON public.pv_invoice_item_details FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.pv_line_items l
    JOIN public.payment_vouchers v ON v.id = l.voucher_id
    WHERE l.id = pv_invoice_item_details.line_item_id
      AND v.archived_at IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM public.user_profiles u
    WHERE u.id = (SELECT auth.uid())
      AND u.is_active = true
      AND u.role <> 'non_executive'
  )
  AND (
    NOT public.jims_finance_non_ap_user_v1()
    OR (
      public.jims_finance_non_ap_fm_v1()
      AND EXISTS (
        SELECT 1
        FROM public.pv_line_items l
        JOIN public.payment_vouchers v ON v.id = l.voucher_id
        WHERE l.id = pv_invoice_item_details.line_item_id
          AND v.status IN ('pending_finance_manager','pending_manager')
      )
    )
  )
);

-- Write path is an audited, atomic RPC (never permit direct client DML).
-- This allows item details to be replaced without leaving a partially saved invoice.
CREATE OR REPLACE FUNCTION public.jims_save_invoice_item_details_v1(
  p_line_item_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_voucher_id uuid;
  v_invoice_amount numeric;
  v_status text;
  v_department text;
  v_user_department text;
  v_user_role text;
  v_user_active boolean;
  v_row jsonb;
  v_no integer := 0;
  v_description text;
  v_category text;
  v_gl text;
  v_qty_text text;
  v_price_text text;
  v_qty numeric;
  v_price numeric;
  v_sum numeric := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Lock the parent PV to serialize item saves with draft and submit actions.
  SELECT v.id, l.amount, v.status, v.origin_department
    INTO v_voucher_id, v_invoice_amount, v_status, v_department
  FROM public.pv_line_items l
  JOIN public.payment_vouchers v ON v.id = l.voucher_id
  WHERE l.id = p_line_item_id AND v.archived_at IS NULL
  FOR UPDATE OF v;

  IF NOT FOUND OR v_status NOT IN ('draft', 'returned')
     OR NOT public.jauhar_is_current_requester_v1(v_voucher_id) THEN
    RAISE EXCEPTION 'Only current requester may edit a Draft/Returned invoice';
  END IF;

  SELECT role, department, is_active
    INTO v_user_role, v_user_department, v_user_active
  FROM public.user_profiles
  WHERE id = v_actor;

  IF v_user_active IS DISTINCT FROM true OR v_user_role IS DISTINCT FROM 'executive'
     OR v_user_department IS DISTINCT FROM v_department THEN
    RAISE EXCEPTION 'Invoice editing is not permitted for this user';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) > 300 THEN
    RAISE EXCEPTION 'Invoice items must be an array with at most 300 rows';
  END IF;

  -- All failures roll back the deletion and inserts.
  DELETE FROM public.pv_invoice_item_details WHERE line_item_id = p_line_item_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'Invalid invoice item';
    END IF;

    v_description := btrim(coalesce(v_row->>'item_description', ''));
    v_category := btrim(coalesce(v_row->>'category', ''));
    v_gl := nullif(btrim(coalesce(v_row->>'gl_code', '')), '');
    v_qty_text := btrim(coalesce(v_row->>'quantity', ''));
    v_price_text := btrim(coalesce(v_row->>'unit_price', ''));

    IF length(v_description) NOT BETWEEN 1 AND 500
       OR length(v_category) NOT BETWEEN 1 AND 120
       OR (v_gl IS NOT NULL AND length(v_gl) > 64)
       OR v_qty_text !~ '^[0-9]{1,10}([.][0-9]{1,3})?$'
       OR v_price_text !~ '^[0-9]{1,10}([.][0-9]{1,4})?$' THEN
      RAISE EXCEPTION 'Item description, category, quantity or price is invalid';
    END IF;

    v_qty := v_qty_text::numeric;
    v_price := v_price_text::numeric;
    IF v_qty <= 0 OR v_price < 0 THEN
      RAISE EXCEPTION 'Quantity must be positive and unit price cannot be negative';
    END IF;

    v_no := v_no + 1;
    v_sum := v_sum + round(v_qty * v_price, 2);

    INSERT INTO public.pv_invoice_item_details(
      line_item_id, item_no, item_description, category,
      quantity, unit_price, gl_code
    ) VALUES (
      p_line_item_id, v_no, v_description, v_category,
      v_qty, v_price, v_gl
    );
  END LOOP;

  -- Itemisation is OPTIONAL; when present it must reconcile to invoice amount.
  IF v_no > 0 AND round(v_sum, 2) <> round(v_invoice_amount, 2) THEN
    RAISE EXCEPTION 'Invoice breakdown RM % does not match invoice amount RM %',
      round(v_sum,2), round(v_invoice_amount,2);
  END IF;

  INSERT INTO public.pv_audit_events(voucher_id, actor_id, action, details)
  VALUES (
    v_voucher_id, v_actor, 'invoice_item_details_saved',
    jsonb_build_object(
      'line_item_id', p_line_item_id,
      'item_count', v_no,
      'breakdown_total', round(v_sum, 2)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'line_item_id', p_line_item_id,
    'item_count', v_no,
    'total_amount', round(v_sum, 2)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.jims_save_invoice_item_details_v1(uuid,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jims_save_invoice_item_details_v1(uuid,jsonb)
  TO authenticated;

-- A single submit-time guard covers legacy, Finance tiers and department PVs.
-- It does not modify their approval decisions, payment states or existing RPC bodies.
CREATE OR REPLACE FUNCTION public.jims_invoice_details_submit_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.status IN ('draft','returned')
     AND NEW.status IN (
       'pending_manager','pending_hod','pending_ap_finance',
       'pending_finance_manager','pending_ceo','pending_bod'
     ) THEN

    -- Every invoice must have a registered, *existing* private Storage object.
    IF EXISTS (
      SELECT 1
      FROM public.pv_line_items l
      WHERE l.voucher_id = NEW.id
        AND NOT EXISTS (
          SELECT 1
          FROM public.pv_invoice_documents d
          JOIN storage.objects o
            ON o.bucket_id = 'jauhar-pv-invoices'
           AND o.name = d.storage_path
          WHERE d.voucher_id = NEW.id
            AND d.line_item_id = l.id
        )
    ) THEN
      RAISE EXCEPTION 'Cannot submit PV: upload invoice PDF/image for every invoice';
    END IF;

    -- When a breakdown exists, totals must still match the parent invoice.
    IF EXISTS (
      SELECT 1
      FROM public.pv_line_items l
      JOIN public.pv_invoice_item_details i ON i.line_item_id = l.id
      WHERE l.voucher_id = NEW.id
      GROUP BY l.id, l.amount
      HAVING round(sum(i.total_amount), 2) <> round(l.amount, 2)
    ) THEN
      RAISE EXCEPTION 'Cannot submit PV: an invoice item breakdown does not match its invoice amount';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jims_invoice_details_submit_guard_v1()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS jims_invoice_details_submit_guard_v1_trg
  ON public.payment_vouchers;
CREATE TRIGGER jims_invoice_details_submit_guard_v1_trg
  BEFORE UPDATE OF status ON public.payment_vouchers
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.jims_invoice_details_submit_guard_v1();

COMMENT ON TABLE public.pv_invoice_item_details IS
  'Optional item-level breakdown of each existing PV invoice line; proof remains stored in pv_invoice_documents.';
