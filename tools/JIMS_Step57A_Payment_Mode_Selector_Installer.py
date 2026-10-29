#!/usr/bin/env python3
"""JIMS Step 57A — guarded Payment Mode Selection installer.

Safe UI foundation: Full Payment V1 remains exactly intact and fully functional.
Partial Payment is a read-only amount/balance PREVIEW; Step 57B is required
before any installment may be initiated, reserved, settled, or uploaded.
Installs 2 new payment UI assets and modifies only PaymentTrackingPanel.jsx.
No Supabase DDL/DML, no changes to existing payment RPCs or payment approval flow.
Requires Step 56N and the 51A read-only balance view already installed.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT = Path('/workspaces/Jauhar')
BRANCH = 'jsync-gui-revamp-20261029'
SRC = ROOT / 'app/src/payment/PaymentTrackingPanel.jsx'
APP = ROOT / 'app/src/App.jsx'
PV = ROOT / 'app/src/PaymentVoucher.jsx'
SELECTOR = ROOT / 'app/src/payment/JIMSPaymentModeSelector.jsx'
STYLE = ROOT / 'app/src/payment/JIMSPaymentModeSelector.css'
DRY = '--dry-run' in sys.argv

def stop(message):
    sys.exit('STOP: ' + str(message))

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True)

def remote(path):
    try:
        return git('show', 'origin/' + BRANCH + ':' + path)
    except Exception as exc:
        stop('Could not fetch ' + path + '. Run git fetch origin first. ' + str(exc))

def one(text, before, after, name):
    n = text.count(before)
    if n != 1:
        stop(name + ' requires exactly 1 anchor; found ' + str(n) + '. No edits made.')
    return text.replace(before, after, 1)

if git('branch', '--show-current').strip() != BRANCH:
    stop('Switch to the existing branch ' + BRANCH + ' before running.')
for p in (SRC, APP, PV):
    if not p.is_file():
        stop('Missing protected JIMS file: ' + str(p))
if SELECTOR.exists() or STYLE.exists():
    stop('Step 57A assets already exist. Refusing duplicate installation.')

app = APP.read_text()
pv = PV.read_text()
old = SRC.read_text()

for marker in ('JIMS_STEP_55L_ORDER', 'jimsActionCounts', 'JIMSFinanceActionBadges.css'):
    if marker not in app:
        stop('Step 56N baseline missing App marker: ' + marker)
for marker in ('PV History', 'Payment History', 'PaymentTrackingPanel'):
    if marker not in pv:
        stop('Step 54H payment/history baseline missing: ' + marker)
for marker in (
    "import { supabase } from '../lib/supabase'",
    "const INIT_BUCKET = 'jauhar-pv-payment-initiation'",
    "const RECEIPT_BUCKET = 'jauhar-pv-receipts'",
    'const canInitiate = eligible && financeExec',
    '  const latest = proofs[0]',
    '  const [busy, setBusy] = useState(false)',
    '    setProofFile(null)',
    "supabase.rpc('register_pv_payment_initiation_proof_v1'",
    "supabase.rpc('initiate_pv_payment_v1'",
    "supabase.rpc('review_pv_payment_initiation_v1'",
    "supabase.rpc('complete_pv_payment_v1'",
):
    if marker not in old:
        stop('Existing Full Payment V1 source differs; missing: ' + marker)
if 'JIMSPaymentModeSelector' in old:
    stop('Step 57A may already be installed.')

selector = remote('gui-patches/57A/JIMSPaymentModeSelector.jsx')
css = remote('gui-patches/57A/JIMSPaymentModeSelector.css')
for marker in ('pv_payment_balances_v2', 'preview-only', "value='partial'"):
    # JSX currently uses double-quoted HTML attributes.
    if marker not in selector and (marker != "value='partial'" or 'value="partial"' not in selector):
        stop('Invalid selector source: ' + marker)
for forbidden in ('.insert(', '.update(', '.upsert(', '.delete(', '.rpc(', '.upload('):
    if forbidden in selector:
        stop('Partial mode preview must remain read-only: ' + forbidden)
if '.jims-pay-mode' not in css:
    stop('Payment mode stylesheet missing.')

new = old
new = one(
    new, "import { supabase } from '../lib/supabase'",
    "import { supabase } from '../lib/supabase'\n"
    "import JIMSPaymentModeSelector from './JIMSPaymentModeSelector'\n"
    "import './JIMSPaymentModeSelector.css'",
    'New selector imports'
)
new = one(
    new, '  const [busy, setBusy] = useState(false)',
    "  const [busy, setBusy] = useState(false)\n"
    "  const [paymentMode, setPaymentMode] = useState('full')",
    'Default Full Payment state'
)
new = one(
    new, '    setProofFile(null)\n    setReceiptFile(null)',
    "    setPaymentMode('full')\n"
    "    setProofFile(null)\n"
    "    setReceiptFile(null)",
    'Reset choice when switching vouchers'
)
new = one(
    new, '  const latest = proofs[0]',
    """  // Choose a mode only before the legacy V1 initiation/proof exists.
  // V1 returned initiatives continue through their original workflow.
  const modeChoiceAllowed = canInitiate && status === 'pending_payment' &&
    !voucher?.payment_initiation_proof_id && proofs.length === 0
  const latest = proofs[0]""",
    'Safely restrict mode selection'
)
target = "      {canInitiate && <div style={{border:'1px solid #d5e2f0',borderRadius:10,padding:14,margin:'12px 0'}}>"
replacement = """      {modeChoiceAllowed && (
        <JIMSPaymentModeSelector voucher={voucher} mode={paymentMode}
          onModeChange={setPaymentMode} disabled={busy}/>
      )}
      {canInitiate && (!modeChoiceAllowed || paymentMode === 'full') && <div style={{border:'1px solid #d5e2f0',borderRadius:10,padding:14,margin:'12px 0'}}>"""
new = one(new, target, replacement, 'Render selector without enabling partial payment')

# Verify all existing payment RPC calls and their counts remain unchanged.
rpcs = (
    'register_pv_payment_initiation_proof_v1',
    'initiate_pv_payment_v1',
    'review_pv_payment_initiation_v1',
    'complete_pv_payment_v1',
)
for name in rpcs:
    if old.count(name) != new.count(name):
        stop('Protected Full Payment RPC occurrence changed: ' + name)
if new.count('JIMSPaymentModeSelector') != 4:
    stop('Unexpected selector import/render count.')
if old.count('supabase.rpc(') != new.count('supabase.rpc('):
    stop('Protected payment RPC calls changed.')

print('JIMS STEP 57A — ' + ('DRY RUN' if DRY else 'INSTALL'))
print('Full Payment V1: existing initiation, approval, paid RPCs untouched.')
print('Partial Payment: selectable preview and secure read-only balance only.')
print('No database, voucher, delegated authority, history, or sidebar edits.')
if DRY:
    print('DRY RUN PASS — zero files changed.')
    sys.exit(0)

backup = ROOT / 'app/gui-backups' / (
    '57A_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
)
backup.mkdir(parents=True, exist_ok=False)
(backup / SRC.name).write_text(old)
created = []
try:
    with SELECTOR.open('x') as f:
        f.write(selector)
    created.append(SELECTOR)
    with STYLE.open('x') as f:
        f.write(css)
    created.append(STYLE)
    SRC.write_text(new)
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT / 'app', check=True)
    print('JIMS STEP 57A PAYMENT MODE SELECTION — BUILD PASS')
    print('Backup:', backup)
    print('Test: AP Finance > Payment Process > select a fully approved Pending Payment PV.')
    print('Full remains active. Partial is preview-only pending Step 57B.')
except Exception as exc:
    SRC.write_text(old)
    for path in created:
        path.unlink(missing_ok=True)
    stop('Install/build failed; original payment panel restored, new assets removed: ' + str(exc))
