CREATE OR REPLACE FUNCTION public.jims_finance_ap_operational_history_export_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_vouchers jsonb;
  v_payments jsonb;
  v_petty jsonb;
  v_pv_events jsonb;
  v_pc_events jsonb;
  v_max int:=20000;
BEGIN
  IF NOT public.jims_can_export_ap_history_v1() THEN
    RAISE EXCEPTION 'AP History export requires assigned Accounts Payable or Accounting unit'
      USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM public.payment_vouchers)>v_max
    OR (SELECT count(*) FROM public.pv_payment_transactions)>v_max
    OR (SELECT count(*) FROM public.cash_vouchers)>v_max
    OR (SELECT count(*) FROM public.pv_audit_events)>v_max
    OR (SELECT count(*) FROM public.cash_voucher_audit_events)>v_max THEN
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
    'charge_subdepartment',m.charge_subdepartment,
    'requester_department',m.requester_department,
    'requester_subdepartment',m.requester_subdepartment,
    'requester_cost_center',m.requester_cost_center,
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

  -- Operational PV timeline only, explicit safe-action allowlist:
  -- NEVER include approvals, rejection, return, JR meeting attestations.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'pv_number',v.pv_number,'action',a.action,
    'actor',coalesce(p.username,'Account unavailable'),
    'event_time',a.created_at,'details',(coalesce(a.details,'{}'::jsonb) - 'proof_path' - 'receipt_path' - 'storage_path' - 'signature_png')
  ) ORDER BY a.created_at,a.id),'[]'::jsonb)
  INTO v_pv_events
  FROM public.pv_audit_events a
  JOIN public.payment_vouchers v ON v.id=a.voucher_id
  LEFT JOIN public.user_profiles p ON p.id=a.actor_id
  WHERE a.action IN (
    'draft_archived','edit_draft','edit_returned',
    'executive_payment_remarks_updated','financial_tier_changed',
    'financial_tier_set','jims_pv_template_revision_used',
    'jims_v2_installment_draft_created',
    'jims_v2_installment_initiated','jims_v2_installment_paid',
    'payment_completed_v1','payment_initiated',
    'payment_initiation_proof_registered','pv_number_issued_v1',
    'jr_pdf_registered','department_jr_pdf_registered'
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cv_number',v.cv_number,'action',a.action,
    'actor',coalesce(p.username,'Account unavailable'),
    'event_time',a.created_at,'details',(coalesce(a.details,'{}'::jsonb) - 'proof_path' - 'receipt_path' - 'storage_path' - 'signature_png')
  ) ORDER BY a.created_at,a.id),'[]'::jsonb)
  INTO v_pc_events FROM public.cash_voucher_audit_events a
  JOIN public.cash_vouchers v ON v.id=a.voucher_id
  LEFT JOIN public.user_profiles p ON p.id=a.actor_id
  WHERE a.action IN ('created_draft','receipt_uploaded','submitted','updated_draft');

  RETURN jsonb_build_object('pv_history',v_vouchers,
    'payment_process_history',v_payments,'petty_cash_history',v_petty,
    'pv_operational_events_history',v_pv_events,
    'petty_cash_operational_events_history',v_pc_events,
    'generated_at',clock_timestamp(),'export_type','AP Operational History');
END;
$$;
