#!/usr/bin/env python3
"""JIMS Step57C4 — BOD-only Approval Summary, View Details optional.
Does not change approval RPCs, PV data model, invoice forms or other roles.
Requires database migration Step57C4 BOD summary RPC (already installed).
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess, tempfile, sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
DRY='--dry-run' in sys.argv
PV=ROOT/'app/src/PaymentVoucher.jsx'
TARGET_JSX=ROOT/'app/src/BODApprovalSummary.jsx'
TARGET_CSS=ROOT/'app/src/BODApprovalSummary.css'
PATCH='gui-patches/57C/'

def fail(msg): sys.exit('STOP: '+str(msg))
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(path):
    try: return git('show','origin/'+BRANCH+':'+path)
    except Exception as exc: fail('Cannot read remote patch '+path+': '+str(exc))
def exactly_once(src,needle,label):
    if src.count(needle)!=1:
        fail(label+' needs one exact anchor, found '+str(src.count(needle))+' — nothing changed')
def rpc_calls(src):
    return sorted(line.strip() for line in src.splitlines() if "supabase.rpc(" in line)

if git('branch','--show-current').strip()!=BRANCH:
    fail('Switch Codespaces branch to '+BRANCH)
if not PV.is_file(): fail('PaymentVoucher.jsx not found')
for f in (TARGET_JSX,TARGET_CSS):
    if f.exists(): fail('BOD summary file already exists. Nothing overwritten: '+str(f))

original=PV.read_text()
if "JIMS_STEP_57C4_BOD_SUMMARY" in original:
    fail('Step57C4 already installed')
if 'parseRevisionOneWorkbook' not in original:
    fail('Expected Step53T-C Rev1 frontend is missing. No changes.')
if '<PaymentTrackingPanel' not in original or '<JRPanel' not in original:
    fail('Protected payment/JR panels missing. No changes.')

anchor_import="import ApprovalQueues from './ApprovalQueues'"
anchor_widget='          <ApprovalQueues profile={profile} onOpenVoucher={openVoucher} mode="actual" refreshKey={allDelegationRecords.length + allHandoverRecords.length} />'
exactly_once(original,anchor_import,'Approved import')
exactly_once(original,anchor_widget,'Actual authority queue')

patched=original.replace(anchor_import,
    anchor_import+"\nimport BODApprovalSummary from './BODApprovalSummary'",1)
patched=patched.replace(anchor_widget,
    """          {/* JIMS_STEP_57C4_BOD_SUMMARY — actual BOD only. Other roles unchanged. */}
          {canApproveBOD ? (
            <BODApprovalSummary profile={profile} onOpenVoucher={openVoucher}
              onDecisionRecorded={refreshPVData} />
          ) : (
            <ApprovalQueues profile={profile} onOpenVoucher={openVoucher}
              mode="actual" refreshKey={allDelegationRecords.length + allHandoverRecords.length} />
          )}""",1)

if rpc_calls(original)!=rpc_calls(patched):
    fail('Existing protected approval RPC call list changed unexpectedly.')
for marker in ('async function bodDecide(','async function bodDecideT08(',
               'async function bodDecideJR(','async function decideCrossDepartment(',
               '<PaymentTrackingPanel','<JRPanel','PVDelegationHistory'):
    if original.count(marker)!=patched.count(marker):
        fail('Existing workflow altered: '+marker)

bod_jsx=remote(PATCH+'BODApprovalSummary.jsx')
bod_css=remote(PATCH+'BODApprovalSummary.css')
for token in ('jims_bod_approval_summary_v1','bod_decide_jr_v1',
              'bod_decide_t08_v1','bod_decide_department_pv_v2',
              'View Details','Approve','Return','Reject',
              'Cost Center','Subdept','Branch'):
    if token not in bod_jsx: fail('Missing summary token: '+token)
if 'JIMS Step 57C4' not in bod_css: fail('Missing Step57C4 styles')
if '.upload(' in bod_jsx or '.insert(' in bod_jsx or '.update(' in bod_jsx:
    fail('BOD UI unexpectedly writes outside existing decision RPCs.')

parser=ROOT/'app/node_modules/@babel/parser'
if parser.is_dir():
    with tempfile.TemporaryDirectory(prefix='jims_57c4_preview_') as tmp:
        file1=Path(tmp)/'PaymentVoucher.jsx'
        file2=Path(tmp)/'BODApprovalSummary.jsx'
        file1.write_text(patched);file2.write_text(bod_jsx)
        node="""const fs=require('fs'),p=require('@babel/parser');
        for(const file of process.argv.slice(1)){
          p.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']});
        }
        console.log('BOD SUMMARY JSX PARSER PASS');
        """
        test=subprocess.run(['node','-e',node,str(file1),str(file2)],
            cwd=ROOT/'app',capture_output=True,text=True)
        if test.returncode:fail('JSX syntax check: '+test.stderr[-2500:])
        print(test.stdout.strip())
else: print('NOTE: @babel/parser unavailable; Vite build performs syntax check.')

print('JIMS STEP 57C4 — '+('DRY RUN' if DRY else 'INSTALL'))
print('Actual BOD only: PV / Purpose / Payee / Branch / Department / Subdept / Cost Center / RM.')
print('Quick Approve, Return, Reject; View Details opens existing full PV and JR controls.')
print('Other roles, delegated queue, existing BOD detail approval RPCs unchanged.')
if DRY:
    print('DRY RUN PASS — no files touched.')
    sys.exit(0)

backup=ROOT/'app/gui-backups'/('57C4_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/PV.name).write_text(original)
try:
    PV.write_text(patched)
    TARGET_JSX.write_text(bod_jsx)
    TARGET_CSS.write_text(bod_css)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP57C4 BOD APPROVAL SUMMARY — BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    PV.write_text(original)
    TARGET_JSX.unlink(missing_ok=True)
    TARGET_CSS.unlink(missing_ok=True)
    fail('Build failure — original PaymentVoucher restored: '+str(exc))
