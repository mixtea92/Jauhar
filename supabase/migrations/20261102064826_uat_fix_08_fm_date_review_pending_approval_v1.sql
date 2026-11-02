-- UAT-FIX-08: FM-only payment plan review while PV is pending Finance Manager approval.
-- Separate from PV approval decision, and preserves 57D3 post-approval FM workflow.
CREATE OR REPLACE FUNCTION public.jims_57d8_fm_review_payment_plan_v1(
  p_voucher_id uuid,
  p_action text,
  p_due_date date,
  p_payment_date date DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_supplier_evidence_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user public.user_profiles;
  v_pv public.payment_vouchers;
  v_due private.jims_57d3_due_v1;
  v_schedule private.jims_57d3_schedule_v1;
  v_original_proposed date;
  v_selected_payment date;
  v_due_changed boolean;
  v_old_approved date;
  v_reason text:=NULLIF(btrim(coalesce(p_reason,'')),'');
  v_evidence text:=NULLIF(btrim(coalesce(p_supplier_evidence_reference,'')),'');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_user FROM public.user_profiles
    WHERE id=auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR v_user.role<>'manager' OR v_user.department<>'Finance' THEN
    RAISE EXCEPTION 'Only an active Finance Manager can review payment dates'
      USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_pv FROM public.payment_vouchers
    WHERE id=p_voucher_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_pv.status<>'pending_finance_manager' THEN
    RAISE EXCEPTION 'Finance Manager date review is available only at Pending Finance Manager'
      USING ERRCODE='42501';
  END IF;
  IF p_action NOT IN ('accept','change') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Invalid FM Payment Planning action';
  END IF;
  IF p_due_date IS NULL OR p_due_date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
    RAISE EXCEPTION 'Valid Supplier Due Date required';
  END IF;
  SELECT * INTO v_due FROM private.jims_57d3_due_v1
    WHERE voucher_id=p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AP must record Supplier Due Date first'; END IF;
  SELECT * INTO v_schedule FROM private.jims_57d3_schedule_v1
    WHERE voucher_id=p_voucher_id AND transaction_id IS NULL
    ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE;
  v_due_changed:=v_due.current_due_date IS DISTINCT FROM p_due_date;
  IF v_due_changed AND
    (length(coalesce(v_reason,''))<8 OR length(coalesce(v_evidence,''))<5) THEN
    RAISE EXCEPTION 'Supplier Due Date amendment needs a reason (8+ chars) and supplier evidence reference (5+ chars)';
  END IF;

  v_old_approved:=v_schedule.approved_date;
  v_original_proposed:=v_schedule.proposed_date;
  IF p_action='accept' THEN
    IF v_old_approved IS NOT NULL THEN
      RAISE EXCEPTION 'FM payment date already approved. Use Change & Approve with reason';
    END IF;
    IF v_original_proposed IS NULL THEN
      RAISE EXCEPTION 'AP Proposed Payment Date is required before FM acceptance';
    END IF;
    v_selected_payment:=v_original_proposed;
  ELSE
    v_selected_payment:=p_payment_date;
    IF length(coalesce(v_reason,''))<8 THEN
      RAISE EXCEPTION 'Changing the Payment Date requires a reason (8+ characters)';
    END IF;
    IF v_selected_payment IS NOT DISTINCT FROM coalesce(v_old_approved,v_original_proposed) THEN
      RAISE EXCEPTION 'No date change detected. Use Accept Proposed Date or select a different date';
    END IF;
  END IF;
  IF v_selected_payment IS NULL OR
    v_selected_payment NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN
    RAISE EXCEPTION 'Valid FM Payment Date required';
  END IF;
  IF v_selected_payment>p_due_date AND length(coalesce(v_reason,''))<8 THEN
    RAISE EXCEPTION 'FM reason (8+ characters) required for payment date after Supplier Due Date';
  END IF;

  UPDATE private.jims_57d3_due_v1
     SET current_due_date=p_due_date,
         fm_validated_by=auth.uid(),fm_validated_at=clock_timestamp(),
         last_changed_by=CASE WHEN v_due_changed THEN auth.uid() ELSE last_changed_by END,
         last_changed_at=CASE WHEN v_due_changed THEN clock_timestamp() ELSE last_changed_at END
   WHERE voucher_id=p_voucher_id;
  IF v_due_changed OR v_due.fm_validated_at IS NULL THEN
    INSERT INTO private.jims_57d3_audit_v1
      (voucher_id,event_type,actor_id,actor_role,old_value,new_value,reason,supplier_evidence_reference)
    VALUES (p_voucher_id,CASE WHEN v_due_changed THEN 'due_amended' ELSE 'due_validated' END,
      auth.uid(),'finance_manager',v_due.current_due_date,p_due_date,
      CASE WHEN v_due_changed THEN v_reason ELSE NULL END,
      CASE WHEN v_due_changed THEN v_evidence ELSE NULL END);
  END IF;

  IF v_schedule.id IS NULL THEN
    INSERT INTO private.jims_57d3_schedule_v1
      (voucher_id,transaction_id,first_approved_date,approved_date,approved_by,approved_at)
    VALUES (p_voucher_id,NULL,v_selected_payment,v_selected_payment,auth.uid(),clock_timestamp());
  ELSE
    UPDATE private.jims_57d3_schedule_v1
      SET first_approved_date=coalesce(first_approved_date,v_selected_payment),
          approved_date=v_selected_payment,approved_by=auth.uid(),approved_at=clock_timestamp(),
          proposed_date=NULL,proposed_by=NULL,proposed_at=NULL,updated_at=clock_timestamp()
      WHERE id=v_schedule.id;
  END IF;
  INSERT INTO private.jims_57d3_audit_v1
    (voucher_id,event_type,actor_id,actor_role,old_value,new_value,reason)
  VALUES (p_voucher_id,
    CASE WHEN v_old_approved IS NULL THEN 'schedule_approved' ELSE 'schedule_rescheduled' END,
    auth.uid(),'finance_manager',v_old_approved,v_selected_payment,v_reason);
  RETURN public.jims_57d8_read_payment_dates_v1(p_voucher_id) ||
    jsonb_build_object('saved',true,'action',p_action);
END
$function$;
REVOKE ALL ON FUNCTION public.jims_57d8_fm_review_payment_plan_v1(uuid,text,date,date,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jims_57d8_fm_review_payment_plan_v1(uuid,text,date,date,text,text)
  TO authenticated;
