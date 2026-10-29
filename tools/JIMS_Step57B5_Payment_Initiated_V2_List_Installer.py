#!/usr/bin/env python3
"""JIMS Step 57B5 — Fix missing V2 installments inside 'Payment Initiated'.

The Payment Initiated PV list is V1-only by design (parent voucher's
payment_status='payment_initiated'). Step 57B3 intentionally keeps partial
voucher parent status='pending_payment', and the installment itself is
'initiated' in pv_payment_transactions. Step57B4 added its V2 queue ONLY to
the Payment Process HOME page, not the Payment Initiated list screenshot.

This guarded UI-only patch shows the EXISTING authorized Step57B4 queue
directly within Payment Initiated, above the legacy Full Payment table.
No payment status update, no SQL, no changing V1 filters or approvals.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess, sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PV=ROOT/'app/src/PaymentVoucher.jsx'
QUEUE=ROOT/'app/src/JIMSV2FinanceManagerQueue.jsx'
DRY='--dry-run' in sys.argv

def stop(message):sys.exit('STOP: '+str(message))
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def one(source,old,new,label):
    n=source.count(old)
    if n!=1:stop(label+': expected exactly 1 anchor; found '+str(n)+'. NO FILE CHANGED.')
    return source.replace(old,new,1)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong Codespaces branch; expected '+BRANCH)
if not PV.is_file() or not QUEUE.is_file():
    stop('Step 57B4 must first be installed (missing PaymentVoucher or JIMSV2FinanceManagerQueue)')
old=PV.read_text()
queue=QUEUE.read_text()
for marker in (
  "import JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'",
  'const [jimsV2FMCount,setJimsV2FMCount] = useState(null)',
  "const paymentLanding = dashboardSection === 'payment'",
  "aria-label=\"Payment Voucher tracking table\"",
  "const modeChoiceAllowed",
  "jimsV2FMCount ?? '—'",
  "payment_initiated:'Payment Initiated'",
):
    if marker not in old:stop('Required 57B4/57B3 baseline marker missing: '+marker)
for marker in ("jims_v2_my_fm_review_queue_v1","onOpenVoucher(t.voucher_id)"):
    if marker not in queue:stop('Existing V2 review queue invalid: '+marker)
if 'JIMS_STEP_57B5_INITIATED_LIST' in old:
    stop('Step 57B5 already installed; refusing duplicate')

new=old
new=one(
    new,
    '        <div className="table-wrap" aria-label="Payment Voucher tracking table">',
    """        {/* JIMS_STEP_57B5_INITIATED_LIST:
            The legacy PV table below lists Full Payment V1 (parent status).
            Show the server-authorized Partial Payment V2 pending queue directly
            in this SAME Payment Initiated list, without rewriting V1 filtering. */}
        {listCategory === 'payment_initiated' && canManage &&
          profile?.department === 'Finance' && (
          <div className="jims-v2-initiated-list" style={{margin:'18px 0 22px'}}>
            <JIMSV2FinanceManagerQueue onOpenVoucher={openVoucher}
              onCountChange={setJimsV2FMCount}/>
          </div>
        )}
        {listCategory === 'payment_initiated' && (
          <p className="muted" style={{margin:'12px 0'}}>
            Full Payment V1 records are listed below. Partial Payment V2
            installments awaiting Finance Manager appear separately above.
          </p>
        )}
        <div className="table-wrap" aria-label="Payment Voucher tracking table">""",
    'Display secure V2 Finance Manager actions above legacy V1 Payment Initiated list'
)
new=one(
    new,
    """            <p className="muted">{listTotal} matching voucher(s) · Page {listPage + 1}.
              Click a PV Number to open details and permitted actions.</p>""",
    """            <p className="muted">
              {listCategory === 'payment_initiated' ? 'Full Payment V1: ' : ''}
              {listTotal} matching voucher(s) · Page {listPage + 1}.
              {listCategory === 'payment_initiated' &&
                ' Partial Payment V2 reviews appear in their own queue below.'}
              {' '}Click a PV Number to open details and permitted actions.
            </p>""",
    'Make V1 count explicit so users do not mistake it for combined V1 + V2 count'
)
new=one(
    new,
    'onClick={() => changeMode(\'home\')}>← Payment Voucher Dashboard</button>',
    """onClick={() => changeMode('home')}>
              {paymentLanding ? '← Payment Process Dashboard' : '← Payment Voucher Dashboard'}
            </button>""",
    'Correct confusing list back-link label'
)

# Keep existing legacy filters, RPC invocations, approval buttons and tables.
for marker in (
  "query.eq('status', 'fully_approved').eq('payment_status', 'payment_initiated')",
  "onClick={() => openCategory('payment_initiated')}",
):
    if old.count(marker)!=new.count(marker):
        stop('Protected legacy V1 filter/navigation changed: '+marker)
if old.count('<PaymentTrackingPanel')!=new.count('<PaymentTrackingPanel'):
    stop('Protected payment tracking mount changed')
if old.count('supabase.rpc(')!=new.count('supabase.rpc('):
    stop('Existing payment RPC calls changed')
if new.count('JIMSV2FinanceManagerQueue')!=old.count('JIMSV2FinanceManagerQueue')+1:
    stop('Unexpected V2 queue mount or import count')
if old.count("openCategory('payment_initiated')")!=new.count("openCategory('payment_initiated')"):
    stop('Protected payment category links changed')

print('JIMS STEP 57B5 — '+('DRY RUN' if DRY else 'INSTALL'))
print('In Payment Initiated list: V2 FM queue appears ABOVE unchanged V1 table.')
print('V2 uses current authenticated user / server-authorized FM review queue.')
print('Existing PV-2026-000008 and PV-2026-000012 data/proofs NOT edited.')
print('No SQL, no payment status changes, no legacy V1 workflow changes.')
if DRY:
    print('DRY RUN PASS — zero files modified.')
    sys.exit(0)

backup=ROOT/'app/gui-backups'/('57B5_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'PaymentVoucher.jsx').write_text(old)
try:
    PV.write_text(new)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 57B5 PAYMENT INITIATED V2 QUEUE — BUILD PASS')
    print('Backup:',backup)
    print('Test: Finance Manager > Payment Process > Payment Initiated.')
    print('Two initiated V2 installments should appear ABOVE V1 PV-2026-000022.')
except Exception as e:
    PV.write_text(old)
    stop('Build failed: original PaymentVoucher.jsx restored. '+str(e))
