CREATE OR REPLACE FUNCTION public.jims_recurring_fm_instruction_save_v2(p_id uuid, p_category_id uuid, p_supplier_name text, p_branch_code text, p_amount_type text, p_fixed_amount numeric, p_due_day integer, p_start_month date, p_end_month date, p_assigned_ap_id uuid, p_notes text, p_status text, p_document_requirement text, p_supporting_document_id uuid, p_pv_preset jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid; v_preset jsonb:=coalesce(p_pv_preset,'{}'::jsonb);
BEGIN
 IF NOT public.jims_recurring_is_fm_v1() THEN RAISE EXCEPTION 'Finance Manager only' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(v_preset)<>'object'
 OR  (SELECT count(*) FROM jsonb_object_keys(v_preset))>14
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_preset) k(key)
 WHERE k.key NOT IN ('financial_tier','payment_lead_days','supplier_code','supplier_tin',
  'bank_name','bank_account_no','payment_method','payment_type','expense_nature',
  'budget_classification','gl_code','line_description')) THEN
 RAISE EXCEPTION 'Invalid FM preset fields' USING ERRCODE='22023';END IF;
 IF coalesce(v_preset->>'financial_tier','') NOT IN ('','T01','T02','T03','T04','T05','T06','T07','T08','T09')
 OR (v_preset ? 'payment_lead_days' AND coalesce(v_preset->>'payment_lead_days','') !~ '^[0-9]{1,2}$')
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
END;$function$;