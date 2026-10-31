# JIMS 57D7C5 — Finance Document Archive

Status: STAGED on isolated feature branch; NOT installed in complete Codespaces JIMS; NOT deployed.

## Locked UX
Sidebar label: Finance Document Archive only, immediately below Petty Cash.
Page: search by PV/CV no., filename and supplier; document type/branch/date filters; View and Download per file; multi-selection; Download Selected ZIP; Download All Filtered ZIP; Document_Index.csv in each ZIP.

Exactly six uploaded categories:
1. Invoice attachments
2. Justification Reports (JR)
3. Payment Initiation Proofs
4. Final Bank Receipts
5. Partial Payment Proofs (per-tranche)
6. Petty Cash Receipts

Excluded by decision: PV and CV Excel imports. System-generated official PV/CV exports are a separate future scope.

## Live Supabase read-only audit (2026-11-01)

Project: npaozikolbwlvnztvoef.
All five Storage buckets are PRIVATE.
- jauhar-pv-invoices: 29 physical objects, 27 registry-matched.
- jauhar-pv-jr: 8 physical, 8 matched.
- jauhar-pv-payment-initiation: 4 physical, 4 distinct matched.
- jauhar-pv-receipts: 2 physical, 2 distinct matched.
- jsync-cv-receipts: 1 physical, 1 matched.
Total 44 physical objects; 42 unique registered. Two invoice objects lacked a matching registered document and are excluded pending audit. Some payment documents have duplicate registry references; deduplicate by bucket and storage path.

Source metadata includes payment_vouchers, cash_vouchers, pv_invoice_documents, pv_justification_reports, pv_payment_initiation_proofs, pv_payment_transactions, jims_v2_payment_documents and cash_voucher_receipts.

No new database objects, migrations, policies or Storage uploads were performed.

## Security and behavior
- UI access: active Finance Executive/Manager, CEO, BOD, System Admin only.
- Actual metadata access is still enforced by existing Supabase RLS; the archive retains only documents attached to vouchers that are SELECT-visible to the current user.
- File content is downloaded from private Storage through the authenticated user's session. View uses a 60-second signed URL, issued only if private Storage RLS authorizes it.
- No service-role key, public buckets, or new permission grants. Existing RLS must be tested under each role; frontend menu hiding is not the security boundary.
- Read-only: no inserts, updates, deletes, upload or payment status changes.
- Document name/path sanitized for ZIP, CSV injection defended against.
- ZIP split in groups of up to 25 documents to manage browser memory; large exports may need browser permission for multiple downloads.
- Client archive retrieval caps at 20,000 rows per source table rather than silently presenting a truncated archive. Future large-scale export should use paginated server-side export.

## Stage safely in the COMPLETE integration branch
GitHub feature branch: jims-finance-document-archive-57d7c5.
Complete local integration branch: jims-integration-57d7c2, initial checkpoint ee9d030.

The GitHub main GUI branch is missing many local JIMS modules: DO NOT REPLACE or merge its App.jsx into the complete integration workspace.

From a CLEAN /workspaces/Jauhar-INTEGRATION worktree:

    cd /workspaces/Jauhar-INTEGRATION
    git fetch origin jims-finance-document-archive-57d7c5
    git cherry-pick origin/jsync-gui-revamp-20261029..origin/jims-finance-document-archive-57d7c5
    python3 tools/JIMS_57D7C5_Archive_Installer.py --dry-run
    python3 tools/JIMS_57D7C5_Archive_Installer.py --apply
    node --test app/tests/FinanceDocumentArchive.test.mjs
    node --test app/tests/mobileUploadGuard.test.mjs
    (cd app && npm run build)

The installer performs strict structural checks and stops without writing if App.jsx's navigation or route does not match. Successful apply saves a separate timestamped App.jsx backup outside the repository. Do NOT push or deploy until full build and role-authenticated UAT.

## UAT gates still pending
1. Full integration build and lint.
2. Sidebar placement below Petty Cash, no sidebar explanatory copy.
3. Check Finance AP, FM, CEO, BOD, System Admin, non-Finance HOD and Non-Executive.
4. Verify RLS-limited listings and each private Storage download without broadening permissions.
5. Download one of each of six categories, including partial tranches.
6. Verify search, date/branch/category filters, selected ZIP, all-filtered ZIP and CSV index.
7. Verify two unmatched invoice Storage objects are not exposed without valid registry entries.
8. Regression PV, Petty Cash, Payment Process, Delegation and desktop/mobile upload rules.
9. Go-live remains HOLD until full browser/security UAT passes.

Rollback: use the timestamped App.jsx backup before committing. Once committed, revert only new feature commits in the integration branch; original worktree is untouched.
