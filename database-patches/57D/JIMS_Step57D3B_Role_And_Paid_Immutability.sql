-- JIMS 57D3B SECURITY HARDENING: AP-only scheduling (not Accounting) and paid-PV immutability.
-- Does not touch existing PV approval/payment workflows.
create or replace function private.jims_57d3_role_v1()
returns text language plpgsql security definer set search_path=''
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
 if r='executive' and d='Finance' and s='Accounts Payable' then return 'ap_executive'; end if;
 raise exception 'Payment planning is restricted to Finance AP, Finance Manager, CEO, BOD and read-only System Admin';
end
$$;

create or replace function private.jims_57d3_assert_tranche_v1(p_voucher_id uuid,p_transaction_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_status text; v_mode text;
begin
 if p_transaction_id is null then return; end if;
 select payment_mode into v_mode from public.payment_vouchers where id=p_voucher_id;
 if v_mode<>'partial' then raise exception 'Tranche-level schedules are only for Partial Payment PVs'; end if;
 select t.status into v_status from public.pv_payment_transactions t
 where t.id=p_transaction_id and t.voucher_id=p_voucher_id;
 if not found then raise exception 'Payment tranche not found in the selected PV'; end if;
 if v_status in ('paid','completed','voided','cancelled') then raise exception 'A completed/voided tranche cannot be rescheduled'; end if;
end
$$;

create or replace function public.jims_57d3_manager_due_v1(
 p_voucher_id uuid,p_due_date date,p_reason text default null,p_supplier_evidence_reference text default null)
returns jsonb language plpgsql security definer set search_path=''
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
 if is_change and v.payment_status='paid' then
   raise exception 'Cannot amend supplier obligation after PV has been fully Paid; historical records must remain unchanged';
 end if;
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
revoke all on function private.jims_57d3_role_v1(),private.jims_57d3_assert_tranche_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.jims_57d3_manager_due_v1(uuid,date,text,text) from public,anon,authenticated;
grant execute on function public.jims_57d3_manager_due_v1(uuid,date,text,text) to authenticated;
