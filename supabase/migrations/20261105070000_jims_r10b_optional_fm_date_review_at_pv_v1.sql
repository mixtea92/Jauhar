-- JIMS STAGING ONLY — R10B.
-- Restore optional FM date adjustment while PV is pending FM approval.
-- Mandatory FM date approval remains ONLY at Payment Process initiation verification.
-- No change to PV approval trigger, payment review triggers, or historical records.
DO $migration$
DECLARE
  v_definition text;
  v_old text:=$old$
  IF NOT FOUND OR v_pv.status<>'fully_approved'
    OR v_pv.payment_status NOT IN ('pending_payment','payment_initiated') THEN
    RAISE EXCEPTION 'FM Payment Planning review is available in Payment Process for fully approved, unpaid PVs'
      USING ERRCODE='42501';
  END IF;
$old$;
  v_new text:=$new$
  IF NOT FOUND OR NOT (
    v_pv.status='pending_finance_manager'
    OR (
      v_pv.status='fully_approved'
      AND v_pv.payment_status IN ('pending_payment','payment_initiated')
    )
  ) THEN
    RAISE EXCEPTION 'FM date review is available optionally during PV approval or during Payment Process before completion'
      USING ERRCODE='42501';
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='jims_57d8_fm_review_payment_plan_v1'
    AND pg_get_function_identity_arguments(p.oid)=
      'p_voucher_id uuid, p_action text, p_due_date date, p_payment_date date, p_reason text, p_supplier_evidence_reference text';
  IF v_definition IS NULL OR strpos(v_definition,v_old)=0 THEN
    RAISE EXCEPTION 'Unexpected FM date review RPC baseline; abort R10B migration';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$migration$;
