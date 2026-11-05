-- JIMS STAGING ONLY — R11A-01.
-- Fix FM delegation bottleneck in Payment Process planning, without
-- granting blanket AP access to AR and without changing R10 PV/Payment gates.
--
-- Delegated actor must: be active Finance employee in eligible role; hold
-- the active authorized FM grant with approve permission; not be PV creator;
-- not have signed an earlier approval tier; and have an actionable FM
-- Payment Initiation verification pending. All verified by the established
-- jauhar_can_stage_view_v1 / jauhar_can_stage_act_v1 authorization.
CREATE OR REPLACE FUNCTION public.jims_r11a_can_delegated_fm_plan_v1(p_voucher_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
 SELECT EXISTS(
   SELECT 1 FROM public.payment_vouchers v
   JOIN public.pv_authority_delegations d
     ON d.id=public.jauhar_active_authority_grant_v1(v.id,'finance_manager')
   WHERE v.id=p_voucher_id
     AND v.archived_at IS NULL AND v.status='fully_approved'
     AND d.delegate_id=auth.uid()
     AND d.status='approved' AND d.authorized_by IS NOT NULL
     AND d.revoked_at IS NULL
     AND now()>=d.starts_at AND now()<d.ends_at
     AND 'approve'=ANY(d.permissions)
     AND public.jauhar_can_stage_view_v1(v.id,'finance_manager','approve')
     AND (
       (v.payment_mode IS DISTINCT FROM 'partial'
          AND v.payment_status='payment_initiated'
          AND v.payment_initiation_manager_decision='pending')
       OR (v.payment_mode='partial' AND v.payment_status='pending_payment'
          AND EXISTS (
            SELECT 1 FROM public.pv_payment_transactions t
            WHERE t.voucher_id=v.id
              AND t.status='initiated' AND t.review_decision='pending'
              AND t.initiation_proof_path IS NOT NULL
          ))
     )
 );
$function$;
REVOKE ALL ON FUNCTION public.jims_r11a_can_delegated_fm_plan_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jims_r11a_can_delegated_fm_plan_v1(uuid) TO authenticated;

-- Reuse the active FM authority with no new roles, no delegation bypass,
-- and preserve the full audited FM date-review function logic.
DO $migration$
DECLARE v_def text;
  v_old text:=$old$
  IF NOT FOUND OR v_user.role<>'manager' OR v_user.department<>'Finance' THEN
    RAISE EXCEPTION 'Only an active Finance Manager can review payment dates'
      USING ERRCODE='42501';
  END IF;
$old$;
  v_new text:=$new$
  IF NOT FOUND OR NOT (
    (v_user.role='manager' AND v_user.department='Finance'
      AND public.jauhar_can_stage_act_v1(p_voucher_id,'finance_manager','approve'))
    OR (
      public.jims_r11a_can_delegated_fm_plan_v1(p_voucher_id)
      AND public.jauhar_can_stage_act_v1(p_voucher_id,'finance_manager','approve')
    )
  ) THEN
    RAISE EXCEPTION 'Active FM approval authority or FM approve delegation is required for Payment Planning'
      USING ERRCODE='42501';
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jims_57d8_fm_review_payment_plan_v1';
  IF v_def IS NULL OR strpos(v_def,v_old)=0
     THEN RAISE EXCEPTION 'R11A-01: unexpected FM review RPC baseline'; END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$migration$;

-- Readiness uses the SAME server-side authority check as writing.
DO $migration$
DECLARE v_def text;
  v_old text:=$old$
    OR (v_user.role='manager' AND v_user.department='Finance')
    OR v_user.role IN ('ceo','bod','system_admin')
$old$;
  v_new text:=$new$
    OR (v_user.role='manager' AND v_user.department='Finance')
    OR public.jims_r11a_can_delegated_fm_plan_v1(p_voucher_id)
    OR v_user.role IN ('ceo','bod','system_admin')
$new$;
  v_old_data text:=$old2$
    'payment_process_plan_ready',private.jims_payment_process_plan_ready_v1(p_voucher_id,NULL)
$old2$;
  v_new_data text:=$new2$
    'payment_process_plan_ready',private.jims_payment_process_plan_ready_v1(p_voucher_id,NULL),
    'can_fm_payment_planning',
       public.jauhar_can_stage_act_v1(p_voucher_id,'finance_manager','approve')
       AND (v_user.role='manager' AND v_user.department='Finance'
         OR public.jims_r11a_can_delegated_fm_plan_v1(p_voucher_id))
$new2$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jims_57d8_read_payment_dates_v1';
  IF v_def IS NULL OR strpos(v_def,v_old)=0 OR strpos(v_def,v_old_data)=0
     THEN RAISE EXCEPTION 'R11A-01: unexpected date read RPC baseline'; END IF;
  EXECUTE replace(replace(v_def,v_old,v_new),v_old_data,v_new_data);
END;
$migration$;

-- The existing tranche planning modal must be able to read the SAME voucher
-- when the active FM delegate is reviewing an initiated partial installment.
DO $migration$
DECLARE v_def text;
  v_old text:=$old$
 v_role := private.jims_57d3_role_v1();
$old$;
  v_new text:=$new$
 IF public.jims_r11a_can_delegated_fm_plan_v1(p_voucher_id) THEN
   v_role:='finance_manager_delegate';
 ELSE
   v_role := private.jims_57d3_role_v1();
   IF v_role='finance_manager' AND
      NOT public.jauhar_can_stage_act_v1(p_voucher_id,'finance_manager','approve')
   THEN v_role:='finance_manager_suspended'; END IF;
 END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jims_57d3_get_planning_v1';
  IF v_def IS NULL OR strpos(v_def,v_old)=0
     THEN RAISE EXCEPTION 'R11A-01: unexpected planning read baseline'; END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$migration$;

-- Allow delegated approval of tranche-specific dates; keep all original
-- reasons, due date limits, tranche checks, audit, and scheduling rules.
DO $migration$
DECLARE v_def text;
  v_old text:=$old$
 r:=private.jims_57d3_role_v1();
 if r<>'finance_manager' then raise exception 'Only Finance Manager can approve or reschedule a payment'; end if;
$old$;
  v_new text:=$new$
 if public.jims_r11a_can_delegated_fm_plan_v1(p_voucher_id) THEN
   if NOT public.jauhar_can_stage_act_v1(p_voucher_id,'finance_manager','approve') then
     raise exception 'Approved FM delegation with approve permission is required'; end if;
   r:='finance_manager_delegate';
 else
   r:=private.jims_57d3_role_v1();
   if r<>'finance_manager' OR
      NOT public.jauhar_can_stage_act_v1(p_voucher_id,'finance_manager','approve') then
     raise exception 'Only active FM authority may approve or reschedule payments'; end if;
 end if;
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jims_57d3_manager_schedule_v1';
  IF v_def IS NULL OR strpos(v_def,v_old)=0
     THEN RAISE EXCEPTION 'R11A-01: unexpected FM schedule baseline'; END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$migration$;

-- Do not allow the original FM to bypass delegated authority using the
-- legacy due date path. Delegates continue using the evidence-checked
-- jims_57d8_fm_review_payment_plan_v1 for supplier due-date validation.
DO $migration$
DECLARE v_def text;
  v_old text:=$old$
 if r<>'finance_manager' then raise exception 'Only Finance Manager may validate or amend a payment due date'; end if;
$old$;
  v_new text:=$new$
 if r<>'finance_manager' OR
    NOT public.jauhar_can_stage_act_v1(p_voucher_id,'finance_manager','approve')
 then raise exception 'Active Finance Manager approval authority is required for this due-date action'; end if;
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jims_57d3_manager_due_v1';
  IF v_def IS NULL OR strpos(v_def,v_old)=0
     THEN RAISE EXCEPTION 'R11A-01: unexpected FM due-date baseline'; END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$migration$;

-- AP/AR separation is preserved except for a single PV being actively
-- reviewed under an approved FM delegation with 'approve' permission.
-- Existing permissive SELECT policies still apply in addition to these guards.
ALTER POLICY jims_57c7_ap_finance_segmentation
 ON public.payment_vouchers
 USING(
   NOT public.jims_finance_non_ap_user_v1()
   OR (public.jims_finance_non_ap_fm_v1()
       AND status IN ('pending_finance_manager','pending_manager'))
   OR public.jims_r11a_can_delegated_fm_plan_v1(id)
 );

ALTER POLICY jims_57c7_ap_txn_finance_segmentation
 ON public.pv_payment_transactions
 USING(
   NOT public.jims_finance_non_ap_user_v1()
   OR public.jims_r11a_can_delegated_fm_plan_v1(voucher_id)
 );

ALTER POLICY jims_57c7_ap_child_read_guard
 ON public.pv_payment_initiation_proofs
 USING(
   NOT public.jims_finance_non_ap_user_v1()
   OR (public.jims_finance_non_ap_fm_v1()
       AND EXISTS(SELECT 1 FROM public.payment_vouchers cv
           WHERE cv.id=voucher_id AND cv.status IN ('pending_finance_manager','pending_manager')))
   OR public.jims_r11a_can_delegated_fm_plan_v1(voucher_id)
 );

-- Keep original child-table read restrictions for non-delegated AR actors.
ALTER POLICY jims_57c7_ap_child_read_guard
 ON public.pv_line_items
 USING(
   NOT public.jims_finance_non_ap_user_v1()
   OR (public.jims_finance_non_ap_fm_v1()
       AND EXISTS(SELECT 1 FROM public.payment_vouchers cv
           WHERE cv.id=voucher_id AND cv.status IN ('pending_finance_manager','pending_manager')))
   OR public.jims_r11a_can_delegated_fm_plan_v1(voucher_id)
 );
ALTER POLICY jims_57c7_ap_child_read_guard
 ON public.pv_invoice_documents
 USING(
   NOT public.jims_finance_non_ap_user_v1()
   OR (public.jims_finance_non_ap_fm_v1()
       AND EXISTS(SELECT 1 FROM public.payment_vouchers cv
           WHERE cv.id=voucher_id AND cv.status IN ('pending_finance_manager','pending_manager')))
   OR public.jims_r11a_can_delegated_fm_plan_v1(voucher_id)
 );
ALTER POLICY jims_57c7_ap_child_read_guard
 ON public.pv_approval_actions
 USING(
   NOT public.jims_finance_non_ap_user_v1()
   OR (public.jims_finance_non_ap_fm_v1()
       AND EXISTS(SELECT 1 FROM public.payment_vouchers cv
           WHERE cv.id=voucher_id AND cv.status IN ('pending_finance_manager','pending_manager')))
   OR public.jims_r11a_can_delegated_fm_plan_v1(voucher_id)
 );

-- Evidence for a delegated FM review, not a blanket AR PDF export grant.
ALTER POLICY jims_57c8_ar_ap_storage_guard
 ON storage.objects
 USING(
   bucket_id <> ALL(ARRAY['jauhar-pv-invoices','jauhar-pv-jr',
       'jauhar-pv-payment-initiation','jauhar-pv-receipts','jsync-cv-receipts']::text[])
   OR NOT public.jims_finance_non_ap_user_v1()
   OR (public.jims_finance_non_ap_fm_v1()
     AND (
       (bucket_id='jsync-cv-receipts' AND EXISTS(
         SELECT 1 FROM public.cash_voucher_receipts cr
         JOIN public.cash_vouchers cv ON cv.id=cr.voucher_id
         WHERE cr.storage_path=objects.name AND cv.status='pending_approval'))
       OR (bucket_id <> 'jsync-cv-receipts' AND EXISTS(
         SELECT 1 FROM public.payment_vouchers v
         WHERE v.status IN ('pending_finance_manager','pending_manager')
           AND v.id::text=split_part(objects.name,'/',1)))
     ))
   OR (bucket_id IN ('jauhar-pv-invoices','jauhar-pv-payment-initiation')
       AND EXISTS (
         SELECT 1 FROM public.payment_vouchers v
         WHERE v.id::text=split_part(objects.name,'/',1)
           AND public.jims_r11a_can_delegated_fm_plan_v1(v.id)
       ))
 );
