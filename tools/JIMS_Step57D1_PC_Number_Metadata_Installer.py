#!/usr/bin/env python3
"""JIMS 57D1 — Petty Cash immutable PC/RVnn/MMYY/NNNN numbering & metadata UI.
Requires backend migrations 57D1, 57D1B, 57D1C already installed.
Run: python3 /tmp/JIMS_57D1.py --dry-run && python3 /tmp/JIMS_57D1.py
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
APP=ROOT/'app'
CASH=APP/'src/CashVoucher.jsx'
REPORT=APP/'src/JIMSHistoryExports.jsx'
BASE='app/src/CashVoucher.jsx'
PATCH='gui-patches/57D/JIMS_CashVoucher_57D1_PettyCash_Number_Metadata.jsx'
DRY='--dry-run' in sys.argv

def stop(s):sys.exit('STOP: '+str(s))
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(path):
    try:return git('show','origin/'+BRANCH+':'+path)
    except Exception as e:stop('Cannot fetch '+path+': '+str(e))
def once(s,part,label):
    n=s.count(part)
    if n!=1:stop(label+' expected once; found '+str(n))

if git('branch','--show-current').strip()!=BRANCH:stop('Wrong GitHub branch')
if not CASH.exists() or not REPORT.exists():stop('Petty Cash / Report Generation component missing')
old_cash=CASH.read_text()
old_report=REPORT.read_text()
new_cash=remote(PATCH)
base_cash=remote(BASE)
if 'JIMS_STEP57D1_PC_MONTHLY_REVISION_AND_METADATA' in old_cash:
    stop('PC numbering UI already installed; no duplicate')
if old_cash!=base_cash:
    stop('CashVoucher.jsx differs from GitHub baseline. Stop to avoid overwriting custom local changes.')
if 'jims_pc_number_status_v1' not in new_cash or 'jims_pc_set_next_revision_v1' not in new_cash:
    stop('New UI missing revision control')
if 'charge_subdepartment' not in new_cash or 'charge_cost_center' not in new_cash:
    stop('New UI missing metadata fields')
if 'Report Generation' not in old_report:
    stop('Install Step57C8B Report Generation first')

old_col="['cost_center','Cost Center'],['claimant','Claimant'],['amount','Amount (RM)'],"
new_col="['cost_center','Cost Center'],['charge_subdepartment','Charge Sub-Department'],['requester_department','Requester Department'],['requester_subdepartment','Requester Sub-Department'],['requester_cost_center','Requester Cost Center'],['claimant','Claimant'],['amount','Amount (RM)'],"
once(old_report,old_col,'Petty Cash Excel export column')
new_report=old_report.replace(old_col,new_col,1)

# All business flows must remain intact; changes limited to numbering and metadata.
protected=['jsync_cv_save_draft_v1','jsync_cv_submit_v1','jsync_cv_approve_many_v1',
           'jsync_cv_attach_receipt_v1','downloadSignedCVExcel',
           'SignaturePad','cash_voucher_approvals','cash_voucher_receipts',
           'captureSignedCVSignatures','isMobileUpload']
for token in protected:
    if old_cash.count(token)!=new_cash.count(token):
        stop('Existing Cash Voucher workflow changed unexpectedly: '+token)
if new_cash.count('JIMS_STEP57D1_PC_MONTHLY_REVISION_AND_METADATA')!=1:
    stop('New UI marker count invalid')
if new_report.count('charge_subdepartment')!=old_report.count('charge_subdepartment')+1:
    stop('Report export metadata patch ambiguous')

if (APP/'node_modules/@babel/parser').is_dir():
    with tempfile.TemporaryDirectory(prefix='jims57d1_') as t:
        pc=Path(t)/'CashVoucher.jsx'
        rep=Path(t)/'JIMSHistoryExports.jsx'
        pc.write_text(new_cash)
        rep.write_text(new_report)
        script="""const fs=require('fs'),babel=require('@babel/parser');
          for (const f of process.argv.slice(1)) {
            babel.parse(fs.readFileSync(f,'utf8'),{sourceType:'module',plugins:['jsx']})
          }
          console.log('JIMS 57D1 JSX PARSER PASS')"""
        test=subprocess.run(['node','-e',script,str(pc),str(rep)],
          cwd=APP,capture_output=True,text=True)
        if test.returncode:stop('JSX preflight failed: '+test.stderr[-2300:])
        print(test.stdout.strip())

print('JIMS STEP57D1 PETTY CASH NUMBER + METADATA — '+('DRY RUN' if DRY else 'INSTALL'))
print('PC/RV01/MMYY/NNNN non-editable, monthly reset; future RV advanced by System Admin.')
print('Department / Sub-Department / Cost Center allocation stored in private metadata.')
print('Original PC Excel unchanged; old CV numbers preserved; exports updated.')
if DRY:
    print('DRY RUN PASS — no project files modified.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D1_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'CashVoucher.jsx').write_text(old_cash)
(backup/'JIMSHistoryExports.jsx').write_text(old_report)
try:
    CASH.write_text(new_cash)
    REPORT.write_text(new_report)
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS STEP57D1 PETTY CASH NUMBER + METADATA — BUILD PASS')
    print('Backup:',backup)
except Exception as e:
    CASH.write_text(old_cash)
    REPORT.write_text(old_report)
    stop('Build failed; original components restored: '+str(e))
