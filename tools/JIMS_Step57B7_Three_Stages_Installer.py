#!/usr/bin/env python3
"""JIMS 57B7: 3 stages + AP Finance final-proof queue. UI only, guarded."""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys
R=Path('/workspaces/Jauhar'); B='jsync-gui-revamp-20261029'
PV=R/'app/src/PaymentVoucher.jsx'
FLOW=R/'app/src/payment/JIMSInstallmentWorkflow.jsx'
NEW=R/'app/src/JIMSPaymentCompletionQueue.jsx'
dry='--dry-run' in sys.argv
def stop(s):sys.exit('STOP: '+s)
def one(s,a,b):
    if s.count(a)!=1:stop('Expected one anchor, found '+str(s.count(a))+': '+a[:70])
    return s.replace(a,b,1)
def git(*args):return subprocess.check_output(['git',*args],cwd=R,text=True)
if git('branch','--show-current').strip()!=B:stop('Use branch '+B)
if not PV.exists() or not FLOW.exists():stop('Payment module missing')
if NEW.exists():stop('57B7 already installed, refusing overwrite')
old=PV.read_text(); f0=FLOW.read_text()
for x in ('JIMS_STEP_57B5_INITIATED_LIST',
          "import JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'",
          "const [jimsV2FMCount,setJimsV2FMCount] = useState(null)",
          "<span>AP Finance — Payment Completion / Returned</span>",
          "{ id:'paid', label:'Paid', hint:'Final PDF receipt and transaction details' }"):
    if x not in old:stop('57B5 baseline missing '+x)
if "canAP&&active?.status==='approved'" not in f0:stop('57B3 final receipt flow missing')
queue=git('show','origin/'+B+':gui-patches/57B/JIMSPaymentCompletionQueue.jsx')
if 'pv_payment_transactions' not in queue or '.insert(' in queue:stop('Unexpected queue source')
s=old
s=one(s,
"import JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'",
"import JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'\nimport JIMSPaymentCompletionQueue from './JIMSPaymentCompletionQueue'")
s=one(s,
"  const [jimsV2FMCount,setJimsV2FMCount] = useState(null)",
"  const [jimsV2FMCount,setJimsV2FMCount] = useState(null)\n  const [jimsCompletionSnapshot,setJimsCompletionSnapshot] = useState(null)")
s=one(s,
"""              <button type="button" className="pv-action-link"
                onClick={() => openCategory('payment_initiated')}>
                <span>AP Finance — Payment Completion / Returned</span>
                <strong>{dashboardCounts?.needs_payment_completion ?? '—'} →</strong>
              </button>""",
"""              <button type="button" className="pv-action-link"
                onClick={() => document.getElementById('jims-payment-completion')?.scrollIntoView({behavior:'smooth'})}>
                <span>AP Finance — Payment Completion · Upload Final PDF</span>
                <strong>{jimsCompletionSnapshot?.completionCount ?? '—'} →</strong>
              </button>""")
s=one(s,
"dashboardCounts.pending_payment + dashboardCounts.needs_payment_completion",
"""(jimsCompletionSnapshot
                  ? Math.max(0,dashboardCounts.pending_payment
                      -jimsCompletionSnapshot.partialInitiated
                      -jimsCompletionSnapshot.partialApproved)
                    +jimsCompletionSnapshot.completionCount
                    +Math.max(0,dashboardCounts.needs_payment_completion
                      -jimsCompletionSnapshot.v1Approved)
                  : '—')""")
s=one(s,
"              { id:'paid', label:'Paid', hint:'Final PDF receipt and transaction details' }",
"              { id:'payment_completion', label:'Payment Completion', hint:'AP Finance: upload mandatory final PDF' }")
s=one(s,
"                onClick={() => openCategory(card.id)}>\n                <strong>{dashboardCounts?.[card.id] ?? '—'}</strong>",
"""                onClick={() => card.id === 'payment_completion'
                  ? document.getElementById('jims-payment-completion')?.scrollIntoView({behavior:'smooth'})
                  : openCategory(card.id)}
                disabled={card.id === 'payment_completion' && !isAPFinance}>
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
                  : dashboardCounts?.[card.id] ?? '—'}</strong>""")
s=one(s,
"          <p className=\"muted\">Existing Full Payment V1 workflow remains unchanged. Partial Payment V2 will be integrated separately.</p>",
"""          <button type="button" className="btn" onClick={() => openCategory('paid')}>
            Paid History · {dashboardCounts?.paid ?? '—'} PV(s)
          </button>
          <p className="muted">Three active stages. Paid is final history; partial installments settle separately.</p>""")
s=one(s,
"      {workspaceMode === 'home' && !paymentLanding && (",
"""      {workspaceMode === 'home' && paymentLanding && isAPFinance && (
        <JIMSPaymentCompletionQueue onOpenVoucher={openVoucher}
          onSnapshot={setJimsCompletionSnapshot}/>
      )}
      {workspaceMode === 'home' && !paymentLanding && (""")
f=one(f0,
"""    {canAP&&active?.status==='approved'&&<div className="jims-v2-fieldset">
      <label htmlFor="jims-v2-paydate">Actual Payment Date</label>""",
"""    {canAP&&active?.status==='approved'&&<div className="jims-v2-fieldset" id="jims-v2-final-payment-proof">
      <h4>Payment Completion — Upload Final Payment Receipt (PDF)</h4>
      <label htmlFor="jims-v2-paydate">Actual Payment Date</label>""")
if old.count('supabase.rpc(')!=s.count('supabase.rpc('):stop('Protected PV approval calls changed')
if f.count('supabase.rpc(')!=f0.count('supabase.rpc('):stop('Protected payment calls changed')
if s.count('<PaymentTrackingPanel')!=old.count('<PaymentTrackingPanel'):stop('Panel changed')
print('JIMS 57B7 '+('DRY RUN' if dry else 'INSTALL')+' — 3 stages + Paid History')
if dry:
    print('DRY RUN PASS — zero files changed');sys.exit(0)
bk=R/'app/gui-backups'/('57B7_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
bk.mkdir(parents=True,exist_ok=False)
(bk/'PaymentVoucher.jsx').write_text(old)
(bk/'JIMSInstallmentWorkflow.jsx').write_text(f0)
created=False
try:
    NEW.write_text(queue);created=True
    PV.write_text(s);FLOW.write_text(f)
    subprocess.run(['npm','run','build'],cwd=R/'app',check=True)
    print('JIMS STEP 57B7 PAYMENT COMPLETION — BUILD PASS')
except Exception as e:
    PV.write_text(old);FLOW.write_text(f0)
    if created:NEW.unlink(missing_ok=True)
    stop('Build failed; original source restored: '+str(e))
