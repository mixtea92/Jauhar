#!/usr/bin/env python3
"""JIMS Step 57B4 — repair missing Partial Payment V2 Finance Manager queue.

REQUIRES SQL 57B4 installed first. Safe GUI-only installer:
- Add FM V2 actionable queue inside Payment Process page.
- Include V2 pending count in FM Payment Process Action Required and sidebar badge.
- Preserve Full Payment V1, V2 installment RPCs, evidence, history, approvals.
- No data/schema writes. Backup files; rollback after failed build.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PV=ROOT/'app/src/PaymentVoucher.jsx'
NAV=ROOT/'app/src/jimsActionNotifications.js'
QUEUE=ROOT/'app/src/JIMSV2FinanceManagerQueue.jsx'
DRY='--dry-run' in sys.argv

def stop(message):sys.exit('STOP: '+str(message))
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(path):
    try:return git('show','origin/'+BRANCH+':'+path)
    except Exception as e:stop('Missing GitHub asset '+path+': '+str(e))
def exactly(text,needle,replacement,label):
    n=text.count(needle)
    if n!=1:stop(label+' expected exactly one anchor, found '+str(n)+'. No changes.')
    return text.replace(needle,replacement,1)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Codespaces branch must be '+BRANCH)
for f in (PV,NAV):
    if not f.is_file():stop('Missing existing JIMS source '+str(f))
if QUEUE.exists():stop('Queue file already exists; refusing duplicate install')
pv0,nav0=PV.read_text(),NAV.read_text()

# Target the actual 51UI Payment Process home route, not the PV Approval dashboard.
for marker in (
  'const paymentLanding = dashboardSection ===',
  '<h2>Payment Process Dashboard</h2>',
  "onClick={() => openCategory('payment_initiated')}",
  "dashboardCounts.pending_initiation_review",
  "aria-label=\"Payment History\"",
  "<PaymentTrackingPanel",
):
    if marker not in pv0:stop('Existing Payment Process baseline differs: '+marker)
if 'JIMSV2FinanceManagerQueue' in pv0:stop('57B4 PV queue already installed')
if "jims_v2_my_fm_review_queue_v1" in nav0:stop('57B4 sidebar badge already installed')
for marker in (
    "if(isAP){", "else if(isFinanceManager){",
    "payment=done(await exact(q=>q.eq('status','fully_approved')",
    "cash_voucher_approvals", "jauhar_my_approval_queues_v1",
):
    if marker not in nav0:stop('Existing sidebar notification helper differs: '+marker)

queue=remote('gui-patches/57B/JIMSV2FinanceManagerQueue.jsx')
for marker in ('jims_v2_my_fm_review_queue_v1','onOpenVoucher(t.voucher_id)',
               'onCountChange?.(data.length)','Partial Payment — Finance Manager Review'):
    if marker not in queue:stop('Queue asset incomplete: '+marker)
if '.insert(' in queue or '.update(' in queue or '.delete(' in queue:
    stop('Read-only FM queue cannot mutate database')

pv=pv0
pv=exactly(pv,
   "import PaymentTrackingPanel from './payment/PaymentTrackingPanel'",
   "import PaymentTrackingPanel from './payment/PaymentTrackingPanel'\nimport JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'",
   'FM queue import')
pv=exactly(pv,
   "  const [dashboardCounts, setDashboardCounts] = useState(null)",
   "  const [dashboardCounts, setDashboardCounts] = useState(null)\n  const [jimsV2FMCount,setJimsV2FMCount] = useState(null)",
   'FM queue count state')
pv=exactly(pv,
   ": canManage && profile?.department === 'Finance' ? dashboardCounts.pending_initiation_review",
   ": canManage && profile?.department === 'Finance' ? dashboardCounts.pending_initiation_review + (jimsV2FMCount ?? 0)",
   'Payment Process Action Required counts include V2')
# Original V1 link remains intact, and is now explicitly labeled.
pv=exactly(pv,
   "<span>Finance Manager — Verify Initiation</span>",
   "<span>Finance Manager — Verify Full Payment Initiation</span>",
   'Clearly distinguish Full Payment V1 review link')
pv=exactly(pv,
   """                <strong>{dashboardCounts?.pending_initiation_review ?? '—'} →</strong>
              </button>}""",
   """                <strong>{dashboardCounts?.pending_initiation_review ?? '—'} →</strong>
              </button>}
            {canManage && profile?.department === 'Finance' &&
              <button type="button" className="pv-action-link"
                onClick={() => document.getElementById('jims-v2-fm-review-queue')?.scrollIntoView({behavior:'smooth'})}>
                <span>Finance Manager — Partial Payment Initiation</span>
                <strong>{jimsV2FMCount ?? '—'} →</strong>
              </button>}""",
   'Add clickable Partial Payment action in Payment Process')
pv=exactly(pv,
   """      {workspaceMode === 'home' && !paymentLanding && (""",
   """      {workspaceMode === 'home' && paymentLanding &&
        canManage && profile?.department === 'Finance' && (
        <JIMSV2FinanceManagerQueue onOpenVoucher={openVoucher}
          onCountChange={setJimsV2FMCount}/>
      )}

      {workspaceMode === 'home' && !paymentLanding && (""",
   'Mount V2 Finance Manager review queue in Payment Process')

nav=nav0
nav=exactly(nav,
   """      payment=done(await exact(q=>q.eq('status','fully_approved')
        .eq('payment_status','payment_initiated')
        .eq('payment_initiation_manager_decision','pending')))""",
   """      const legacy=await exact(q=>q.eq('status','fully_approved')
        .eq('payment_status','payment_initiated')
        .eq('payment_initiation_manager_decision','pending'))
      // Step 57B4: server-authorized V2 pending installment decisions.
      const {data:partial,error:v2Error}=await supabase.rpc('jims_v2_my_fm_review_queue_v1')
      if(v2Error) throw v2Error
      if(!Array.isArray(partial)) throw new Error('Invalid partial-payment FM queue result')
      payment=done(legacy+partial.length)""",
   'Finance Manager sidebar actionable count (V1 + V2)')

# No finance/payment approval or bank transfer RPCs may be altered.
for src_old,src_new,label in ((pv0,pv,'PV'),(nav0,nav,'Sidebar')):
    for key in ("jims_v2_create_payment_draft_v1","jims_v2_cancel_payment_draft_v1",
                "jims_v2_submit_installment_v1","jims_v2_review_installment_v1",
                "jims_v2_complete_installment_v1","complete_pv_payment_v1",
                "jauhar_my_approval_queues_v1"):
        if src_old.count(key)!=src_new.count(key):
            stop(label+' protected RPC changed: '+key)
if pv.count('<PaymentTrackingPanel')!=pv0.count('<PaymentTrackingPanel'):
    stop('Protected payment workflow mount changed')
if pv.count("paymentLanding")!=pv0.count("paymentLanding")+1:
    stop('Unexpected Payment Process route mutations')
if nav.count('jims_v2_my_fm_review_queue_v1')!=1:
    stop('Expected only one V2 FM notification RPC')

print('JIMS STEP 57B4 — '+('DRY RUN' if DRY else 'INSTALL'))
print('Finance Manager Payment Process: new actionable V2 review queue + count.')
print('Sidebar Payment Process badge: pending Full Payment V1 + authorized V2.')
print('No Supabase writes, no status edits, no Full Payment V1 modifications.')
if DRY:
    print('DRY RUN PASS — zero files changed.')
    sys.exit(0)
backup=ROOT/('app/gui-backups/57B4_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/PV.name).write_text(pv0)
(backup/NAV.name).write_text(nav0)
added=False
try:
    with QUEUE.open('x') as f:f.write(queue)
    added=True
    PV.write_text(pv)
    NAV.write_text(nav)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 57B4 FINANCE MANAGER PARTIAL PAYMENT QUEUE — BUILD PASS')
    print('Backup:',backup)
    print('Test: FM > Payment Process > Partial Payment — Finance Manager Review > Open for Review.')
except Exception as e:
    PV.write_text(pv0)
    NAV.write_text(nav0)
    if added:QUEUE.unlink(missing_ok=True)
    stop('Build/install failed, original files restored: '+str(e))
