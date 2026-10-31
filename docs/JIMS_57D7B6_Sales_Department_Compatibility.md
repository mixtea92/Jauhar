# JIMS — 57D7B6 Sales Department Naming Compatibility (Backend + Staff Accounts)

**Date:** 2026-11-01 (Asia/Kuala_Lumpur)  
**Supabase live project:** `npaozikolbwlvnztvoef`  
**GitHub branch:** `jsync-gui-revamp-20261029`  
**Edge Function:** `jauhar-admin-users` v7 → **v8** (ACTIVE)  
**DB migration:** `jims_57d7b6_sales_department_alias_compatibility` (applied)  
**GitHub commits:** `58df6937a870a24ea69c5aad31d632c335b9a669` and `4fd84dac3e14f180ee126afadfca8f73f8d9d9f4`.

## Problem diagnosed

The active Staff Accounts form and Edge v7 created staff with Department `Sales and Marketing`; several existing PV, HOD authority, delegation and Petty Cash workflows expect the exact value `Sales & Marketing`. An active Sales HOD could be blocked from intended approval or delegation when the account label and voucher label differ. Exact comparisons are required and have been preserved.

At time of audit: **0 Sales profiles and 0 Sales-origin PVs** in live DB. The live Cash Voucher template dropdown and delegation UI already use `Sales & Marketing`.

## Smallest backward-compatible solution implemented

- Official canonical storage/organization label for new accounts: **`Sales & Marketing`**.
- Edge `jauhar-admin-users` v8 accepts both `Sales and Marketing` (legacy input) and `Sales & Marketing` (current UI), normalizes the former to the canonical value before the existing validations, including allowed Sales subdepartments `Marketing`/`Sale`. All other roles/departments keep their prior behavior.
- The live System Admin organization editing function `public.jauhar_update_user_organization_v2(uuid,text,text,text,text)` now normalizes legacy Sales input to canonical Sales, and validates the same two Sales subdepartments. **No other SQL functions changed**. Existing System Admin authorization check, profile guard, and audit logging are unchanged.
- `app/src/UserOrganizationAssignment.jsx` exports canonical Sales Department and accepts the old Sales label for legacy form normalization.
- `app/src/JSYNCUserAdminForm.jsx` accepts legacy Sales Department on edit but displays/sends canonical Sales; CEO/BOD global no-department form and other roles remain unchanged.
- Existing PV, Petty Cash, Delegation, approval and payment function definitions, grants, tables, records and schema unchanged.

**Existing UI / version caveat:** These GitHub changes are committed to development branch, not confirmed built/pulled in any running Codespace or deployed frontend. Live backend already supports both Sales labels, so old UI input remains accepted.

## Pre-deployment / post-deployment tests

- Static, read-only role/department truth table **10/10 PASS** (Sales old/new labels, allowed subdepartments, Finance/Operation, staff Department requirement, CEO/BOD NULL rule).
- DB migration succeeded. Postcheck of function source verified canonical Sales label, backward-compatible normalization, active System Admin guard and audit insert.
- Edge Function v8 ACTIVE; deployed source verified exact intended code; `verify_jwt=false` retained (actual authenticated caller check is in the function via `withSupabase({auth:"user"})` and active System Admin profile query).
- GitHub changes confirmed by fetching updated source.
- Purpose-built read-only regression `uat/JIMS_57D7B6_Sales_Department_ReadOnly.sql`: **10 PASS / 0 FAIL**.
- Existing master `uat/JIMS_Regression_UAT_ReadOnly.sql`: **10 PASS / 1 NOT EXERCISED / 0 FAIL** (R1 JR final approval document test has zero samples).
- Database counts unchanged after patch: **9 user profiles; 31 PVs; 1 Petty Cash**. CEO and BOD continue to have NULL departments.
- Public SECURITY DEFINER function ACLs unchanged: **0 anon callable, 115 authenticated callable**.
- Security advisor unchanged: 5 RLS/no-policy infos, 115 authenticated privileged function warnings, 1 leaked-password-protection warning.

## Strict scope

This compatibility change did **not** create/disable/modify any user account, alter old Sales users, modify any PV or CV, change historical approval and delegation entries, alter payment initiation/settlement, change RLS grants or permissions, or change any approval stage transition.

## Rollback / recovery

- If any issue occurs, stop changing business data. Check live Edge Function version and admin form input/output, then inspect this migration and its prechange function definition.
- **Backend Edge**: restore prior `jauhar-admin-users` v7 source/config (from Supabase deployment history), preserving authentication settings and the CEO/BOD NULL Department fix from 57D7B5. Do not roll back further to v6.
- **DB org-edit RPC**: restore its exact prior `CREATE OR REPLACE FUNCTION` body, reversing the three 57D7B6-specific edits (Sales alias normalization, allowed department label, Sales subdepartment branch). Preserve SECURITY DEFINER, search_path, privileges, all unrelated clauses, and the original function-level audit.
- **Frontend**: revert the two 57D7B6 commits above; do not revert the earlier CEO/BOD v7 form fix.
- Rollbacks must first be reviewed, tested, and applied only if necessary; **never remove historic user profiles/PVs/CVs** to fix naming.

## Go-live / UAT gate (not yet PASS)

- Confirm frontend Codespaces/build and browser sessions use updated branch code.
- With isolated test accounts and test records, verify Sales Executive/Manager creation, Sales subdepartment persistence, PV HOD approval, appropriate Delegation, Petty Cash applicable HOD approval, and negative tests for other departments.
- Independently resolve legacy `manager_correct_pv_payment_date` Finance-only authorization weakness from 57D7B2/B3. Fresh accounts do **not** solve that weakness.
- Until these checks pass and disaster recovery / release checks are complete, overall production **go-live remains HOLD**.

**Read-only test:** https://github.com/mixtea92/Jauhar/blob/jsync-gui-revamp-20261029/uat/JIMS_57D7B6_Sales_Department_ReadOnly.sql
