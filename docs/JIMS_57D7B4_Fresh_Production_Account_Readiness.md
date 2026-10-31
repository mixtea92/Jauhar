# JIMS — Step 57D7B4: Fresh Production Accounts & Access Cutover Readiness

**Date:** 2026-11-01 (Asia/Kuala_Lumpur)  
**Supabase live project:** `npaozikolbwlvnztvoef`  
**GitHub:** `mixtea92/Jauhar`, branch `jsync-gui-revamp-20261029`  
**Status:** READ-ONLY AUDIT COMPLETE; PRODUCTION CUTOVER HOLD.

## Non-negotiable protection

- Do **not** modify existing Payment Voucher, Payment Process, Petty Cash, Delegation, approval stages, user records, or historical financial data as part of this checkpoint.
- Do **not** create, delete, disable, or reset user accounts before an authorized cutover and actual end-to-end role UAT.
- Do **not** claim a SQL-only regression result proves the frontend works.
- All fixes must be minimum scoped, independently testable, rollbackable, and verified before live deployment.
- New accounts are subject to current database RBAC/functions, **including any existing defects**. Fresh accounts do not fix old function authorization problems.

## Verified live findings

1. Supabase has one main project and **no development branches** at the time of this audit. No staging instance was provisioned or charged.
2. Active user provisioning: Edge Function `jauhar-admin-users` **version 6**, guarded by active System Admin check, validates username (3–32 characters starting with a letter), password (12–128 characters), role, department, subdepartment, branch, optional staff designation and cost center; creates Auth identity + profile, audits creation and compensates on profile/audit failure.
3. JIMS GUI actually mounts `JSYNCUserAdminForm` for new users (`app/src/App.jsx`). The legacy `AddUser.jsx` is imported but is not the active form.
4. Current provisioning Edge Function supports roles `executive`, `non_executive`, `manager`, `ceo`, `bod` but intentionally not `system_admin`. Keep at least one active System Admin available during cutover; never disable the last admin.
5. Edge Function currently requires a **Department for every new account**, including CEO/BOD. A role of CEO/BOD is global authority, but its Department is mandatory profile metadata on the current account creation path. Do not assume an empty Department will be accepted.
6. Canonical create/edit UI and Edge Function use `Sales and Marketing`; several PV approval/origin workflows use `Sales & Marketing`. Exact department comparisons occur in `jauhar_can_stage_act_v1()`. For a new Sales HOD, approval of a PV whose origin_department is `Sales & Marketing` could fail. **HOLD** pending staging testing and a compatibility-preserving fix; do not globally rename stored departments.
7. Legacy `manager_correct_pv_payment_date(uuid,date,text)` checks active `manager` but not Finance Department. A newly created Operation Manager could still satisfy this role predicate. **HOLD** pending isolated negative authorization UAT and a minimal backend Finance-only guard. New user creation alone will not fix this.
8. `user_profiles` is RLS enabled. Role, username, branch, subdepartment, staff designation, and cost center check constraints exist. Organization and Cost Center update RPCs require active System Admin.
9. Before production cutover, there were 9 active development/UAT profiles, one of which was System Admin; some lacked Dept, Branch or Cost Center. Do **not** change those accounts until new production accounts are verified and historical references preserved.

### Read-only preflight run against live database

| ID | Check | Result |
| --- | --- | --- |
| A01 | Active System Admin remains | PASS |
| A02 | User profile RLS | PASS |
| A03 | Required organization columns | PASS |
| A04 | Four Branch values | PASS |
| A05 | Cost Centers Management / Operation | PASS |
| A06 | Non-Executive role supported | PASS |
| A07 | Anonymous access to public SECURITY DEFINER functions blocked | PASS |
| A08 | Sales Department labels align with approval/origin flows | **HOLD** |
| A09 | Legacy Payment Date correction restricted to Finance Manager | **HOLD** |
| A10 | Existing active account organization completeness | REVIEW |

**Summary: 7 PASS / 2 HOLD / 1 REVIEW.** Read-only catalog/profile count queries, no mutation operations.

## Future fresh-account onboarding sequence (do not execute until cutover)

1. Confirm the code/deployment version and provision an isolated **data-less staging** database with test identities (Supabase branches can incur compute and usage charges; obtain approval first).
2. Run Finance Manager vs Operation Manager negative UAT for the two historic manager functions and Sales HOD exact-name approval compatibility. Fix only the demonstrated backend issues on staging, then repeat existing PV/PC/Payment Process regression and GUI UAT.
3. Confirm production authorization matrix for each role: Finance AP Executive; Finance Manager; Operation/Medical/Sales/SPI HOD; CEO; BOD; System Admin (read-only approvals); Non-Executive (no PV visibility).
4. Prepare verified staff roster internally containing **username, role, Department, Subdepartment, Branch, Cost Center**, and optionally staff designation. No plaintext passwords in the roster or Git.
5. Create accounts through the active JIMS System Admin user form, one batch at a time. Verify `auth.users` account existence, `user_profiles` row, exact Role/Dept/Subdept/Branch/Cost Center and the user-management audit entry. Use fresh private initial passwords; do not store them in files.
6. For each role, login with the real test account, verify menu visibility and **allowed actions**, then verify a blocked negative action remains blocked via backend. Include PDF uploads using desktop browser and ensure mobile browser uploads stay blocked.
7. Keep historical PV/PC transactions, approval histories and user IDs intact. After successful smoke/regression UAT, deactivate old development/UAT logins in a controlled order, maintaining the admin recovery path.
8. Final go-live is **HOLD** until minimum-security fixes and end-to-end role/UAT sign-off.

## Scope completed

This step did **not** create staging, create users, disable accounts, edit SQL functions, apply migrations, modify repository application code, deploy Edge Functions, touch transactional records or change role permissions.

For continuity: 57D7A anonymous hardening passed (18 -> 0); 57D7B1 authenticated helper ACL hardening passed (120 -> 115) with live 10 PASS / 1 NOT EXERCISED read-only regression. Neither replaces full browser-based role UAT.

## External reference

Supabase branches are separate environments and are **data-less by default**; a branch may incur charges:
- https://supabase.com/docs/guides/deployment/branching
- https://supabase.com/docs/guides/platform/manage-your-usage/branching
