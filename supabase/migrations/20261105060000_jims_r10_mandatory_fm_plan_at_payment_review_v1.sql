-- JIMS STAGING ONLY — R10
-- Finance Manager date acceptance moves from PV approval to PAYMENT PROCESS.
-- No mutation/backdating of historical PVs or settlement records.
-- Existing initiation proof, final receipt, separation-of-duties, and approval routing stay unchanged.

-- R09C was an approval-stage guard: remove it so FM can approve PV without
-- first accepting/changing an AP proposed payment date.
DROP TRIGGER IF EXISTS jims_all_pv_fm_plan_gate_trg ON public.pv_approval_actions;
DROP TRIGGER IF EXISTS jims_recurring_fm_plan_gate_trg ON public.pv_approval_actions;

-- Resolve a PV general plan; for a partial installment a tranche-specific
-- plan supersedes the general plan if the tranche has its own proposal/decision.
-- AP proposals awaiting FM decision are intentionally NOT approval evidence.
CREATE OR REPLACE FUNCTION private.jims_payment_process_plan_ready_v1(
  p_voucher_id uuid,
  p_transaction_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT EXISTS (
  SELECT 1 FROM private.jims_57d3_due_v1 d
  JOIN LATERAL (
    SELECT s.approved_date,s.approved_by,s.approved_at,s.proposed_date
    FROM private.jims_57d3_schedule_v1 s
    WHERE s.voucher_id=d.voucher_id
      AND (s.transaction_id IS NULL OR s.transaction_id=p_transaction_id)
    ORDER BY (s.transaction_id IS NOT NULL) DESC,s.updated_at DESC,s.id DESC
    LIMIT 1
  ) s ON TRUE
  WHERE d.voucher_id=p_voucher_id
    AND d.current_due_date IS NOT NULL
    AND d.fm_validated_by IS NOT NULL
    AND d.fm_validated_at IS NOT NULL
    AND s.approved_date IS NOT NULL
    AND s.approved_by IS NOT NULL
    AND s.approved_at IS NOT NULL
    AND s.proposed_date IS NULL
);
$function$;
REVOKE ALL ON FUNCTION private.jims_payment_process_plan_ready_v1(uuid,uuid) FROM PUBLIC;

-- Trigger is at the PAYMENT INITIATION REVIEW transition, and is shared by
-- all full PVs and all V2 partial tranches. No frontend/direct-RPC bypass.
CREATE OR REPLACE FUNCTION private.jims_payment_process_plan_gate_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_RELID='public.payment_vouchers'::regclass THEN
    IF NEW.payment_initiation_manager_decision='approved'
      AND OLD.payment_initiation_manager_decision IS DISTINCT FROM 'approved'
      AND NEW.status='fully_approved'
      AND NEW.payment_status='payment_initiated'
      AND NOT private.jims_payment_process_plan_ready_v1(NEW.id,NULL)
    THEN
      RAISE EXCEPTION 'Payment Process: FM must validate Supplier Due Date and Accept / Change the Payment Date before approving Payment Initiation.'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  ELSIF TG_RELID='public.pv_payment_transactions'::regclass THEN
    IF NEW.review_decision='approved'
      AND OLD.review_decision IS DISTINCT FROM 'approved'
      AND NEW.status='approved'
      AND NOT private.jims_payment_process_plan_ready_v1(NEW.voucher_id,NEW.id)
    THEN
      RAISE EXCEPTION 'Payment Process: FM must validate Supplier Due Date and Accept / Change the Payment Date before approving this installment.'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Unexpected payment process trigger table' USING ERRCODE='23514';
END;
$function$;
REVOKE ALL ON FUNCTION private.jims_payment_process_plan_gate_v1() FROM PUBLIC;

DROP TRIGGER IF EXISTS jims_payment_process_fm_plan_gate_full_trg ON public.payment_vouchers;
CREATE TRIGGER jims_payment_process_fm_plan_gate_full_trg
BEFORE UPDATE ON public.payment_vouchers
FOR EACH ROW
EXECUTE FUNCTION private.jims_payment_process_plan_gate_v1();

DROP TRIGGER IF EXISTS jims_payment_process_fm_plan_gate_partial_trg ON public.pv_payment_transactions;
CREATE TRIGGER jims_payment_process_fm_plan_gate_partial_trg
BEFORE UPDATE ON public.pv_payment_transactions
FOR EACH ROW
EXECUTE FUNCTION private.jims_payment_process_plan_gate_v1();

-- Keep existing validated-FM audit rules and evidence checks exactly as-is.
-- Allow the same audited Accept/Change RPC at fully approved / unpaid Payment
-- Process instead of requiring a pending Finance Manager PV approval stage.
DO $migration$
DECLARE
  v_definition text;
  v_old text:=$old$
  IF NOT FOUND OR v_pv.status<>'pending_finance_manager' THEN
    RAISE EXCEPTION 'Finance Manager date review is available only at Pending Finance Manager'
      USING ERRCODE='42501';
  END IF;
$old$;
  v_new text:=$new$
  IF NOT FOUND OR v_pv.status<>'fully_approved'
    OR v_pv.payment_status NOT IN ('pending_payment','payment_initiated') THEN
    RAISE EXCEPTION 'FM Payment Planning review is available in Payment Process for fully approved, unpaid PVs'
      USING ERRCODE='42501';
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jims_57d8_fm_review_payment_plan_v1'
    AND pg_get_function_identity_arguments(p.oid)=
      'p_voucher_id uuid, p_action text, p_due_date date, p_payment_date date, p_reason text, p_supplier_evidence_reference text';
  IF v_definition IS NULL OR strpos(v_definition,v_old)=0 THEN
    RAISE EXCEPTION 'Unexpected FM date review function baseline; abort R10 migration';
  END IF;
  EXECUTE replace(v_definition,v_old,v_new);
END;
$migration$;
