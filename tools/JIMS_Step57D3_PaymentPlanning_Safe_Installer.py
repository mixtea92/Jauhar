#!/usr/bin/env python3
"""JIMS Step 57D3 — SAFE additive UI installer.
Add ONE standalone component to the existing Payment Process board.
NEVER replace user's local PaymentVoucher.jsx / original approval & payment engines.
--dry-run performs all structural checks with NO writes.
On install, backs up original Board + rollback on npm build failure.
"""
from pathlib import Path
from datetime import datetime, timezone
import re, subprocess, sys

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
BOARD=APP/'src/JIMSPaymentProcessBoard.jsx'
COMP=APP/'src/JIMSPaymentPlanning57D3.jsx'
DRY='--dry-run' in sys.argv
BRANCH='jsync-gui-revamp-20261029'
SOURCE='gui-patches/57D/JIMSPaymentPlanning57D3.jsx'

def stop(msg):sys.exit('STOP: '+str(msg)+' — project files unchanged.')
def run(*args,cwd=ROOT):
    return subprocess.check_output(list(args),cwd=cwd,text=True)
def once(haystack,needle,label):
    n=haystack.count(needle)
    if n!=1:stop(f'{label} must appear once; found {n} (do not overwrite custom local changes).')

if run('git','branch','--show-current').strip()!=BRANCH:stop('Wrong Codespaces branch')
if not BOARD.exists():stop('Payment Process board not installed locally. Nothing changed.')
if COMP.exists():stop('57D3 UI component already exists; do not double-install')
original=BOARD.read_text(encoding='utf-8')
if 'JIMS_STEP57D3_PAYMENT_PLANNING' in original:stop('57D3 already installed in Payment Process Board')
source=run('git','show','origin/'+BRANCH+':'+SOURCE)
for marker in ('JIMS STEP 57D3','jims_57d3_get_planning_v1','jims_57d3_record_due_v1',
               'jims_57d3_manager_schedule_v1','jims_57d3_manager_due_v1'):
    if marker not in source:stop('Standalone UI component missing '+marker)
# Verify specific finance board features without modifying their implementations.
for marker in ('export default function JIMSPaymentProcessBoard',
               'payment_vouchers', 'pv_payment_transactions','jims-payment-history'):
    if marker not in original:stop('Current Payment Process board missing '+marker)

# One import, one unconditional state hook, modal, two small buttons. Existing
# financial calculation, SQL calls, payment stages, histories remain byte-for-byte.
v=original
v="import JIMSPaymentPlanning57D3 from './JIMSPaymentPlanning57D3'\n"+v
func=re.compile(r'(?m)^export default function JIMSPaymentProcessBoard\([^\n]*\)\{\s*\n')
matches=list(func.finditer(v))
if len(matches)!=1:stop('Cannot locate exactly one Payment Process component function')
m=matches[0]
v=v[:m.end()]+"  // JIMS_STEP57D3_PAYMENT_PLANNING — additive Finance planning modal.\n  const [planningVoucher,setPlanningVoucher]=useState(null)\n"+v[m.end():]

render='<section className="panel jims-payment-board" aria-label="Payment Process">'
once(v,render,'board JSX root')
v=v.replace(render,render+"""
    {planningVoucher&&<JIMSPaymentPlanning57D3
      voucher={planningVoucher} profile={profile}
      transactions={ledger.filter(t=>t.voucher_id===planningVoucher.id)}
      initialTransactionId={ledger.find(t=>t.voucher_id===planningVoucher.id
        && t.installment_no===planningVoucher.installment_no
        && !['paid','voided','cancelled','completed'].includes(t.status))?.id||null}
      onClose={()=>setPlanningVoucher(null)} />}
""",1)

# Insert small action only next to existing Open PV buttons (no replacement).
list_button='<button type="button" className="btn" onClick={()=>onOpenVoucher(v.id)}>'
once(v,list_button,'active payment list Open PV button')
v=v.replace(list_button,
    '<button type="button" className="btn" onClick={()=>setPlanningVoucher(v)}>'
    'Payment Planning</button>\n            '+list_button,1)
history_button='<button type="button" className="btn" onClick={()=>onOpenVoucher(r.id)}>'
if v.count(history_button)==1:
    v=v.replace(history_button,
      '<button type="button" className="btn" onClick={()=>setPlanningVoucher(r)}>Planning History</button>\n            '
      +history_button,1)

# These counts ensure we've not changed a financial RPC or finance summary.
for guard in ('payment_vouchers','pv_payment_transactions','financialSummary','onOpenVoucher(',
              'jims-pb-money-summary','jims-payment-history','status===','payment_mode'):
    if original.count(guard)!=v.count(guard):
        stop('Existing protected payment logic was altered: '+guard)
if v.count('JIMS_STEP57D3_PAYMENT_PLANNING')!=1:stop('Duplicate 57D3 state hook')

print('57D3 additive UI anchors PASS')
print('Existing payment / approval engine preserved.')
if DRY:
    print('JIMS 57D3 DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D3_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'JIMSPaymentProcessBoard.jsx').write_text(original,encoding='utf-8')
try:
    COMP.write_text(source,encoding='utf-8')
    BOARD.write_text(v,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D3 BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    BOARD.write_text(original,encoding='utf-8')
    COMP.unlink(missing_ok=True)
    sys.exit('STOP: Vite build failed; local Payment Process Board restored from backup: '+str(exc))
