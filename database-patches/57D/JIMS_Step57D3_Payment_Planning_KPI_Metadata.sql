-- JIMS STEP 57D3: Payment obligation + scheduling + KPI-ready audit
-- Additive only. NO changes to existing Payment Voucher / Payment Process functions or workflow.
-- 2026-10-31. DUE DATE is supplier obligation; FM schedule DOES NOT overwrite it.
begin;

create table if not exists private.jims_57d3_due_v1 (
  voucher_id uuid primary key references public.payment_vouchers(id),
  original_due_date date not null,
  current_due_date date not null,
  first_recorded_by uuid not null references auth.users(id),
  first_recorded_at timestamptz not null default clock_timestamp(),
  last_changed_by uuid references auth.users(id),
  last_changed_at timestamptz,
  fm_validated_by uuid references auth.users(id),
  fm_validated_at timestamptz,
  constraint jims_57d3_due_date_year_check check (original_due_date between date '2000-01-01' and date '2100-12-31' and current_due_date between date '2000-01-01' and date '2100-12-31')
);

create table if not exists private.jims_57d3_schedule_v1 (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.payment_vouchers(id),
  transaction_id uuid references public.pv_payment_transactions(id),
  proposed_date date,
  proposed_by uuid references auth.users(id),
  proposed_at timestamptz,
  first_approved_date date,
  approved_date date,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint jims_57d3_schedule_proposal_pair check ((proposed_date is null) = (proposed_by is null)),
  constraint jims_57d3_schedule_approval_pair check ((approved_date is null) = (approved_by is null)),
  constraint jims_57d3_schedule_first_approved_immutable_base check (first_approved_date is null or approved_date is not null)
);
create unique index if not exists jims_57d3_schedule_one_per_voucher
  on private.jims_57d3_schedule_v1(voucher_id) where transaction_id is null;
create unique index if not exists jims_57d3_schedule_one_per_tranche
  on private.jims_57d3_schedule_v1(transaction_id) where transaction_id is not null;
create index if not exists jims_57d3_schedule_voucher_lookup on private.jims_57d3_schedule_v1(voucher_id);

create table if not exists private.jims_57d3_audit_v1 (
 id bigint generated always as identity primary key,
 voucher_id uuid not null references public.payment_vouchers(id),
 transaction_id uuid references public.pv_payment_transactions(id),
 event_type text not null check (event_type in ('due_recorded','due_validated','due_amended','schedule_proposed','schedule_approved','schedule_rescheduled')),
 actor_id uuid not null references auth.users(id),
 actor_role text not null,
 old_value date,
 new_value date,
 reason text,
 supplier_evidence_reference text,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists jims_57d3_audit_voucher_idx on private.jims_57d3_audit_v1(voucher_id,created_at);

alter table private.jims_57d3_due_v1 enable row level security;
alter table private.jims_57d3_schedule_v1 enable row level security;
alter table private.jims_57d3_audit_v1 enable row level security;
revoke all on private.jims_57d3_due_v1,private.jims_57d3_schedule_v1,private.jims_57d3_audit_v1 from public,anon,authenticated;
revoke all on sequence private.jims_57d3_audit_v1_id_seq from public,anon,authenticated;

-- A privileged function may read private planning data ONLY after verifying an active JIMS role.
create or replace function private.jims_57d3_role_v1()
returns text language plpgsql security definer set search_path = ''
as $$
declare r text; d text; s text;
begin
 select role,department,subdepartment into r,d,s
 from public.user_profiles where id=auth.uid() and is_active is true;
 if not found then raise exception 'An active JIMS session is required'; end if;
 if r='system_admin' then return 'system_admin'; end if;
 if r='ceo' then return 'ceo'; end if;
 if r='bod' then return 'bod'; end if;
 if r='manager' and d='Finance' then return 'finance_manager'; end if;
 if r='executive' and d='Finance' and s in ('Accounts Payable','Accounting') then return 'ap_executive'; end if;
 raise exception 'Payment planning is restricted to authorized Finance, CEO, BOD and read-only System Admin';
end
$$;

create or replace function private.jims_57d3_lock_pv_v1(p_voucher_id uuid)
returns public.payment_vouchers language plpgsql security definer set search_path = ''
as $$
declare v public.payment_vouchers;
begin
 select * into v from public.payment_vouchers
 where id=p_voucher_id and archived_at is null for update;
 if not found then raise exception 'Active Payment Voucher not found'; end if;
 if v.status <> 'fully_approved' then raise exception 'Payment planning is available only after final PV approval'; end if;
 return v;
end
$$;

create or replace function private.jims_57d3_assert_tranche_v1(p_voucher_id uuid,p_transaction_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_status text;
begin
 if p_transaction_id is null then return; end if;
 select t.status into v_status from public.pv_payment_transactions t
 where t.id=p_transaction_id and t.voucher_id=p_voucher_id;
 if not found then raise exception 'Payment tranche not found in the selected PV'; end if;
 if v_status in ('paid','completed','voided','cancelled') then raise exception 'A completed/voided tranche cannot be rescheduled'; end if;
end
$$;

-- Read-only: does not leak private tables beyond authorized roles and approved PV records.
create or replace function public.jims_57d3_get_planning_v1(p_voucher_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_role text; v_pv public.payment_vouchers;
begin
 v_role := private.jims_57d3_role_v1();
 select * into v_pv from public.payment_vouchers
 where id=p_voucher_id and archived_at is null;
 if not found or v_pv.status<>'fully_approved' then raise exception 'Approved Payment Voucher unavailable'; end if;
 return jsonb_build_object(
   'pv_id',v_pv.id,'pv_number',v_pv.pv_number,'payee_name',v_pv.payee_name,
   'amount',v_pv.amount,'payment_mode',v_pv.payment_mode,'payment_status',v_pv.payment_status,
   'role',v_role,
   'due',(select jsonb_build_object(
     'original_due_date',d.original_due_date,'current_due_date',d.current_due_date,
     'first_recorded_at',d.first_recorded_at,'fm_validated_at',d.fm_validated_at
   ) from private.jims_57d3_due_v1 d where d.voucher_id=p_voucher_id),
   'schedules',coalesce((select jsonb_agg(jsonb_build_object(
       'id',s.id,'transaction_id',s.transaction_id,
       'proposed_date',s.proposed_date,'first_approved_date',s.first_approved_date,
       'approved_date',s.approved_date,'approved_at',s.approved_at
     ) order by s.updated_at,s.id)
     from private.jims_57d3_schedule_v1 s where s.voucher_id=p_voucher_id),'[]'::jsonb),
   'audit',coalesce((select jsonb_agg(jsonb_build_object(
       'event_type',a.event_type,'transaction_id',a.transaction_id,'old_value',a.old_value,
       'new_value',a.new_value,'reason',a.reason,'supplier_evidence_reference',a.supplier_evidence_reference,
       'actor_id',a.actor_id,'actor_role',a.actor_role,'created_at',a.created_at
     ) order by a.id)
     from private.jims_57d3_audit_v1 a where a.voucher_id=p_voucher_id),'[]'::jsonb)
 );
end
$$;

-- AP records the contractual due date ONCE. FM can also initialize if AP did not.
-- Existing due date is never replaced with "scheduled date".
create or replace function public.jims_57d3_record_due_v1(p_voucher_id uuid,p_due_date date)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r text; v public.payment_vouchers;
begin
 r:=private.jims_57d3_role_v1();
 if r not in ('ap_executive','finance_manager') then raise exception 'Only AP Executive/Finance Manager can record payment obligation'; end if;
 if p_due_date is null or p_due_date not between date '2000-01-01' and date '2100-12-31' then raise exception 'Valid obligation due date required'; end if;
 v:=private.jims_57d3_lock_pv_v1(p_voucher_id);
 insert into private.jims_57d3_due_v1(voucher_id,original_due_date,current_due_date,first_recorded_by)
 values(p_voucher_id,p_due_date,p_due_date,auth.uid());
 insert into private.jims_57d3_audit_v1(voucher_id,event_type,actor_id,actor_role,new_value)
 values(p_voucher_id,'due_recorded',auth.uid(),r,p_due_date);
 return public.jims_57d3_get_planning_v1(p_voucher_id);
exception when unique_violation then
 raise exception 'Due date already exists. Only Finance Manager can approve an amendment with evidence.';
end
$$;

-- FM validates the AP-entered due date OR amends it with a supplier agreement reference.
-- Original obligation is immutable, and every change is a separate audit event.
create or replace function public.jims_57d3_manager_due_v1(
 p_voucher_id uuid,p_due_date date,p_reason text default null,p_supplier_evidence_reference text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r text; v public.payment_vouchers; d private.jims_57d3_due_v1; is_change boolean;
begin
 r:=private.jims_57d3_role_v1();
 if r<>'finance_manager' then raise exception 'Only Finance Manager may validate or amend a payment due date'; end if;
 v:=private.jims_57d3_lock_pv_v1(p_voucher_id);
 select * into d from private.jims_57d3_due_v1 where voucher_id=p_voucher_id for update;
 if not found then raise exception 'AP must first record a due date'; end if;
 if p_due_date is null or p_due_date not between date '2000-01-01' and date '2100-12-31' then raise exception 'Valid due date is required'; end if;
 is_change:=p_due_date is distinct from d.current_due_date;
 if is_change and (length(btrim(coalesce(p_reason,'')))<8 or length(btrim(coalesce(p_supplier_evidence_reference,'')))<5) then
   raise exception 'Due-date amendment requires a reason (8+ characters) and supplier agreement/evidence reference (5+ characters)';
 end if;
 if is_change then
   update private.jims_57d3_due_v1 set current_due_date=p_due_date,last_changed_by=auth.uid(),
     last_changed_at=clock_timestamp(),fm_validated_by=auth.uid(),fm_validated_at=clock_timestamp()
   where voucher_id=p_voucher_id;
 else
   update private.jims_57d3_due_v1 set fm_validated_by=auth.uid(),fm_validated_at=clock_timestamp()
   where voucher_id=p_voucher_id;
 end if;
 insert into private.jims_57d3_audit_v1(voucher_id,event_type,actor_id,actor_role,old_value,new_value,reason,supplier_evidence_reference)
 values(p_voucher_id,case when is_change then 'due_amended' else 'due_validated' end,auth.uid(),r,
   d.current_due_date,p_due_date,nullif(btrim(coalesce(p_reason,'')),''),nullif(btrim(coalesce(p_supplier_evidence_reference,'')),''));
 return public.jims_57d3_get_planning_v1(p_voucher_id);
end
$$;

-- AP proposes a schedule. The proposal never overrides an FM-approved schedule.
-- Transactions can optionally be targeted for partial payments.
create or replace function public.jims_57d3_propose_schedule_v1(
 p_voucher_id uuid,p_scheduled_date date,p_transaction_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r text; v public.payment_vouchers; s private.jims_57d3_schedule_v1; old_date date;
begin
 r:=private.jims_57d3_role_v1();
 if r<>'ap_executive' then raise exception 'Only AP Executive can propose a payment schedule'; end if;
 v:=private.jims_57d3_lock_pv_v1(p_voucher_id);
 if v.payment_status='paid' then raise exception 'Paid PV cannot be rescheduled'; end if;
 if p_scheduled_date is null or p_scheduled_date not between date '2000-01-01' and date '2100-12-31' then raise exception 'Valid scheduled payment date required'; end if;
 if not exists(select 1 from private.jims_57d3_due_v1 where voucher_id=p_voucher_id) then raise exception 'Record obligation due date before scheduling payment'; end if;
 perform private.jims_57d3_assert_tranche_v1(p_voucher_id,p_transaction_id);
 select * into s from private.jims_57d3_schedule_v1
 where voucher_id=p_voucher_id and transaction_id is not distinct from p_transaction_id for update;
 if found then
   old_date:=s.proposed_date;
   update private.jims_57d3_schedule_v1
   set proposed_date=p_scheduled_date,proposed_by=auth.uid(),proposed_at=clock_timestamp(),updated_at=clock_timestamp()
   where id=s.id;
 else
   insert into private.jims_57d3_schedule_v1(voucher_id,transaction_id,proposed_date,proposed_by,proposed_at)
   values(p_voucher_id,p_transaction_id,p_scheduled_date,auth.uid(),clock_timestamp());
 end if;
 insert into private.jims_57d3_audit_v1(voucher_id,transaction_id,event_type,actor_id,actor_role,old_value,new_value)
 values(p_voucher_id,p_transaction_id,'schedule_proposed',auth.uid(),r,old_date,p_scheduled_date);
 return public.jims_57d3_get_planning_v1(p_voucher_id);
end
$$;

-- FM sets/approves schedule. On reschedule old date stays in original + immutable audit.
-- Scheduling past the current supplier due date is permitted only with clear audit reason;
-- it does not erase overdue exposure.
create or replace function public.jims_57d3_manager_schedule_v1(
 p_voucher_id uuid,p_scheduled_date date,p_transaction_id uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r text; v public.payment_vouchers; s private.jims_57d3_schedule_v1; old_date date; due date; reschedule boolean;
begin
 r:=private.jims_57d3_role_v1();
 if r<>'finance_manager' then raise exception 'Only Finance Manager can approve or reschedule a payment'; end if;
 v:=private.jims_57d3_lock_pv_v1(p_voucher_id);
 if v.payment_status='paid' then raise exception 'Paid PV cannot be rescheduled'; end if;
 if p_scheduled_date is null or p_scheduled_date not between date '2000-01-01' and date '2100-12-31' then raise exception 'Valid scheduled payment date required'; end if;
 select current_due_date into due from private.jims_57d3_due_v1 where voucher_id=p_voucher_id;
 if not found then raise exception 'Record obligation due date before scheduling payment'; end if;
 perform private.jims_57d3_assert_tranche_v1(p_voucher_id,p_transaction_id);
 select * into s from private.jims_57d3_schedule_v1
 where voucher_id=p_voucher_id and transaction_id is not distinct from p_transaction_id for update;
 old_date:=s.approved_date;
 reschedule := old_date is not null and p_scheduled_date is distinct from old_date;
 if (reschedule or p_scheduled_date>due) and length(btrim(coalesce(p_reason,'')))<8 then
   raise exception 'FM reason (8+ characters) required for rescheduling or a scheduled payment beyond supplier due date';
 end if;
 if found then
   update private.jims_57d3_schedule_v1
   set first_approved_date=coalesce(first_approved_date,p_scheduled_date),
       approved_date=p_scheduled_date,approved_by=auth.uid(),approved_at=clock_timestamp(),
       proposed_date=null,proposed_by=null,proposed_at=null,updated_at=clock_timestamp()
   where id=s.id;
 else
   insert into private.jims_57d3_schedule_v1(voucher_id,transaction_id,first_approved_date,approved_date,approved_by,approved_at)
   values(p_voucher_id,p_transaction_id,p_scheduled_date,p_scheduled_date,auth.uid(),clock_timestamp());
 end if;
 insert into private.jims_57d3_audit_v1(voucher_id,transaction_id,event_type,actor_id,actor_role,old_value,new_value,reason)
 values(p_voucher_id,p_transaction_id,case when reschedule then 'schedule_rescheduled' else 'schedule_approved' end,
    auth.uid(),r,old_date,p_scheduled_date,nullif(btrim(coalesce(p_reason,'')),''));
 return public.jims_57d3_get_planning_v1(p_voucher_id);
end
$$;

revoke all on function private.jims_57d3_role_v1(),private.jims_57d3_lock_pv_v1(uuid),private.jims_57d3_assert_tranche_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.jims_57d3_get_planning_v1(uuid),
 public.jims_57d3_record_due_v1(uuid,date),
 public.jims_57d3_manager_due_v1(uuid,date,text,text),
 public.jims_57d3_propose_schedule_v1(uuid,date,uuid),
 public.jims_57d3_manager_schedule_v1(uuid,date,uuid,text)
 from public,anon,authenticated;
grant execute on function public.jims_57d3_get_planning_v1(uuid),
 public.jims_57d3_record_due_v1(uuid,date),
 public.jims_57d3_manager_due_v1(uuid,date,text,text),
 public.jims_57d3_propose_schedule_v1(uuid,date,uuid),
 public.jims_57d3_manager_schedule_v1(uuid,date,uuid,text)
 to authenticated;

comment on table private.jims_57d3_audit_v1 is
 'KPI-ready, append-only payment planning audit. Supplier due obligation and FM-approved schedule remain distinct; no existing PV approval/payment workflow is changed.';
comment on function public.jims_57d3_get_planning_v1(uuid) is
 'Role-checked planning detail: Finance AP/FM, CEO/BOD and System Admin read-only. Approved active PV only.';
commit;