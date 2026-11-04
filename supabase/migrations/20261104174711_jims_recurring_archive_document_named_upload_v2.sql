
CREATE TABLE private.jims_recurring_support_docs_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_name text NOT NULL CHECK(length(btrim(document_name)) BETWEEN 3 AND 120),
 original_filename text NOT NULL CHECK(length(btrim(original_filename)) BETWEEN 1 AND 200),
 supplier_name text NOT NULL DEFAULT '',
 branch_code text CHECK(branch_code IS NULL OR branch_code IN ('GP','KM','PM','TD')),
 effective_from date,
 effective_to date,
 file_extension text NOT NULL CHECK(file_extension IN ('pdf','png','jpg','jpeg','webp')),
 storage_path text NOT NULL UNIQUE,
 uploaded_by uuid NOT NULL REFERENCES public.user_profiles(id),
 prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 confirmed_at timestamptz,
 is_active boolean NOT NULL DEFAULT true,
 CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to>=effective_from)
);
ALTER TABLE private.jims_recurring_support_docs_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.jims_recurring_support_docs_v1 FROM PUBLIC,anon,authenticated;
ALTER TABLE private.jims_recurring_instructions_v1
 ADD COLUMN document_requirement text NOT NULL DEFAULT 'monthly_invoice'
 CHECK(document_requirement IN ('monthly_invoice','recurring_supporting')),
 ADD COLUMN supporting_document_id uuid REFERENCES private.jims_recurring_support_docs_v1(id),
 ADD COLUMN pv_preset jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE private.jims_recurring_ap_tasks_v1
 ADD COLUMN document_requirement text NOT NULL DEFAULT 'monthly_invoice'
 CHECK(document_requirement IN ('monthly_invoice','recurring_supporting')),
 ADD COLUMN supporting_document_id uuid REFERENCES private.jims_recurring_support_docs_v1(id);
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('jauhar-recurring-supporting','jauhar-recurring-supporting',false,10485760,
 ARRAY['application/pdf','image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.jims_recurring_document_prepare_v1(
 p_name text,p_original_filename text,p_supplier text,p_branch text,
 p_from date,p_to date,p_ext text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_id uuid:=gen_random_uuid();v_ext text:=lower(btrim(coalesce(p_ext,'')));
v_name text:=btrim(coalesce(p_name,''));v_origin text:=btrim(coalesce(p_original_filename,''));
v_path text;
BEGIN
 IF NOT public.jims_recurring_is_fm_v1() THEN RAISE EXCEPTION 'Finance Manager only' USING ERRCODE='42501';END IF;
 IF length(v_name) NOT BETWEEN 3 AND 120 OR length(v_origin) NOT BETWEEN 1 AND 200
 OR v_ext NOT IN('pdf','png','jpg','jpeg','webp')
 OR (p_branch IS NOT NULL AND p_branch NOT IN ('GP','KM','PM','TD'))
 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_to<p_from)
 OR length(btrim(coalesce(p_supplier,'')))>150
 THEN RAISE EXCEPTION 'Document name, file or dates invalid' USING ERRCODE='22023';END IF;
 v_path:=auth.uid()::text||'/'||v_id::text||'.'||v_ext;
 INSERT INTO private.jims_recurring_support_docs_v1
 (id,document_name,original_filename,supplier_name,branch_code,effective_from,effective_to,
 file_extension,storage_path,uploaded_by)
 VALUES(v_id,v_name,v_origin,btrim(coalesce(p_supplier,'')),p_branch,p_from,p_to,
 v_ext,v_path,auth.uid());
 RETURN jsonb_build_object('id',v_id,'path',v_path);
END;$fn$;
CREATE OR REPLACE FUNCTION public.jims_recurring_document_confirm_v1(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_doc private.jims_recurring_support_docs_v1;
BEGIN
 IF NOT public.jims_recurring_is_fm_v1() THEN RAISE EXCEPTION 'Finance Manager only' USING ERRCODE='42501';END IF;
 SELECT * INTO v_doc FROM private.jims_recurring_support_docs_v1
 WHERE id=p_id AND uploaded_by=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document not prepared for this FM' USING ERRCODE='22023';END IF;
 IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='jauhar-recurring-supporting'
 AND name=v_doc.storage_path) THEN
 RAISE EXCEPTION 'File was not uploaded to private storage' USING ERRCODE='22023';END IF;
 IF v_doc.confirmed_at IS NULL THEN
  UPDATE private.jims_recurring_support_docs_v1 SET confirmed_at=clock_timestamp() WHERE id=p_id;
  INSERT INTO private.jims_recurring_audit_v1(actor_id,entity_type,entity_id,action,payload)
  VALUES(auth.uid(),'supporting_document',p_id,'uploaded',
   jsonb_build_object('name',v_doc.document_name,'original_filename',v_doc.original_filename,
    'storage_path',v_doc.storage_path));
 END IF;
 RETURN p_id;
END;$fn$;

CREATE OR REPLACE FUNCTION private.jims_recurring_can_read_doc_v1(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT EXISTS(SELECT 1 FROM private.jims_recurring_support_docs_v1 d
 JOIN public.user_profiles p ON p.id=auth.uid()
 WHERE d.id=p_id AND d.confirmed_at IS NOT NULL AND d.is_active AND p.is_active
 AND ((p.role='manager' AND p.department='Finance')
 OR p.role IN ('ceo','bod','system_admin')
 OR (p.role='executive' AND p.department='Finance' AND p.subdepartment='Accounts Payable'
  AND EXISTS(SELECT 1 FROM private.jims_recurring_ap_tasks_v1 t
  WHERE t.assigned_ap_id=p.id AND t.supporting_document_id=d.id))));
$fn$;
CREATE OR REPLACE FUNCTION public.jims_recurring_storage_doc_access_v1(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT EXISTS(SELECT 1 FROM private.jims_recurring_support_docs_v1 d
 WHERE d.storage_path=p_path AND private.jims_recurring_can_read_doc_v1(d.id));
$fn$;
CREATE POLICY jims_recurring_supporting_fm_upload_v1 ON storage.objects
 FOR INSERT TO authenticated
 WITH CHECK(bucket_id='jauhar-recurring-supporting' AND
 EXISTS(SELECT 1 FROM private.jims_recurring_support_docs_v1 d
 WHERE d.storage_path=name AND d.uploaded_by=auth.uid()
 AND d.confirmed_at IS NULL AND public.jims_recurring_is_fm_v1()));
CREATE POLICY jims_recurring_supporting_read_v1 ON storage.objects
 FOR SELECT TO authenticated USING(bucket_id='jauhar-recurring-supporting'
 AND public.jims_recurring_storage_doc_access_v1(name));

CREATE OR REPLACE FUNCTION public.jims_recurring_documents_list_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
 SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.is_active AND
 ((p.role='manager' AND p.department='Finance') OR p.role IN('ceo','bod','system_admin')
 OR (p.role='executive' AND p.department='Finance' AND p.subdepartment='Accounts Payable')))
 THEN RAISE EXCEPTION 'Recurring document access denied' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM private.jims_recurring_support_docs_v1)>1000 THEN
 RAISE EXCEPTION 'Document list exceeds safe limit' USING ERRCODE='54000';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',d.id,'document_name',d.document_name,'original_filename',d.original_filename,
  'supplier_name',d.supplier_name,'branch_code',d.branch_code,
  'effective_from',d.effective_from,'effective_to',d.effective_to,
  'storage_path',d.storage_path,'confirmed_at',d.confirmed_at,
  'uploaded_by',d.uploaded_by) ORDER BY d.confirmed_at DESC),'[]'::jsonb)
 INTO v_rows FROM private.jims_recurring_support_docs_v1 d
 WHERE private.jims_recurring_can_read_doc_v1(d.id);
 RETURN jsonb_build_object('documents',v_rows,'category','Recurring Payment Supporting Documents');
END;$fn$;
REVOKE ALL ON FUNCTION public.jims_recurring_document_prepare_v1(text,text,text,text,date,date,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_document_confirm_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_documents_list_v1() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_storage_doc_access_v1(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_recurring_document_prepare_v1(text,text,text,text,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_document_confirm_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_documents_list_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_storage_doc_access_v1(text) TO authenticated;