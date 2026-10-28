# JSYNC Cash Voucher V1 — post-disbursement records
Status: backend migration applied; FE source ready for Codespaces installation; browser/end-to-end tests still pending.

## User-confirmed rules
- Petty cash has ALREADY been disbursed before AP records a CV.
- AP creates a CV for documenting actual spend and original receipts.
- Both Applicable HOD and HOD Finance Manager must APPROVE with a digital signature before CV is CLOSED.
- CV verification can be individual or bulk, with a distinct audit record and digital signature linked to each CV.
- There is NO payment initiation, payment execution, or Paid transition; Closed is documentation completion.
- System Admin can view all CV data, but cannot create or approve.
- Preserve all verified Payment Voucher and Delegation workflows. CV has separate tables/RPCs.
- GUI is provisional; optimize only after end-to-end workflow tests.
- Do not alter the uploaded original Excel template: it is the print master.

## Official Excel input template
File: FIN_FM_PC_Petty Cash.xlsx (54,696 bytes)
Sheets:
- PC (Digital): A4 portrait print area B1:I50, 10 receipt lines, exact 20-item ExpenseCategories named list from sheet 3.
- PC (Manual): A4 portrait print area B1:I50, 10 receipt lines, separate 8-item expense-category list.
- List Expenses Category: 20 categories.
Original dropdowns:
- G13:I13: Cash Advance / Reimbursement Claim.
- D17:E17 and G21:G30: JMC_GP / JMC_KM / JMC_PM / JMC_TD.
- C18: eight-item auxiliary expense category.
- F21:F30: 20 digital categories or 8 manual categories (do not conflate).
- I21:I30: Yes / No.
Other mappings: H10 request date, D13 claimant, D14 staff ID, D15 position, D16 department, D17 branch, G14 remarks, 10 expense rows C:I 21–30, H31 original SUM formula.
Original image, merges, printer settings, declaration, claimant and multiple signature fields are NOT modified by JSYNC.
The source form's reimbursement-before-payment language is legacy; preserve it until user approves wording changes.

## Implemented
- Independent public.cash_vouchers / cash_voucher_approvals / cash_voucher_audit_events tables.
- Server-side Finance AP create restriction, strict submit validation, HOD scoped approval and read-only System Admin.
- Two approval stage records with drawn PNG signature; status CLOSED only when both exist.
- Individual or up to 50 CVs per bulk approval; all-or-nothing transaction.
- Manual entry (max 10 rows), Excel import for either sheet, original template download from app/public/templates.
- System-only 'Actual Petty Cash Disbursement Date' field (not written into original XLSX).
- Preserve JSYNC mobile rule: file uploads disabled on mobile.
- No CV direct payment/transfer functions.

## Next testing
1. Copy original unchanged XLSX into app/public/templates/FIN_FM_PC_Petty Cash.xlsx (binary asset).
2. Install CashVoucher.jsx, cashVoucherExcel.js and guarded App.jsx patch in Codespaces. Verify npm run build.
3. Login as Finance Executive -> Create draft/manual and Excel-import, submit.
4. Login Applicable HOD -> view and sign.
5. Login HOD FM -> view and sign -> CLOSED. Test reverse order and bulk.
6. Login Operation Exec -> cannot create; System Admin -> view only.
7. Verify original XLSX download and 1-page original print layout.
8. Confirm behavior for Finance-department applicable HOD and any correction/return flow; not specified yet.
9. Rendering filled CV into untouched Excel print layout is NOT yet implemented; current download is exact original blank template.
