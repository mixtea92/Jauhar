-- JIMS Step 57D3.7 — AP Payment Process Audit Export.
-- Additive authorized reporting only. No PV/PC/payment mutation or approval access.
-- Amounts: full paid comes from recorded full-PV completion; partial paid only from
-- transactions with status='paid'. Outstanding is calculated ONCE per PV.
create or replace function public.jims_57d3_payment_process_audit_export_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_tranches jsonb;
  v_changes jsonb;
  v_max integer := 20000;
begin
  if not public.jims_can_export_ap_history_v1() then
    raise exception 'AP/Accounting operational report access required'
      using errcode='42501';
  end if;
  if (select count(*) from public.payment_vouchers)>v_max
     or (select count(*) from public.pv_payment_transactions)>v_max
     or (select count(*) from private.jims_57d3_audit_v1)>v_max then
    raise exception 'Payment Process audit export exceeds safe limit; use a scoped archival report'
      using errcode='54000';
  end if;

  with partial_paid as (
    select t.voucher_id,
       coalesce(sum(coalesce(t.settled_amount,0)) filter(where t.status='paid'),0)::numeric(18,2) as paid,
       max(t.payment_date) filter(where t.status='paid') as last_payment_date
    from public.pv_payment_transactions t
    group by t.voucher_id
  ), payment_rows as (
    select v.*,m.branch_code as metadata_branch,m.cost_center,m.charge_department,
       m.charge_subdepartment,m.budget_code,
       d.original_due_date,d.current_due_date,d.fm_validated_at,
       s.first_approved_date,s.approved_date,s.proposed_date,
       case when v.payment_mode='partial' then coalesce(pp.paid,0)
         when v.payment_status='paid' then coalesce(v.payment_amount,v.amount)
         else 0 end::numeric(18,2) as total_paid,
       case when v.payment_mode='partial' then pp.last_payment_date
         when v.payment_status='paid' then v.payment_date else null end as last_paid_date,
       exists (select 1 from private.jims_57d3_schedule_v1 ts
               where ts.voucher_id=v.id and ts.transaction_id is not null) as has_tranche_plan
    from public.payment_vouchers v
    left join private.jims_financial_metadata_v1 m
      on m.source_type='payment_voucher' and m.source_id=v.id
    left join private.jims_57d3_due_v1 d on d.voucher_id=v.id
    left join private.jims_57d3_schedule_v1 s
      on s.voucher_id=v.id and s.transaction_id is null
    left join partial_paid pp on pp.voucher_id=v.id
    where v.status='fully_approved'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'pv_number',v.pv_number,'supplier',v.payee_name,'invoice_reference',v.invoice_reference,
    'tier',v.financial_tier,'branch',coalesce(v.metadata_branch,v.branch_department),
    'department',v.charge_department,'subdepartment',v.charge_subdepartment,
    'cost_center',v.cost_center,'budget_code',v.budget_code,
    'payment_mode',v.payment_mode,'payment_status',v.payment_status,
    'approved_amount',v.amount,'paid_amount',v.total_paid,
    'outstanding_amount',greatest(v.amount-v.total_paid,0),
    'original_due_date',v.original_due_date,'current_due_date',v.current_due_date,
    'due_verified',v.fm_validated_at is not null,
    'first_scheduled_date',v.first_approved_date,'current_scheduled_date',v.approved_date,
    'ap_proposed_date',v.proposed_date,
    'schedule_scope',case when v.has_tranche_plan then 'Tranche plan available' else 'PV level / none' end,
    'last_actual_payment_date',v.last_paid_date,
    'full_payment_bank_reference',case when v.payment_mode='full' and v.payment_status='paid'
       then v.transaction_cheque_no else null end,
    'due_status',case
      when greatest(v.amount-v.total_paid,0)<=0 then
        case when v.last_paid_date is not null and v.current_due_date is not null
                       and v.last_paid_date>v.current_due_date then 'Paid Late'
             else 'Paid' end
      when v.current_due_date is null then 'Due Date Not Recorded'
      when v.current_due_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then 'Overdue'
      when v.current_due_date = (now() at time zone 'Asia/Kuala_Lumpur')::date then 'Due Today'
      else 'Within Terms' end,
    'pv_created_at',v.created_at,'final_approved_at',v.final_approval_date,
    'archived',v.archived_at is not null
  ) order by v.pv_number,v.id),'[]'::jsonb)
  into v_summary from payment_rows v;

  -- Tranches are detailed evidence rows only: NEVER sum PV approved/outstanding
  -- from this sheet; those aggregate amounts appear once per PV in Summary.
  select coalesce(jsonb_agg(jsonb_build_object(
    'pv_number',v.pv_number,'supplier',v.payee_name,
    'tranche_no',t.installment_no,'transaction_id',t.id,
    'requested_amount',t.requested_amount,
    'settled_paid_amount',case when t.status='paid' then coalesce(t.settled_amount,0) else 0 end,
    'tranche_status',t.status,'fm_review',t.review_decision,
    'review_remarks',t.review_remarks,
    'original_due_date',d.original_due_date,'current_due_date',d.current_due_date,
    'first_scheduled_date',coalesce(ts.first_approved_date,s.first_approved_date),
    'current_scheduled_date',coalesce(ts.approved_date,s.approved_date),
    'schedule_source',case when ts.id is not null then 'Tranche' when s.id is not null then 'PV' else 'Not recorded' end,
    'ap_proposed_date',coalesce(ts.proposed_date,s.proposed_date),
    'actual_payment_date',case when t.status='paid' then t.payment_date else null end,
    'bank_reference',case when t.status='paid' then t.bank_transaction_reference else null end,
    'initiated_at',t.initiated_at,'reviewed_at',t.reviewed_at,
    'completed_at',t.completed_at,'voided_at',t.voided_at,
    'void_reason',t.void_reason,'created_at',t.created_at
  ) order by v.pv_number,t.installment_no,t.created_at,t.id),'[]'::jsonb)
  into v_tranches
  from public.pv_payment_transactions t
  join public.payment_vouchers v on v.id=t.voucher_id and v.status='fully_approved'
  left join private.jims_57d3_due_v1 d on d.voucher_id=v.id
  left join private.jims_57d3_schedule_v1 ts on ts.transaction_id=t.id
  left join private.jims_57d3_schedule_v1 s on s.voucher_id=v.id and s.transaction_id is null;

  -- No approval decisions or approval history included: preserves System Owner gate.
  select coalesce(jsonb_agg(jsonb_build_object(
    'pv_number',v.pv_number,'tranche_no',t.installment_no,
    'event',a.event_type,
    'previous_date',a.old_value,'new_date',a.new_value,
    'reason',a.reason,'supplier_evidence_reference',a.supplier_evidence_reference,
    'actor_username',coalesce(p.username,'Account unavailable'),
    'actor_id',a.actor_id,'actor_role',a.actor_role,
    'actor_department',a.actor_department,'actor_subdepartment',a.actor_subdepartment,
    'actor_branch',a.actor_branch,'actor_cost_center',a.actor_cost_center,
    'event_time',a.created_at
  ) order by v.pv_number,a.created_at,a.id),'[]'::jsonb)
  into v_changes
  from private.jims_57d3_audit_v1 a
  join public.payment_vouchers v on v.id=a.voucher_id and v.status='fully_approved'
  left join public.pv_payment_transactions t on t.id=a.transaction_id
  left join public.user_profiles p on p.id=a.actor_id;

  return jsonb_build_object(
    'payment_planning_summary',v_summary,
    'payment_planning_tranches',v_tranches,
    'payment_planning_changes',v_changes,
    'generated_at',clock_timestamp(),
    'report_type','AP Payment Process Planning Audit',
    'amount_basis','Summary contains one amount per approved PV. Tranches are detail only. Only paid tranche settlements count as paid.'
  );
end
$$;
revoke all on function public.jims_57d3_payment_process_audit_export_v1() from public,anon,authenticated;
grant execute on function public.jims_57d3_payment_process_audit_export_v1() to authenticated;
comment on function public.jims_57d3_payment_process_audit_export_v1() is
'JIMS 57D3.7 operational planning audit report; AP/Accounting export gate; no Owner-only approval histories.';
