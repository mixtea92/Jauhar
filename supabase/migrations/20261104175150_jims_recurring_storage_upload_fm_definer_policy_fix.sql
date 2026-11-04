
CREATE OR REPLACE FUNCTION public.jims_recurring_storage_can_upload_v1(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT public.jims_recurring_is_fm_v1() AND EXISTS(
  SELECT 1 FROM private.jims_recurring_support_docs_v1 d
  WHERE d.storage_path=p_path AND d.uploaded_by=auth.uid()
   AND d.confirmed_at IS NULL
 );
$fn$;
REVOKE ALL ON FUNCTION public.jims_recurring_storage_can_upload_v1(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_recurring_storage_can_upload_v1(text) TO authenticated;
DROP POLICY IF EXISTS jims_recurring_supporting_fm_upload_v1 ON storage.objects;
CREATE POLICY jims_recurring_supporting_fm_upload_v1 ON storage.objects
FOR INSERT TO authenticated
WITH CHECK(bucket_id='jauhar-recurring-supporting'
 AND public.jims_recurring_storage_can_upload_v1(name));
