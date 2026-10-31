#!/usr/bin/env python3
"""JIMS Step 57D5.5 — additive DEV-only Overdue + Partial UAT Preview installer.
Tests calendar overdue outside date ranges WITHOUT creating/updating real PV data.
Only two files changed: Payment Calendar JSX and CSS.
Strict baseline comparison, JSX parser, dry-run, backup, build and restore on failure.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
JSX=APP/'src/JIMSPaymentCalendar57D5.jsx'
CSS=APP/'src/JIMSPaymentCalendar57D5.css'
BRANCH='jsync-gui-revamp-20261029'
REMOTE='gui-patches/57D/'
MARKER='JIMS_STEP57D55_UAT_PREVIEW'
DRY='--dry-run' in sys.argv

def stop(message):
    sys.exit('STOP: '+str(message)+' — no local JIMS files modified.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(filename):
    return git('show','origin/'+BRANCH+':'+REMOTE+filename)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Incorrect Codespaces branch; expected '+BRANCH)
if not JSX.is_file() or not CSS.is_file():
    stop('Existing Step57D5B Calendar JSX/CSS not found')
original_jsx=JSX.read_text(encoding='utf-8')
original_css=CSS.read_text(encoding='utf-8')
if MARKER in original_jsx or MARKER in original_css:
    stop('Step57D5.5 DEV UAT Preview already installed')
baseline_jsx=remote('57D5B_Baseline_before_OverdueUAT.jsx')
baseline_css=remote('57D5B_Baseline_before_OverdueUAT.css')
if original_jsx!=baseline_jsx or original_css!=baseline_css:
    stop('Local Payment Calendar changed since 57D5B; refusing to overwrite customization. Compare first.')
updated_jsx=remote('JIMSPaymentCalendar57D5.jsx')
updated_css=remote('JIMSPaymentCalendar57D5.css')

for marker in (
    MARKER,'DEV_UAT=import.meta.env.DEV','UAT-DEMO-FULL','UAT-DEMO-PARTIAL',
    'if(!DEV_UAT||!uatPreview||!feed?.today)return original',
    'amount:500,paid_amount:200,outstanding_amount:300',
    'Overdue Payments · All Dates',
    'const overdue=useMemo(()=>visible.filter(r=>r.calendar_status===',
    'r.isUatPreview?',
    'Preview only · no real PV',
    'disabled={outside}',
    "supabase.rpc('jims_57d5_payment_calendar_v1')",
    '<JIMSPaymentPlanning57D3',
    'aria-pressed={uatPreview}',
):
    if marker not in updated_jsx:stop('UAT component missing protected feature '+marker)
if updated_css.count(MARKER)!=1:
    stop('UAT CSS marker missing/duplicated')
for protected in (
 'jims_57d5_payment_calendar_v1',
 'JIMSPaymentPlanning57D3',
 'const overdue=useMemo',
 'const missing=useMemo',
 'const branches=useMemo',
 'setShowOverdue(e.currentTarget.open)',
 'jims-cal-range-from','jims-cal-range-to',
 'className="jims-cal-expand"',
 'onClose={closePlanning}',
):
    if updated_jsx.count(protected)!=original_jsx.count(protected):
        stop('Existing Calendar behavior changed unexpectedly: '+protected)
if updated_jsx.count(MARKER)!=1:stop('UAT code marker duplicated')
for forbidden in ('.insert(','.update(','.upsert(','.delete(','.upload('):
    if forbidden in updated_jsx:stop('UAT preview must not mutate backend financial data')
if updated_jsx.count('supabase.rpc(')!=original_jsx.count('supabase.rpc('):
    stop('UAT preview must not add any backend RPCs')

# Validate JSX in the exact same Vite 8 parser prior to file writes.
with tempfile.TemporaryDirectory(prefix='jims_57d55_preflight_') as td:
    temp=Path(td)/'JIMSPaymentCalendar57D5.jsx'
    temp.write_text(updated_jsx,encoding='utf-8')
    checker=(
      "const fs=require('node:fs');"
      "import('vite').then(async({transformWithOxc})=>{"
      "await transformWithOxc(fs.readFileSync(process.argv[1],'utf8'),process.argv[1]);"
      "console.log('JIMS 57D5.5 JSX PARSER PASS');"
      "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    res=subprocess.run(['node','-e',checker,str(temp)],cwd=APP,capture_output=True,text=True)
    if res.returncode!=0:stop('JSX syntax preflight failed: '+(res.stderr or res.stdout)[-1600:])
    print(res.stdout.strip())

print('JIMS 57D5.5 DEV OVERDUE UAT SAFE ANCHORS PASS')
print('Preview rows: Full RM250 overdue + Partial RM300 outstanding overdue.')
print('Preview only in Vite dev; never inserts/updates Supabase financial records.')
print('Payment Voucher, Payment Process, Approvals, Auth, Petty Cash untouched.')
if DRY:
    print('JIMS 57D5.5 DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D55_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/JSX.name).write_text(original_jsx,encoding='utf-8')
(backup/CSS.name).write_text(original_css,encoding='utf-8')
try:
    JSX.write_text(updated_jsx,encoding='utf-8')
    CSS.write_text(updated_css,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D5.5 BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    JSX.write_text(original_jsx,encoding='utf-8')
    CSS.write_text(original_css,encoding='utf-8')
    sys.exit('STOP: build failed; Calendar JSX/CSS restored: '+str(exc))
