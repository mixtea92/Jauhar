CREATE OR REPLACE FUNCTION public.jims_recurring_ap_prepare_v1(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  'due_day',i.due_day,'fm_notes',i.notes,'ap_notes',i.ap_details_notes,
  'details_completed',i.ap_last_edited_at IS NOT NULL,
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
END;$function$;