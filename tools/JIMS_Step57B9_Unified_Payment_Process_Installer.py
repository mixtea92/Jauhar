#!/usr/bin/env python3
"""JIMS Step 57B9 — Pending > Full/Partial status groups > unified Payment History.

UI-only installer on the existing 57B8 Codespaces baseline.
- Replaces ONLY Payment Process HOME markup with one responsive board.
- Removes BOTH existing home Payment History panels (no duplicate).
- Keeps all payment-voucher details, approval/payment RPCs, Sidebar, delegation,
  initiation proof, final receipt, and Paid payment data untouched.
- Backups and automatic rollback on failed Vite build.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PV=ROOT/'app/src/PaymentVoucher.jsx'
BOARD=ROOT/'app/src/JIMSPaymentProcessBoard.jsx'
CSS=ROOT/'app/src/JIMSPaymentProcessBoard.css'
DRY='--dry-run' in sys.argv

def stop(message):
    sys.exit('STOP: '+str(message))

def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)

def upstream(path):
    try:
        return git('show','origin/'+BRANCH+':'+path)
    except Exception as exc:
        stop('Could not get GitHub asset '+path+': '+str(exc))

if git('branch','--show-current').strip()!=BRANCH:
    stop('Use Codespaces working branch '+BRANCH)
if not PV.is_file():
    stop('PaymentVoucher.jsx not found')
if BOARD.exists() or CSS.exists():
    stop('Step 57B9 board assets already exist; refusing duplicate install')

original=PV.read_text()
for marker in (
    "const paymentLanding = dashboardSection === 'payment'",
    "JIMS_STEP_57B7_COMPLETION",
    "JIMS_STEP_57B8_HISTORY_LAST",
    "JIMS_STEP_57B5_INITIATED_LIST",
    "import JIMSPaymentCompletionQueue from './JIMSPaymentCompletionQueue'",
    "import JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'",
    "<PaymentTrackingPanel",
    "function openCategory(",
    "async function openVoucher(",
):
    if marker not in original:
        stop('57B8 source differs; missing '+marker+'. No changes made.')
if 'JIMS_STEP_57B9_UNIFIED_PAYMENT_PROCESS' in original:
    stop('Step 57B9 already installed')

start_anchor="      {workspaceMode === 'home' && paymentLanding && ("
end_anchor="      {workspaceMode === 'home' && !paymentLanding && ("
# Step 57B7 has THREE home sections; two start with paymentLanding:
#   1) original Payment Process Dashboard, 2) AP Finance Completion queue.
# Step 57B8 adds the final Payment History after both.
# Replace that contiguous payment-home region once, not each matching anchor.
dashboard_marker='<h2>Payment Process Dashboard</h2>'
if original.count(dashboard_marker)!=1 or original.count(end_anchor)!=1:
    stop('Payment Process Dashboard / end boundary not unique.')
dashboard_pos=original.index(dashboard_marker)
start=original.rfind(start_anchor,0,dashboard_pos)
if start<0:
    stop('Cannot identify Payment Process Dashboard opening.')
end=original.index(end_anchor,dashboard_pos)
region=original[start:end]
if region.count(start_anchor)<2 or region.count('JIMS_STEP_57B8_HISTORY_LAST')!=1:
    stop('Unexpected Step57B7/57B8 home layout. No files changed.')
for marker in (
    "Payment Process Dashboard",
    "jims-payment-history",
    "JIMSPaymentCompletionQueue",
    "JIMSV2FinanceManagerQueue",
    "Paid History",
):
    if marker not in region:
        stop('Expected Payment Process 57B8 section missing: '+marker)

# Preserve the whole payment engine outside the home dashboard.
newboard=upstream('gui-patches/57B/JIMSPaymentProcessBoard.jsx')
newcss=upstream('gui-patches/57B/JIMSPaymentProcessBoard.css')
for marker in (
    "Pending Payment", "Full Payment Status", "Partial Payment Status",
    "Partially Paid — Outstanding Balance", "Payment History",
    "pv_payment_transactions", "payment_vouchers",
    "status==='paid'", "onOpenVoucher(r.id)"
):
    if marker not in newboard:
        stop('Payment board missing feature '+marker)
for forbidden in ('.insert(','.update(','.upsert(','.delete(','.rpc(','.upload('):
    if forbidden in newboard:
        stop('New Payment Process board must remain read-only: '+forbidden)
if '.jims-pb-groups' not in newcss or '.jims-pb-history' not in newcss:
    stop('Responsive grouped status and history styles missing')

import_anchor="import PaymentTrackingPanel from './payment/PaymentTrackingPanel'"
if original.count(import_anchor)!=1:
    stop('PaymentTrackingPanel import not unique')
content=original.replace(
    import_anchor,
    import_anchor+"\nimport JIMSPaymentProcessBoard from './JIMSPaymentProcessBoard'",
    1
)
# Anchor on Payment Process Dashboard itself, not the second
# paymentLanding block which mounts the AP Completion queue.
dashboard_pos=content.index(dashboard_marker)
start=content.rfind(start_anchor,0,dashboard_pos)
end=content.index(end_anchor,dashboard_pos)
if start<0 or end<=start:
    stop('Cannot safely isolate Payment Process HOME in modified source')
new_home="""      {/* JIMS_STEP_57B9_UNIFIED_PAYMENT_PROCESS:
          Pending Payment -> Full/Partial status -> one Payment History LAST. */}
      {workspaceMode === 'home' && paymentLanding && (
        <JIMSPaymentProcessBoard
          profile={profile}
          onOpenVoucher={openVoucher}
        />
      )}

"""
content=content[:start]+new_home+content[end:]

# The only removed rendering code is from the Payment Process HOME.
# No existing payment RPC, payment detail mount, or historical list filter changes.
checks=(
    ('payment RPC invocation count',original.count('supabase.rpc('),content.count('supabase.rpc(')),
    ('payment details component',original.count('<PaymentTrackingPanel'),content.count('<PaymentTrackingPanel')),
    ('existing view/list category',original.count("listCategory === 'paid'"),content.count("listCategory === 'paid'")),
    ('existing PV detail view',original.count('viewingVoucher.status'),content.count('viewingVoucher.status')),
    ('PV opened from routes',original.count('async function openVoucher('),content.count('async function openVoucher(')),
)
for label,before,after in checks:
    if before!=after:
        stop('Protected '+label+' changed: '+str(before)+' -> '+str(after))
if content.count('<JIMSPaymentProcessBoard')!=1:
    stop('Expected one unified board mount')
if 'JIMS_STEP_57B8_HISTORY_LAST' in content:
    stop('Duplicate 57B8 home Payment History still present')
if content.count('JIMS_STEP_57B9_UNIFIED_PAYMENT_PROCESS')!=1:
    stop('Unified board marker count wrong')
if original[end:]!=content[content.index(end_anchor):]:
    stop('Code after Payment Process HOME region changed unexpectedly')

print('JIMS STEP 57B9 — '+('DRY RUN' if DRY else 'INSTALL'))
print('Pending Payment > [Full Payment Status | Partial Payment Status] > Payment History')
print('Partially Paid means outstanding balance remains; paid installments appear once in unified history.')
print('Existing V1/V2 payment approvals, final PDFs, RLS and Supabase remain unchanged.')
if DRY:
    print('DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=ROOT/'app/gui-backups'/(
    '57B9_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
)
backup.mkdir(parents=True,exist_ok=False)
(backup/'PaymentVoucher.jsx').write_text(original)
created=[]
try:
    with BOARD.open('x') as f:
        f.write(newboard)
    created.append(BOARD)
    with CSS.open('x') as f:
        f.write(newcss)
    created.append(CSS)
    PV.write_text(content)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 57B9 UNIFIED PAYMENT PROCESS — BUILD PASS')
    print('Backup:',backup)
    print('Refresh AP Finance > Payment Process to preview full/partial statuses.')
except Exception as exc:
    PV.write_text(original)
    for path in created:
        path.unlink(missing_ok=True)
    stop('Installation/build failed. Original payment UI restored: '+str(exc))
