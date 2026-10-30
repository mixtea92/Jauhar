-- JIMS 57D3C — Safe planning integrity gates.
-- Supplier obligation must be logged before payment completion, and validated by
-- Finance Manager before FM approves the payment schedule. Existing PV workflows unaffected.
create or replace function private.jims_57d3_due_insert_gate_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_status text;
begin
 select payment_status into v_status from public.payment_vouchers where id=new.voucher_id;
 if not found then raise exception 'PV does not exist'; end if;
 if v_status='paid' then
   raise exception 'Cannot backfill an obligation date on a fully Paid PV; preserve historical KPI integrity';
 end if;
 return new;
end
$$;
drop trigger if exists jims_57d3_due_insert_gate on private.jims_57d3_due_v1;
create trigger jims_57d3_due_insert_gate
before insert on private.jims_57d3_due_v1
for each row execute function private.jims_57d3_due_insert_gate_v1();

create or replace function private.jims_57d3_schedule_approval_gate_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare verified_at timestamptz;
begin
 if new.approved_date is not null then
   select fm_validated_at into verified_at from private.jims_57d3_due_v1
   where voucher_id=new.voucher_id;
   if verified_at is null then
      raise exception 'Finance Manager must validate supplier Due Date before approving a payment schedule';
   end if;
 end if;
 return new;
end
$$;
drop trigger if exists jims_57d3_schedule_approval_gate on private.jims_57d3_schedule_v1;
create trigger jims_57d3_schedule_approval_gate
before insert or update of approved_date on private.jims_57d3_schedule_v1
for each row execute function private.jims_57d3_schedule_approval_gate_v1();
revoke all on function private.jims_57d3_due_insert_gate_v1(),
 private.jims_57d3_schedule_approval_gate_v1() from public,anon,authenticated;
