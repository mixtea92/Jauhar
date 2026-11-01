-- 57D7C7-T2-C: Finance-only, read-only invoice detail report dataset.
-- Returns three arrays for ExcelJS. Source data is *only* existing PV and
-- invoice-item records; no invented invoice dates, items or document links.
CREATE OR REPLACE FUNCTION public.jims_invoice_details_report_v1(
  p_pv_number text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_branch text DEFAULT NULL,
  p_tier text DEFAULT NULL,
  p_payment_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = v_actor AND p.is_active = true
      AND p.department = 'Finance'
      AND p.role IN ('executive','manager')
      AND p.subdepartment IN ('Accounts Payable','Accounting')
  ) THEN
    RAISE EXCEPTION 'Invoice Details Report is restricted to authorised Finance staff';
  END IF;

  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL
     AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Invalid report date range';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.pv_line_items l
  JOIN public.payment_vouchers v ON v.id = l.voucher_id
  WHERE (p_pv_number IS NULL OR v.pv_number ILIKE '%' || p_pv_number || '%')
    AND (p_date_from IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date >= p_date_from)
    AND (p_date_to IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date <= p_date_to)
    AND (p_branch IS NULL OR v.branch_department = p_branch)
    AND (p_tier IS NULL OR v.financial_tier = p_tier)
    AND (p_payment_status IS NULL OR v.payment_status = p_payment_status);

  IF v_count > 2500 THEN
    RAISE EXCEPTION 'More than 2500 invoices match. Please narrow the report filters.';
  END IF;

  WITH invoices AS (
    SELECT
      v.id AS voucher_id,
      v.pv_number,
      v.created_at AS pv_created_at,
      v.financial_tier,
      v.status AS pv_status,
      v.payment_status,
      v.branch_department AS branch,
      v.origin_department AS department,
      creator.subdepartment,
      creator.cost_center,
      v.payee_name AS supplier,
      l.id AS line_item_id,
      l.line_no,
      l.invoice_reference AS invoice_no,
      l.description AS invoice_description,
      l.gl_code AS invoice_gl_code,
      l.amount AS invoice_amount,
      d.storage_path AS proof_storage_path,
      d.created_at AS proof_uploaded_at,
      (o.name IS NOT NULL) AS proof_exists
    FROM public.pv_line_items l
    JOIN public.payment_vouchers v ON v.id = l.voucher_id
    LEFT JOIN public.user_profiles creator ON creator.id = v.created_by
    LEFT JOIN public.pv_invoice_documents d ON d.line_item_id = l.id
    LEFT JOIN storage.objects o
      ON o.bucket_id = 'jauhar-pv-invoices' AND o.name = d.storage_path
    WHERE (p_pv_number IS NULL OR v.pv_number ILIKE '%' || p_pv_number || '%')
      AND (p_date_from IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date >= p_date_from)
      AND (p_date_to IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date <= p_date_to)
      AND (p_branch IS NULL OR v.branch_department = p_branch)
      AND (p_tier IS NULL OR v.financial_tier = p_tier)
      AND (p_payment_status IS NULL OR v.payment_status = p_payment_status)
  ),
  item_totals AS (
    SELECT i.line_item_id,
           count(*) AS item_count,
           sum(i.total_amount) AS breakdown_total
    FROM public.pv_invoice_item_details i
    JOIN invoices s ON s.line_item_id = i.line_item_id
    GROUP BY i.line_item_id
  )
  SELECT jsonb_build_object(
    'invoice_summary',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pv_number', s.pv_number,
        'invoice_no', s.invoice_no,
        'supplier', s.supplier,
        'invoice_description', s.invoice_description,
        'invoice_gl_code', s.invoice_gl_code,
        'invoice_amount', s.invoice_amount,
        'item_count', COALESCE(t.item_count, 0),
        'breakdown_total', t.breakdown_total,
        'branch', s.branch,
        'department', s.department,
        'subdepartment', s.subdepartment,
        'cost_center', s.cost_center,
        'financial_tier', s.financial_tier,
        'pv_status', s.pv_status,
        'payment_status', s.payment_status,
        'pv_created_at', s.pv_created_at,
        'proof_exists', s.proof_exists
      ) ORDER BY s.pv_created_at, s.pv_number, s.line_no)
      FROM invoices s LEFT JOIN item_totals t USING (line_item_id)
    ), '[]'::jsonb),

    'invoice_item_details',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pv_number', s.pv_number,
        'invoice_no', s.invoice_no,
        'supplier', s.supplier,
        'invoice_description', s.invoice_description,
        'invoice_amount', s.invoice_amount,
        'item_no', i.item_no,
        'item_description', i.item_description,
        'category', i.category,
        'quantity', i.quantity,
        'unit_price', i.unit_price,
        'total_amount', i.total_amount,
        'gl_code', COALESCE(i.gl_code, s.invoice_gl_code),
        'branch', s.branch,
        'department', s.department,
        'subdepartment', s.subdepartment,
        'cost_center', s.cost_center,
        'pv_status', s.pv_status,
        'payment_status', s.payment_status,
        'pv_created_at', s.pv_created_at
      ) ORDER BY s.pv_created_at, s.pv_number, s.line_no, i.item_no)
      FROM invoices s LEFT JOIN public.pv_invoice_item_details i
        ON i.line_item_id = s.line_item_id
    ), '[]'::jsonb),

    'invoice_proof_register',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pv_number', s.pv_number,
        'invoice_no', s.invoice_no,
        'supplier', s.supplier,
        'branch', s.branch,
        'invoice_amount', s.invoice_amount,
        'proof_status',
          CASE WHEN s.proof_exists THEN 'Uploaded'
               WHEN s.proof_storage_path IS NOT NULL THEN 'Missing in Storage'
               ELSE 'Not Uploaded' END,
        'proof_storage_path', s.proof_storage_path,
        'proof_uploaded_at', s.proof_uploaded_at,
        'pv_created_at', s.pv_created_at
      ) ORDER BY s.pv_created_at, s.pv_number, s.line_no)
      FROM invoices s
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jims_invoice_details_report_v1(
  text,date,date,text,text,text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jims_invoice_details_report_v1(
  text,date,date,text,text,text
) TO authenticated;
