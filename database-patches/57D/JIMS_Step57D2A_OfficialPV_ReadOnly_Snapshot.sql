-- JIMS STEP 57D2A — official Payment Voucher PDF read-only source.
-- Snapshot is generated on demand from approved PV + immutable approval/payment records.
-- Financials: only completed (status=paid) partial installments reduce outstanding.
-- NO changes to the payment/approval workflow, no financial writes.
begin;

create or replace function public.jims_57d2_official_pv_snapshot_v1(p_voucher_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $jims$
declare
  v_actor uuid := auth.uid();
  v_staff public.user_profiles%rowtype;
  v public.payment_vouchers%rowtype;
  v_metadata jsonb;
  v_lines jsonb;
  v_approvals jsonb;
  v_payments jsonb;
  v_payment_events jsonb;
  v_paid numeric(18,2);
  v_outstanding numeric(18,2);
  v_due jsonb;
begin
  if v_actor is null or p_voucher_id is null then
    raise exception 'Active session and voucher are required' using errcode='42501';
  end if;
  select * into v_staff from public.user_profiles
   where id=v_actor and is_active is true;
  if not found or v_staff.role='non_executive' then
    raise exception 'Official PV PDF access denied' using errcode='42501';
  end if;

  select * into v from public.payment_vouchers
   where id=p_voucher_id and archived_at is null;
  if not found then
    raise exception 'Active PV not found' using errcode='P0002';
  end if;
  if v.status<>'fully_approved' then
    raise exception 'Official PV PDF is available only after final approval'
      using errcode='P0001';
  end if;

  -- SECURITY DEFINER reads private finance and actor labels; authorization
  -- MUST be checked explicitly. No status/approval/finance data is mutated.
  if not (
    v_staff.role in ('ceo','bod','system_admin')
    or (v_staff.role='manager' and
        (v_staff.department='Finance' or v_staff.department=v.origin_department))
    or (v_staff.role='executive' and
        ((v_staff.department='Finance' and
          v_staff.subdepartment in ('Accounts Payable','Accounting'))
          or v.created_by=v_actor
          or public.jauhar_is_current_requester_v1(v.id)))
  ) then
    raise exception 'Official PV PDF access denied for this voucher'
      using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_no',li.line_no,
    'invoice_reference',li.invoice_reference,
    'description',li.description,'gl_code',li.gl_code,'amount',li.amount,
    'invoice_document_on_file',exists(
      select 1 from public.pv_invoice_documents d
      where d.voucher_id=v.id and d.line_item_id=li.id)
  ) order by li.line_no,li.id),'[]'::jsonb)
  into v_lines from public.pv_line_items li where li.voucher_id=v.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'approval_round',a.approval_round,
    'tier',a.tier,'action',a.action,'actor',coalesce(p.username,'Unknown'),
    'actor_id',a.actor_id,'remarks',a.remarks,'occurred_at',a.created_at
  ) order by a.created_at,a.id),'[]'::jsonb)
  into v_approvals
  from public.pv_approval_actions a
  left join public.user_profiles p on p.id=a.actor_id
  where a.voucher_id=v.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'installment_no',t.installment_no,
    'status',t.status,
    'requested_amount',t.requested_amount,
    'settled_amount',case when t.status='paid'
       then t.settled_amount else null end,
    'payment_date',t.payment_date,
    'bank_reference',t.bank_transaction_reference,
    'initiated_at',t.initiated_at,'initiated_by',coalesce(initiator.username,''),
    'review_decision',t.review_decision,'reviewed_at',t.reviewed_at,
    'reviewed_by',coalesce(reviewer.username,''),
    'review_remarks',t.review_remarks,
    'completed_at',t.completed_at,'completed_by',coalesce(completer.username,''),
    'initiated_proof_on_file',t.initiation_proof_path is not null,
    'final_receipt_on_file',t.final_receipt_path is not null
  ) order by t.installment_no,t.created_at,t.id),'[]'::jsonb)
  into v_payments
  from public.pv_payment_transactions t
  left join public.user_profiles initiator on initiator.id=t.initiated_by
  left join public.user_profiles reviewer on reviewer.id=t.reviewed_by
  left join public.user_profiles completer on completer.id=t.completed_by
  where t.voucher_id=v.id;


  -- Actual payment lifecycle: chronological events, separate from decisions.
  -- Do not expose raw audit JSON or private storage paths in the official PDF.
  select coalesce(jsonb_agg(jsonb_build_object(
    'action',ev.action,'actor',coalesce(u.username,'Unknown'),
    'occurred_at',ev.created_at,
    'remark',coalesce(ev.details->>'remarks',ev.details->>'reason')
  ) order by ev.created_at,ev.id),'[]'::jsonb)
  into v_payment_events
  from public.pv_audit_events ev
  left join public.user_profiles u on u.id=ev.actor_id
  where ev.voucher_id=v.id
    and (ev.action like 'payment_%'
         or ev.action like 'jims_v2_installment_%'
         or ev.action='executive_payment_remarks_updated');

  if v.payment_mode='partial' then
    select coalesce(sum(coalesce(t.settled_amount,0)),0)::numeric(18,2)
      into v_paid from public.pv_payment_transactions t
      where t.voucher_id=v.id and t.status='paid';
  elsif v.payment_status='paid' then
    v_paid:=coalesce(v.amount,0)::numeric(18,2);
  else
    v_paid:=0;
  end if;

  if v_paid<0 or v_paid>coalesce(v.amount,0)+0.01 then
    raise exception 'PV financial ledger is inconsistent; PDF generation halted'
      using errcode='22003';
  end if;
  v_outstanding:=greatest(coalesce(v.amount,0)-v_paid,0)::numeric(18,2);

  select jsonb_build_object(
    'branch',m.branch_code,'cost_center',m.cost_center,
    'charge_department',m.charge_department,'charge_subdepartment',m.charge_subdepartment,
    'requester_branch',m.requester_branch
  ) into v_metadata
  from private.jims_financial_metadata_v1 m
  where m.source_type='payment_voucher' and m.source_id=v.id;

  select jsonb_build_object(
    'original_due_date',d.original_due_date,'supplier_due_date',d.current_due_date,
    'fm_verified_at',d.fm_validated_at,
    'fm_schedule',(
      select s.approved_date from private.jims_57d3_schedule_v1 s
      where s.voucher_id=v.id and s.transaction_id is null limit 1)
  ) into v_due
  from private.jims_57d3_due_v1 d
  where d.voucher_id=v.id;

  return jsonb_build_object(
    'document_type','JAUHAR OFFICIAL PAYMENT VOUCHER',
    'document_version','JIMS-57D2-V1',
    'generated_at',clock_timestamp(),
    'generated_by',v_staff.username,
    'voucher',jsonb_build_object(
      'id',v.id,'pv_number',v.pv_number,
      'financial_tier',v.financial_tier,'status',v.status,
      'payment_status',v.payment_status,'payment_mode',v.payment_mode,
      'approval_round',v.approval_round,
      'created_at',v.created_at,'final_approval_at',v.final_approval_date,
      'payee_name',v.payee_name,'supplier_code',v.supplier_code,
      'supplier_tin',v.supplier_tin,
      'branch',coalesce(v_metadata->>'branch',v.branch_department),
      'origin_department',v.origin_department,
      'cost_center',v_metadata->>'cost_center',
      'charge_department',v_metadata->>'charge_department',
      'bank_name',v.bank_name,'bank_account_no',v.bank_account_no,
      'payment_method',v.payment_method,'payment_category',v.payment_category,
      'payment_type',v.payment_type,'expense_nature',v.expense_nature,
      'budget_classification',v.budget_classification,
      'description',v.description,'remarks',v.remarks,
      'sst_amount',v.sst_amount,'approved_amount',v.amount,
      'source_voucher_no',v.source_voucher_no,
      'source_pv_date',v.source_pv_date,
      'payment_date',v.payment_date,
      'payment_recorded_at',v.paid_recorded_at,
      'bank_reference',v.transaction_cheque_no,
      'payment_executive_remarks',v.executive_payment_remarks,
      'receipt_on_file',v.receipt_path is not null,
      'initiation_proof_on_file',v.payment_initiation_proof_path is not null,
      'payment_initiation_date',v.payment_initiated_at,
      'fm_payment_review_decision',v.payment_initiation_manager_decision,
      'fm_payment_review_date',v.payment_initiation_reviewed_at,
      'fm_payment_review_remarks',v.payment_initiation_manager_remarks
    ),
    'supplier_obligation',v_due,
    'invoice_lines',v_lines,
    'approval_history',v_approvals,
    'payment_transactions',v_payments,
    'payment_events',v_payment_events,
    'financial_summary',jsonb_build_object(
      'approved_amount',v.amount,'settled_paid_amount',v_paid,
      'outstanding_amount',v_outstanding,'currency','MYR'
    ),
    'disclaimer','JIMS system-generated read-only record. Approval is not proof of bank payment. Paid amounts reflect recorded settlement only.'
  );
end
$jims$;

revoke all on function public.jims_57d2_official_pv_snapshot_v1(uuid) from public,anon,authenticated;
grant execute on function public.jims_57d2_official_pv_snapshot_v1(uuid) to authenticated;
comment on function public.jims_57d2_official_pv_snapshot_v1(uuid)
is 'Read-only authorized official approved PV snapshot for system generated PDF; tracks approval and full/partial actual payment history, no mutation.';
commit;
