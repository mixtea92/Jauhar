#!/usr/bin/env python3
"""JIMS 57D1E - safer PC metadata frontend installer.
No merge-file; no replacement of the locally customized CashVoucher.jsx.
Only insert two independent React components into existing screen states.
Backend migrations already installed; this installer changes frontend only.
"""
from pathlib import Path
from datetime import datetime, timezone
import re
import subprocess
import sys
import tempfile

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
APP=ROOT/'app'
CASH=APP/'src/CashVoucher.jsx'
REPORT=APP/'src/JIMSHistoryExports.jsx'
WIDGET=APP/'src/JIMSPettyCash57D1E.jsx'
SOURCE='gui-patches/57D/JIMSPettyCash57D1E.jsx'
DRY='--dry-run' in sys.argv

def fail(reason):
    sys.exit('STOP: '+str(reason)+' (no project files changed).')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def single_match(text,pattern,label):
    found=list(re.finditer(pattern,text,re.MULTILINE))
    if len(found)!=1:
        # Give concrete diagnostic instead of looping on opaque anchors.
        alternatives=[x.strip()[:160] for x in text.splitlines()
                      if ('mode' in x and ('home' in x or 'form' in x))
                      or ('isAP' in x and '&&' in x)]
        fail(label+': expected one screen marker, found '+str(len(found))+
             '. Relevant local lines: '+repr(alternatives[:14]))
    return found[0]

if git('branch','--show-current').strip()!=BRANCH:
    fail('Expected GitHub branch '+BRANCH)
if not CASH.is_file() or not REPORT.is_file():
    fail('Petty Cash / Report Generation source files missing')
old=CASH.read_text(encoding='utf-8')
old_report=REPORT.read_text(encoding='utf-8')
if WIDGET.exists():
    fail('External PC metadata component already exists. Review before installing again')
if 'JIMSPettyCash57D1E' in old:
    fail('External PC metadata component already imported in Petty Cash')
if 'JIMS_STEP57D1_PC_MONTHLY_REVISION_AND_METADATA' in old:
    fail('Older 57D1 frontend already partially installed')
widget=git('show','origin/'+BRANCH+':'+SOURCE)
if ('JIMS_STEP57D1E_EXTERNAL_PETTY_CASH_FIELDS' not in widget
    or 'jims_pc_number_status_v1' not in widget
    or 'jims_pc_set_next_revision_v1' not in widget):
    fail('Remote standalone UI missing required features')

# Add a single import, without changing existing imports, role conditions or
# voucher business methods.
import_line="import { JIMSPettyCashChargeFields, JIMSPettyCashRevisionPanel } from './JIMSPettyCash57D1E'\n"
modified=import_line+old

# JIMS standard screen markers. Match all whitespace/quote variations.
home_rx=r"\{\s*mode\s*===\s*(['\"])home\1\s*&&\s*<>\s*"
form_rx=r"\{\s*mode\s*===\s*(['\"])form\1\s*&&\s*isAP\s*&&\s*<>\s*"
home=single_match(modified,home_rx,'Petty Cash home screen')
modified=modified[:home.end()]+"\n      <JIMSPettyCashRevisionPanel profile={profile} />"+modified[home.end():]
form=single_match(modified,form_rx,'Petty Cash edit/create form')
modified=modified[:form.end()]+"\n      <JIMSPettyCashChargeFields form={form} setForm={setForm} />"+modified[form.end():]

# Keep old PC data/approver/receipt workflows, browser mobile restrictions,
# and existing AP security branches byte-for-byte, except two JSX elements.
protected=('jsync_cv_save_draft_v1','jsync_cv_submit_v1',
           'jsync_cv_approve_many_v1','jsync_cv_attach_receipt_v1',
           'downloadSignedCVExcel','captureSignedCVSignatures','SignaturePad',
           'cash_voucher_approvals','cash_voucher_receipts','isMobileUpload')
for token in protected:
    if old.count(token)!=modified.count(token):
        fail('Protected existing workflow changed: '+token)
if modified.count('<JIMSPettyCashChargeFields')!=1:
    fail('Metadata fields appear more than once')
if modified.count('<JIMSPettyCashRevisionPanel')!=1:
    fail('Revision widget appears more than once')
if "charge_subdepartment" not in widget or "charge_cost_center" not in widget:
    fail('Component lacks mandatory subdepartment or cost center input')

# Extend PC Excel export if the locally customized report still has the expected
# Petty Cash column map. Never replace whole report or block PC screen install
# because the user customized report layout.
new_report=old_report
old_columns="['cost_center','Cost Center'],['claimant','Claimant'],['amount','Amount (RM)'],"
new_columns="['cost_center','Cost Center'],['charge_subdepartment','Charge Sub-Department'],['requester_department','Requester Department'],['requester_subdepartment','Requester Sub-Department'],['requester_cost_center','Requester Cost Center'],['claimant','Claimant'],['amount','Amount (RM)'],"
if old_report.count(old_columns)==1:
    new_report=old_report.replace(old_columns,new_columns,1)
    print('Petty Cash Excel metadata columns: added.')
elif old_report.count(new_columns)==1:
    print('Petty Cash Excel metadata columns: already installed, preserved.')
else:
    print('NOTE: Local Excel report layout differs; left untouched to preserve custom reports.')
    print('New Petty Cash allocation fields WILL be stored in Supabase private metadata.')

# Syntax preflight for the exact frontend files intended to be installed.
with tempfile.TemporaryDirectory(prefix='jims57d1e_preflight_') as t:
    temp=Path(t)
    pc=temp/'CashVoucher.jsx'
    ui=temp/'JIMSPettyCash57D1E.jsx'
    report=temp/'JIMSHistoryExports.jsx'
    pc.write_text(modified,encoding='utf-8')
    ui.write_text(widget,encoding='utf-8')
    report.write_text(new_report,encoding='utf-8')
    checker="""const fs=require('fs'),p=require('@babel/parser');
      for(const f of process.argv.slice(1)){
        p.parse(fs.readFileSync(f,'utf8'),{sourceType:'module',plugins:['jsx']});
      }
      console.log('JIMS 57D1E JSX CHECK PASS')"""
    preflight=subprocess.run(
       ['node','-e',checker,str(pc),str(ui),str(report)],
       cwd=APP,capture_output=True,text=True)
    if preflight.returncode:
        fail('JSX preflight failed: '+preflight.stderr[-1700:])
    print(preflight.stdout.strip())

print('JIMS 57D1E PC METADATA — '+('DRY RUN' if DRY else 'INSTALL'))
print('Only 1 import + 2 component references added to existing CashVoucher.jsx.')
print('All previous local PC workflow edits retained.')
if DRY:
    print('DRY RUN PASS — no source files modified.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D1E_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'CashVoucher.jsx').write_text(old,encoding='utf-8')
(backup/'JIMSHistoryExports.jsx').write_text(old_report,encoding='utf-8')
try:
    WIDGET.write_text(widget,encoding='utf-8')
    CASH.write_text(modified,encoding='utf-8')
    if new_report!=old_report:
        REPORT.write_text(new_report,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D1E PETTY CASH FRONTEND — BUILD PASS')
    print('Backup:',backup)
except Exception as err:
    CASH.write_text(old,encoding='utf-8')
    REPORT.write_text(old_report,encoding='utf-8')
    WIDGET.unlink(missing_ok=True)
    fail('Build failed and original files restored: '+str(err))
