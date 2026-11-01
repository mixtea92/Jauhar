# JIMS 57D7C7 — F5B Pre-Integration Audit

Status: **OFFLINE PRE-INTEGRATION GATE ONLY — NOT FINAL OR MERGED**

Feature branch: `jims-feature-invoice-details-57d7c7`
Pinned Integration baseline: `9e55decf1ddf2280b932888b23276e20a0429b1e`

## Confirmed from user-run tests

- F1: 6/6 — ExcelJS 3 worksheets, UI validation and formula injection protection.
- F3: 14/14 — real feature SQL migrations and status guard exercised in isolated PGlite/PostgreSQL, with dummy data.
- F4: 20/20 — role-based access using **simulated baseline JIMS role helpers and parent-PV RLS** in isolated PostgreSQL. This is *not* actual Supabase RLS verification.
- F5A: 15/15 — unchanged source compared to Integration, including 24 protected PV methods, payment modules, Petty Cash and legacy exports.
- Vite: build PASS (143 modules).
- F5B consolidated audit runner: `node tests/invoiceDetailsFinalGateF5B.mjs` — not passed until separately executed.

## UI review / feature design

- Invoice item breakdown required before Submit: item name, category, quantity, unit price, optional item GL; sum must match parent invoice.
- Invoice PDF/image proof required and must have a registered private Storage object.
- Report Generation: Invoice Summary, Invoice Item Details, Invoice Proof Register.
- UI review accepted and design locked. Static preview data is illustrative only.

## Risks / blockers that REQUIRE actual Supabase UAT before FINAL / Integration

1. **Baseline schema and helpers unverified in actual cloud.** Repo contains only three invoice feature migrations; previous JIMS production/staging migrations are not represented in this repository path. Test fixtures supplied `payment_vouchers`, `pv_line_items`, `pv_invoice_documents`, `user_profiles`, `pv_audit_events`, `storage.objects`, `auth.uid()` and existing helper functions.
2. **RLS cannot be claimed cloud-verified** from F4 fixture: confirm actual PV/line-item SELECT RLS, visible-parent policy, Finance AP/Accounting rules, non-executive restrictions, and System Admin read-only under actual authenticated user sessions.
3. **Submission RPC compatibility:** test real `submit_pv_for_approval`, `submit_finance_t01_t02_v2`, `submit_finance_t04_v1`/T08 variants, `submit_finance_jr_v1` and department submit as applicable; confirm status transitions invoke new guard and existing optimistic locks.
4. **Storage/RPC integration:** test private upload, registered document, Storage existence, missing object, JWT role, signed URL access and the mobile upload restriction.
5. **Legacy drafts and returned PVs:** mandatory new invoice breakdown applies when submitting old Draft/Returned records; verify this is acceptable and provide item-entry path, while old Approved/Paid records remain unaffected.
6. **Actual end-to-end regression:** test delegated approval, Finance Manager, CEO/BOD tiers, JR evidence, return for amendment, rejection, payment initiation/full/partial completion, final receipts, reports, Petty Cash.
7. **Report data integrity:** verify actual invoice fields (PV number, branch, supplier, tier, cost center), file status, one-to-many invoices, real large datasets and Excel download under allowed Finance roles.
8. **Rollout control:** no branch merge, staging DB migration or production change before explicit user approval. Run cloud UAT against **separately authorized disposable test environment**; do not silently use existing staging/production.

## Test command — feature worktree only

```bash
cd /workspaces/JIMS-INVOICE-DETAILS
git pull --ff-only origin jims-feature-invoice-details-57d7c7
cd app
node --check tests/invoiceDetailsFinalGateF5B.mjs && node tests/invoiceDetailsFinalGateF5B.mjs
```

Requires the previously installed local `@electric-sql/pglite`. This offline test does not require Docker or connect to Supabase Cloud.

**Decision:** Passing F5B means *offline code / isolated SQL readiness*, not production-ready and not automatic approval to merge. Next stage must be explicitly authorized integration & staging UAT.
