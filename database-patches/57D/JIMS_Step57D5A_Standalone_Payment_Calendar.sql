-- JIMS Step 57D5A — standalone Payment Calendar, role-checked read-only data.
-- Dates: SUPPLIER DUE (obligation), never FM schedule. Overdue separate from calendar.
-- One row per approved PV; partial paid sums only completed, paid installments.
create or replace function public.jims_57d5_payment_calendar_v1()
returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_role text;
  v_records jsonb;
  v_today date := (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_count int;
begin
  v_role:=private.jims_57d3_role_v1();
  if v_role not in ('ap_executive','finance_manager','ceo','bod','system_admin') then
    raise exception 'Payment Calendar access denied' using errcode='42501';
  end if;
  select count(*) into v_count
  from public.payment_vouchers v
  where v.status='fully_approved' and v.archived_at is null;
  if v_count>2000 then
    raise exception 'Calendar has more than 2000 approved PVs; pagination required before listing'
      using errcode='54000';
  end if;

  with paid_partial as (
    select t.voucher_id,
      coalesce(sum(coalesce(t.settled_amount,0))
        filter(where t.status='paid'),0)::numeric as paid_amount,
      max(t.payment_date) filter(where t.status='paid') as last_payment_date
    from public.pv_payment_transactions t
    group by t.voucher_id
  ), base as (
    select
      v.id,v.pv_number,v.payee_name,v.amount,
      v.payment_mode,v.payment_status,v.payment_date,
      coalesce(m.branch_code,v.branch_department) as branch,
      d.original_due_date,d.current_due_date,d.fm_validated_at,
      sched.proposed_date,sched.first_approved_date,sched.approved_date,
      case
        when v.payment_mode='partial' then coalesce(pp.paid_amount,0)
        when v.payment_mode='full' and v.payment_status='paid' then v.amount
        else 0 end::numeric as paid_amount,
      case when v.payment_mode='partial' then pp.last_payment_date
           when v.payment_status='paid' then v.payment_date else null end as last_payment_date
    from public.payment_vouchers v
    left join private.jims_financial_metadata_v1 m
      on m.source_type='payment_voucher' and m.source_id=v.id
    left join private.jims_57d3_due_v1 d on d.voucher_id=v.id
    left join private.jims_57d3_schedule_v1 sched
      on sched.voucher_id=v.id and sched.transaction_id is null
    left join paid_partial pp on pp.voucher_id=v.id
    where v.status='fully_approved' and v.archived_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
     'id',b.id,'pv_number',b.pv_number,'payee_name',b.payee_name,
     'branch',b.branch,'amount',b.amount,'payment_mode',b.payment_mode,
     'payment_status',b.payment_status,
     'paid_amount',b.paid_amount,
     'outstanding_amount',greatest(b.amount-b.paid_amount,0),
     'last_payment_date',b.last_payment_date,
     'original_due_date',b.original_due_date,
     'current_due_date',b.current_due_date,
     'due_verified',b.fm_validated_at is not null,
     'ap_proposed_date',b.proposed_date,
     'first_scheduled_date',b.first_approved_date,
     'fm_scheduled_date',b.approved_date,
     'calendar_status',case
       when greatest(b.amount-b.paid_amount,0)<=0 then 'paid'
       when b.current_due_date is null then 'missing_due'
       when b.current_due_date<v_today then 'overdue'
       when b.current_due_date=v_today then 'due_today'
       else 'upcoming' end,
     'transactions',coalesce((
       select jsonb_agg(jsonb_build_object(
         'id',t.id,'voucher_id',t.voucher_id,
         'installment_no',t.installment_no,
         'status',t.status,'requested_amount',t.requested_amount,
         'settled_amount',t.settled_amount,'payment_date',t.payment_date,
         'first_scheduled_date',ts.first_approved_date,
         'fm_scheduled_date',ts.approved_date,
         'ap_proposed_date',ts.proposed_date
       ) order by t.installment_no,t.created_at,t.id)
       from public.pv_payment_transactions t
       left join private.jims_57d3_schedule_v1 ts
         on ts.transaction_id=t.id and ts.voucher_id=t.voucher_id
       where t.voucher_id=b.id
     ),'[]'::jsonb)
   ) order by b.current_due_date nulls last,b.pv_number,b.id),'[]'::jsonb)
  into v_records
  from base b;

  return jsonb_build_object(
    'role',v_role,
    'today',v_today,
    'records',v_records,
    'count',coalesce(jsonb_array_length(v_records),0),
    'rules','Due date is supplier contractual obligation; FM schedule never replaces due. Tranche paid amounts count only paid settlements.'
  );
end
$function$;

revoke all on function public.jims_57d5_payment_calendar_v1() from public,anon,authenticated;
grant execute on function public.jims_57d5_payment_calendar_v1() to authenticated;
comment on function public.jims_57d5_payment_calendar_v1()
is '57D5 read-only calendar for authorized Finance AP/FM CEO BOD and read-only System Admin. No payment or approval mutation.';
