-- JSYNC Cash Voucher Step 48J: receipt upload PER expense line.
-- All objects are CV-only. No changes to PV, Delegation, or original Excel template.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES (
 'jsync-cv-receipts','jsync-cv-receipts',false,10485760,
 ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cash_voucher_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 voucher_id uuid NOT NULL REFERENCES public.cash_vouchers(id) ON DELETE RESTRICT,
 line_index int NOT NULL CHECK (line_index BETWEEN 1 AND 10),
 storage_path text NOT NULL UNIQUE,
 original_file_name text NOT NULL CHECK (char_length(original_file_name) BETWEEN 1 AND 220),
 content_type text NOT NULL CHECK (content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
 row_fingerprint text NOT NULL CHECK (char_length(row_fingerprint)=32),
 uploaded_by uuid NOT NULL REFERENCES public.user_profiles(id),
 uploaded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(voucher_id,line_index)
);
CREATE INDEX IF NOT EXISTS jsync_cv_receipt_voucher_idx ON public.cash_voucher_receipts(voucher_id);
ALTER TABLE public.cash_voucher_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_voucher_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cash_voucher_receipts TO authenticated;
CREATE POLICY "jsync_cv_receipt_details_read_v1"
ON public.cash_voucher_receipts FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.cash_vouchers v WHERE v.id=voucher_id));

-- The upload path: <voucher uuid>/<line 1..10>/<unique uuid>.<allowed extension>.
-- Only AP author of a DRAFT can add a file to that CV's bucket folder.
CREATE POLICY "jsync_cv_receipt_upload_v1"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
 bucket_id='jsync-cv-receipts'
 AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(10|[1-9])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg|jpeg|webp)$'
 AND public.jsync_cv_is_finance_ap_v1(auth.uid())
 AND EXISTS(
   SELECT 1 FROM public.cash_vouchers v
   WHERE v.id::text=split_part(name,'/',1)
     AND v.created_by=auth.uid() AND v.status='draft'
 )
);
-- No UPDATE / DELETE policy: no overwriting/deleting evidence or other CVs' files.
-- Read only registered evidence and only when user may view corresponding CV.
CREATE POLICY "jsync_cv_receipt_download_v1"
ON storage.objects FOR SELECT TO authenticated
USING (
 bucket_id='jsync-cv-receipts'
 AND EXISTS(
  SELECT 1 FROM public.cash_voucher_receipts r
  WHERE r.storage_path=name
   AND EXISTS(SELECT 1 FROM public.cash_vouchers v WHERE v.id=r.voucher_id)
 )
);

CREATE OR REPLACE FUNCTION public.jsync_cv_attach_receipt_v1(
 p_voucher_id uuid,p_line_index integer,p_storage_path text,p_original_name text
)
RETURNS public.cash_voucher_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE actor uuid:=auth.uid();v public.cash_vouchers;l jsonb;o record;
rtype text; ext text; receipt public.cash_voucher_receipts; sz bigint;
BEGIN
 IF NOT public.jsync_cv_is_finance_ap_v1(actor) THEN
  RAISE EXCEPTION 'Only active AP Finance Executive may attach CV receipts' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v FROM public.cash_vouchers WHERE id=p_voucher_id FOR UPDATE;
 IF NOT FOUND OR v.status<>'draft' OR v.created_by IS DISTINCT FROM actor THEN
   RAISE EXCEPTION 'Only your Draft CV can receive receipts' USING ERRCODE='42501';
 END IF;
 IF p_line_index NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Receipt row number must be 1..10'; END IF;
 l:=v.form_data->'lines'->(p_line_index-1);
 IF l IS NULL OR jsonb_typeof(l)<>'object' THEN
   RAISE EXCEPTION 'Save the expense row before attaching its receipt';
 END IF;
 IF NOT (
   nullif(btrim(coalesce(l->>'description','')),'') IS NOT NULL OR
   nullif(btrim(coalesce(l->>'amount','')),'') IS NOT NULL
 ) THEN RAISE EXCEPTION 'Cannot attach a receipt to an empty expense row'; END IF;
 IF p_original_name IS NULL OR length(btrim(p_original_name)) NOT BETWEEN 1 AND 220 THEN
  RAISE EXCEPTION 'Invalid receipt filename'; END IF;
 IF p_storage_path IS NULL OR p_storage_path !~
  ('^'||p_voucher_id::text||'/'||p_line_index::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg|jpeg|webp)$')
 THEN RAISE EXCEPTION 'Receipt path must belong to this CV expense row'; END IF;
 SELECT metadata,owner_id INTO o FROM storage.objects
 WHERE bucket_id='jsync-cv-receipts' AND name=p_storage_path;
 IF NOT FOUND OR o.owner_id IS DISTINCT FROM actor::text THEN
  RAISE EXCEPTION 'Receipt file missing or was not uploaded by this AP' USING ERRCODE='42501';
 END IF;
 ext:=lower(substring(p_storage_path from '[.]([a-z]+)$'));
 rtype:=lower(coalesce(o.metadata->>'mimetype',''));
 IF (ext='pdf' AND rtype<>'application/pdf') OR
    (ext IN ('jpg','jpeg') AND rtype<>'image/jpeg') OR
    (ext='png' AND rtype<>'image/png') OR
    (ext='webp' AND rtype<>'image/webp') THEN
    RAISE EXCEPTION 'Receipt type does not match uploaded file extension';
 END IF;
 IF coalesce(o.metadata->>'size','') !~ '^[0-9]+$' THEN
  RAISE EXCEPTION 'Receipt size metadata is missing';
 END IF;
 sz:=(o.metadata->>'size')::bigint;
 IF sz<1 OR sz>10485760 THEN RAISE EXCEPTION 'Receipt must be between 1 byte and 10 MB'; END IF;
 INSERT INTO public.cash_voucher_receipts(
  voucher_id,line_index,storage_path,original_file_name,content_type,
  row_fingerprint,uploaded_by
 )
 VALUES(
  v.id,p_line_index,p_storage_path,btrim(p_original_name),rtype,
  md5((l-'receipt_attached')::text),actor
 )
 ON CONFLICT (voucher_id,line_index) DO UPDATE SET
  storage_path=EXCLUDED.storage_path,
  original_file_name=EXCLUDED.original_file_name,
  content_type=EXCLUDED.content_type,
  row_fingerprint=EXCLUDED.row_fingerprint,
  uploaded_by=EXCLUDED.uploaded_by,
  uploaded_at=now()
 RETURNING * INTO receipt;
 UPDATE public.cash_vouchers
 SET form_data=jsonb_set(form_data,
     ARRAY['lines',(p_line_index-1)::text,'receipt_attached'],
     to_jsonb('Yes'::text),true),
     updated_at=now()
 WHERE id=v.id;
 INSERT INTO public.cash_voucher_audit_events(voucher_id,actor_id,action,details)
 VALUES(v.id,actor,'receipt_uploaded',
  jsonb_build_object('row',p_line_index,'filename',btrim(p_original_name)));
 RETURN receipt;
END $f$;

CREATE OR REPLACE FUNCTION public.jsync_cv_require_receipts_v1(p_voucher_id uuid,p_form jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE l jsonb; idx integer:=0;
BEGIN
 FOR l IN SELECT e.value FROM jsonb_array_elements(coalesce(p_form->'lines','[]'::jsonb)) AS e(value) LOOP
  idx:=idx+1;
  IF coalesce(l->>'receipt_attached','')<>'Yes' THEN
   RAISE EXCEPTION 'Receipt Attached? must be Yes for expense row %',idx;
  END IF;
  IF NOT EXISTS (
   SELECT 1 FROM public.cash_voucher_receipts r
    JOIN storage.objects o ON o.bucket_id='jsync-cv-receipts' AND o.name=r.storage_path
   WHERE r.voucher_id=p_voucher_id AND r.line_index=idx
    AND r.row_fingerprint=md5((l-'receipt_attached')::text)
  ) THEN
   RAISE EXCEPTION 'Upload a matching JPG, PNG, WEBP or PDF receipt for expense row % before Submit',idx;
  END IF;
 END LOOP;
END $f$;

-- Patch the existing CV-only submit RPC, leaving its existing validations intact.
DO $do$
DECLARE s text;
 old text:=' PERFORM public.jsync_cv_validate_template_values_v1(f);';
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO s FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='jsync_cv_submit_v1';
 IF s IS NULL OR length(s)-length(replace(s,old,''))<>length(old) THEN
  RAISE EXCEPTION 'CV Submit RPC has changed; do not apply receipt requirement blindly';
 END IF;
 s:=replace(s,old,old||E'\n PERFORM public.jsync_cv_require_receipts_v1(v.id,f);');
 EXECUTE rtrim(s,';')||';';
END $do$;

REVOKE ALL ON FUNCTION public.jsync_cv_attach_receipt_v1(uuid,integer,text,text),
 public.jsync_cv_require_receipts_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jsync_cv_attach_receipt_v1(uuid,integer,text,text) TO authenticated;
