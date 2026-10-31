#!/usr/bin/env python3
"""JIMS Step 57D5 FINAL — Remove temporary DEV Overdue UAT Preview safely.
Only touches installed standalone Payment Calendar JSX/CSS, never PV/Process.
Keeps date range, genuine overdue, partial outstanding and Payment Planning.
Dry-run has zero project-file writes. Backup + build + rollback on apply.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess, sys, tempfile

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
JSX=APP/'src/JIMSPaymentCalendar57D5.jsx'
CSS=APP/'src/JIMSPaymentCalendar57D5.css'
BRANCH='jsync-gui-revamp-20261029'
PREFIX='gui-patches/57D/'
PREVIEW='JIMS_STEP57D55_UAT_PREVIEW'
RANGE='JIMS_STEP57D5B_DATE_RANGE'
DRY='--dry-run' in sys.argv

def stop(message):
    sys.exit('STOP: '+message+' — local files not changed.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(path):
    return git('show','origin/'+BRANCH+':'+PREFIX+path)
def verify(text,test,label):
    if not test: stop(label)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong Codespaces branch; expected '+BRANCH)
if not JSX.is_file() or not CSS.is_file():
    stop('Standalone Payment Calendar not installed')
old_jsx=JSX.read_text(encoding='utf-8')
old_css=CSS.read_text(encoding='utf-8')
clean_jsx=remote('JIMSPaymentCalendar57D5.jsx')
clean_css=remote('JIMSPaymentCalendar57D5.css')
preview_jsx=remote('57D55_UAT_Preview_Installed_Baseline.jsx')
preview_css=remote('57D55_UAT_Preview_Installed_Baseline.css')

if old_jsx==clean_jsx and old_css==clean_css:
    print('JIMS 57D5 UAT PREVIEW ALREADY REMOVED — no changes needed.')
    sys.exit(0)
if old_jsx!=preview_jsx or old_css!=preview_css:
    stop('Local Calendar has other modifications; refusing to overwrite any customization. Review diff first.')
if PREVIEW not in old_jsx or PREVIEW not in old_css:
    stop('Installed UAT marker missing')
if PREVIEW in clean_jsx or PREVIEW in clean_css:
    stop('GitHub cleanup assets still contain preview code')
if RANGE not in clean_jsx or RANGE not in clean_css:
    stop('Date Range Filter not preserved')

must_keep=(
    "supabase.rpc('jims_57d5_payment_calendar_v1')",
    "const overdue=useMemo(()=>visible.filter(r=>r.calendar_status==='overdue')",
    "const missing=useMemo(",
    "setDueRange(r=>r.custom?r:{from:today,to:monthEnd(today),custom:false})",
    "Overdue Payments · All Dates",
    "jims-cal-range-from","jims-cal-range-to",
    "setSelectedPV(record)","<JIMSPaymentPlanning57D3",
    "onClose={closePlanning}",
    "const withinMonth=visible.filter(",
    "const inSelectedRange=date=>rangeValid"
)
for needle in must_keep:
    if needle not in clean_jsx or needle not in old_jsx:
        stop('Protected finance/calendar feature missing: '+needle)
    if clean_jsx.count(needle)!=old_jsx.count(needle):
        stop('Protected finance/calendar feature count changed: '+needle)
if '.jims-cal-range' not in clean_css or '.jims-cal-day:disabled' not in clean_css:
    stop('Date range styling missing')
if 'UAT-DEMO-' in clean_jsx or 'Enable Overdue UAT Preview' in clean_jsx:
    stop('DEMO fixture or toggle remains in cleaned Calendar')
if clean_jsx.count('supabase.rpc(')!=old_jsx.count('supabase.rpc('):
    stop('Backend access code changed unexpectedly')
if any(a in clean_jsx for a in ('.insert(','.update(','.delete(','.upsert(','.upload(')):
    stop('Read-only Calendar is unexpectedly attempting financial mutations')

# Syntax verify the exact cleaned JSX before touching the user's project.
with tempfile.TemporaryDirectory(prefix='jims_57d5_clean_') as td:
    candidate=Path(td)/'JIMSPaymentCalendar57D5.jsx'
    candidate.write_text(clean_jsx,encoding='utf-8')
    checker=(
      "const fs=require('node:fs');"
      "import('vite').then(async({transformWithOxc})=>{"
      "await transformWithOxc(fs.readFileSync(process.argv[1],'utf8'),process.argv[1]);"
      "console.log('JIMS 57D5 CLEANUP JSX PARSER PASS');"
      "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    result=subprocess.run(['node','-e',checker,str(candidate)],cwd=APP,
      capture_output=True,text=True)
    if result.returncode!=0:
        stop('JSX preflight failed: '+(result.stderr or result.stdout)[-1400:])
    print(result.stdout.strip())

print('JIMS 57D5 CLEANUP SAFE ANCHORS PASS')
print('Removed: DEV UAT preview button, synthetic full/partial overdue DEMO rows and banner.')
print('Preserved: Date Range, real overdue, partial outstanding, Payment Planning.')
print('Payment Voucher, Payment Process, Petty Cash and Supabase untouched.')
if DRY:
    print('JIMS 57D5 CLEANUP DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D5_CLEANUP_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/JSX.name).write_text(old_jsx,encoding='utf-8')
(backup/CSS.name).write_text(old_css,encoding='utf-8')
try:
    JSX.write_text(clean_jsx,encoding='utf-8')
    CSS.write_text(clean_css,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D5 CLEANUP BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    JSX.write_text(old_jsx,encoding='utf-8')
    CSS.write_text(old_css,encoding='utf-8')
    sys.exit('STOP: Build failed; original Calendar restored: '+str(exc))
