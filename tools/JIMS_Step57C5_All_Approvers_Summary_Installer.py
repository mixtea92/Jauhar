#!/usr/bin/env python3
"""JIMS Step57C5 — universal actual Approver Summary for HOD/FM/CEO/BOD.
ONE INSTALLER replaces the not-installed Step57C4 BOD-only summary.
Also upgrades gracefully if Step57C4 was already installed.
Uses only tested approval RPCs. No database, payment, evidence, JR or other module changes.
Usage: python3 /tmp/JIMS_57C5.py --dry-run && python3 /tmp/JIMS_57C5.py
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess, sys, tempfile

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
SRC=ROOT/'app/src/PaymentVoucher.jsx'
TARGET_JSX=ROOT/'app/src/JIMSApproverSummary.jsx'
TARGET_CSS=ROOT/'app/src/JIMSApproverSummary.css'
PATCH_DIR='gui-patches/57C/'
DRY='--dry-run' in sys.argv

def stop(msg): sys.exit('STOP: '+str(msg))
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(path):
    try: return git('show','origin/'+BRANCH+':'+path)
    except Exception as exc: stop('Patch file missing: '+path+' '+str(exc))
def one(txt,needle,label):
    n=txt.count(needle)
    if n!=1:stop(label+' must occur once, found '+str(n)+'. Nothing changed.')
def rpc_set(s):
    return sorted(x.strip() for x in s.splitlines() if 'supabase.rpc(' in x)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong Codespaces branch: '+BRANCH)
if not SRC.is_file():stop('Missing installed PaymentVoucher.jsx')
if TARGET_JSX.exists() or TARGET_CSS.exists():
    stop('Step57C5 appears already installed. Nothing overwritten.')

original=SRC.read_text()
if 'JIMS_STEP_57C5_ALL_APPROVERS' in original:
    stop('Already installed universal approval table')
if '<PaymentTrackingPanel' not in original or '<JRPanel' not in original:
    stop('Protected Payment Process/JR components missing')
if 'parseRevisionOneWorkbook' not in original:
    stop('Revision1 53T-C frontend baseline not installed; do not modify this app')

import_anchor="import PVDelegationHistory from './PVDelegationHistory'"
one(original,import_anchor,'PV import')
new=original.replace(import_anchor,import_anchor+
    "\nimport JIMSApproverSummary from './JIMSApproverSummary'",1)

widget="""          {/* JIMS_STEP_57C5_ALL_APPROVERS — one approval summary at TOP, role-restricted. */}
          {(canManage || canApproveCEO || canApproveBOD) && (
            <JIMSApproverSummary profile={profile} onOpenVoucher={openVoucher}
              onDecisionRecorded={refreshPVData}
              refreshKey={[
                dashboardCounts?.pending_hod,
                dashboardCounts?.pending_manager,
                dashboardCounts?.pending_finance_manager,
                dashboardCounts?.pending_ceo,
                dashboardCounts?.pending_bod
              ].join(':')} />
          )}
"""

if 'JIMS_STEP_57C4_BOD_SUMMARY' in new:
    # Version 57C4 installed: REPLACE its single BOD-only section and remove
    # the old actual-only queue. Keep delegated approvals fully unchanged.
    start=new.find('          {/* JIMS_STEP_57C4_BOD_SUMMARY')
    end=new.find('          <section className="panel">',start)
    if start<0 or end<0 or end-start>900:
        stop('Unexpected prior 57C4 home layout; no edits')
    new=new[:start]+widget+new[end:]
    old_queue="""          {!canApproveBOD && (
            <ApprovalQueues profile={profile} onOpenVoucher={openVoucher}
              mode="actual" refreshKey={allDelegationRecords.length + allHandoverRecords.length} />
          )}"""
    one(new,old_queue,'57C4 duplicate queue')
    new=new.replace(old_queue,'',1)
    old_import="import BODApprovalSummary from './BODApprovalSummary'\n"
    one(new,old_import,'57C4 import')
    new=new.replace(old_import,'',1)
else:
    # Version 57C4 NOT installed: use the existing legacy approval queue home.
    home="""      {workspaceMode === 'home' && (
        <>
          <section className="panel">"""
    one(new,home,'PV home container')
    new=new.replace(home,"""      {workspaceMode === 'home' && (
        <>
"""+widget+"""          <section className="panel">""",1)
    old_queue='          <ApprovalQueues profile={profile} onOpenVoucher={openVoucher} mode="actual" refreshKey={allDelegationRecords.length + allHandoverRecords.length} />'
    one(new,old_queue,'Legacy actual approval queue')
    new=new.replace(old_queue,'',1)

# Existing actual-only legacy import is now unused. Delegation UI is a separate module.
old_import="import ApprovalQueues from './ApprovalQueues'\n"
one(new,old_import,'ApprovalQueues import')
new=new.replace(old_import,'',1)

if rpc_set(original)!=rpc_set(new):
    stop('Protected existing PV RPC handlers changed!')
for marker in ('async function bodDecide(','async function bodDecideJR(',
  'async function financeManagerDecide(','async function decideCrossDepartment(',
  'async function departmentHODDecide(','<PaymentTrackingPanel',
  '<JRPanel','<PVDelegationHistory'):
    if original.count(marker)!=new.count(marker):
        stop('Protected PV workflow changed: '+marker)
if new.count('JIMS_STEP_57C5_ALL_APPROVERS')!=1:
    stop('Duplicate summary in resulting PV')

jsx=remote(PATCH_DIR+'JIMSApproverSummary.jsx')
css=remote(PATCH_DIR+'JIMSApproverSummary.css')
for s in ('jims_actual_approver_summary_v1','View Details',
  'hod_decide_department_pv_v1','finance_manager_decide_department_pv_v2',
  'ceo_decide_jr_v1','bod_decide_jr_v1','jr_meeting_ready',
  'Cost Center','Subdept','Branch','Return','Reject','Approve'):
    if s not in jsx: stop('Missing protected summary feature: '+s)
if any(x in jsx for x in ('.insert(','.update(','.delete(','.upload(')):
    stop('Unexpected unsafe direct write / upload in summary')
if 'JIMS Step57C5' not in css:
    stop('Missing Step57C5 style marker')

# Verify syntax before touching installed files.
parser=ROOT/'app/node_modules/@babel/parser'
if parser.is_dir():
    with tempfile.TemporaryDirectory(prefix='jims_57c5_check_') as tmp:
        f1,f2=Path(tmp)/'PaymentVoucher.jsx',Path(tmp)/'JIMSApproverSummary.jsx'
        f1.write_text(new);f2.write_text(jsx)
        script="""const fs=require('fs'),p=require('@babel/parser');
        for(const file of process.argv.slice(1))
          p.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']});
        console.log('JIMS STEP57C5 JSX PARSER PASS');
        """
        result=subprocess.run(['node','-e',script,str(f1),str(f2)],
             cwd=ROOT/'app',text=True,capture_output=True)
        if result.returncode:stop('JSX preflight: '+result.stderr[-2000:])
        print(result.stdout.strip())
else:
    print('NOTE: JSX parser absent, npm build validates installation.')

print('JIMS STEP 57C5 — '+('DRY RUN' if DRY else 'INSTALL'))
print('HOD / Finance Manager / CEO / BOD: ONE role-specific Approval Summary Table.')
print('PV, Purpose, Payee, Department, Subdept, Branch, Cost Center, Amount.')
print('View Details optional; Approve, Return, Reject via existing secure RPCs.')
print('Actual authority only. Delegated workspace unchanged.')
if DRY:
    print('DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=ROOT/'app/gui-backups'/('57C5_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'PaymentVoucher.jsx').write_text(original)
try:
    SRC.write_text(new)
    TARGET_JSX.write_text(jsx)
    TARGET_CSS.write_text(css)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP57C5 UNIVERSAL APPROVER SUMMARY — BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    SRC.write_text(original)
    TARGET_JSX.unlink(missing_ok=True)
    TARGET_CSS.unlink(missing_ok=True)
    stop('Build failed; old PV restored: '+str(exc))
