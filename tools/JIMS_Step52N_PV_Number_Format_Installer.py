#!/usr/bin/env python3
"""JIMS Step 52N — change NEW PV number generation to v5 (front-end only).

Supabase migration must have been applied FIRST. Preserves 51M manual/Excel
entry and all previously tested PV/CV/payment/delegation workflows.
One RPC function-name change + one disabled field hint; backup/build/rollback.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PV=ROOT/'app/src/PaymentVoucher.jsx'
DRY='--dry-run' in sys.argv

def stop(message): sys.exit('STOP: '+message)
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def one(source,old,new,label):
    if source.count(old)!=1:
        stop(label+' expected exactly once; found '+str(source.count(old))+'; no files touched.')
    return source.replace(old,new,1)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch. Expected '+BRANCH)
if not PV.is_file(): stop('PV source missing.')
old=PV.read_text()

# Refuse to modify if the optional Excel/manual Step51M form was not installed.
required=(
    'Two options: Manual Entry or Excel Import.',
    "template_version: REQUIRED_TEMPLATE_REVISION",
    "form.template_version !== REQUIRED_TEMPLATE_REVISION",
    "async function handleExcelImport(event)",
    "async function handleSave(event)",
    "<PaymentTrackingPanel",
    "<JRPanel",
    "Download Official Template (Optional)"
)
for marker in required:
    if marker not in old: stop('Protected PV entry/version missing: '+marker)
if 'create_pv_draft_v5' in old: stop('New PV numbering v5 already referenced.')
old_rpc="supabase.rpc('create_pv_draft_v4', {"
new_rpc="supabase.rpc('create_pv_draft_v5', {"
new=one(old,old_rpc,new_rpc,'New draft RPC')
new=one(new,"value={editingVoucher?.pv_number || 'Auto-generated on Save Draft'}",
    "value={editingVoucher?.pv_number || 'PV/TXX/RV01/MMYY/NNNN — assigned on Save Draft'}",
    'Number format preview')
# Ensure no business function/body was edited.
old_calls=[line.strip() for line in old.splitlines() if '.rpc(' in line]
new_calls=[line.strip() for line in new.splitlines() if '.rpc(' in line]
if len(old_calls)!=len(new_calls):
    stop('RPC call count unexpectedly changed.')
expected=[line.replace(old_rpc,new_rpc,1) for line in old_calls]
if sorted(expected)!=sorted(new_calls):
    stop('Unexpected RPC change in Payment Voucher.')
if old.count('create_pv_draft_v4')!=1 or new.count('create_pv_draft_v5')!=1:
    stop('New draft RPC migration check failed.')
if len(new)<100000:
    stop('PV component content unexpectedly short.')

print('JIMS STEP 52N — '+('DRY RUN' if DRY else 'INSTALL'))
print('New PV number: PV/TXX/RVXX/MMYY/NNNN; assigned by secure Supabase RPC v5')
print('Existing PV numbers untouched; manual/Excel import and all approvals unchanged')
print('Only app/src/PaymentVoucher.jsx modified.')
if DRY:
    print('DRY RUN PASS — no file changed.')
    sys.exit(0)

backup=ROOT/('app/gui-backups/52N_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'PaymentVoucher.jsx').write_text(old)
try:
    PV.write_text(new)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 52N PV NUMBER FORMAT — BUILD PASS')
    print('Backup:',backup)
except Exception as err:
    PV.write_text(old)
    stop('Build failed; original PV source restored: '+str(err))
