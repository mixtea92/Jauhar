-- JIMS 57D3D — KPI actor organization snapshots and append-only audit protection.
-- Prevents historical KPI attribution from changing when employee switches branch / role.
alter table private.jims_57d3_audit_v1
  add column if not exists actor_department text,
  add column if not exists actor_subdepartment text,
  add column if not exists actor_branch text,
  add column if not exists actor_cost_center text;

create or replace function private.jims_57d3_snapshot_actor_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 select p.department,p.subdepartment,p.branch,p.cost_center
 into new.actor_department,new.actor_subdepartment,new.actor_branch,new.actor_cost_center
 from public.user_profiles p where p.id=new.actor_id;
 if not found then raise exception 'Unknown KPI event actor'; end if;
 return new;
end
$$;

drop trigger if exists jims_57d3_snapshot_actor_trg on private.jims_57d3_audit_v1;
create trigger jims_57d3_snapshot_actor_trg
before insert on private.jims_57d3_audit_v1
for each row execute function private.jims_57d3_snapshot_actor_v1();

create or replace function private.jims_57d3_block_audit_mutation_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 raise exception 'JIMS Payment Planning Audit is append-only; updates and deletes are forbidden';
end
$$;
drop trigger if exists jims_57d3_block_audit_mutation_trg on private.jims_57d3_audit_v1;
create trigger jims_57d3_block_audit_mutation_trg
before update or delete on private.jims_57d3_audit_v1
for each row execute function private.jims_57d3_block_audit_mutation_v1();

revoke all on function private.jims_57d3_snapshot_actor_v1(),private.jims_57d3_block_audit_mutation_v1()
 from public,anon,authenticated;
