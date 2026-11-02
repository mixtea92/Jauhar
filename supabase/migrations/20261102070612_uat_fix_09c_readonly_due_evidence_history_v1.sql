-- UAT-FIX-09C: read-only evidence history, same authorisation as existing PV Planning read.
CREATE OR REPLACE FUNCTION public.jims_57d8_due_evidence_history_v1(p_voucher_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
 PERFORM public.jims_57d8_read_payment_dates_v1(p_voucher_id);
 RETURN COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
   'audit_id',e.audit_id,'evidence_source',e.evidence_source,
   'invoice_document_id',e.invoice_document_id,'storage_path',e.storage_path,
   'supplier_reference',e.supplier_reference,'old_due_date',a.old_value,
   'new_due_date',a.new_value,'recorded_at',a.created_at
  ) ORDER BY a.id)
  FROM private.jims_57d8_due_evidence_v1 e
  JOIN private.jims_57d3_audit_v1 a ON a.id=e.audit_id
  WHERE e.voucher_id=p_voucher_id
 ),'[]'::jsonb);
END
$fn$;
REVOKE ALL ON FUNCTION public.jims_57d8_due_evidence_history_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_57d8_due_evidence_history_v1(uuid) TO authenticated;
