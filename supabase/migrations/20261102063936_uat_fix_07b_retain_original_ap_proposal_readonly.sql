-- UAT-FIX-07B: read-only AP proposal retained through existing immutable audit after FM accepts.
CREATE OR REPLACE FUNCTION public.jims_57d8_read_payment_dates_v1(p_voucher_id uuid)
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_user FROM public.user_profiles
  WHERE id=auth.uid() AND is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active JIMS user required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_pv FROM public.payment_vouchers
  WHERE id=p_voucher_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment Voucher unavailable' USING ERRCODE='42501';
  END IF;
  IF NOT (
    (v_user.role='executive' AND v_user.department='Finance'
      AND v_user.subdepartment='Accounts Payable'
      AND v_pv.created_by=auth.uid())
    OR (v_user.role='manager' AND v_user.department='Finance')
    OR v_user.role IN ('ceo','bod','system_admin')
  ) THEN
    RAISE EXCEPTION 'Not authorised to view PV planning dates' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_due FROM private.jims_57d3_due_v1
    WHERE voucher_id=p_voucher_id;
  SELECT * INTO v_schedule FROM private.jims_57d3_schedule_v1
    WHERE voucher_id=p_voucher_id AND transaction_id IS NULL
    ORDER BY updated_at DESC,id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'supplier_due_date',v_due.current_due_date,
    'proposed_payment_date',COALESCE(v_schedule.proposed_date,
      (SELECT audit.new_value FROM private.jims_57d3_audit_v1 audit
       WHERE audit.voucher_id=p_voucher_id
         AND audit.transaction_id IS NULL
         AND audit.event_type='schedule_proposed'
         AND audit.new_value IS NOT NULL
       ORDER BY audit.id DESC LIMIT 1)),
    'fm_due_validated',v_due.fm_validated_at IS NOT NULL,
    'fm_approved_payment_date',v_schedule.approved_date
  );
END
$function$;
