-- JIMS STAGING ONLY — R10 supporting readout.
-- Expose the exact backend FM planning readiness through the existing
-- role-checked Payment Planning read RPC. No new access rights or mutations.
DO $migration$
DECLARE
  v_definition text;
  v_old text:=$old$
    'fm_due_validated',v_due.fm_validated_at IS NOT NULL,
    'fm_approved_payment_date',v_schedule.approved_date
$old$;
  v_new text:=$new$
    'fm_due_validated',v_due.fm_validated_at IS NOT NULL,
    'fm_approved_payment_date',v_schedule.approved_date,
    'payment_process_plan_ready',private.jims_payment_process_plan_ready_v1(p_voucher_id,NULL)
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jims_57d8_read_payment_dates_v1'
    AND pg_get_function_identity_arguments(p.oid)='p_voucher_id uuid';
  IF v_definition IS NULL OR strpos(v_definition,v_old)=0 THEN
    RAISE EXCEPTION 'Unexpected Payment Planning read RPC baseline; abort R10 migration';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$migration$;
