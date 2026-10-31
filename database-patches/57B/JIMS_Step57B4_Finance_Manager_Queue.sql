-- JIMS Step 57B4 — Finance Manager's actionable Partial Payment V2 queue.
-- Read-only. NO changes to installments, approvals, or Full Payment V1.
-- Execute only AFTER Step 57B3 mandatory evidence SQL.
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.pv_payment_transactions') IS NULL OR
     to_regclass('public.payment_vouchers') IS NULL OR
     to_regclass('public.jims_v2_payment_documents') IS NULL
  THEN RAISE EXCEPTION 'Install 57B3 before installing 57B4'; END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.jims_v2_my_fm_review_queue_v1()
RETURNS TABLE (
    voucher_id uuid,
    installment_id uuid,
    pv_number text,
    installment_no integer,
    requested_amount numeric,
    payee_name text,
    initiated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
  SELECT v.id, t.id, v.pv_number::text,
         t.installment_no, t.requested_amount, v.payee_name::text, t.initiated_at
  FROM public.pv_payment_transactions AS t
  JOIN public.payment_vouchers AS v ON v.id=t.voucher_id
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_profiles AS p
      WHERE p.id=auth.uid() AND p.is_active
    )
    AND v.archived_at IS NULL
    AND v.status='fully_approved'
    AND v.payment_mode='partial'
    AND v.payment_status='pending_payment'
    AND t.status='initiated'
    AND t.review_decision='pending'
    AND t.initiation_proof_path IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.jims_v2_payment_documents d
      WHERE d.transaction_id=t.id
        AND d.kind='initiation'
        AND d.storage_path=t.initiation_proof_path
    )
    AND (
      public.jauhar_can_stage_act_v1(v.id,'finance_manager','approve')
      OR public.jauhar_can_stage_act_v1(v.id,'finance_manager','return')
    )
  ORDER BY t.initiated_at ASC, t.id
  LIMIT 201
$fn$;

REVOKE ALL ON FUNCTION public.jims_v2_my_fm_review_queue_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_v2_my_fm_review_queue_v1() TO authenticated;

COMMENT ON FUNCTION public.jims_v2_my_fm_review_queue_v1() IS
  '57B4: actionable pending V2 Finance Manager initiation queue; role/active delegation verified per PV. Read only.';
COMMIT;

-- Validation (read-only, doesn't impersonate any user):
SELECT proname,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS logged_in_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname='jims_v2_my_fm_review_queue_v1';
