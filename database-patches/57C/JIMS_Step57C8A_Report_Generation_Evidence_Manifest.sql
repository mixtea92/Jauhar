-- JIMS STEP57C8A — AP/Accounting Report Generation supporting documents.
-- No approval history exposure. Never change PV/payment/PC decisions.
-- Actual binary attachments remain in existing PRIVATE Supabase Storage buckets.
-- Offline JR meeting has reference/date records, NOT an uploaded minutes PDF.
CREATE OR REPLACE FUNCTION public.jims_ap_report_document_manifest_v1(
  p_pv_number text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_branch text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $jims57c8$
DECLARE v_files jsonb; v_meetings jsonb; v_total integer;
BEGIN
 IF NOT public.jims_can_export_ap_history_v1() THEN
   RAISE EXCEPTION 'Only assigned AP or Accounting may export AP supporting documents' USING ERRCODE='42501';
 END IF;
 IF length(coalesce(p_pv_number,''))>80 OR length(coalesce(p_branch,''))>80
    OR (p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from>p_date_to) THEN
   RAISE EXCEPTION 'Invalid report filters' USING ERRCODE='22023';
 END IF;

 WITH pv AS MATERIALIZED (
   SELECT v.id,v.pv_number,v.financial_tier,v.created_at,
     v.status,v.payment_status,
     coalesce(m.branch_code,v.branch_department) branch
   FROM public.payment_vouchers v
   LEFT JOIN private.jims_financial_metadata_v1 m
     ON m.source_type='payment_voucher' AND m.source_id=v.id
   WHERE (p_pv_number IS NULL OR p_pv_number='' OR v.pv_number ILIKE '%'||replace(replace(p_pv_number,'%','\%'),'_','\_')||'%' ESCAPE '\')
     AND (p_date_from IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date>=p_date_from)
     AND (p_date_to IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date<=p_date_to)
     AND (p_branch IS NULL OR p_branch='' OR coalesce(m.branch_code,v.branch_department)=p_branch)
 ), uploads AS (
   SELECT v.*, 'invoice'::text kind, 'jauhar-pv-invoices'::text bucket,
          d.storage_path, split_part(d.storage_path,'/',3) original_name, d.created_at file_at
   FROM pv v JOIN public.pv_invoice_documents d ON d.voucher_id=v.id
   UNION ALL
   SELECT v.*,'jr_pdf','jauhar-pv-jr',d.storage_path,d.original_filename,d.created_at
   FROM pv v JOIN public.pv_justification_reports d ON d.voucher_id=v.id
   UNION ALL
   SELECT v.*,'initiation_proof','jauhar-pv-payment-initiation',
       d.storage_path,d.original_filename,d.created_at
   FROM pv v JOIN public.pv_payment_initiation_proofs d ON d.voucher_id=v.id
   UNION ALL
   SELECT v.*,'final_receipt','jauhar-pv-receipts',
       v2.receipt_path,split_part(v2.receipt_path,'/',2),v2.created_at
   FROM pv v JOIN public.payment_vouchers v2 ON v2.id=v.id
   WHERE nullif(v2.receipt_path,'') IS NOT NULL
   UNION ALL
   SELECT v.*,'initiation_proof','jauhar-pv-payment-initiation',
          t.initiation_proof_path,split_part(t.initiation_proof_path,'/',2),t.created_at
   FROM pv v JOIN public.pv_payment_transactions t ON t.voucher_id=v.id
   WHERE nullif(t.initiation_proof_path,'') IS NOT NULL
   UNION ALL
   SELECT v.*,'final_receipt','jauhar-pv-receipts',
          t.final_receipt_path,split_part(t.final_receipt_path,'/',2),t.created_at
   FROM pv v JOIN public.pv_payment_transactions t ON t.voucher_id=v.id
   WHERE nullif(t.final_receipt_path,'') IS NOT NULL
   UNION ALL
   SELECT v.*,CASE WHEN d.kind='initiation' THEN 'initiation_proof' ELSE 'final_receipt' END,
     CASE WHEN d.kind='initiation' THEN 'jauhar-pv-payment-initiation' ELSE 'jauhar-pv-receipts' END,
     d.storage_path,split_part(d.storage_path,'/',2),d.created_at
   FROM pv v JOIN public.jims_v2_payment_documents d ON d.voucher_id=v.id
   WHERE d.kind IN ('initiation','final_receipt')
 ), unique_uploads AS (
   SELECT DISTINCT ON (bucket,storage_path)
      voucher_number,kind,bucket,storage_path,original_name,file_at,
      financial_tier,created_at,status,payment_status,branch
   FROM (SELECT pv_number voucher_number,kind,bucket,storage_path,original_name,file_at,
                financial_tier,created_at,status,payment_status,branch
         FROM uploads WHERE nullif(storage_path,'') IS NOT NULL) a
   ORDER BY bucket,storage_path,file_at DESC
 ), with_storage AS (
   SELECT u.*,o.id IS NOT NULL as exists_in_storage,
          coalesce((o.metadata->>'size')::bigint,0) size_bytes
   FROM unique_uploads u
   LEFT JOIN storage.objects o ON o.bucket_id=u.bucket AND o.name=u.storage_path
 )
 SELECT count(*) INTO v_total FROM with_storage;
 IF v_total>5000 THEN RAISE EXCEPTION 'Too many supporting documents. Apply tighter report filters' USING ERRCODE='54000'; END IF;

 -- Repeat scoped query in a single statement to avoid leaking duplicate rows.
 WITH pv AS MATERIALIZED (
   SELECT v.id,v.pv_number,v.financial_tier,v.created_at,v.status,v.payment_status,
      coalesce(m.branch_code,v.branch_department) branch
   FROM public.payment_vouchers v
   LEFT JOIN private.jims_financial_metadata_v1 m ON m.source_type='payment_voucher' AND m.source_id=v.id
   WHERE (p_pv_number IS NULL OR p_pv_number='' OR v.pv_number ILIKE '%'||replace(replace(p_pv_number,'%','\%'),'_','\_')||'%' ESCAPE '\')
     AND (p_date_from IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date>=p_date_from)
     AND (p_date_to IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date<=p_date_to)
     AND (p_branch IS NULL OR p_branch='' OR coalesce(m.branch_code,v.branch_department)=p_branch)
 ), docs AS (
 SELECT pv_number,financial_tier,created_at,status,payment_status,branch,
   'invoice'::text kind,'jauhar-pv-invoices'::text bucket,
   d.storage_path,split_part(d.storage_path,'/',3) original_name
 FROM pv JOIN public.pv_invoice_documents d ON d.voucher_id=pv.id
 UNION ALL
 SELECT pv_number,financial_tier,created_at,status,payment_status,branch,
  'jr_pdf','jauhar-pv-jr',d.storage_path,d.original_filename
 FROM pv JOIN public.pv_justification_reports d ON d.voucher_id=pv.id
 UNION ALL
 SELECT pv_number,financial_tier,created_at,status,payment_status,branch,
  'initiation_proof','jauhar-pv-payment-initiation',d.storage_path,d.original_filename
 FROM pv JOIN public.pv_payment_initiation_proofs d ON d.voucher_id=pv.id
 UNION ALL
 SELECT pv_number,financial_tier,created_at,status,payment_status,branch,
  'final_receipt','jauhar-pv-receipts',p.receipt_path,split_part(p.receipt_path,'/',2)
 FROM pv JOIN public.payment_vouchers p ON p.id=pv.id WHERE nullif(p.receipt_path,'') IS NOT NULL
 UNION ALL
 SELECT pv_number,financial_tier,created_at,status,payment_status,branch,
  'initiation_proof','jauhar-pv-payment-initiation',t.initiation_proof_path,
  split_part(t.initiation_proof_path,'/',2)
 FROM pv JOIN public.pv_payment_transactions t ON t.voucher_id=pv.id
 WHERE nullif(t.initiation_proof_path,'') IS NOT NULL
 UNION ALL
 SELECT pv_number,financial_tier,created_at,status,payment_status,branch,
  'final_receipt','jauhar-pv-receipts',t.final_receipt_path,
  split_part(t.final_receipt_path,'/',2)
 FROM pv JOIN public.pv_payment_transactions t ON t.voucher_id=pv.id
 WHERE nullif(t.final_receipt_path,'') IS NOT NULL
 UNION ALL
 SELECT pv_number,financial_tier,created_at,status,payment_status,branch,
  CASE WHEN d.kind='initiation' THEN 'initiation_proof' ELSE 'final_receipt' END,
  CASE WHEN d.kind='initiation' THEN 'jauhar-pv-payment-initiation' ELSE 'jauhar-pv-receipts' END,
  d.storage_path,split_part(d.storage_path,'/',2)
 FROM pv JOIN public.jims_v2_payment_documents d ON d.voucher_id=pv.id
 WHERE d.kind IN ('initiation','final_receipt')
 ), unique_docs AS (
 SELECT DISTINCT ON (bucket,storage_path)
   pv_number,financial_tier,created_at,status,payment_status,branch,
   kind,bucket,storage_path,original_name
 FROM docs WHERE nullif(storage_path,'') IS NOT NULL
 ORDER BY bucket,storage_path,pv_number
 )
 SELECT coalesce(jsonb_agg(
    jsonb_build_object('pv_number',u.pv_number,'tier',u.financial_tier,
      'branch',u.branch,'status',u.status,'payment_status',u.payment_status,
      'pv_created_at',u.created_at,'kind',u.kind,'bucket',u.bucket,
      'storage_path',u.storage_path,'filename',u.original_name,
      'exists_in_storage',o.id IS NOT NULL,
      'size_bytes',coalesce((o.metadata->>'size')::bigint,0)
    ) ORDER BY u.pv_number,u.kind,u.storage_path
   ),'[]'::jsonb)
 INTO v_files FROM unique_docs u
 LEFT JOIN storage.objects o ON o.bucket_id=u.bucket AND o.name=u.storage_path;

 WITH scoped_pv AS (
   SELECT v.id,v.pv_number,v.financial_tier,v.created_at,
      coalesce(m.branch_code,v.branch_department) branch
   FROM public.payment_vouchers v
   LEFT JOIN private.jims_financial_metadata_v1 m ON m.source_type='payment_voucher' AND m.source_id=v.id
   WHERE (p_pv_number IS NULL OR p_pv_number='' OR v.pv_number ILIKE '%'||replace(replace(p_pv_number,'%','\%'),'_','\_')||'%' ESCAPE '\')
     AND (p_date_from IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date>=p_date_from)
     AND (p_date_to IS NULL OR (v.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date<=p_date_to)
     AND (p_branch IS NULL OR p_branch='' OR coalesce(m.branch_code,v.branch_department)=p_branch)
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
    'pv_number',v.pv_number,'tier',v.financial_tier,'branch',v.branch,
    'pv_created_at',v.created_at,'approval_round',r.approval_round,
    'decision_tier',r.decision_tier,'meeting_reference',r.meeting_reference,
    'meeting_date',r.meeting_date,'jr_document_id',r.jr_document_id,
    'recorded_at',r.created_at
 ) ORDER BY v.pv_number,r.created_at),'[]'::jsonb)
 INTO v_meetings FROM scoped_pv v JOIN public.pv_jr_meeting_records r ON r.voucher_id=v.id;

 RETURN jsonb_build_object('files',v_files,'meeting_records',v_meetings,
    'generated_at',clock_timestamp());
END;
$jims57c8$;

REVOKE ALL ON FUNCTION public.jims_ap_report_document_manifest_v1(text,date,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_ap_report_document_manifest_v1(text,date,date,text) TO authenticated;

-- AP/Accounting may download registered private file bytes.
-- No public URLs or bucket-wide reads; AR and unaffiliated staff excluded.
DROP POLICY IF EXISTS jims_57c8_ap_report_registered_files ON storage.objects;
CREATE POLICY jims_57c8_ap_report_registered_files ON storage.objects
FOR SELECT TO authenticated USING (
  public.jims_can_export_ap_history_v1() AND (
   (bucket_id='jauhar-pv-invoices' AND EXISTS(
      SELECT 1 FROM public.pv_invoice_documents d WHERE d.storage_path=name))
   OR (bucket_id='jauhar-pv-jr' AND EXISTS(
      SELECT 1 FROM public.pv_justification_reports d WHERE d.storage_path=name))
   OR (bucket_id='jauhar-pv-payment-initiation' AND (
      EXISTS(SELECT 1 FROM public.pv_payment_initiation_proofs d WHERE d.storage_path=name)
      OR EXISTS(SELECT 1 FROM public.pv_payment_transactions t WHERE t.initiation_proof_path=name)
      OR EXISTS(SELECT 1 FROM public.jims_v2_payment_documents d WHERE d.kind='initiation' AND d.storage_path=name)))
   OR (bucket_id='jauhar-pv-receipts' AND (
      EXISTS(SELECT 1 FROM public.payment_vouchers v WHERE v.receipt_path=name)
      OR EXISTS(SELECT 1 FROM public.pv_payment_transactions t WHERE t.final_receipt_path=name)
      OR EXISTS(SELECT 1 FROM public.jims_v2_payment_documents d WHERE d.kind='final_receipt' AND d.storage_path=name)))
  )
);

-- Classified non-AP Finance must not use old permissive storage policies
-- to read AP files outside current-stage FM verification.
DROP POLICY IF EXISTS jims_57c8_ar_ap_storage_guard ON storage.objects;
CREATE POLICY jims_57c8_ar_ap_storage_guard ON storage.objects
AS RESTRICTIVE FOR SELECT TO authenticated USING(
  bucket_id NOT IN ('jauhar-pv-invoices','jauhar-pv-jr',
                    'jauhar-pv-payment-initiation','jauhar-pv-receipts','jsync-cv-receipts')
  OR NOT public.jims_finance_non_ap_user_v1()
  OR (public.jims_finance_non_ap_fm_v1() AND (
     (bucket_id='jsync-cv-receipts' AND EXISTS(
       SELECT 1 FROM public.cash_voucher_receipts cr
       JOIN public.cash_vouchers cv ON cv.id=cr.voucher_id
       WHERE cr.storage_path=name AND cv.status='pending_approval'))
     OR (bucket_id<>'jsync-cv-receipts' AND EXISTS(
       SELECT 1 FROM public.payment_vouchers v
       WHERE v.status IN ('pending_finance_manager','pending_manager')
         AND (v.id::text)=split_part(name,'/',1)
     ))
  ))
);
