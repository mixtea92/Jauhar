-- UAT-FIX-09B: verification helper; existing FM decision and PV approval flows unchanged.
CREATE OR REPLACE FUNCTION private.jims_57d8_verify_due_evidence_v1(p_voucher_id uuid,p_reference text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE j jsonb;src text;d uuid;path text;external_ref text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 BEGIN j:=p_reference::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'Select an actual invoice or uploaded document; text reference alone is insufficient';
 END;
 IF jsonb_typeof(j)<>'object' THEN RAISE EXCEPTION 'Verified evidence object required'; END IF;
 src:=j->>'source';
 external_ref:=nullif(btrim(coalesce(j->>'reference','')),'');
 IF length(coalesce(external_ref,''))>200 THEN RAISE EXCEPTION 'Supplier reference too long'; END IF;
 IF src='invoice' THEN
  SELECT id INTO d FROM public.pv_invoice_documents
  WHERE id=(j->>'invoice_document_id')::uuid AND voucher_id=p_voucher_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice evidence must be attached to the same PV'; END IF;
  RETURN jsonb_build_object('source','invoice','invoice_document_id',d,'reference',external_ref)::text;
 ELSIF src='upload' THEN
  path:=j->>'storage_path';
  IF path IS NULL OR path !~* ('^'||p_voucher_id::text||'/'||auth.uid()::text||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg|webp)$')
  THEN RAISE EXCEPTION 'Evidence path must be within the authorised PV private folder'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='jauhar-pv-due-evidence'
      AND o.name=path AND (o.owner=auth.uid() OR o.owner_id=auth.uid()::text)
      AND o.metadata->>'mimetype' IN ('application/pdf','image/jpeg','image/png','image/webp')
      AND coalesce((o.metadata->>'size')::bigint,0) BETWEEN 1 AND 5242880)
  THEN RAISE EXCEPTION 'Uploaded supplier evidence was not verified in private Storage'; END IF;
  RETURN jsonb_build_object('source','upload','storage_path',path,'reference',external_ref)::text;
 ELSE RAISE EXCEPTION 'Choose attached invoice or uploaded evidence';
 END IF;
END
$fn$;
REVOKE ALL ON FUNCTION private.jims_57d8_verify_due_evidence_v1(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.jims_57d8_record_due_evidence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE j jsonb;
BEGIN
 IF NEW.event_type='due_amended' AND NEW.actor_role='finance_manager'
    AND NEW.supplier_evidence_reference LIKE '{%' THEN
  j:=NEW.supplier_evidence_reference::jsonb;
  INSERT INTO private.jims_57d8_due_evidence_v1
   (audit_id,voucher_id,evidence_source,invoice_document_id,storage_path,
    supplier_reference,recorded_by)
  VALUES (NEW.id,NEW.voucher_id,j->>'source',(j->>'invoice_document_id')::uuid,
    j->>'storage_path',j->>'reference',NEW.actor_id);
 END IF;
 RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION private.jims_57d8_record_due_evidence_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER jims_57d8_register_due_evidence_trg AFTER INSERT
ON private.jims_57d3_audit_v1 FOR EACH ROW
EXECUTE FUNCTION private.jims_57d8_record_due_evidence_v1();

DO $patch$
DECLARE f text;old_block text;new_block text;
BEGIN
 SELECT pg_get_functiondef('public.jims_57d8_fm_review_payment_plan_v1(uuid,text,date,date,text,text)'::regprocedure) INTO f;
 old_block:=E'  v_old_approved:=v_schedule.approved_date;';
 new_block:=E'  IF v_due_changed THEN\n    v_evidence:=private.jims_57d8_verify_due_evidence_v1(p_voucher_id,v_evidence);\n  END IF;\n\n  v_old_approved:=v_schedule.approved_date;';
 IF position(old_block IN f)=0 THEN RAISE EXCEPTION 'FM validation patch anchor missing'; END IF;
 f:=replace(f,old_block,new_block);
 EXECUTE f;
END
$patch$;
