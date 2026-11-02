-- UAT-FIX-09 A: a new private bucket and immutable audit-linked evidence table.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('jauhar-pv-due-evidence','jauhar-pv-due-evidence',false,5242880,
ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS private.jims_57d8_due_evidence_v1(
 audit_id bigint PRIMARY KEY REFERENCES private.jims_57d3_audit_v1(id) ON DELETE RESTRICT,
 voucher_id uuid NOT NULL REFERENCES public.payment_vouchers(id),
 evidence_source text NOT NULL CHECK(evidence_source IN ('invoice','upload')),
 invoice_document_id uuid REFERENCES public.pv_invoice_documents(id) ON DELETE RESTRICT,
 storage_path text,
 supplier_reference text,
 recorded_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT jims_due_evidence_source_pair CHECK
 ((evidence_source='invoice' AND invoice_document_id IS NOT NULL AND storage_path IS NULL)
 OR (evidence_source='upload' AND storage_path IS NOT NULL AND invoice_document_id IS NULL))
);
CREATE INDEX IF NOT EXISTS jims_due_evidence_voucher_idx
ON private.jims_57d8_due_evidence_v1(voucher_id);
ALTER TABLE private.jims_57d8_due_evidence_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.jims_57d8_due_evidence_v1 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.jims_57d8_can_read_due_file_v1(p_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE usr public.user_profiles;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 SELECT * INTO usr FROM public.user_profiles WHERE id=auth.uid() AND is_active IS TRUE;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN EXISTS(
  SELECT 1 FROM private.jims_57d8_due_evidence_v1 e
  JOIN public.payment_vouchers v ON v.id=e.voucher_id
  WHERE e.storage_path=p_path AND v.archived_at IS NULL
   AND ((usr.role='manager' AND usr.department='Finance')
   OR usr.role IN ('ceo','bod','system_admin')
   OR (usr.role='executive' AND usr.department='Finance'
       AND usr.subdepartment='Accounts Payable' AND v.created_by=auth.uid()))
 );
END
$fn$;
REVOKE ALL ON FUNCTION private.jims_57d8_can_read_due_file_v1(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.jims_57d8_can_read_due_file_v1(text) TO authenticated;

CREATE POLICY "jims_due_evidence_fm_insert" ON storage.objects
FOR INSERT TO authenticated WITH CHECK(
 bucket_id='jauhar-pv-due-evidence'
 AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg|webp)$'
 AND split_part(name,'/',2)=(select auth.uid())::text
 AND EXISTS(SELECT 1 FROM public.payment_vouchers v
 JOIN public.user_profiles p ON p.id=(select auth.uid())
 WHERE v.id::text=split_part(name,'/',1)
 AND v.status='pending_finance_manager' AND v.archived_at IS NULL
 AND p.role='manager' AND p.department='Finance' AND p.is_active IS TRUE)
);
CREATE POLICY "jims_due_evidence_authorized_read" ON storage.objects
FOR SELECT TO authenticated USING (
 bucket_id='jauhar-pv-due-evidence'
 AND private.jims_57d8_can_read_due_file_v1(name)
);
