-- JIMS STAGING ONLY: R08-01. The recurring FM instruction remains linked to the standard PV.
-- FM must explicitly validate the due date and approve a planned payment date before approving a recurring PV.
-- Historical Paid PV rows are not altered or backdated.
CREATE OR REPLACE FUNCTION private.jims_recurring_fm_plan_gate_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.tier IS DISTINCT FROM 'finance_manager'
     OR NEW.action IS DISTINCT FROM 'approve' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.jims_recurring_ap_tasks_v1 t
    WHERE t.linked_voucher_id=NEW.voucher_id
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.jims_57d3_due_v1 d
    JOIN private.jims_57d3_schedule_v1 s
      ON s.voucher_id=d.voucher_id AND s.transaction_id IS NULL
    WHERE d.voucher_id=NEW.voucher_id
      AND d.fm_validated_by IS NOT NULL AND d.fm_validated_at IS NOT NULL
      AND s.approved_date IS NOT NULL AND s.approved_by IS NOT NULL
      AND s.approved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Recurring PV requires Finance Manager Payment Planning review. Open PAYMENT PLANNING and use Accept Proposed Date or Change & Approve Payment Date before approving the PV.'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER jims_recurring_fm_plan_gate_trg
 BEFORE INSERT ON public.pv_approval_actions
 FOR EACH ROW
 EXECUTE FUNCTION private.jims_recurring_fm_plan_gate_v1();
