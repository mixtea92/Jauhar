# JIMS 57D7A — Anonymous SECURITY DEFINER hardening

Date: 2026-11-01 (Asia/Kuala_Lumpur)
Supabase project: npaozikolbwlvnztvoef
GitHub branch: jsync-gui-revamp-20261029

## Purpose
Close 18 Supabase security advisor 0028 anonymous-executable SECURITY DEFINER findings without modifying business logic, privileges for authenticated/service roles, trigger definitions, application files, or financial data.

## Preconditions checked
- 9 ordinary callable functions were owned by postgres, with direct EXECUTE grants for anon, authenticated and service_role, no PUBLIC grant.
- 8 table-trigger functions and 1 event-trigger function had EXECUTE for PUBLIC, anon, authenticated and service_role.
- All 8 table-trigger functions remained attached (9 enabled trigger attachments); rls_auto_enable had 1 enabled event-trigger attachment.
- Both categories passed preflight assertions and transactional dry-run with ROLLBACK.
- This is a privilege change (DCL), not a function rewrite. No auth metadata or user passwords were read.

## Applied SQL (live, committed transaction)
```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION
  public.jauhar_can_stage_act_v1(uuid,text,text),
  public.jauhar_can_view_delegation_docs_v1(uuid),
  public.jauhar_delegation_dashboard_v1(),
  public.jauhar_invoice_object_exists(text),
  public.jauhar_is_current_requester_v1(uuid),
  public.jauhar_my_active_delegations_v1(),
  public.jauhar_my_current_handovers_v1(),
  public.jauhar_requester_at_v1(uuid,uuid,timestamp with time zone),
  public.jauhar_valid_approval_actor_v1(uuid,text,text,timestamp with time zone)
FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION
  public.jauhar_delegated_approval_gate_v1(),
  public.jauhar_delegated_payment_review_gate_v1(),
  public.jauhar_delegation_jr_meeting_gate_v1(),
  public.jauhar_handover_document_gate_v1(),
  public.jauhar_handover_owner_gate_v1(),
  public.jauhar_protect_archived_pv(),
  public.jauhar_protect_archived_pv_child(),
  public.jauhar_set_origin_department_v1(),
  public.rls_auto_enable()
FROM anon, PUBLIC;
COMMIT;
```

## Verified result
- 18 target functions: 0 accessible to anon; 18 accessible to authenticated and service_role.
- Supabase Security Advisor lint 0028: 18 -> 0.
- 9 enabled table-trigger attachments and 1 enabled event-trigger attachment remain.
- Existing JIMS read-only regression UAT: 10 PASS, 1 NOT EXERCISED, 0 REVIEW/failures.
- Unexercised check: R1 JR final approvals have registered JR document.
- Does NOT substitute for authenticated role-based browser UAT / negative authorization testing.

## Emergency rollback
Use only if a confirmed legitimate dependent workflow needs the old anonymous rights. This intentionally re-exposes the previously flagged permissions. Review security impact before execution.

```sql
BEGIN;
GRANT EXECUTE ON FUNCTION
  public.jauhar_can_stage_act_v1(uuid,text,text),
  public.jauhar_can_view_delegation_docs_v1(uuid),
  public.jauhar_delegation_dashboard_v1(),
  public.jauhar_invoice_object_exists(text),
  public.jauhar_is_current_requester_v1(uuid),
  public.jauhar_my_active_delegations_v1(),
  public.jauhar_my_current_handovers_v1(),
  public.jauhar_requester_at_v1(uuid,uuid,timestamp with time zone),
  public.jauhar_valid_approval_actor_v1(uuid,text,text,timestamp with time zone)
TO anon;

GRANT EXECUTE ON FUNCTION
  public.jauhar_delegated_approval_gate_v1(),
  public.jauhar_delegated_payment_review_gate_v1(),
  public.jauhar_delegation_jr_meeting_gate_v1(),
  public.jauhar_handover_document_gate_v1(),
  public.jauhar_handover_owner_gate_v1(),
  public.jauhar_protect_archived_pv(),
  public.jauhar_protect_archived_pv_child(),
  public.jauhar_set_origin_department_v1(),
  public.rls_auto_enable()
TO anon, PUBLIC;
COMMIT;
```

## Follow-up / constraints
- Security Advisor still flags 120 authenticated-executable SECURITY DEFINER functions. Their role checks require a separate, function-by-function review before production sign-off.
- Leaked-password protection is still a WARN.
- Do not broaden PUBLIC grants on new functions; apply least privilege in future migrations.
- This markdown file documents the executed production change; it is NOT an auto-applied Supabase migration.
- Existing developer Codespaces working tree and deployment branch require separate verification. Do not overwrite them from the repository base.

Reference: https://supabase.com/docs/guides/database/functions
