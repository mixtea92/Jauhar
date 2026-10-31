#!/usr/bin/env python3
"""JIMS Step 57B3: mandatory per-installment evidence/Finance Manager approval.
REQUIRES manual installation of Step57B3 SQL BEFORE running this UI installer.
Protected: Full Payment V1, PV approvals, sidebar, 57B2 draft cancellation.
Touch only PaymentTrackingPanel.jsx, JIMSPaymentModeSelector.jsx;
create new workflow JSX+CSS, with backup/rollback + npm run build.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PANEL=ROOT/'app/src/payment/PaymentTrackingPanel.jsx'
SELECTOR=ROOT/'app/src/payment/JIMSPaymentModeSelector.jsx'
FLOW=ROOT/'app/src/payment/JIMSInstallmentWorkflow.jsx'
CSS=ROOT/'app/src/payment/JIMSInstallmentWorkflow.css'
DRY='--dry-run' in sys.argv

def stop(msg):sys.exit('STOP: '+str(msg))
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(path):
    try:return git('show','origin/'+BRANCH+':'+path)
    except Exception as exc:stop('Missing upstream asset '+path+': '+str(exc))
def one(text,old,new,label):
    count=text.count(old)
    if count!=1:stop(label+' expected 1 anchor, found '+str(count)+'. No edits made.')
    return text.replace(old,new,1)

if git('branch','--show-current').strip()!=BRANCH:stop('Unexpected Codespaces branch')
for f in (PANEL,SELECTOR):
    if not f.exists():stop('Missing active file: '+str(f))
if FLOW.exists() or CSS.exists():stop('Step57B3 files already exist. Refusing duplicate install.')
oldpanel=PANEL.read_text()
oldselector=SELECTOR.read_text()
for marker in ("import './JIMSPartialDraft.css'",
               "voucher?.payment_mode !== 'partial'",
               "  const modeChoiceAllowed = eligible && financeExec && status === 'pending_payment' &&",
               "onDraftChanged={onVoucherChanged}",
               "supabase.rpc('complete_pv_payment_v1'"):
    if marker not in oldpanel:stop('Protected 57B2 PaymentTrackingPanel differs: '+marker)
for marker in ("STEP 57B.2", "jims_v2_create_payment_draft_v1",
               "jims_v2_cancel_payment_draft_v1","Drafts only at Step 57B.2"):
    if marker not in oldselector:stop('Protected Step 57B2 selector differs: '+marker)

newselector=remote('gui-patches/57B/JIMSPaymentModeSelector_Step57B3.jsx')
workflow=remote('gui-patches/57B/JIMSInstallmentWorkflow.jsx')
css=remote('gui-patches/57B/JIMSInstallmentWorkflow.css')
for x in ('JIMSInstallmentWorkflow','jims_v2_create_payment_draft_v1',
          'jims_v2_cancel_payment_draft_v1','canFM={canReview}'):
    if x not in newselector:stop('Unexpected 57B3 selector: '+x)
for x in ('jims_v2_submit_installment_v1','jims_v2_review_installment_v1',
          'jims_v2_complete_installment_v1',
          'jims_v2_payment_documents','Final Bank Receipt PDF','initiation proof'):
    if x not in workflow:stop('Missing mandatory evidence step '+x)
for forbidden in ('.insert(','.update(','.upsert(','.delete('):
    if forbidden in newselector or forbidden in workflow:
        stop('New UI must not directly mutate Supabase tables: '+forbidden)
if '.jims-v2-evidence' not in css:stop('Invalid payment UI CSS')

newpanel=oldpanel
newpanel=one(newpanel,
    "import './JIMSPartialDraft.css'",
    "import './JIMSPartialDraft.css'\nimport './JIMSInstallmentWorkflow.css'",
    'V2 evidence CSS')
newpanel=one(newpanel,
    """  const modeChoiceAllowed = eligible && financeExec && status === 'pending_payment' &&
    (voucher?.payment_mode === 'partial' ||
      (!voucher?.payment_initiation_proof_id && proofs.length === 0))""",
    """  // The installment history/approval must also be visible to Finance Manager
  // and permitted PV viewers after V2 starts, including after final settlement.
  const modeChoiceAllowed = eligible && (
    voucher?.payment_mode === 'partial' ||
    (financeExec && status === 'pending_payment' &&
      !voucher?.payment_initiation_proof_id && proofs.length === 0))""",
    'Read-only V2 history and FM access')
newpanel=one(newpanel,
    """        <JIMSPaymentModeSelector voucher={voucher} mode={paymentMode}
          onModeChange={setPaymentMode} onDraftChanged={onVoucherChanged}
          disabled={busy}/>""",
    """        <JIMSPaymentModeSelector voucher={voucher} mode={paymentMode}
          onModeChange={setPaymentMode} onDraftChanged={onVoucherChanged}
          profile={profile} canReview={financeManager} disabled={busy}/>""",
    'Propagate true user authority to FM actions')

# Absolutely no existing Full Payment V1 RPCs altered.
for rpc in ("register_pv_payment_initiation_proof_v1","initiate_pv_payment_v1",
            "review_pv_payment_initiation_v1","complete_pv_payment_v1"):
    if newpanel.count(rpc)!=oldpanel.count(rpc):
        stop('Protected V1 payment RPC modified: '+rpc)
if oldpanel.count('supabase.rpc(')!=newpanel.count('supabase.rpc('):
    stop('Legacy V1 RPC count differs')
if newpanel.count('JIMSPaymentModeSelector')!=oldpanel.count('JIMSPaymentModeSelector'):
    stop('Unexpected selector mounts')
for rpc in ('jims_v2_create_payment_draft_v1','jims_v2_cancel_payment_draft_v1'):
    if newselector.count(rpc)!=oldselector.count(rpc):
        stop('Protected 57B2 draft RPC changed: '+rpc)

print('JIMS STEP 57B3 — '+('DRY RUN' if DRY else 'INSTALL'))
print('Mandatory upload initiation evidence per installment + FM approve/return.')
print('Mandatory final PDF bank receipt + private history per installment.')
print('Fully paid ONLY after all installments settle, enforced by Supabase RPC.')
print('Full Payment V1, PV approval, Delegation, sidebar untouched.')
if DRY:
    print('DRY RUN PASS — no local files changed.')
    sys.exit(0)

backup=ROOT/('app/gui-backups/57B3_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/PANEL.name).write_text(oldpanel)
(backup/SELECTOR.name).write_text(oldselector)
created=[]
try:
    with FLOW.open('x') as f:f.write(workflow)
    created.append(FLOW)
    with CSS.open('x') as f:f.write(css)
    created.append(CSS)
    PANEL.write_text(newpanel)
    SELECTOR.write_text(newselector)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 57B3 — BUILD PASS')
    print('Backup:',backup)
    print('Now test draft #1 with NEW proof before FM approval.')
except Exception as exc:
    PANEL.write_text(oldpanel)
    SELECTOR.write_text(oldselector)
    for p in created:p.unlink(missing_ok=True)
    stop('Install/build failed, original UI restored: '+str(exc))
