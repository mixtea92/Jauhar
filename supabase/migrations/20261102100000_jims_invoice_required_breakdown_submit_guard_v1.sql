-- 57D7C7-T2-H — Protect NEW PV submissions from missing or mismatched invoice items.
-- Feature-branch only until explicit Final/LOCK, Integration and Staging UAT approval.
-- Existing approved/paid vouchers and all payment/approval functions are unchanged.
-- Replace only the previously introduced 57D7C7 invoice guard, not legacy RPC bodies.

CREATE OR REPLACE FUNCTION public.jims_invoice_details_submit_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_line_total numeric;
BEGIN
  -- Only Draft/Returned -> submitted transitions: no effect on old approved/paid PVs.
  IF OLD.status IN ('draft','returned')
     AND NEW.status IN (
       'pending_manager','pending_hod','pending_ap_finance',
       'pending_finance_manager','pending_ceo','pending_bod'
     ) THEN

    IF NOT EXISTS (
      SELECT 1 FROM public.pv_line_items l WHERE l.voucher_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Cannot submit PV: at least one invoice is required';
    END IF;

    -- A forgotten invoice line, amount or incomplete mandatory field is a hard block.
    IF EXISTS (
      SELECT 1 FROM public.pv_line_items l
      WHERE l.voucher_id = NEW.id
        AND (
          nullif(btrim(coalesce(l.invoice_reference,'')),'') IS NULL
          OR nullif(btrim(coalesce(l.description,'')),'') IS NULL
          OR l.amount IS NULL OR l.amount <= 0
        )
    ) THEN
      RAISE EXCEPTION 'Cannot submit PV: complete invoice number, description and positive amount for every invoice';
    END IF;

    SELECT coalesce(sum(l.amount),0) INTO v_line_total
    FROM public.pv_line_items l WHERE l.voucher_id = NEW.id;

    IF NEW.amount IS NULL OR NEW.amount <= 0
       OR NEW.sst_amount IS NULL OR NEW.sst_amount < 0
       OR round(v_line_total + NEW.sst_amount, 2) <> round(NEW.amount, 2)
    THEN
      RAISE EXCEPTION 'Cannot submit PV: invoice totals plus SST do not match PV amount';
    END IF;

    -- Details are REQUIRED for every invoice, not optional. The presence of an
    -- attachment alone must never unlock Submit.
    IF EXISTS (
      SELECT 1 FROM public.pv_line_items l
      WHERE l.voucher_id = NEW.id
        AND NOT EXISTS (
          SELECT 1 FROM public.pv_invoice_item_details i
          WHERE i.line_item_id = l.id
        )
    ) THEN
      RAISE EXCEPTION 'Cannot submit PV: item breakdown missing for one or more invoices';
    END IF;

    -- Exact total comparison in cents; catches omitted items and stale edits
    -- to the parent invoice amount made after saving its breakdown.
    IF EXISTS (
      SELECT 1 FROM public.pv_line_items l
      JOIN public.pv_invoice_item_details i ON i.line_item_id = l.id
      WHERE l.voucher_id = NEW.id
      GROUP BY l.id, l.amount
      HAVING round(sum(i.total_amount),2) <> round(l.amount,2)
    ) THEN
      RAISE EXCEPTION 'Cannot submit PV: invoice item totals do not match invoice amounts';
    END IF;

    -- The original proof requirement is retained, including actual Storage existence.
    IF EXISTS (
      SELECT 1 FROM public.pv_line_items l
      WHERE l.voucher_id = NEW.id
        AND NOT EXISTS (
          SELECT 1 FROM public.pv_invoice_documents d
          JOIN storage.objects o
            ON o.bucket_id = 'jauhar-pv-invoices'
           AND o.name = d.storage_path
          WHERE d.voucher_id = NEW.id
            AND d.line_item_id = l.id
        )
    ) THEN
      RAISE EXCEPTION 'Cannot submit PV: upload an actual invoice PDF/image for every invoice';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jims_invoice_details_submit_guard_v1()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.jims_invoice_details_submit_guard_v1()
  IS 'Submit-time hard guard for complete invoice lines, item totals and registered private invoice proofs. Draft/Returned transitions only.';
