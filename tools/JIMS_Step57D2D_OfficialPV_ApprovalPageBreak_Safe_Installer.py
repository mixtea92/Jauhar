#!/usr/bin/env python3
"""JIMS Step 57D2D: deterministic new-page approval history heading.
Fixes orphaned heading observed in real PV-2026-000002 PDF after 57D2C.
Guarded single-PDF-component update; --dry-run, backup, build, rollback.
Does not alter approval logic, amounts, backend, Payment Calendar or PV UI.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
COMP=APP/'src/JIMS57D2OfficialPVDownload.jsx'
BRANCH='jsync-gui-revamp-20261029'
PREFIX='gui-patches/57D/'
BEFORE='57D2C_Baseline_before_FixedApprovalPageBreak.jsx'
AFTER='JIMS57D2OfficialPVDownload.jsx'
MARKER='JIMS_STEP57D2D_FIXED_APPROVAL_PAGEBREAK'
DRY='--dry-run' in sys.argv

def stop(msg):
  sys.exit('STOP: '+msg+' — project files were not modified.')
def git(*args):
  return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(filename):
  return git('show','origin/'+BRANCH+':'+PREFIX+filename)

if git('branch','--show-current').strip()!=BRANCH:stop('Wrong Codespaces branch')
if not COMP.is_file():stop('Original 57D2 Official PV PDF renderer missing')
old=COMP.read_text(encoding='utf-8')
original=remote(BEFORE)
fixed=remote(AFTER)
if old==fixed:
  print('JIMS 57D2D ALREADY INSTALLED — PDF component clean, no changes.')
  sys.exit(0)
if old!=original:
  stop('Local PDF renderer differs from 57D2C baseline — refusing overwrite')
if MARKER in original or fixed.count(MARKER)!=1:
  stop('Pagination version markers mismatch')
if fixed.count("pageBreak:'before'")!=1 or "pageBreakBefore:" in fixed:
  stop('Explicit page break missing or legacy orphan callback remains')
if fixed.count("section('ACTUAL APPROVAL HISTORY — ALL ROUNDS')")!=1:
  stop('Approval section missing or repeated')
if fixed.count("pageBreak:'before',margin:[0,0,0,7]")!=1:
  stop('Approval title page-break attachment missing')
if fixed.count("ACTUAL APPROVAL HISTORY — ALL ROUNDS")!=original.count("ACTUAL APPROVAL HISTORY — ALL ROUNDS"):
  stop('Approval history sections altered')
for term in (
 "jims_57d2_official_pv_snapshot_v1",
 "pdfMake.createPdf(definition).download",
 "ACTUAL PAYMENT HISTORY",
 "PAYMENT ACTIVITY TIMELINE",
 "Math.abs(approved-paid-remaining)>0.011",
 "Not Yet Initiated","Not Yet Reviewed",
 "voucher.status!=='fully_approved'",
 "pdfMake.addVirtualFileSystem(vfs)"
):
  if term not in fixed or fixed.count(term)!=original.count(term):
    stop('Protected 57D2 function altered: '+term)
if fixed.count('supabase.rpc(')!=original.count('supabase.rpc('):
  stop('Backend read logic changed')
for prohibited in ('.insert(','.update(','.upsert(','.delete(','.upload('):
  if prohibited in fixed:stop('PDF cannot perform database writes')
with tempfile.TemporaryDirectory(prefix='jims_57d2d_jsx_') as td:
  preflight=Path(td)/'JIMS57D2OfficialPVDownload.jsx'
  preflight.write_text(fixed,encoding='utf-8')
  script=(
   "const fs=require('node:fs');"
   "import('vite').then(async({transformWithOxc})=>{"
   "await transformWithOxc(fs.readFileSync(process.argv[1],'utf8'),process.argv[1]);"
   "console.log('JIMS 57D2D JSX PARSER PASS');"
   "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
  )
  result=subprocess.run(['node','-e',script,str(preflight)],cwd=APP,
    capture_output=True,text=True)
  if result.returncode:
    stop('JSX parser failed: '+(result.stderr or result.stdout)[-1700:])
  print(result.stdout.strip())
print('JIMS 57D2D APPROVAL PAGE BREAK SAFE CHECK PASS')
print('PDF heading explicitly starts with approval table on a fresh page.')
print('No PV, Calendar, Payment Process, Supabase or finance logic changes.')
if DRY:
  print('JIMS 57D2D DRY RUN PASS — no files changed.')
  sys.exit(0)
backup=APP/'gui-backups'/('57D2D_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/COMP.name).write_text(old,encoding='utf-8')
try:
  COMP.write_text(fixed,encoding='utf-8')
  subprocess.run(['npm','run','build'],cwd=APP,check=True)
  print('JIMS 57D2D BUILD PASS')
  print('Backup:',backup)
except Exception as exc:
  COMP.write_text(old,encoding='utf-8')
  sys.exit('STOP: Build failed; original PDF renderer restored: '+str(exc))
