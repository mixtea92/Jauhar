#!/usr/bin/env python3
"""JIMS 57D5B — safe Date Range filter upgrade for standalone Payment Calendar.
Changes ONLY app/src/JIMSPaymentCalendar57D5.jsx and .css.
Default: Malaysia current date -> end of current month.
Overdue: always visible outside date range; based on supplier contractual due.
Strict baseline compare prevents overwriting custom local changes. Dry-run never writes.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
SRC=APP/'src/JIMSPaymentCalendar57D5.jsx'
CSS=APP/'src/JIMSPaymentCalendar57D5.css'
BRANCH='jsync-gui-revamp-20261029'
DRY='--dry-run' in sys.argv
PREFIX='gui-patches/57D/'
MARKER='JIMS_STEP57D5B_DATE_RANGE'

def stop(message):
    sys.exit('STOP: '+str(message)+' — existing JIMS files unchanged.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(path):
    return git('show','origin/'+BRANCH+':'+PREFIX+path)
def verify_count(old,new,needle,label):
    if old.count(needle)!=new.count(needle):
        stop('Protected '+label+' changed unexpectedly: '+needle)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch: expected '+BRANCH)
if not SRC.is_file() or not CSS.is_file():
    stop('57D5 standalone Calendar not installed. Need Step57D5 first.')

old_src=SRC.read_text(encoding='utf-8')
old_css=CSS.read_text(encoding='utf-8')
if MARKER in old_src or MARKER in old_css:
    stop('57D5B Date Range already installed.')
baseline_src=remote('57D5_Baseline_before_DateRange.jsx')
baseline_css=remote('57D5_Baseline_before_DateRange.css')
new_src=remote('JIMSPaymentCalendar57D5.jsx')
new_css=remote('JIMSPaymentCalendar57D5.css')
if old_src!=baseline_src or old_css!=baseline_css:
    stop('Calendar has local changes; refusing to overwrite. Preserve customization and review diff first.')

for marker in (
 'JIMS_STEP57D5B_DATE_RANGE',
 "const [dueRange,setDueRange]=useState({from:'',to:'',custom:false})",
 "setDueRange(r=>r.custom?r:{from:today,to:monthEnd(today),custom:false})",
 "const inSelectedRange=date=>rangeValid",
 "const overdue=useMemo(()=>visible.filter(r=>r.calendar_status==='overdue')",
 'Overdue is always included, even outside this date range.',
 '<JIMSPaymentPlanning57D3',
 'disabled={outside}',
 "supabase.rpc('jims_57d5_payment_calendar_v1')",
):
    if marker not in new_src:stop('Updated Date Range component missing '+marker)
if new_css.count(MARKER)!=1:stop('CSS filter styling marker missing/duplicated')
if any(forbidden in new_src for forbidden in ('.insert(','.update(','.delete(','.upsert(','.upload(')):
    stop('Calendar modification must not write directly to financial data')

for token in (
 'jims_57d5_payment_calendar_v1',
 '<JIMSPaymentPlanning57D3',
 'onClose={closePlanning}',
 'className="jims-cal-expand"',
 "setShowOverdue(e.currentTarget.open)",
 "const overdue=useMemo",
 "const missing=useMemo",
 "const branches=useMemo",
 "setSelectedPV(record)",
 "const recordCard=(r)",
 "const monthGrid",
):
    verify_count(old_src,new_src,token,'Calendar logic')
if len([line for line in old_src.splitlines() if 'supabase.rpc(' in line])!=len(
    [line for line in new_src.splitlines() if 'supabase.rpc(' in line]):
    stop('Unexpected change to Supabase RPC invocation count')
if new_src.count(MARKER)!=1:stop('Date Range marker duplicated')

# Parse JSX in-memory before any real project write; use already-installed Vite Oxc.
with tempfile.TemporaryDirectory(prefix='jims_57d5b_preflight_') as td:
    temp=Path(td)/'JIMSPaymentCalendar57D5.jsx'
    temp.write_text(new_src,encoding='utf-8')
    checker=(
      "const fs=require('node:fs');"
      "import('vite').then(async({transformWithOxc})=>{"
      "await transformWithOxc(fs.readFileSync(process.argv[1],'utf8'),process.argv[1]);"
      "console.log('JIMS 57D5B JSX PARSER PASS');"
      "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    verify=subprocess.run(['node','-e',checker,str(temp)],cwd=APP,capture_output=True,text=True)
    if verify.returncode!=0:
        stop('JSX syntax preflight failed: '+(verify.stderr or verify.stdout)[-1400:])
    print(verify.stdout.strip())

print('JIMS 57D5B SAFE DATE RANGE ANCHORS PASS')
print('Default filter: Kuala Lumpur today -> last day of current month.')
print('Overdue: ALL outstanding contractual due dates, even outside selected range.')
print('Only standalone Payment Calendar JSX/CSS changed; PV/Process/PC untouched.')
if DRY:
    print('JIMS 57D5B DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D5B_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'JIMSPaymentCalendar57D5.jsx').write_text(old_src,encoding='utf-8')
(backup/'JIMSPaymentCalendar57D5.css').write_text(old_css,encoding='utf-8')
try:
    SRC.write_text(new_src,encoding='utf-8')
    CSS.write_text(new_css,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D5B BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    SRC.write_text(old_src,encoding='utf-8')
    CSS.write_text(old_css,encoding='utf-8')
    sys.exit('STOP: build failed, original Calendar JSX/CSS restored: '+str(exc))
