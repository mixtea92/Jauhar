-- JIMS 57C8A2: registered private-file lookup for AP/Accounting.
-- SECURITY DEFINER permits AP reporting across historical/archived PVs without
-- granting access to raw storage listings or relaxing underlying document RLS.
CREATE OR REPLACE FUNCTION public.jims_ap_registered_storage_object_v1(
  p_bucket text,p_name text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT public.jims_can_export_ap_history_v1() AND
  CASE
   WHEN p_bucket='jauhar-pv-invoices' THEN
     EXISTS(SELECT 1 FROM public.pv_invoice_documents d WHERE d.storage_path=p_name)
   WHEN p_bucket='jauhar-pv-jr' THEN
     EXISTS(SELECT 1 FROM public.pv_justification_reports d WHERE d.storage_path=p_name)
   WHEN p_bucket='jauhar-pv-payment-initiation' THEN
     EXISTS(SELECT 1 FROM public.pv_payment_initiation_proofs d WHERE d.storage_path=p_name)
     OR EXISTS(SELECT 1 FROM public.pv_payment_transactions t WHERE t.initiation_proof_path=p_name)
     OR EXISTS(SELECT 1 FROM public.jims_v2_payment_documents d
       WHERE d.kind='initiation' AND d.storage_path=p_name)
   WHEN p_bucket='jauhar-pv-receipts' THEN
     EXISTS(SELECT 1 FROM public.payment_vouchers v WHERE v.receipt_path=p_name)
     OR EXISTS(SELECT 1 FROM public.pv_payment_transactions t WHERE t.final_receipt_path=p_name)
     OR EXISTS(SELECT 1 FROM public.jims_v2_payment_documents d
       WHERE d.kind='final_receipt' AND d.storage_path=p_name)
   ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.jims_ap_registered_storage_object_v1(text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_ap_registered_storage_object_v1(text,text)
 TO authenticated;

DROP POLICY IF EXISTS jims_57c8_ap_report_registered_files ON storage.objects;
CREATE POLICY jims_57c8_ap_report_registered_files ON storage.objects
FOR SELECT TO authenticated USING (
  public.jims_ap_registered_storage_object_v1(bucket_id,name)
);
