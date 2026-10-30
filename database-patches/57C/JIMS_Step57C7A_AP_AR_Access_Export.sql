-- JIMS Step 57C7A: Finance AP / Accounting export privileges & AR data isolation.
-- Existing Finance accounts with NULL subdepartment are in explicit LEGACY TRANSITION
-- for normal workflows; they CANNOT export AP History until assigned by System Admin.
-- Finance AR / Strategic Finance have no AP module rights.
-- HOD, Finance Manager, CEO, BOD stage approvals remain within existing authority.
-- User org assignment via existing user admin UI ONLY.
CREATE OR REPLACE FUNCTION private.jims_finance_non_ap_user_v1()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS(
     SELECT 1 FROM public.user_profiles p
     WHERE p.id=auth.uid() AND p.is_active IS TRUE
     AND p.department='Finance'
     AND p.subdepartment IS NOT NULL
     AND p.subdepartment NOT IN ('Accounts Payable','Accounting')
  );
$$;
REVOKE ALL ON FUNCTION private.jims_finance_non_ap_user_v1() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.jims_finance_non_ap_fm_v1()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT EXISTS(
     SELECT 1 FROM public.user_profiles p
     WHERE p.id=auth.uid() AND p.is_active IS TRUE
     AND p.role='manager' AND p.department='Finance'
     AND p.subdepartment IS NOT NULL
     AND p.subdepartment NOT IN ('Accounts Payable','Accounting')
  );
$$;
REVOKE ALL ON FUNCTION private.jims_finance_non_ap_fm_v1() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.jims_can_export_ap_history_v1()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(
     SELECT 1 FROM public.user_profiles p
     WHERE p.id=auth.uid() AND p.is_active IS TRUE
       AND p.department='Finance'
       AND p.subdepartment IN ('Accounts Payable','Accounting')
       AND p.role IN ('executive','manager')
  );
$$;
REVOKE ALL ON FUNCTION public.jims_can_export_ap_history_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_can_export_ap_history_v1() TO authenticated;

-- RESTRICTIVE: Intersection with existing permissive policies.
-- Classified AR / Strategic Finance cannot read AP vouchers wholesale.
-- Finance Manager retains current-stage review when assigned outside AP.
DROP POLICY IF EXISTS jims_57c7_ap_finance_segmentation ON public.payment_vouchers;
CREATE POLICY jims_57c7_ap_finance_segmentation ON public.payment_vouchers
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  NOT private.jims_finance_non_ap_user_v1()
  OR (private.jims_finance_non_ap_fm_v1()
      AND status IN ('pending_finance_manager','pending_manager'))
);

DROP POLICY IF EXISTS jims_57c7_ap_cv_finance_segmentation ON public.cash_vouchers;
CREATE POLICY jims_57c7_ap_cv_finance_segmentation ON public.cash_vouchers
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  NOT private.jims_finance_non_ap_user_v1()
  OR (private.jims_finance_non_ap_fm_v1()
      AND status='pending_approval')
);

-- Additional financial ledgers / proof storage registry have their own ACL:
-- Deny direct reads from non-AP finance users (incl Finance Manager) to
-- payment ledger (Finance Manager can still view the PV requiring approval).
DROP POLICY IF EXISTS jims_57c7_ap_txn_finance_segmentation ON public.pv_payment_transactions;
CREATE POLICY jims_57c7_ap_txn_finance_segmentation
ON public.pv_payment_transactions AS RESTRICTIVE FOR SELECT TO authenticated
USING (NOT private.jims_finance_non_ap_user_v1());

-- Block AR/Strategic Finance from creating AP vouchers even through older
-- SECURITY DEFINER APIs. Leave Finance Manager approval status changes untouched.
CREATE OR REPLACE FUNCTION private.jims_57c7_ap_creation_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF private.jims_finance_non_ap_user_v1() THEN
    RAISE EXCEPTION 'Only Accounts Payable / Accounting may create AP records'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.jims_57c7_ap_creation_guard_v1() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS jims_57c7_pv_ap_creation_guard ON public.payment_vouchers;
CREATE TRIGGER jims_57c7_pv_ap_creation_guard BEFORE INSERT ON public.payment_vouchers
FOR EACH ROW EXECUTE FUNCTION private.jims_57c7_ap_creation_guard_v1();
DROP TRIGGER IF EXISTS jims_57c7_cv_ap_creation_guard ON public.cash_vouchers;
CREATE TRIGGER jims_57c7_cv_ap_creation_guard BEFORE INSERT ON public.cash_vouchers
FOR EACH ROW EXECUTE FUNCTION private.jims_57c7_ap_creation_guard_v1();

-- CRITICAL: no approval history here; owner-only export is separate 57C6 RPC.
-- AP-only finance operations export: PV ledger, payment transactions, Petty Cash.
-- Excludes sensitive bank account, TIN, private storage paths, signed images.
CREATE OR REPLACE FUNCTION public.jims_finance_ap_operational_history_export_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_vouchers jsonb;
  v_payments jsonb;
  v_petty jsonb;
  v_max int:=20000;
BEGIN
  IF NOT public.jims_can_export_ap_history_v1() THEN
    RAISE EXCEPTION 'AP History export requires assigned Accounts Payable or Accounting unit'
      USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM public.payment_vouchers)>v_max
    OR (SELECT count(*) FROM public.pv_payment_transactions)>v_max
    OR (SELECT count(*) FROM public.cash_vouchers)>v_max THEN
      RAISE EXCEPTION 'AP export limit reached; use a scoped archival extract'
      USING ERRCODE='54000';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'pv_number',v.pv_number,'financial_tier',v.financial_tier,
    'tier_version',v.jims_tier_policy_version,'department',v.origin_department,
    'branch',coalesce(m.branch_code,v.branch_department),
    'cost_center',m.cost_center,'charge_department',m.charge_department,
    'charge_subdepartment',m.charge_subdepartment,'budget_code',m.budget_code,
    'payee',v.payee_name,'purpose',v.description,
    'amount',v.amount,'approval_status',v.status,'payment_status',v.payment_status,
    'payment_mode',v.payment_mode,'created_at',v.created_at,
    'final_approval_date',v.final_approval_date,'payment_date',v.payment_date,
    'archived',v.archived_at IS NOT NULL
  ) ORDER BY v.created_at,v.id),'[]'::jsonb)
  INTO v_vouchers
  FROM public.payment_vouchers v
  LEFT JOIN private.jims_financial_metadata_v1 m
    ON m.source_type='payment_voucher' AND m.source_id=v.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'pv_number',v.pv_number,'installment_no',t.installment_no,
    'requested_amount',t.requested_amount,'settled_amount',t.settled_amount,
    'status',t.status,'review_decision',t.review_decision,
    'review_remarks',t.review_remarks,
    'payment_date',t.payment_date,
    'bank_transaction_reference',t.bank_transaction_reference,
    'created_at',t.created_at,'initiated_at',t.initiated_at,
    'reviewed_at',t.reviewed_at,'completed_at',t.completed_at,
    'voided_at',t.voided_at,'void_reason',t.void_reason
  ) ORDER BY t.created_at,t.id),'[]'::jsonb)
  INTO v_payments FROM public.pv_payment_transactions t
  JOIN public.payment_vouchers v ON v.id=t.voucher_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cv_number',c.cv_number,'department',c.applicable_department,
    'branch',m.branch_code,'cost_center',m.cost_center,
    'claimant',c.form_data->>'claimant_name','amount',c.total_amount,
    'status',c.status,'created_at',c.created_at,
    'submitted_at',c.submitted_at,'closed_at',c.closed_at,
    'receipt_count',(
       SELECT count(*) FROM public.cash_voucher_receipts r WHERE r.voucher_id=c.id
    )
  ) ORDER BY c.created_at,c.id),'[]'::jsonb)
  INTO v_petty
  FROM public.cash_vouchers c
  LEFT JOIN private.jims_financial_metadata_v1 m
    ON m.source_type='petty_cash' AND m.source_id=c.id;

  RETURN jsonb_build_object('pv_history',v_vouchers,
    'payment_process_history',v_payments,'petty_cash_history',v_petty,
    'generated_at',clock_timestamp(),'export_type','AP Operational History');
END;
$$;
REVOKE ALL ON FUNCTION public.jims_finance_ap_operational_history_export_v1()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_finance_ap_operational_history_export_v1()
  TO authenticated;
COMMENT ON FUNCTION public.jims_finance_ap_operational_history_export_v1() IS
 'Finance Accounts Payable / Accounting only. No Approval History. Export via ExcelJS client.';
