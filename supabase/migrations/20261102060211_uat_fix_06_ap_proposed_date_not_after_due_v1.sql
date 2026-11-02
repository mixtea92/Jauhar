-- UAT-FIX-06 (STAGING): AP Draft only; Proposed Payment Date <= Supplier Due Date.
-- Preserve Finance Manager validation/reschedule functions, permissions and all prior data.
CREATE OR REPLACE FUNCTION public.jims_57d8_draft_payment_dates_v1(p_voucher_id uuid, p_save boolean DEFAULT false, p_due_date date DEFAULT NULL::date, p_proposed_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_pv public.payment_vouchers;
 v_user public.user_profiles;
 v_due private.jims_57d3_due_v1;
 v_sch private.jims_57d3_schedule_v1;
 v_old_due date;
 v_old_proposal date;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_user FROM public.user_profiles WHERE id=auth.uid() AND is_active IS TRUE;
 IF NOT FOUND OR v_user.role <> 'executive' OR v_user.department <> 'Finance'
 OR v_user.subdepartment <> 'Accounts Payable' THEN
  RAISE EXCEPTION 'Finance AP Executive required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_pv FROM public.payment_vouchers WHERE id=p_voucher_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR v_pv.status NOT IN ('draft','returned')
 OR NOT public.jauhar_is_current_requester_v1(p_voucher_id)
 THEN RAISE EXCEPTION 'Only current Draft/Returned PV requester can edit payment planning' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_due FROM private.jims_57d3_due_v1 WHERE voucher_id=p_voucher_id FOR UPDATE;
 SELECT * INTO v_sch FROM private.jims_57d3_schedule_v1
 WHERE voucher_id=p_voucher_id AND transaction_id IS NULL FOR UPDATE;
 IF p_save THEN
  IF p_due_date IS NULL OR p_proposed_date IS NULL OR p_due_date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'
  OR (p_proposed_date IS NOT NULL AND p_proposed_date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')
  THEN RAISE EXCEPTION 'Both Supplier Due Date and Proposed Payment Date are required and must be valid'; END IF;
  IF p_proposed_date > p_due_date THEN
   RAISE EXCEPTION 'Proposed Payment Date cannot be later than Supplier Due Date';
  END IF;
  IF v_due.fm_validated_at IS NOT NULL OR v_sch.approved_date IS NOT NULL THEN
   RAISE EXCEPTION 'Finance Manager validated planning cannot be changed by AP' USING ERRCODE='42501';
  END IF;
  v_old_due:=v_due.current_due_date;
  v_old_proposal:=v_sch.proposed_date;
  INSERT INTO private.jims_57d3_due_v1 (voucher_id,original_due_date,current_due_date,first_recorded_by)
  VALUES(p_voucher_id,p_due_date,p_due_date,auth.uid())
  ON CONFLICT (voucher_id) DO UPDATE SET
   current_due_date=EXCLUDED.current_due_date,
   last_changed_by=auth.uid(),
   last_changed_at=clock_timestamp();
  IF v_sch.id IS NOT NULL THEN
   UPDATE private.jims_57d3_schedule_v1 SET
    proposed_date=p_proposed_date,proposed_by=CASE WHEN p_proposed_date IS NULL THEN NULL ELSE auth.uid() END,
    proposed_at=CASE WHEN p_proposed_date IS NULL THEN NULL ELSE clock_timestamp() END,
    updated_at=clock_timestamp()
   WHERE id=v_sch.id;
  ELSEIF p_proposed_date IS NOT NULL THEN
   INSERT INTO private.jims_57d3_schedule_v1(voucher_id,transaction_id,proposed_date,proposed_by,proposed_at)
   VALUES(p_voucher_id,NULL,p_proposed_date,auth.uid(),clock_timestamp());
  END IF;
  IF v_old_due IS DISTINCT FROM p_due_date THEN
   INSERT INTO private.jims_57d3_audit_v1(voucher_id,event_type,actor_id,actor_role,old_value,new_value)
   VALUES(p_voucher_id,CASE WHEN v_old_due IS NULL THEN 'due_recorded' ELSE 'due_amended' END,
          auth.uid(),'ap_executive',v_old_due,p_due_date);
  END IF;
  IF v_old_proposal IS DISTINCT FROM p_proposed_date THEN
   INSERT INTO private.jims_57d3_audit_v1(voucher_id,event_type,actor_id,actor_role,old_value,new_value)
   VALUES(p_voucher_id,'schedule_proposed',auth.uid(),'ap_executive',v_old_proposal,p_proposed_date);
  END IF;
 END IF;
 SELECT * INTO v_due FROM private.jims_57d3_due_v1 WHERE voucher_id=p_voucher_id;
 SELECT * INTO v_sch FROM private.jims_57d3_schedule_v1 WHERE voucher_id=p_voucher_id AND transaction_id IS NULL;
 RETURN jsonb_build_object(
  'due_date',v_due.current_due_date,
  'proposed_payment_date',v_sch.proposed_date,
  'fm_validated',v_due.fm_validated_at IS NOT NULL,
  'fm_approved_date',v_sch.approved_date,
  'saved',p_save
 );
END
$function$;
