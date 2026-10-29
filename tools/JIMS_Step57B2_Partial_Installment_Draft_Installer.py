#!/usr/bin/env python3
"""JIMS Step 57B2 — guarded draft-only Partial Payment interface.
Requires live Supabase 57B1 SQL and successful 57A Codespaces build.
Touches only PaymentTrackingPanel.jsx and its 57A mode selector, plus NEW CSS.
Does not change Full Payment V1 RPC logic, Supabase, approval history or sidebar.
Partial transfer/review/settlement remain disabled until 57B3.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PAY=ROOT/'app/src/payment/PaymentTrackingPanel.jsx'
SELECTOR=ROOT/'app/src/payment/JIMSPaymentModeSelector.jsx'
STYLE=ROOT/'app/src/payment/JIMSPartialDraft.css'
DRY='--dry-run' in sys.argv

def stop(message): sys.exit('STOP: '+str(message))
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(path):
    try: return git('show','origin/'+BRANCH+':'+path)
    except Exception as exc: stop('Missing remote asset '+path+': '+str(exc))
def one(source,old,new,label):
    n=source.count(old)
    if n != 1: stop(label+' expected one match, found '+str(n)+'. Files unchanged.')
    return source.replace(old,new,1)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong Codespaces branch; expected '+BRANCH)
for f in (PAY,SELECTOR):
    if not f.is_file(): stop('Missing 57A file '+str(f))
if STYLE.exists(): stop('57B2 new CSS file already exists; refusing duplicate install.')

oldpay=PAY.read_text()
oldselector=SELECTOR.read_text()
for marker in ('JIMSPaymentModeSelector',"import './JIMSPaymentModeSelector.css'",
               "const [paymentMode, setPaymentMode] = useState('full')",
               "supabase.rpc('initiate_pv_payment_v1'",
               "supabase.rpc('review_pv_payment_initiation_v1'",
               "supabase.rpc('complete_pv_payment_v1'"):
    if marker not in oldpay: stop('Protected 57A payment baseline mismatch: '+marker)
for marker in ('STEP 57A', 'preview-only', 'pv_payment_balances_v2'):
    if marker not in oldselector: stop('Protected 57A selector baseline mismatch: '+marker)
if 'JIMSPartialDraft.css' in oldpay or 'jims_v2_create_payment_draft_v1' in oldselector:
    stop('Step 57B2 may be already installed.')

nextselector=remote('gui-patches/57B/JIMSPaymentModeSelector.jsx')
css=remote('gui-patches/57B/JIMSPartialDraft.css')
for marker in ('jims_v2_create_payment_draft_v1','jims_v2_cancel_payment_draft_v1',
               'pv_payment_balances_v2','pv_payment_transactions',
               'onDraftChanged','Drafts only at Step 57B.2'):
    if marker not in nextselector: stop('Incomplete 57B2 selector: '+marker)
for forbidden in ('.insert(', '.update(', '.upsert(', '.delete(', '.upload('):
    if forbidden in nextselector: stop('Direct partial-payment mutation forbidden: '+forbidden)
if 'jims-partial-draft' not in css: stop('Invalid 57B2 CSS')

newpay=oldpay
newpay=one(newpay,
    "import './JIMSPaymentModeSelector.css'",
    "import './JIMSPaymentModeSelector.css'\nimport './JIMSPartialDraft.css'",
    'Draft-only CSS import')
newpay=one(newpay,
    '  const canInitiate = eligible && financeExec && (status ===',
    "  const canInitiate = eligible && financeExec && voucher?.payment_mode !== 'partial' && (status ===",
    'Lock legacy V1 initiation on partial mode')
newpay=one(newpay,
    "    setPaymentMode('full')",
    "    setPaymentMode(voucher?.payment_mode === 'partial' ? 'partial' : 'full')",
    'Remember saved mode on re-opening voucher')
newpay=one(newpay,
    """  const modeChoiceAllowed = canInitiate && status === 'pending_payment' &&
    !voucher?.payment_initiation_proof_id && proofs.length === 0""",
    """  const modeChoiceAllowed = eligible && financeExec && status === 'pending_payment' &&
    (voucher?.payment_mode === 'partial' ||
      (!voucher?.payment_initiation_proof_id && proofs.length === 0))""",
    'Keep selector visible on partial PV')
newpay=one(newpay,
    """        <JIMSPaymentModeSelector voucher={voucher} mode={paymentMode}
          onModeChange={setPaymentMode} disabled={busy}/>""",
    """        <JIMSPaymentModeSelector voucher={voucher} mode={paymentMode}
          onModeChange={setPaymentMode} onDraftChanged={onVoucherChanged}
          disabled={busy}/>""",
    'Use secure draft RPC and refresh voucher')

for name in ('register_pv_payment_initiation_proof_v1','initiate_pv_payment_v1',
             'review_pv_payment_initiation_v1','complete_pv_payment_v1'):
    if oldpay.count(name)!=newpay.count(name):
        stop('Full Payment V1 RPC modified: '+name)
if oldpay.count('supabase.rpc(')!=newpay.count('supabase.rpc('):
    stop('Existing Full Payment RPC occurrences modified.')
if newpay.count('JIMSPaymentModeSelector') != oldpay.count('JIMSPaymentModeSelector'):
    stop('Selector mounting count unexpectedly changed.')

print('JIMS STEP 57B2 — '+('DRY RUN' if DRY else 'INSTALL'))
print('Partial installment: draft creation, cancel with reason, history and balance only.')
print('Full Payment V1: protected. Partial upload/review/paid: NOT yet enabled.')
print('No database changes, no PV approval/delegation/sidebar modifications.')
if DRY:
    print('DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=ROOT/('app/gui-backups/57B2_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'PaymentTrackingPanel.jsx').write_text(oldpay)
(backup/'JIMSPaymentModeSelector.jsx').write_text(oldselector)
try:
    with STYLE.open('x') as f: f.write(css)
    PAY.write_text(newpay)
    SELECTOR.write_text(nextselector)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 57B2 — BUILD PASS')
    print('Backup:',backup)
    print('Test ONLY on a new/approved unpaid PV without V1 proof history.')
except Exception as exc:
    PAY.write_text(oldpay)
    SELECTOR.write_text(oldselector)
    STYLE.unlink(missing_ok=True)
    stop('Build/install failed. Originals restored. '+str(exc))
