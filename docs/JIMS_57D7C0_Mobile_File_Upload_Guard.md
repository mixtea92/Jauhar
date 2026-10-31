# JIMS 57D7C0 — Mobile Browser File Upload Restriction

**Date:** 2026-11-01 (Asia/Kuala_Lumpur)  
**Repository/branch:** `mixtea92/Jauhar` / `jsync-gui-revamp-20261029`  
**Status:** Frontend code change committed and source verified; live browser/device UAT and frontend build NOT YET VERIFIED.

## Locked requirement

- Mobile browsers (including iPhone, iPad / iPad desktop mode, Android phone and tablet) may view and use otherwise authorized JIMS functionality.
- **Mobile browsers must not select/import/upload documents**. File selection and upload must be performed through a desktop browser.
- Do **not** disable ordinary approvals, comments, delegation, review or other non-upload operations on mobile. Existing payment evidence uploaded on desktop may still be used for the downstream authorized operation without a new upload.
- Desktop file import, invoice registration, JR attachment, payment initiation, final PDF receipt and Petty Cash uploads must continue to behave as before.
- Do not alter Supabase grants, SQL functions, authorization/approval workflow, user accounts, transactional data or historical records.

## Scoped source changes

1. **Shared helper:** `app/src/lib/mobileUploadGuard.js`
   - Exports `isMobileUploadBlocked()` and `MOBILE_UPLOAD_NOTICE`.
   - Detects `navigator.userAgentData.mobile`, Android/iPhone/iPad/iPod/Mobile user agents, and iPadOS desktop-mode `Macintosh` with multiple touchpoints.
   - Safe when `navigator` is missing (SSR/test).
   - **Important limitation:** Browser device detection is best-effort and spoofable; it is an application UX/product restriction, **not a cryptographically enforceable server-side security boundary**. The existing Supabase role/storage authorization remains necessary and unchanged.

2. **Payment Voucher:** `app/src/PaymentVoucher.jsx`
   - PV Excel input disabled on mobile; `handleExcelImport()` rejects file processing on mobile.
   - Invoice input disabled on mobile; `uploadInvoice()` rejects mobile file upload before Storage writes, including direct UI handler invocation.
   - `uploadJR()` rejects mobile PDF upload before Storage writes.
   - Mobile notice displayed beside PV Excel input. Existing desktop file selectors and every backend RPC/Storage path retained.

3. **Justification Report:** `app/src/jr/JRPanel.jsx`
   - JR PDF file input disabled on mobile, and the change handler checks again before invoking `onUpload`.
   - Display notice on mobile. **Existing JR viewing and recording actual offline committee meeting evidence remain available.**

4. **Full Payment Tracking:** `app/src/payment/PaymentTrackingPanel.jsx`
   - Initiation proof input disabled on mobile; `uploadProof()` rejects calls made while mobile.
   - Final PDF receipt input disabled on mobile, and `completePayment()` rejects mobile attempts that require a new file upload.
   - If a valid `receiptPath` was already uploaded by desktop, the non-upload completion action is not categorically blocked solely for being on mobile. Backend role and evidence validation remain authoritative.
   - **Review/Approve/Return initiation and Submit Initiation with pre-registered evidence remain otherwise available on mobile.**

5. **Petty Cash:** `app/src/CashVoucher.jsx` already blocked mobile Excel and receipt uploads. It was **not edited**.

## Commits

- Shared helper: `5986db5fbf8b1622d1512beb735b3483b5973d91`
- PaymentVoucher: `1bcfe3feeea2c766f420a5f5842afa472e710dfe`
- JRPanel: `d78b4a0581e133520ab994aefb220ff3cc52adb3`
- PaymentTrackingPanel: `dc1de2451114b43d7923b950e7553fd365c5e8fc`
- Mobile test file `app/tests/mobileUploadGuard.test.mjs`: `79fc2b2c684de44ebe04d5e6dde55712230864c9`

**No Supabase DDL/DML/migration/Edge deployment. No Petty Cash or approval UI changes.**

## What was verified

- Source read back from the GitHub branch exactly matches expected changes for all four source files and the added test.
- 11 simulated device-detection cases PASS in the change-script dry-run (iPhone, iPad, Android phone/tablet, iPad desktop mode, Client Hints, Windows/Mac/Linux desktops, SSR).
- 20 independent read-only source checks PASS, covering imports, disabled inputs, handler guards, review preservation, Petty Cash existing guard and expected number of known file inputs.
- Existing `supabase.storage.upload()` and `supabase.rpc()` call counts in the modified components match original versions, supporting that non-upload flow and desktop API calls were not removed.
- All five Supabase read-only regression suites re-run: master **10 PASS + 1 NOT EXERCISED**, Sales **10 PASS**, Payment Date **12 PASS**, Legacy Manager **15 PASS**, RBAC **26 PASS + 1 previously identified FINDING**. Combined: **73 PASS / 1 NOT EXERCISED / 1 FINDING / 0 FAIL**.
- Live counts unchanged: 9 profiles, 31 Payment Vouchers, 1 Petty Cash, 102 PV approval actions, 22 user-management audit entries.

## Tests deliberately not claimed

- The full frontend Vite build and Oxlint have **not been run**. The execution environment could not resolve GitHub DNS to clone the repository. There were no CI status checks on the latest source commit.
- New Node tests were committed and reviewed **but not executed in the checked-out repository**.
- No iOS/Android device or browser devtools testing done; no desktop file uploaded to live Supabase as a test.
- No claim that the running production frontend has pulled this branch or is deployed at this commit.
- No claim that user-agent restriction resists deliberate spoofing; a true trustworthy mobile prohibition would require a trusted client/device attestation design and separate architecture decisions.

## User-run verification (Codespaces, after checking for uncommitted changes)

```bash
cd /workspaces/Jauhar
git status --short
git branch --show-current
# Review local changes first; do not overwrite or force-reset.
git pull --ff-only origin jsync-gui-revamp-20261029
node --test app/tests/mobileUploadGuard.test.mjs
cd app
npm ci
npm run build
npm run lint
```

**Do not run a forced reset.** If local changes prevent a fast-forward, reconcile without overwriting them. Build/lint outputs must be reviewed; do not call a failing suite PASS.

### Manual browser UAT

| Device/client | Action | Expected |
| --- | --- | --- |
| Desktop Chrome/Edge | PV official Excel select/import | Allowed |
| Desktop Chrome/Edge | PV invoice and JR PDF upload | Allowed with existing role/status checks |
| Desktop Chrome/Edge | Payment initiation proof and final receipt | Allowed with Finance AP role/status/evidence checks |
| Desktop Chrome/Edge | Petty Cash Excel and receipt | Allowed with existing Finance AP rules |
| iPhone Safari | All aforementioned file inputs | Disabled / handlers deny file processing |
| Android phone/tablet browser | All aforementioned file inputs | Disabled / handlers deny file processing |
| iPad Safari / desktop site | All aforementioned file inputs | Disabled / handlers deny file processing |
| Mobile authorized approver | Approve / Return / Reject within authority | Remains functional |
| Mobile authorized Finance Manager | Review payment initiation | Remains functional |
| Mobile view-only user | View authorized private documents | Remains functional subject to existing access |

## Rollback and non-disruption

If a genuine desktop regression occurs, stop and inspect the live frontend version. Revert the **five 57D7C0 commits** in reverse order in a reviewed GitHub change, avoiding removal of later unrelated work. This is frontend-only; **do not** roll back database, change Supabase grants, drop files or alter PV/CV records. Re-run the Node suite and Vite build before deploying a correction.

## Other unresolved go-live items (out of scope)

- Authenticated browser-based positive/negative role UAT and deployment verification.
- Live Supabase staging branch not provisioned; provisioning may incur billing.
- Previously reported public `jauhar_test` table's unnecessary anonymous write/TRUNCATE privileges; isolated cleanup review.
- Petty Cash same-person dual-stage approval governance for Finance-origin petty cash awaits business policy.
- One existing JR final approval document test has zero samples.

**57D7C0 source patch checkpoint:** verified. **Overall go-live HOLD** until frontend build, mobile/desktop upload tests and cross-role browser UAT actually pass.
