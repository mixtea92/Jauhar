-- JIMS 57D4A — Cross-PV duplicate-invoice discovery and submission gate.
-- Additive only. No changes to existing approval RPCs, PV ledger or existing PV records.
-- Existing approved records are left untouched; this applies to new Draft/Returned submissions.
create or replace function private.jims_57d4_invoice_key_v1(p_value text)
returns text language sql immutable set search_path='' as $$
  select upper(regexp_replace(btrim(coalesce(p_value,'')),'[[:space:]]+','','g'))
$$;
create or replace function private.jims_57d4_name_key_v1(p_value text)
returns text language sql immutable set search_path='' as $$
  select lower(regexp_replace(btrim(coalesce(p_value,'')),'[[:space:]]+',' ','g'))
$$;

-- Internal only: one match per invoice reference + existing PV, never same PV.
create or replace function private.jims_57d4_find_conflicts_v1(
 p_payee text,p_supplier_code text,p_supplier_tin text,
 p_refs jsonb,p_exclude_pv uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare result jsonb;
begin
 if p_refs is null or jsonb_typeof(p_refs)<>'array'
  or jsonb_array_length(p_refs)>100 then
   raise exception 'Invoice reference list must contain at most 100 items';
 end if;
 with requested as (
   select distinct private.jims_57d4_invoice_key_v1(value) invoice_key
   from jsonb_array_elements_text(p_refs)
   where nullif(private.jims_57d4_invoice_key_v1(value),'') is not null
 ), matches as (
   select distinct on (req.invoice_key,p.id)
     req.invoice_key,l.invoice_reference,p.pv_number,p.status,p.branch_department,p.id
   from requested req
   join public.pv_line_items l
     on private.jims_57d4_invoice_key_v1(l.invoice_reference)=req.invoice_key
   join public.payment_vouchers p on p.id=l.voucher_id
   where p.archived_at is null
     and p.status<>'rejected'
     and (p_exclude_pv is null or p.id<>p_exclude_pv)
     and (
       (private.jims_57d4_invoice_key_v1(p_supplier_code)<>''
        and private.jims_57d4_invoice_key_v1(p.supplier_code)
          =private.jims_57d4_invoice_key_v1(p_supplier_code))
       or (private.jims_57d4_invoice_key_v1(p_supplier_tin)<>''
        and private.jims_57d4_invoice_key_v1(p.supplier_tin)
          =private.jims_57d4_invoice_key_v1(p_supplier_tin))
       or (private.jims_57d4_name_key_v1(p_payee)<>''
        and private.jims_57d4_name_key_v1(p.payee_name)
          =private.jims_57d4_name_key_v1(p_payee))
     )
   order by req.invoice_key,p.id,l.id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
    'invoice_reference',m.invoice_reference,'existing_pv',m.pv_number,
    'existing_status',m.status,'existing_branch',m.branch_department)
   order by m.invoice_key,m.pv_number),'[]'::jsonb)
 into result from matches m;
 return result;
end
$$;

-- UI draft validation. Authorized Finance AP staff only; do not expose unrelated PV details.
create or replace function public.jims_57d4_check_draft_v1(
 p_payee_name text,p_supplier_code text,p_supplier_tin text,
 p_invoice_references jsonb,p_exclude_pv uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare matches jsonb;
begin
 if auth.uid() is null or not exists(
    select 1 from public.user_profiles p
    where p.id=auth.uid() and p.is_active is true
      and p.department='Finance'
      and p.role in ('executive','manager')
      and p.subdepartment in ('Accounts Payable','Accounting')
 ) then raise exception 'Only authorized Finance AP users can check invoice references'
   using errcode='42501'; end if;
 if p_exclude_pv is not null and not exists(
   select 1 from public.payment_vouchers v
   where v.id=p_exclude_pv and public.jauhar_is_current_requester_v1(v.id)
     and v.status in ('draft','returned') and v.archived_at is null
 ) then raise exception 'Draft voucher unavailable for comparison'
   using errcode='42501'; end if;
 matches:=private.jims_57d4_find_conflicts_v1(p_payee_name,p_supplier_code,
   p_supplier_tin,p_invoice_references,p_exclude_pv);
 return jsonb_build_object('duplicate',jsonb_array_length(matches)>0,'matches',matches);
end
$$;

-- UI submission preflight: logs blocked attempts without throwing, so the
-- append-only audit survives this committed RPC. The status-changing trigger below
-- independently blocks even when a client bypasses preflight.
create or replace function public.jims_57d4_preflight_submit_v1(p_voucher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_actor uuid:=auth.uid();
 v_pv public.payment_vouchers;
 v_refs jsonb;
 v_matches jsonb;
begin
 if v_actor is null or not exists(
  select 1 from public.user_profiles p
  where p.id=v_actor and p.is_active is true and p.department='Finance'
    and p.role='executive' and p.subdepartment='Accounts Payable'
 ) then raise exception 'AP Executive Finance required' using errcode='42501';end if;
 select * into v_pv from public.payment_vouchers
 where id=p_voucher_id and archived_at is null for update;
 if not found or v_pv.status not in ('draft','returned')
    or not public.jauhar_is_current_requester_v1(p_voucher_id)
 then raise exception 'Only your current Draft/Returned PV can be submitted'
   using errcode='42501';end if;
 select coalesce(jsonb_agg(l.invoice_reference),'[]'::jsonb) into v_refs
 from public.pv_line_items l where l.voucher_id=v_pv.id;
 v_matches:=private.jims_57d4_find_conflicts_v1(
   v_pv.payee_name,v_pv.supplier_code,v_pv.supplier_tin,v_refs,v_pv.id);
 if jsonb_array_length(v_matches)>0 then
    insert into public.pv_audit_events(voucher_id,actor_id,action,details)
    values(v_pv.id,v_actor,'duplicate_invoice_submit_blocked',
      jsonb_build_object('matches',v_matches,'blocked_at','preflight',
        'source','JIMS_57D4','approval_round',v_pv.approval_round));
 end if;
 return jsonb_build_object('can_submit',jsonb_array_length(v_matches)=0,
    'matches',v_matches,'status',v_pv.status);
end
$$;

-- Final database guard: covers all status-changing submission RPCs, not just one tier.
create or replace function private.jims_57d4_block_duplicate_submit_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_refs jsonb; v_matches jsonb; ref record;
begin
 if old.status not in ('draft','returned')
   or new.status not in ('pending_hod','pending_ap_finance','pending_manager',
                        'pending_finance_manager','pending_ceo','pending_bod')
 then return new;end if;
 -- Serialize all submissions with a matching invoice number (even across suppliers).
 -- Acquire in sorted order to avoid deadlocks between multi-invoice vouchers.
 for ref in
  select distinct private.jims_57d4_invoice_key_v1(l.invoice_reference) invoice_key
  from public.pv_line_items l where l.voucher_id=new.id
    and nullif(private.jims_57d4_invoice_key_v1(l.invoice_reference),'') is not null
  order by 1
 loop
   perform pg_catalog.pg_advisory_xact_lock(
     pg_catalog.hashtextextended(ref.invoice_key,574));
 end loop;
 select coalesce(jsonb_agg(l.invoice_reference),'[]'::jsonb) into v_refs
 from public.pv_line_items l where l.voucher_id=new.id;
 v_matches:=private.jims_57d4_find_conflicts_v1(
   new.payee_name,new.supplier_code,new.supplier_tin,v_refs,new.id);
 if jsonb_array_length(v_matches)>0 then
   raise exception
      'Duplicate supplier invoice found in another PV. Review the existing PV before submitting.'
      using errcode='23505',
        hint='Use Payment Voucher draft duplicate warning to see matching PV number(s).';
 end if;
 return new;
end
$$;
drop trigger if exists jims_57d4_block_duplicate_submit_trg on public.payment_vouchers;
create trigger jims_57d4_block_duplicate_submit_trg
before update of status on public.payment_vouchers
for each row execute function private.jims_57d4_block_duplicate_submit_v1();

revoke all on function private.jims_57d4_invoice_key_v1(text) from public,anon,authenticated;
revoke all on function private.jims_57d4_name_key_v1(text) from public,anon,authenticated;
revoke all on function private.jims_57d4_find_conflicts_v1(text,text,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function private.jims_57d4_block_duplicate_submit_v1() from public,anon,authenticated;
revoke all on function public.jims_57d4_check_draft_v1(text,text,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.jims_57d4_preflight_submit_v1(uuid) from public,anon,authenticated;
grant execute on function public.jims_57d4_check_draft_v1(text,text,text,jsonb,uuid) to authenticated;
grant execute on function public.jims_57d4_preflight_submit_v1(uuid) to authenticated;
comment on function public.jims_57d4_check_draft_v1(text,text,text,jsonb,uuid)
 is '57D4 draft cross-PV duplicate invoice warning, Finance AP only; no PV mutation.';
comment on function public.jims_57d4_preflight_submit_v1(uuid)
 is '57D4 AP submit duplicate preflight; logs blocked attempts separately so the audit survives a refused submit.';
