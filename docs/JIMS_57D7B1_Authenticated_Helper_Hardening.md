# JIMS Step 57D7B1 — Authenticated Internal Authorization Helper Hardening

Date: 2026-11-01 (Asia/Kuala_Lumpur)
Database project: `npaozikolbwlvnztvoef`
Git branch: `jsync-gui-revamp-20261029`

## Goal

Reduce unnecessary direct RPC exposure to any signed-in user for five internal `SECURITY DEFINER` authorization helper functions. Preserve authority checks, business workflows, RLS policies, triggers, and existing functions.

## Scope and dependency checks

The following five `public` functions each returned `boolean`, were owned by `postgres`, and initially had explicit `EXECUTE` granted to `authenticated`, but not `anon` or `PUBLIC`. `service_role` had an independent grant.

- `public.jauhar_acting_hod_self_exception_v1(uuid,uuid,text)`
- `public.jauhar_handover_authorizer_v1(uuid,uuid)`
- `public.jauhar_historic_acting_hod_self_v1(uuid,uuid,timestamp with time zone,integer)`
- `public.jauhar_requester_at_v1(uuid,uuid,timestamp with time zone)`
- `public.jauhar_valid_approval_actor_v1(uuid,text,text,timestamp with time zone)`

Pre-change inspection confirmed:
- No direct use of these helpers in the PostgreSQL RLS policy expressions inspected.
- All 15 source references in other `public`/`private` functions were within `SECURITY DEFINER` callers, which execute as the privileged owner.
- None of these helper names appeared in the JIMS frontend component files checked in the GitHub branch. The actual user's Codespaces working tree is **not** equivalent to this repository snapshot, and must be tested before final go-live.
- `public.jauhar_invoice_object_exists(text)` was **deliberately excluded**, because it is used by a live RLS policy and removing authenticated EXECUTE could disrupt invoice operations.
- Other report/calendar functions using dedicated role validators were deliberately left unchanged pending role-based UAT.

## Applied change

One atomic transaction, with preflight assertions and post-change permission checks, executed successfully. A dry-run using the same statements within `BEGIN ... ROLLBACK` passed before live application.

```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION
  public.jauhar_acting_hod_self_exception_v1(uuid,uuid,text),
  public.jauhar_handover_authorizer_v1(uuid,uuid),
  public.jauhar_historic_acting_hod_self_v1(uuid,uuid,timestamp with time zone,integer),
  public.jauhar_requester_at_v1(uuid,uuid,timestamp with time zone),
  public.jauhar_valid_approval_actor_v1(uuid,text,text,timestamp with time zone)
FROM authenticated;
COMMIT;
```

## Verified outcomes

- `authenticated`: no EXECUTE on all 5 helpers.
- `anon`: no EXECUTE on all 5 helpers, unchanged.
- `service_role`, function owner `postgres`: EXECUTE retained.
- Supabase Security Advisor: `authenticated_security_definer_function_executable` findings reduced `120 -> 115`.
- Supabase Security Advisor: `anon_security_definer_function_executable` remained `0`.
- Repository's `uat/JIMS_Regression_UAT_ReadOnly.sql` executed against the live database: 10 PASS / 1 NOT EXERCISED / 0 failures.
- Unexercised check: R1 JR final approvals require a registered JR document; no applicable sample.
- No function bodies, client application code, approval settings, tables, data, migrations, or storage policies changed.

## Emergency rollback only if confirmed necessary

**Warning:** This restores direct access for every authenticated user, undoing the above hardening. Use only after security review when a legitimate workflow is confirmed broken.

```sql
BEGIN;
GRANT EXECUTE ON FUNCTION
  public.jauhar_acting_hod_self_exception_v1(uuid,uuid,text),
  public.jauhar_handover_authorizer_v1(uuid,uuid),
  public.jauhar_historic_acting_hod_self_v1(uuid,uuid,timestamp with time zone,integer),
  public.jauhar_requester_at_v1(uuid,uuid,timestamp with time zone),
  public.jauhar_valid_approval_actor_v1(uuid,text,text,timestamp with time zone)
TO authenticated;
COMMIT;
```

## Remaining readiness tasks

- 115 public `SECURITY DEFINER` functions remain callable by `authenticated`, and need risk assessment. Finding does not prove vulnerability.
- Conduct browser UAT with actual Finance AP, Finance Manager, HOD, CEO, BOD, System Admin, and non-executive identities; verify positive and negative access.
- Confirm installed Codespaces branch/version before interpreting repository source as live frontend.
- Do not revoke `jauhar_invoice_object_exists` from authenticated without updating and testing its RLS dependencies.
- Security Advisor also flags leaked-password protection; handle separately.

Reference: https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0029_authenticated_security_definer_function_executable
