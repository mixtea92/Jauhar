# JIMS 57D7B5 — CEO/BOD Global Accounts Without Department

**Date:** 2026-11-01 (Asia/Kuala_Lumpur)  
**Branch:** `jsync-gui-revamp-20261029`  
**Live Supabase project:** `npaozikolbwlvnztvoef`  
**Frontend code commit:** `806093639638ee3cf975257325fd951e0cfe381a`  
**Edge Function:** `jauhar-admin-users`, upgraded from v6 to **v7**.

## Confirmed JIMS business rule

- CEO and BOD: **Department = NULL**, **Subdepartment = NULL**, **Staff Designation = NULL**. Global role, so authority is controlled by the existing server-side role/approval functions.
- Executive, Manager/HOD, Non-Executive: **Department required** (and validated against configured Departments).
- Branch and Cost Center retain their pre-existing optional validation and allowable values.
- This change does **not** modify or create System Admin accounts.

## Minimal change

1. Deployed live Edge Function `jauhar-admin-users` version 7 with a **role-aware `organizationFromRequest(body, role)`**. For CEO/BOD, it accepts null Department/Subdepartment/Designation and rejects non-null values; for other roles, pre-existing Department/Subdepartment validation applies.
2. Updated the **active** JIMS form `app/src/JSYNCUserAdminForm.jsx` to hide Department and Subdepartment for CEO/BOD, clear them when switching to either global role, and submit explicit nulls on account creation. For existing accounts currently carrying a Department, editing them into CEO/BOD is intentionally blocked in the form: create a fresh global account in the planned go-live cutover rather than silently migrating an existing user and its audit history.
3. Edge Function's active System Admin authorization, password/username validation, user-management audit logging, Auth profile creation and compensation on failure were preserved. The existing `verify_jwt=false` setting was preserved; function-body authentication remains through `withSupabase({auth:"user"})`, with an active System Admin profile check.
4. **No** payment, PV, Petty Cash, Delegation, invoice, approval flow, RLS policy, SQL function, table records, existing user accounts, or financial transactions were edited.

## Verification

- Pre-deployment role validation truth table: **10/10 PASS** in static logic checks (CEO/BOD null accepted, non-null rejected; other three role families require valid Department).
- Code-level preflight proved only `organizationFromRequest` and its call site changed in Edge Function.
- Post-deployment `get_edge_function`: **ACTIVE v7**, unchanged `verify_jwt=false`, source **exactly equal** to the intended patched text.
- GitHub file fetched back after commit: source **exactly equal** to intended JSX patch.
- Supabase schema still allows `user_profiles.department` NULL. Existing CEO/BOD rows have NULL Department.
- Profile count remains 9; PV count 31; Petty Cash count 1. No new production test account created.
- Existing read-only regression suite: **10 PASS / 1 NOT EXERCISED / 0 FAIL**; unexercised is R1 JR final approval registered-document sample count 0.
- Security Advisor count unchanged: 115 authenticated-security-definer findings; 5 RLS/no-policy infos; leaked password protection 1 warning. Anonymous SECURITY DEFINER warnings remain 0.
- **No live end-to-end account creation was attempted.** Actual Create User, login and approval UI must be verified in the correctly updated Codespaces/deployed frontend. An isolated build attempt was blocked by GitHub DNS access in the test container. Do not represent frontend build as passing.

## Rollback plan (only if required)

- Frontend: revert GitHub commit `806093639638ee3cf975257325fd951e0cfe381a` in a reviewed change, without touching business modules.
- Edge: restore previously deployed `jauhar-admin-users` **v6** code/config using the Supabase Edge Function deployment history or a verified v6 source backup. The v7 patch did not alter authentication or unrelated methods.
- Do not roll back payment, approval or historical tables.
- If a credential, account or workflow test fails, **stop and inspect first**, do not delete user profiles or historic data.

## Outstanding go-live gates

- Run frontend build/preview and desktop browser User Management tests after pulling current branch commit.
- Test CEO/BOD creation without Department; Executive/Manager/Non-Executive must still require Department; verify persisted profile and user-management audit.
- UAT global approval authority and negative access for non-finance Manager. The previous **Sales department label mismatch** and **legacy payment date Finance-only** issues remain separate HOLD items; not changed here.
- Keep go-live HOLD until full role-based browser UAT and security sign-off.
