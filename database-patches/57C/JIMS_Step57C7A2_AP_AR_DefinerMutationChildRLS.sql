-- Step57C7A2: prevent old SECURITY DEFINER AP mutation entrypoints by classified
-- Finance AR / Strategic Finance (while preserving CURRENT FM decision transitions).
-- Finance users with NULL subdepartment remain transitional until assigned.
CREATE OR REPLACE FUNCTION private.jims_57c7_ap_mutation_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF NOT public.jims_finance_non_ap_user_v1() THEN
   RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 IF TG_TABLE_NAME='payment_vouchers' AND TG_OP='UPDATE'
    AND public.jims_finance_non_ap_fm_v1() THEN
    IF OLD.status IN ('pending_finance_manager','pending_manager')
      AND NEW.status IN ('pending_ceo','pending_bod','fully_approved','returned','rejected')
      AND NEW.status IS DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
 END IF;
 IF TG_TABLE_NAME='cash_vouchers' AND TG_OP='UPDATE'
    AND public.jims_finance_non_ap_fm_v1() THEN
    IF OLD.status='pending_approval'
      AND NEW.status IN ('pending_approval','closed') THEN
      RETURN NEW;
    END IF;
 END IF;
 RAISE EXCEPTION 'Only Accounts Payable / Accounting may modify AP operational records'
   USING ERRCODE='42501';
END;
$$;
REVOKE ALL ON FUNCTION private.jims_57c7_ap_mutation_guard_v1()
  FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS jims_57c7_ap_pv_update_guard ON public.payment_vouchers;
CREATE TRIGGER jims_57c7_ap_pv_update_guard
BEFORE UPDATE OR DELETE ON public.payment_vouchers
FOR EACH ROW EXECUTE FUNCTION private.jims_57c7_ap_mutation_guard_v1();

DROP TRIGGER IF EXISTS jims_57c7_ap_pc_update_guard ON public.cash_vouchers;
CREATE TRIGGER jims_57c7_ap_pc_update_guard
BEFORE UPDATE OR DELETE ON public.cash_vouchers
FOR EACH ROW EXECUTE FUNCTION private.jims_57c7_ap_mutation_guard_v1();

DO $block$
DECLARE tab text;
BEGIN
 FOR tab IN SELECT unnest(ARRAY[
     'pv_line_items','pv_invoice_documents','pv_payment_transactions',
     'pv_payment_initiation_proofs','cash_voucher_receipts'
 ]) LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS jims_57c7_ap_mutation_guard ON public.%I',tab);
   EXECUTE format('CREATE TRIGGER jims_57c7_ap_mutation_guard
      BEFORE INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION private.jims_57c7_ap_mutation_guard_v1()',tab);
 END LOOP;
END;
$block$;

-- Direct child SELECT policies must not disclose private PV/PC data to
-- classified non-AP Finance staff even through a historical permissive policy.
DO $policies$
DECLARE tab text; policy_name text; parent_table text; condition text;
BEGIN
 FOR tab IN SELECT unnest(ARRAY[
  'pv_approval_actions','pv_audit_events','pv_line_items',
  'pv_invoice_documents','pv_justification_reports',
  'pv_jr_meeting_records','pv_payment_initiation_proofs',
  'cash_voucher_approvals','cash_voucher_audit_events',
  'cash_voucher_receipts'
 ]) LOOP
  policy_name='jims_57c7_ap_child_read_guard';
  IF tab LIKE 'cash_%' THEN
    parent_table='cash_vouchers';
    condition='cv.status=''pending_approval''';
  ELSE
    parent_table='payment_vouchers';
    condition='cv.status IN (''pending_finance_manager'',''pending_manager'')';
  END IF;
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',policy_name,tab);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
     USING (NOT public.jims_finance_non_ap_user_v1() OR
        (public.jims_finance_non_ap_fm_v1() AND EXISTS
          (SELECT 1 FROM public.%I cv WHERE cv.id = voucher_id AND %s)))',
    policy_name,tab,parent_table,condition
  );
 END LOOP;
END;
$policies$;
