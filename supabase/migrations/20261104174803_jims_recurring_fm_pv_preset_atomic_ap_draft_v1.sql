
-- FM instruction presets: configured fields never change legacy PV approver role rules.
CREATE OR REPLACE FUNCTION private.jims_recurring_task_snapshot_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_instruction private.jims_recurring_instructions_v1;
BEGIN
 SELECT * INTO v_instruction FROM private.jims_recurring_instructions_v1
 WHERE id=NEW.instruction_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recurring instruction missing' USING ERRCODE='23503'; END IF;
 NEW.document_requirement:=v_instruction.document_requirement;
 NEW.supporting_document_id:=v_instruction.supporting_document_id;
 RETURN NEW;
END;$fn$;
CREATE TRIGGER jims_recurring_task_snapshot_before_insert_v1
 BEFORE INSERT ON private.jims_recurring_ap_tasks_v1
 FOR EACH ROW EXECUTE FUNCTION private.jims_recurring_task_snapshot_v1();
REVOKE ALL ON FUNCTION private.jims_recurring_task_snapshot_v1() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.jims_recurring_fm_instruction_save_v2(
 p_id uuid,p_category_id uuid,p_supplier_name text,p_branch_code text,
 p_amount_type text,p_fixed_amount numeric,p_due_day integer,p_start_month date,
 p_end_month date,p_assigned_ap_id uuid,p_notes text,p_status text,
 p_document_requirement text,p_supporting_document_id uuid,p_pv_preset jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_id uuid; v_preset jsonb:=coalesce(p_pv_preset,'{}'::jsonb);
BEGIN
 IF NOT public.jims_recurring_is_fm_v1() THEN RAISE EXCEPTION 'Finance Manager only' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(v_preset)<>'object'
 OR jsonb_object_length(v_preset)>14
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_preset) k(key)
 WHERE k.key NOT IN ('financial_tier','payment_lead_days','supplier_code','supplier_tin',
  'bank_name','bank_account_no','payment_method','payment_type','expense_nature',
  'budget_classification','gl_code','line_description')) THEN
 RAISE EXCEPTION 'Invalid FM preset fields' USING ERRCODE='22023';END IF;
 IF coalesce(v_preset->>'financial_tier','') NOT IN ('','T01','T02','T03','T04','T05','T06','T07','T08','T09')
 OR coalesce(v_preset->>'payment_lead_days','') !~ '^[0-9]{1,2}$'
 OR (v_preset ? 'payment_lead_days'
   AND (v_preset->>'payment_lead_days')::integer>28) THEN
 RAISE EXCEPTION 'Invalid FM tier or payment lead days' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(v_preset) j WHERE length(j.value)>200) THEN
 RAISE EXCEPTION 'FM preset field exceeds 200 characters' USING ERRCODE='22023';END IF;
 IF p_document_requirement NOT IN ('monthly_invoice','recurring_supporting') THEN
 RAISE EXCEPTION 'Invalid supporting document requirement' USING ERRCODE='22023';END IF;
 IF p_document_requirement='recurring_supporting' AND p_supporting_document_id IS NULL THEN
 RAISE EXCEPTION 'Select a registered Recurring Payment Supporting Document' USING ERRCODE='22023';END IF;
 IF p_supporting_document_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM private.jims_recurring_support_docs_v1 d
   WHERE d.id=p_supporting_document_id AND d.confirmed_at IS NOT NULL AND d.is_active
   AND (d.effective_to IS NULL OR d.effective_to>=p_start_month)
   AND (d.branch_code IS NULL OR d.branch_code=p_branch_code)
 ) THEN RAISE EXCEPTION 'Supporting document is missing, expired or for a different branch'
 USING ERRCODE='22023';END IF;
 v_id:=public.jims_recurring_fm_instruction_save_v1(
 p_id,p_category_id,p_supplier_name,p_branch_code,p_amount_type,p_fixed_amount,
 p_due_day,p_start_month,p_end_month,p_assigned_ap_id,p_notes,p_status);
 UPDATE private.jims_recurring_instructions_v1 SET
  document_requirement=p_document_requirement,
  supporting_document_id=p_supporting_document_id,
  pv_preset=v_preset,updated_at=clock_timestamp()
 WHERE id=v_id;
 -- Keep this month's unlinked task aligned with FM's approved preset.
 UPDATE private.jims_recurring_ap_tasks_v1 SET
  document_requirement=p_document_requirement,supporting_document_id=p_supporting_document_id
 WHERE instruction_id=v_id AND status='pending_ap' AND linked_voucher_id IS NULL
 AND period_month=date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
 INSERT INTO private.jims_recurring_audit_v1(actor_id,entity_type,entity_id,action,payload)
 VALUES(auth.uid(),'instruction',v_id,'preset_saved',jsonb_build_object(
   'document_requirement',p_document_requirement,
   'supporting_document_id',p_supporting_document_id,'pv_preset',v_preset));
 RETURN v_id;
END;$fn$;

CREATE OR REPLACE FUNCTION public.jims_recurring_ap_prepare_v1(p_task_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE t private.jims_recurring_ap_tasks_v1;i private.jims_recurring_instructions_v1;
 d private.jims_recurring_support_docs_v1;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
 SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.is_active
 AND p.role='executive' AND p.department='Finance' AND p.subdepartment='Accounts Payable')
 THEN RAISE EXCEPTION 'AP Executive only' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM private.jims_recurring_ap_tasks_v1
 WHERE id=p_task_id AND assigned_ap_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Recurring task is not assigned to you' USING ERRCODE='42501';END IF;
 SELECT * INTO i FROM private.jims_recurring_instructions_v1 WHERE id=t.instruction_id;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Recurring instruction missing';END IF;
 IF t.supporting_document_id IS NOT NULL THEN
 SELECT * INTO d FROM private.jims_recurring_support_docs_v1 WHERE id=t.supporting_document_id;
 END IF;
 RETURN jsonb_build_object(
  'task_id',t.id,'status',t.status,'linked_voucher_id',t.linked_voucher_id,
  'supplier_name',t.supplier_name,'branch_code',t.branch_code,
  'period_month',t.period_month,'due_date',t.due_date,
  'amount_type',t.amount_type,'fixed_amount',t.fixed_amount,
  'category_name',t.category_name,
  'document_requirement',t.document_requirement,
  'supporting_document_id',t.supporting_document_id,
  'supporting_document_name',d.document_name,
  'supporting_document_confirmed',d.confirmed_at IS NOT NULL,
  'supporting_document_valid',CASE
   WHEN t.supporting_document_id IS NULL THEN false
   ELSE (d.confirmed_at IS NOT NULL AND d.is_active
    AND (d.effective_from IS NULL OR d.effective_from<=t.due_date)
    AND (d.effective_to IS NULL OR d.effective_to>=t.due_date)) END,
  'reference_no','RECUR-'||left(t.id::text,8)||'-'||to_char(t.period_month,'YYYYMM'),
  'pv_preset',i.pv_preset);
END;$fn$;

CREATE OR REPLACE FUNCTION public.jims_recurring_ap_create_pv_draft_v1(
 p_task_id uuid,p_form jsonb)
RETURNS public.payment_vouchers
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE t private.jims_recurring_ap_tasks_v1;
 v_data jsonb:=coalesce(p_form,'{}'::jsonb);
 v_items jsonb;
 v_pv public.payment_vouchers;
 v_total numeric;
 v_ref text;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
 SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.is_active
 AND p.role='executive' AND p.department='Finance' AND p.subdepartment='Accounts Payable')
 THEN RAISE EXCEPTION 'AP Executive only' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM private.jims_recurring_ap_tasks_v1
 WHERE id=p_task_id AND assigned_ap_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR t.status<>'pending_ap' OR t.linked_voucher_id IS NOT NULL THEN
 RAISE EXCEPTION 'Recurring task is already linked or unavailable; open the existing PV'
 USING ERRCODE='23505';END IF;
 IF jsonb_typeof(v_data)<>'object'
 OR btrim(coalesce(v_data->>'payee_name',''))<>t.supplier_name
 OR coalesce(v_data->>'branch_department','')<>t.branch_code THEN
 RAISE EXCEPTION 'Recurring supplier or branch does not match FM instruction' USING ERRCODE='22023';END IF;
 IF t.document_requirement='recurring_supporting' AND NOT EXISTS(
  SELECT 1 FROM private.jims_recurring_support_docs_v1 d
  JOIN storage.objects o ON o.bucket_id='jauhar-recurring-supporting' AND o.name=d.storage_path
  WHERE d.id=t.supporting_document_id AND d.confirmed_at IS NOT NULL AND d.is_active
    AND (d.effective_from IS NULL OR d.effective_from<=t.due_date)
    AND (d.effective_to IS NULL OR d.effective_to>=t.due_date)
 ) THEN RAISE EXCEPTION 'Valid recurring supporting document is required' USING ERRCODE='22023';END IF;
 v_items:=v_data->'items';
 IF jsonb_typeof(v_items)<>'array' OR jsonb_array_length(v_items)<1 THEN
 RAISE EXCEPTION 'At least one PV reference line is required' USING ERRCODE='22023';END IF;
 SELECT coalesce(sum((it->>'amount')::numeric),0) INTO v_total
 FROM jsonb_array_elements(v_items) it;
 IF t.amount_type='fixed' AND round(v_total+coalesce((v_data->>'sst_amount')::numeric,0),2)
 !=round(t.fixed_amount,2) THEN
 RAISE EXCEPTION 'Fixed recurring total must match FM preset amount' USING ERRCODE='22023';END IF;
 IF t.document_requirement='recurring_supporting' THEN
  v_ref:='RECUR-'||left(t.id::text,8)||'-'||to_char(t.period_month,'YYYYMM');
  IF jsonb_array_length(v_items)<>1 OR v_items->0->>'invoice_reference'<>v_ref THEN
   RAISE EXCEPTION 'Document-backed recurring PV must use its unique recurring reference'
   USING ERRCODE='22023';END IF;
 END IF;
 v_pv:=public.create_pv_draft_v6(
 p_financial_tier=>v_data->>'financial_tier',
 p_template_version=>v_data->>'template_version',
 p_payee_name=>t.supplier_name,
 p_items=>v_items,
 p_supplier_tin=>v_data->>'supplier_tin',
 p_supplier_code=>v_data->>'supplier_code',
 p_bank_name=>v_data->>'bank_name',
 p_bank_account_no=>v_data->>'bank_account_no',
 p_branch_department=>t.branch_code,
 p_payment_method=>v_data->>'payment_method',
 p_payment_type=>v_data->>'payment_type',
 p_expense_nature=>v_data->>'expense_nature',
 p_budget_classification=>v_data->>'budget_classification',
 p_sst_amount=>coalesce((v_data->>'sst_amount')::numeric,0),
 p_remarks=>v_data->>'remarks',
 p_supporting_types=>coalesce(v_data->'supporting_types','[]'::jsonb),
 p_supporting_other_text=>v_data->>'supporting_other_text',
 p_source_voucher_no=>v_data->>'source_voucher_no',
 p_source_pv_date=>nullif(v_data->>'source_pv_date','')::date);
 UPDATE private.jims_recurring_ap_tasks_v1 SET linked_voucher_id=v_pv.id,status='pv_linked'
 WHERE id=t.id AND status='pending_ap' AND linked_voucher_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recurring task link failed; PV creation was rolled back';END IF;
 INSERT INTO private.jims_recurring_audit_v1(actor_id,entity_type,entity_id,action,payload)
 VALUES(auth.uid(),'task',t.id,'auto_linked_pv',jsonb_build_object(
   'pv_id',v_pv.id,'pv_number',v_pv.pv_number,'period_month',t.period_month,
   'document_requirement',t.document_requirement,'supporting_document_id',t.supporting_document_id));
 RETURN v_pv;
END;$fn$;

CREATE OR REPLACE FUNCTION public.jims_recurring_has_valid_supporting_v1(p_voucher_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
 SELECT EXISTS(
 SELECT 1 FROM private.jims_recurring_ap_tasks_v1 t
 JOIN private.jims_recurring_support_docs_v1 d ON d.id=t.supporting_document_id
 JOIN storage.objects o ON o.bucket_id='jauhar-recurring-supporting'
  AND o.name=d.storage_path
 JOIN public.payment_vouchers v ON v.id=t.linked_voucher_id
 WHERE t.linked_voucher_id=p_voucher_id AND t.status='pv_linked'
   AND t.document_requirement='recurring_supporting'
   AND d.confirmed_at IS NOT NULL AND d.is_active
   AND (d.effective_from IS NULL OR d.effective_from<=t.due_date)
   AND (d.effective_to IS NULL OR d.effective_to>=t.due_date)
   AND v.archived_at IS NULL
   AND (SELECT count(*) FROM public.pv_line_items l WHERE l.voucher_id=v.id)=1
 );
$fn$;

REVOKE ALL ON FUNCTION public.jims_recurring_fm_instruction_save_v2(uuid,uuid,text,text,text,numeric,integer,date,date,uuid,text,text,text,uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_ap_prepare_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_ap_create_pv_draft_v1(uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_has_valid_supporting_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_recurring_fm_instruction_save_v2(uuid,uuid,text,text,text,numeric,integer,date,date,uuid,text,text,text,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_ap_prepare_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_ap_create_pv_draft_v1(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_has_valid_supporting_v1(uuid) TO authenticated;