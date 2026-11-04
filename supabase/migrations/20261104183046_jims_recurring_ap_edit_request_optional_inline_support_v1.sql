
-- STAGING ONLY: AP fills FM recurring requests without deleting, pausing or reassigning them.
ALTER TABLE private.jims_recurring_instructions_v1
 ADD COLUMN IF NOT EXISTS fm_issued_snapshot jsonb,
 ADD COLUMN IF NOT EXISTS ap_details_notes text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS ap_last_edited_by uuid REFERENCES public.user_profiles(id),
 ADD COLUMN IF NOT EXISTS ap_last_edited_at timestamptz;
ALTER TABLE private.jims_recurring_support_docs_v1
 ADD COLUMN IF NOT EXISTS upload_task_id uuid REFERENCES private.jims_recurring_ap_tasks_v1(id);
CREATE INDEX IF NOT EXISTS jims_recurring_support_task_upload_idx
 ON private.jims_recurring_support_docs_v1(upload_task_id) WHERE upload_task_id IS NOT NULL;
 
CREATE OR REPLACE FUNCTION public.jims_recurring_ap_update_details_v1(
 p_task_id uuid,
 p_supplier text,p_branch text,p_amount_type text,p_amount numeric,p_due_day integer,
 p_preset jsonb,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 t private.jims_recurring_ap_tasks_v1;
 i private.jims_recurring_instructions_v1;
 v_supplier text:=btrim(coalesce(p_supplier,''));
 v_preset jsonb:=coalesce(p_preset,'{}'::jsonb);
 v_notes text:=btrim(coalesce(p_notes,''));
 v_due_date date;
 v_change jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.is_active
    AND p.role='executive' AND p.department='Finance' AND p.subdepartment='Accounts Payable'
 ) THEN RAISE EXCEPTION 'Only active AP Executive can edit assigned recurring details' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM private.jims_recurring_ap_tasks_v1
 WHERE id=p_task_id AND assigned_ap_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR t.status<>'pending_ap' OR t.linked_voucher_id IS NOT NULL THEN
  RAISE EXCEPTION 'Only your unlinked recurring request can be edited' USING ERRCODE='42501';
 END IF;
 SELECT * INTO i FROM private.jims_recurring_instructions_v1
 WHERE id=t.instruction_id FOR UPDATE;
 IF NOT FOUND OR i.assigned_ap_id<>auth.uid() OR i.status<>'active' THEN
  RAISE EXCEPTION 'FM request is inactive or is assigned to a different AP' USING ERRCODE='42501';
 END IF;
 IF length(v_supplier) NOT BETWEEN 2 AND 150 OR p_branch NOT IN('GP','KM','PM','TD')
 OR p_branch IS NULL OR p_amount_type NOT IN('fixed','variable')
 OR p_amount_type IS NULL OR (p_amount_type='fixed' AND (p_amount IS NULL OR p_amount<=0 OR p_amount>9999999999))
 OR (p_amount_type='variable' AND p_amount IS NOT NULL)
 OR p_due_day NOT BETWEEN 1 AND 31 OR p_due_day IS NULL OR length(v_notes)>500
 OR jsonb_typeof(v_preset)<>'object'
 OR (SELECT count(*) FROM jsonb_object_keys(v_preset))>12
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_preset) x(key)
   WHERE x.key NOT IN('financial_tier','payment_lead_days','supplier_code','supplier_tin',
   'bank_name','bank_account_no','payment_method','payment_type','expense_nature',
   'budget_classification','gl_code','line_description'))
 OR EXISTS(SELECT 1 FROM jsonb_each(v_preset) x WHERE jsonb_typeof(x.value)<>'string')
 OR EXISTS(SELECT 1 FROM jsonb_each_text(v_preset) x WHERE length(x.value)>200)
 THEN RAISE EXCEPTION 'Invalid AP recurring details' USING ERRCODE='22023';END IF;
 IF coalesce(v_preset->>'financial_tier','') NOT IN
 ('','T01','T02','T03','T04','T05','T06','T07','T08','T09')
 OR ((v_preset?'payment_lead_days') AND
    (coalesce(v_preset->>'payment_lead_days','') !~ '^[0-9]{1,2}$'
      OR (v_preset->>'payment_lead_days')::int>28))
 OR coalesce(v_preset->>'payment_method','') NOT IN('','Online Transfer','Cash','Cheque')
 OR coalesce(v_preset->>'payment_type','') NOT IN('','Supplier','Staff Reimbursement','Staff Advance','Other')
 OR coalesce(v_preset->>'expense_nature','') NOT IN('','Recurring','Ad Hoc')
 OR coalesce(v_preset->>'budget_classification','') NOT IN('','Budgeted','Unbudgeted')
 THEN RAISE EXCEPTION 'Invalid PV preset option' USING ERRCODE='22023';END IF;
 v_due_date:=make_date(extract(year from t.period_month)::integer,
  extract(month from t.period_month)::integer,
  least(p_due_day,extract(day from
    (t.period_month+interval '1 month - 1 day'))::integer));
 IF i.fm_issued_snapshot IS NULL THEN
   UPDATE private.jims_recurring_instructions_v1
   SET fm_issued_snapshot=jsonb_build_object(
     'supplier',i.supplier_name,'branch',i.branch_code,'amount_type',i.amount_type,
     'fixed_amount',i.fixed_amount,'due_day',i.due_day,'fm_notes',i.notes,
     'assigned_ap_id',i.assigned_ap_id,'category_id',i.category_id,
     'created_by',i.created_by,'start_month',i.start_month,'end_month',i.end_month)
   WHERE id=i.id;
 END IF;
 v_change:=jsonb_build_object(
   'from',jsonb_build_object('supplier',i.supplier_name,'branch',i.branch_code,
    'amount_type',i.amount_type,'fixed_amount',i.fixed_amount,'due_day',i.due_day,
    'pv_preset',i.pv_preset,'ap_notes',i.ap_details_notes),
   'to',jsonb_build_object('supplier',v_supplier,'branch',p_branch,
    'amount_type',p_amount_type,'fixed_amount',p_amount,'due_day',p_due_day,
    'pv_preset',v_preset,'ap_notes',v_notes));
 UPDATE private.jims_recurring_instructions_v1 SET
  supplier_name=v_supplier,branch_code=p_branch,amount_type=p_amount_type,
  fixed_amount=p_amount,due_day=p_due_day,
  pv_preset=v_preset,ap_details_notes=v_notes,
  ap_last_edited_by=auth.uid(),ap_last_edited_at=clock_timestamp(),
  updated_at=clock_timestamp(),updated_by=auth.uid()
 WHERE id=i.id;
 UPDATE private.jims_recurring_ap_tasks_v1 q SET
  supplier_name=v_supplier,branch_code=p_branch,amount_type=p_amount_type,
  fixed_amount=p_amount,
  due_date=make_date(extract(year from q.period_month)::integer,
   extract(month from q.period_month)::integer,
   least(p_due_day,extract(day from (q.period_month+interval '1 month - 1 day'))::integer))
 WHERE q.instruction_id=i.id AND q.assigned_ap_id=auth.uid()
  AND q.status='pending_ap' AND q.linked_voucher_id IS NULL;
 INSERT INTO private.jims_recurring_audit_v1(actor_id,entity_type,entity_id,action,payload)
 VALUES(auth.uid(),'instruction',i.id,'ap_completed_details',
  v_change||jsonb_build_object('task_id',t.id,'fm_request_kept',true));
 RETURN jsonb_build_object('saved',true,'task_id',t.id,'due_date',v_due_date);
END;$fn$;

-- AP may optionally upload a named support document DURING Edit Recurring Details.
-- Its name is mandatory iff a file is actually uploaded.
CREATE OR REPLACE FUNCTION public.jims_recurring_ap_document_prepare_v1(
 p_task_id uuid,p_name text,p_original_filename text,p_from date,p_to date,p_ext text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE t private.jims_recurring_ap_tasks_v1;
 v_id uuid:=gen_random_uuid();v_path text;
 v_name text:=btrim(coalesce(p_name,''));
 v_ext text:=lower(btrim(coalesce(p_ext,'')));
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.is_active
    AND p.role='executive' AND p.department='Finance' AND p.subdepartment='Accounts Payable'
 ) THEN RAISE EXCEPTION 'Only AP Executive can attach recurring documents' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM private.jims_recurring_ap_tasks_v1
 WHERE id=p_task_id AND assigned_ap_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR t.status<>'pending_ap' OR t.linked_voucher_id IS NOT NULL THEN
  RAISE EXCEPTION 'This recurring request cannot accept a new document' USING ERRCODE='42501';END IF;
 IF length(v_name) NOT BETWEEN 3 AND 120
 OR length(btrim(coalesce(p_original_filename,''))) NOT BETWEEN 1 AND 200
 OR v_ext NOT IN('pdf','png','jpg','jpeg','webp')
 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_to<p_from) THEN
  RAISE EXCEPTION 'Document Name, file type or validity period is invalid' USING ERRCODE='22023';END IF;
 v_path:=auth.uid()::text||'/'||v_id::text||'.'||v_ext;
 INSERT INTO private.jims_recurring_support_docs_v1
  (id,document_name,original_filename,supplier_name,branch_code,effective_from,effective_to,
   file_extension,storage_path,uploaded_by,upload_task_id)
 VALUES(v_id,v_name,btrim(p_original_filename),t.supplier_name,t.branch_code,
  p_from,p_to,v_ext,v_path,auth.uid(),t.id);
 RETURN jsonb_build_object('id',v_id,'path',v_path);
END;$fn$;

CREATE OR REPLACE FUNCTION public.jims_recurring_ap_document_confirm_v1(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE d private.jims_recurring_support_docs_v1; t private.jims_recurring_ap_tasks_v1;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.is_active
    AND p.role='executive' AND p.department='Finance' AND p.subdepartment='Accounts Payable'
 ) THEN RAISE EXCEPTION 'Only AP Executive can confirm recurring document' USING ERRCODE='42501';END IF;
 SELECT * INTO d FROM private.jims_recurring_support_docs_v1 WHERE id=p_id
 AND uploaded_by=auth.uid() AND upload_task_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AP document not found' USING ERRCODE='22023';END IF;
 SELECT * INTO t FROM private.jims_recurring_ap_tasks_v1 WHERE id=d.upload_task_id
 AND assigned_ap_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR t.status<>'pending_ap' OR t.linked_voucher_id IS NOT NULL THEN
 RAISE EXCEPTION 'Recurring task is no longer editable' USING ERRCODE='42501';END IF;
 IF d.confirmed_at IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='jauhar-recurring-supporting'
  AND o.name=d.storage_path) THEN
   RAISE EXCEPTION 'Uploaded file missing in private storage' USING ERRCODE='22023';END IF;
  UPDATE private.jims_recurring_support_docs_v1 SET confirmed_at=clock_timestamp() WHERE id=p_id;
  UPDATE private.jims_recurring_instructions_v1 SET
   supporting_document_id=p_id,document_requirement='recurring_supporting',
   updated_by=auth.uid(),ap_last_edited_by=auth.uid(),
   ap_last_edited_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=t.instruction_id;
  UPDATE private.jims_recurring_ap_tasks_v1 SET
   supporting_document_id=p_id,document_requirement='recurring_supporting'
  WHERE instruction_id=t.instruction_id AND status='pending_ap'
    AND linked_voucher_id IS NULL;
  INSERT INTO private.jims_recurring_audit_v1(actor_id,entity_type,entity_id,action,payload)
  VALUES(auth.uid(),'supporting_document',p_id,'ap_uploaded_recurring_document',
   jsonb_build_object('task_id',t.id,'instruction_id',t.instruction_id,
   'document_name',d.document_name,'original_filename',d.original_filename,
   'category','Recurring Payment Supporting Documents'));
 END IF;
 RETURN p_id;
END;$fn$;

CREATE OR REPLACE FUNCTION public.jims_recurring_storage_can_upload_v1(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT EXISTS(
  SELECT 1 FROM private.jims_recurring_support_docs_v1 d
  WHERE d.storage_path=p_path AND d.uploaded_by=auth.uid() AND d.confirmed_at IS NULL
    AND (
      public.jims_recurring_is_fm_v1()
      OR (d.upload_task_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM private.jims_recurring_ap_tasks_v1 t
        JOIN public.user_profiles p ON p.id=auth.uid()
        WHERE t.id=d.upload_task_id AND t.assigned_ap_id=auth.uid()
         AND t.status='pending_ap' AND t.linked_voucher_id IS NULL
         AND p.role='executive' AND p.department='Finance'
         AND p.subdepartment='Accounts Payable' AND p.is_active))
    )
 );
$fn$;

REVOKE ALL ON FUNCTION public.jims_recurring_ap_update_details_v1(uuid,text,text,text,numeric,integer,jsonb,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_ap_document_prepare_v1(uuid,text,text,date,date,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_ap_document_confirm_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_recurring_ap_update_details_v1(uuid,text,text,text,numeric,integer,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_ap_document_prepare_v1(uuid,text,text,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_ap_document_confirm_v1(uuid) TO authenticated;