-- JIMS STAGING ONLY — UAT FIX-R09C.
-- FM must validate the supplier due date and accept/change the planned payment date
-- before approving ANY Payment Voucher, regardless of tier, department or recurring source.
-- Return/Reject, HOD, CEO, BOD and payment processing are unchanged.
-- Do not backfill or rewrite historical approval/payment dates.

CREATE OR REPLACE FUNCTION private.jims_all_pv_fm_plan_gate_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Applied to every FM-approval RPC because all current routes insert
  -- a finance_manager decision into the shared pv_approval_actions ledger.
  IF NEW.tier IS DISTINCT FROM 'finance_manager'
     OR NEW.action IS DISTINCT FROM 'approve' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM private.jims_57d3_due_v1 d
      JOIN private.jims_57d3_schedule_v1 s
        ON s.voucher_id=d.voucher_id AND s.transaction_id IS NULL
     WHERE d.voucher_id=NEW.voucher_id
       AND d.current_due_date IS NOT NULL
       AND d.fm_validated_by IS NOT NULL
       AND d.fm_validated_at IS NOT NULL
       AND s.approved_date IS NOT NULL
       AND s.approved_by IS NOT NULL
       AND s.approved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Finance Manager must validate Supplier Due Date and Accept Proposed Date or Change & Approve Payment Date under PAYMENT PLANNING before approving this PV.'
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$function$;

-- Replace the previous recurring-only enforcement with the same guard for ALL PVs.
DROP TRIGGER IF EXISTS jims_recurring_fm_plan_gate_trg ON public.pv_approval_actions;
DROP TRIGGER IF EXISTS jims_all_pv_fm_plan_gate_trg ON public.pv_approval_actions;
CREATE TRIGGER jims_all_pv_fm_plan_gate_trg
 BEFORE INSERT ON public.pv_approval_actions
 FOR EACH ROW
 EXECUTE FUNCTION private.jims_all_pv_fm_plan_gate_v1();

-- The old function is kept unused to avoid unexpected dependency breakage.
