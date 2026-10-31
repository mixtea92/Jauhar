#!/usr/bin/env python3
"""JIMS 57B7 Rev1: three active payment stages and AP final-receipt queue.

Fixes the over-strict "Paid" card text anchor in the original 57B7 installer.
Compatible with the locally installed 57B4/57B5 PaymentVoucher.jsx variants.
UI only: preserves legacy V1, V2 approval/settlement RPCs and Supabase data.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,re

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PV=ROOT/'app/src/PaymentVoucher.jsx'
FLOW=ROOT/'app/src/payment/JIMSInstallmentWorkflow.jsx'
NEW=ROOT/'app/src/JIMSPaymentCompletionQueue.jsx'
DRY='--dry-run' in sys.argv

def stop(msg): sys.exit('STOP: '+str(msg))
def one(s,a,b,label):
    n=s.count(a)
    if n!=1: stop(label+': expected one anchor; found '+str(n))
    return s.replace(a,b,1)
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Use Codespaces branch '+BRANCH)
if not PV.is_file() or not FLOW.is_file():
    stop('JIMS payment source missing; no files changed')
if NEW.exists():
    stop('57B7 queue file already exists; check if Step 57B7 installed')
old=PV.read_text()
f0=FLOW.read_text()
needed=(
    "import JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'",
    'const [jimsV2FMCount,setJimsV2FMCount] = useState(null)',
    'JIMS_STEP_57B5_INITIATED_LIST',
    "const paymentLanding = dashboardSection === 'payment'",
    "className=\"pv-home-grid payment\"",
    'Payment Process Dashboard',
    '<PaymentTrackingPanel',
    "supabase.rpc("
)
for marker in needed:
    if marker not in old: stop('Installed 57B5 baseline missing: '+marker)
for marker in ('jims_v2_complete_installment_v1',
               "canAP&&active?.status==='approved'",
               'Final Bank Receipt PDF'):
    if marker not in f0: stop('Mandatory 57B3 final-payment workflow missing: '+marker)
if 'JIMS_STEP_57B7_COMPLETION' in old or 'JIMSPaymentCompletionQueue' in old:
    stop('Step 57B7 already present; refusing duplicate changes')

try:
    queue=git('show','origin/'+BRANCH+':gui-patches/57B/JIMSPaymentCompletionQueue.jsx')
except Exception as e:
    stop('Fetch origin branch before installation: '+str(e))
for marker in ('pv_payment_transactions','Payment Completion — Upload Final Proof',
               'onOpenVoucher(v.id)','completionCount','partialApproved'):
    if marker not in queue: stop('Completion queue asset missing: '+marker)
for forbidden in ('.insert(','.update(','.upsert(','.delete(','.rpc('):
    if forbidden in queue: stop('Completion queue must remain read-only: '+forbidden)

s=one(old,
    "import JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'",
    "import JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'\n"
    "import JIMSPaymentCompletionQueue from './JIMSPaymentCompletionQueue'",
    'Completion import')
s=one(s,
    '  const [jimsV2FMCount,setJimsV2FMCount] = useState(null)',
    '  const [jimsV2FMCount,setJimsV2FMCount] = useState(null)\n'
    '  const [jimsCompletionSnapshot,setJimsCompletionSnapshot] = useState(null)',
    'Completion count state')

# Existing AP action may include legacy "Returned" in its label; only alter
# the AP action for this stage, leaving FM action buttons untouched.
label='<span>AP Finance — Payment Completion / Returned</span>'
if s.count(label)!=1:
    stop('AP Finance completion action changed; show the STOP message to review')
index=s.index(label)
start=s.rfind('<button',0,index)
end=s.find('</button>',index)+len('</button>')
if start<0 or end<len('</button>') or index-start>400:
    stop('Cannot safely isolate AP completion action')
button=s[start:end]
if "openCategory('payment_initiated')" not in button or 'needs_payment_completion' not in button:
    stop('AP completion action no longer matches expected 57B5 behaviour')
button=button.replace(
    "openCategory('payment_initiated')",
    "document.getElementById('jims-payment-completion')?.scrollIntoView({behavior:'smooth'})",
    1).replace(
    label,
    '<span>AP Finance — Payment Completion · Upload Final PDF</span>',
    1).replace(
    "dashboardCounts?.needs_payment_completion ?? '—'",
    "jimsCompletionSnapshot?.completionCount ?? '—'",
    1)
s=s[:start]+button+s[end:]

# This guarded region is the Payment Process home cards only. Unlike the old
# installer, do not require a literal Paid-card label: earlier GUI versions
# and local Codespaces patches have different Paid card labels/markup.
open_card='<div className="pv-home-grid payment">'
if s.count(open_card)!=1: stop('Payment Process home-grid anchor not unique')
start=s.index(open_card)
end=s.find('</div>',start)+len('</div>')
if end<len('</div>'):stop('Payment Process home-grid closing tag missing')
region=s[start:end]
if any(marker not in region for marker in ("pending_payment","payment_initiated","pv-home-card")):
    stop('Unexpected Payment Process cards; preserving all source')
if 'payment_completion' in region:
    stop('Payment Completion card already exists; refusing duplicate')

cards="""<div className="pv-home-grid payment">
            {/* JIMS_STEP_57B7_COMPLETION: 3 active stages; Paid stays in history. */}
            {[
              {id:'pending_payment',label:'Pending Payment',
               hint:'AP Finance — prepare initiation proof'},
              {id:'payment_initiated',label:'Payment Initiated',
               hint:'Finance Manager — verify initiation'},
              {id:'payment_completion',label:'Payment Completion',
               hint:'AP Finance — upload final bank receipt PDF'}
            ].map(card => (
              <button type="button" key={card.id} className="pv-home-card"
                disabled={card.id === 'payment_completion' && !isAPFinance}
                onClick={() => card.id === 'payment_completion'
                  ? document.getElementById('jims-payment-completion')
                    ?.scrollIntoView({behavior:'smooth'})
                  : openCategory(card.id)}>
                <strong>{card.id === 'payment_completion'
                  ? (jimsCompletionSnapshot?.completionCount ?? '—')
                  : card.id === 'pending_payment' && isAPFinance
                    ? (jimsCompletionSnapshot && dashboardCounts
                      ? Math.max(0,dashboardCounts.pending_payment
                          -jimsCompletionSnapshot.partialInitiated
                          -jimsCompletionSnapshot.partialApproved) : '—')
                  : card.id === 'payment_initiated'
                    ? (isAPFinance
                      ? (jimsCompletionSnapshot && dashboardCounts
                        ? dashboardCounts.pending_initiation_review
                          +jimsCompletionSnapshot.partialInitiated : '—')
                      : (dashboardCounts?.pending_initiation_review ?? 0)
                         +(jimsV2FMCount ?? 0))
                  : dashboardCounts?.[card.id] ?? '—'}</strong>
                <span>{card.label} ↗</span>
                <small>{card.hint}</small>
              </button>
            ))}
          </div>"""
s=s[:start]+cards+s[end:]

# Keep Paid accessible as its own completed-history view.
msg='<p className="muted">Existing Full Payment V1 workflow remains unchanged. Partial Payment V2 will be integrated separately.</p>'
if s.count(msg)==1:
    s=s.replace(msg,
        """<button type="button" className="btn"
            onClick={() => openCategory('paid')}>
            Paid History · {dashboardCounts?.paid ?? '—'} Fully Paid PV(s)
          </button>
          <p className="muted">Three active payment stages. Paid remains a separate history view.</p>""",1)
elif 'Paid History' not in s[s.index(open_card):s.index(open_card)+4500]:
    stop('Cannot safely place Paid History link: home summary differs')

# Snapshot callback populates AP completion tab and counts on dashboard.
mount="      {workspaceMode === 'home' && !paymentLanding && ("
s=one(s,mount,
    """      {workspaceMode === 'home' && paymentLanding && isAPFinance && (
        <JIMSPaymentCompletionQueue onOpenVoucher={openVoucher}
          onSnapshot={setJimsCompletionSnapshot}/>
      )}

"""+mount,'AP Finance queue mount')

# Change only known total expression; leave all other role calculations.
total="dashboardCounts.pending_payment + dashboardCounts.needs_payment_completion"
if s.count(total)==1:
    s=s.replace(total,
        """(jimsCompletionSnapshot
                  ? Math.max(0,dashboardCounts.pending_payment
                      -jimsCompletionSnapshot.partialInitiated
                      -jimsCompletionSnapshot.partialApproved)
                    +jimsCompletionSnapshot.completionCount
                    +Math.max(0,dashboardCounts.needs_payment_completion
                      -jimsCompletionSnapshot.v1Approved)
                  : '—')""",1)
elif s.count('jimsCompletionSnapshot?.completionCount')==0:
    stop('Payment Action Required total changed unexpectedly')

f=one(f0,
    """    {canAP&&active?.status==='approved'&&<div className="jims-v2-fieldset">
      <label htmlFor="jims-v2-paydate">Actual Payment Date</label>""",
    """    {canAP&&active?.status==='approved'&&<div className="jims-v2-fieldset"
      id="jims-v2-final-payment-proof">
      <h4>Payment Completion — Upload Final Payment Receipt (PDF)</h4>
      <label htmlFor="jims-v2-paydate">Actual Payment Date</label>""",
    'Final PDF form heading')

if s.count('supabase.rpc(')!=old.count('supabase.rpc('):
    stop('Original PV approval calls changed')
if f.count('supabase.rpc(')!=f0.count('supabase.rpc('):
    stop('Protected payment settlement calls changed')
if s.count('<PaymentTrackingPanel')!=old.count('<PaymentTrackingPanel'):
    stop('Original Payment Tracking Panel mount changed')
if s.count('<JIMSPaymentCompletionQueue')!=1:
    stop('Completion queue mount must be exactly one')

print('JIMS STEP 57B7 REV1 — '+('DRY RUN' if DRY else 'INSTALL'))
print('Payment Process: Pending Payment / Payment Initiated / Payment Completion')
print('Paid History is separate; Full Payment V1 and approval engine untouched.')
if DRY:
    print('DRY RUN PASS — zero files changed.')
    sys.exit(0)

backup=ROOT/'app/gui-backups'/(
    '57B7_REV1_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'PaymentVoucher.jsx').write_text(old)
(backup/'JIMSInstallmentWorkflow.jsx').write_text(f0)
created=False
try:
    with NEW.open('x') as out: out.write(queue)
    created=True
    PV.write_text(s)
    FLOW.write_text(f)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 57B7 REV1 PAYMENT COMPLETION — BUILD PASS')
    print('Backup:',backup)
except Exception as e:
    PV.write_text(old)
    FLOW.write_text(f0)
    if created: NEW.unlink(missing_ok=True)
    stop('Build failed. Original payment files restored: '+str(e))
