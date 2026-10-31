#!/usr/bin/env python3
"""JIMS Step 57D2C — Official PV PDF pagination and clarity safe installer.
Targets ONLY PDF renderer, with exact baseline guard, preflight, backup, build, rollback.
DOES NOT modify Payment Voucher, Payment Calendar, database, approval or payment flows.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
COMP=APP/'src/JIMS57D2OfficialPVDownload.jsx'
BRANCH='jsync-gui-revamp-20261029'
PREFIX='gui-patches/57D/'
OLD='57D2B_Baseline_before_PaginationFix.jsx'
CURRENT='JIMS57D2OfficialPVDownload.jsx'
MARKER='JIMS_STEP57D2C_KEEP_HEADING_WITH_CONTENT'
DRY='--dry-run' in sys.argv

def stop(reason):
  sys.exit('STOP: '+reason+' — PDF renderer left unchanged.')
def git(*args):
  return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(name):
  return git('show','origin/'+BRANCH+':'+PREFIX+name)

if git('branch','--show-current').strip()!=BRANCH:
  stop('Wrong Codespaces branch')
if not COMP.is_file():stop('57D2B PDF renderer is not installed')
local=COMP.read_text(encoding='utf-8')
old=remote(OLD)
new=remote(CURRENT)

if local==new:
  print('JIMS 57D2C ALREADY INSTALLED — no changes needed.')
  sys.exit(0)
if local!=old:
  stop('Local renderer has unexpected changes; refusing to overwrite customization')
if MARKER in local or MARKER not in new:
  stop('57D2C version markers inconsistent')
for term in (
  "jims_57d2_official_pv_snapshot_v1",
  "pdfMake.createPdf(definition).download",
  "ACTUAL APPROVAL HISTORY",
  "ACTUAL PAYMENT HISTORY",
  "PAYMENT ACTIVITY TIMELINE",
  "Math.abs(approved-paid-remaining)>0.011",
  "voucher.status!=='fully_approved'",
):
  if term not in local or term not in new:
    stop('Missing protected PDF feature: '+term)
  if local.count(term)!=new.count(term):
    stop('Protected PDF feature changed: '+term)
if new.count('pageBreakBefore:')!=1 or new.count('headlineLevel:1')!=1:
  stop('PDF pagination fix missing or duplicated')
if "Not Yet Reviewed" not in new or "Not Yet Initiated" not in new:
  stop('Pending payment labels not updated')
if old.count('supabase.rpc(')!=new.count('supabase.rpc('):
  stop('Unexpected new backend call')
if any(token in new for token in ('.update(','.insert(','.upsert(','.delete(','.upload(')):
  stop('Official PDF renderer must not mutate data')

with tempfile.TemporaryDirectory(prefix='jims_57d2c_preflight_') as td:
  candidate=Path(td)/'JIMS57D2OfficialPVDownload.jsx'
  candidate.write_text(new,encoding='utf-8')
  checker=(
    "const fs=require('node:fs');"
    "import('vite').then(async({transformWithOxc})=>{"
    "await transformWithOxc(fs.readFileSync(process.argv[1],'utf8'),process.argv[1]);"
    "console.log('JIMS 57D2C JSX PARSER PASS');"
    "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
  )
  result=subprocess.run(['node','-e',checker,str(candidate)],cwd=APP,
      capture_output=True,text=True)
  if result.returncode!=0:
    stop('JSX syntax failed: '+(result.stderr or result.stdout)[-1700:])
  print(result.stdout.strip())

print('JIMS 57D2C SAFE UPGRADE CHECK PASS')
print('Orphan approval heading fixed; CEO/BOD and pending review labels refined.')
print('PV workflow, Supabase records, financial logic and Calendar untouched.')
if DRY:
  print('JIMS 57D2C DRY RUN PASS — no files changed.')
  sys.exit(0)

backup=APP/'gui-backups'/('57D2C_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/COMP.name).write_text(local,encoding='utf-8')
try:
  COMP.write_text(new,encoding='utf-8')
  subprocess.run(['npm','run','build'],cwd=APP,check=True)
  print('JIMS 57D2C BUILD PASS')
  print('Backup:',backup)
except Exception as e:
  COMP.write_text(local,encoding='utf-8')
  sys.exit('STOP: Build failed; original PDF renderer restored: '+str(e))
