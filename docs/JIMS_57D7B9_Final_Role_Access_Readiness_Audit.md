# JIMS 57D7B9 — Final Role-Based Access & Go-Live Readiness Audit

**Date:** 2026-11-01 (Asia/Kuala_Lumpur)  
**Repository:** `mixtea92/Jauhar`  
**Branch inspected:** `jsync-gui-revamp-20261029`  
**Supabase live project:** `npaozikolbwlvnztvoef`  
**Mode:** Read-only source and database audit; **no live mutations**.

## Decision

**57D7B9 audit completed. Overall go-live remains HOLD.** No live payment, PV, petty cash, approval, authority, delegation, user creation, authorization grants, or frontend code was changed. Only this documentation and a read-only audit SQL file were added to GitHub.

This checkpoint is **not** a pass for real authenticated browser UAT. It checks current database policies/functions, frontend source, grants, storage metadata and existing aggregate records.

## Role-based access matrix (expected and code-reviewed)

| Role | Backend authorization observed | Remaining end-to-end proof |
| --- | --- | --- |
| Finance AP Executive | Can create/manage Finance PVs and Petty Cash records via Finance-role RPCs; initiate/complete eligible payments with registered evidence; Finance staff can manage delegation subject to authority checks. | New-user login; PV Excel upload; receipt upload; full and partial payment; negative access |
| Finance Manager | Finance Manager PV approvals/reviews and finance delegation; legacy PV decision and Payment Date correction specifically require `manager` + `Finance` after 57D7B7/B8. Finance HOD can sign Petty Cash Finance stage. | Approval, correction, segregation-of-duties, delegation and payment-review scenarios |
| Other Department HOD/Manager | HOD approval/verification uses matching originating Department; Petty Cash applicable HOD stage requires Department equality; no Finance Manager-only Payment Date/legacy approval. | Sample branch/department HOD login and negative Finance action |
| Non-Finance Executive | May read own appropriate records, but new PV creation is Finance-only. No Finance payment mutation gate. | Role visibility and failed direct RPC calls |
| CEO | Global approval role; Department and Subdepartment NULL. No need to assign Department. | Create fresh global account and execute only CEO-permitted approval stages |
| BOD | Global approval role; Department and Subdepartment NULL. No need to assign Department. | Create fresh global account and execute only BOD-permitted approval stages |
| System Admin | All-user organization and Cost Center management; protected read-only financial review and owner-scoped export where permitted; not an approval actor in stage gate. | View-all, Add User, Audit Trail, denial of approval/payment mutations |
| Non-Executive | `payment_vouchers` and `pv_approval_actions` have restrictive active-role/Non-Executive RLS exclusion; no PV authority. | Login and actual read-denial UAT |

**Important:** Per-column and per-row access is composed from PostgreSQL grants, permissive policies **OR**-combined and restrictive policies **AND**-combined. PV Non-Executive and Finance non-AP policies were verified as **RESTRICTIVE**; read policy labels alone cannot establish denial.

## Static security test results

1. New read-only test: `uat/JIMS_57D7B9_Final_Role_Access_ReadOnly.sql` — **26 PASS, 1 FINDING** (27 assertions).
2. Master regression: **10 PASS, 1 NOT EXERCISED, 0 FAIL**, unexercised R1 JR final approval PDF (sample count zero).
3. Department naming 57D7B6: **10 PASS, 0 FAIL**.
4. Finance Manager Payment Date 57D7B7: **12 PASS, 0 FAIL**.
5. Legacy Manager PV approval 57D7B8: **15 PASS, 0 FAIL**.

**Existing four suites combined:** 47 PASS, 1 NOT EXERCISED, 0 FAIL. Results inspect definitions, grants, policy catalog and current-data invariants. They do not simulate end-to-end login/finance mutations.

Database at audit: **23/23 public tables RLS ON; 9 profiles; 31 PV; 1 Petty Cash; 102 PV approval actions; 22 user-management audit events.** No direct UPDATE permission on the PV or CV primary tables to the authenticated role. The five JIMS financial evidence storage buckets are **private**.

Live Edge `jauhar-admin-users` **v8 ACTIVE**, preserves CEO/BOD NULL Department and the `Sales and Marketing` → `Sales & Marketing` compatibility rule. 0 Supabase development branches exist; staging has not been provisioned.

Advisors remain: **115 authenticated-callable SECURITY DEFINER warnings** (heuristic, not automatically exploitable), 5 RLS/no-policy INFO, 1 leaked-password-protection WARN. No `anon`-callable public SECURITY DEFINER functions were found. Do not blanket-revoke operational RPCs.

## Findings and required next steps

### F1 — Mobile upload prohibition not uniformly implemented (Go-Live HOLD)

The locked product rule is **mobile browser access yes; file uploads from mobile no**. Current GitHub branch:

- `app/src/CashVoucher.jsx` has an explicit mobile user-agent detection and disables/refuses file uploads.
- `app/src/PaymentVoucher.jsx` currently has file inputs (PV Excel, invoice evidence) and handlers `uploadInvoice`, `uploadJR` with **no visible mobile check**.
- `app/src/jr/JRPanel.jsx` shows a JR PDF input without a mobile guard.
- `app/src/payment/PaymentTrackingPanel.jsx` has initiation-proof/final-receipt file inputs and upload handlers with **no visible mobile guard**.

This is a **source-level compatibility gap**, not proof that uploading succeeds on an already-deployed/mobile running website. Proposed next separate frontend change: shared and tested `isMobileUpload` guard on every JIMS file input and every upload/import handler (not just visually disabled buttons); preserve all desktop workflow. Add mobile user-agent/tablet tests and browser QA before deploying. **Do not remove any upload capability from desktop.** No code changed here.

### F2 — Legacy public test table excessively granted to anon (Review, isolated)

`public.jauhar_test` (only `id` integer and `message` text; 1 row) has RLS and a public read policy, but **anon has SELECT/INSERT/UPDATE/DELETE/TRUNCATE**. The sole targeted B9 assertion failed because anon has TRUNCATE. SQL RLS does not mediate TRUNCATE, making this a legitimate hygiene issue on the test table. No stored public/private application function references the table in the dependency text search; that alone is not an exhaustive dependency or app-usage proof.

Proposed separate cleanup only after confirming no deployment/tests depend on it: remove unnecessary anonymous grants on this **test table**. Do **not** alter financial production grants, RLS or any user data in this audit.

### F3 — Browser/role-based UAT unavailable (Go-Live HOLD)

No Supabase development branch and no authenticated end-to-end role tests were run against isolated test data. Frontend updates to Staff Accounts are committed but the actual Codespaces build/live frontend version and GUI behavior were not verified. Required before sign-off: fresh accounts for each role and Departments, PV/cash/payment/approval/delegation positive and negative backend calls, desktop Excel/PDF flows, System Admin view-only, non-executive PV read-denial, mobile upload-denial, and historical account preservation.

### F4 — Business policy review: same-person two Petty Cash stages

`jsync_cv_approve_many_v1` requires two authority records (`applicable_hod` and `finance_hod`) but no explicit different-person check. This can matter when the applicable Department is Finance. One existing closed Operation CV has two distinct signers. **Do not change sign-off logic until management confirms** whether two authorities or two distinct humans are required.

### F5 — Supabase Auth configuration warning

The Security Advisor flags `auth_leaked_password_protection`. Review the relevant Supabase Auth setting during go-live security preparation; do not adjust provider settings or password flow without approval and test.

### F6 — Approver Summary legacy backend consistency verified

`jims_actual_approver_summary_v1` recognizes `legacy_manager`, **but its filtering restricts this authority to Finance Managers**. Earlier initial concern that all Managers might receive the legacy summary was therefore **not substantiated** after full function inspection; no fix required for that helper on present evidence.

## What is preserved / absolutely not authorized by this step

- All JIMS PV tier decisions (T01–T09), JR conditions, status transitions, payment initiation, full/partial settlement, Petty Cash record/dual sign/Excel template, delegation, CEO/BOD global approval, branch/cost center metadata and System Admin view-only governance.
- All historical and live PV/CV, profile, receipt, audit, approval and delegation data.
- No password reset, user disable, account migration, RLS/GRANT/REVOKE, function replacement, migration, Edge deploy, GUI edit or billing-bearing staging creation.

## Next practical step

**57D7C0 — Mobile Upload Guard & isolated negative UI/UAT design**, as a separately scoped frontend-only patch. A fix must pass static inspection of all upload paths plus browser QA, and cannot interfere with desktop operations. A later dedicated `jauhar_test` grants cleanup is optional and should remain separate.

**Overall Go-Live decision:** HOLD for mobile-upload rule and real role/browser testing, regardless of the strong backend read-only regression results.

**Read-only audit query:** https://github.com/mixtea92/Jauhar/blob/jsync-gui-revamp-20261029/uat/JIMS_57D7B9_Final_Role_Access_ReadOnly.sql
