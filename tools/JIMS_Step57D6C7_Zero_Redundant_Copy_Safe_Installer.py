#!/usr/bin/env python3
"""JIMS 57D6C7 — remove explanatory filler shown in actual finance screenshots.

Targets ONLY rendered copy in:
  PaymentVoucher.jsx: PV/Payment History explanatory copy and header metadata
  JIMSPaymentProcessBoard.jsx: amount-card and status-card filler
  JIMSPaymentCalendar57D5.jsx: redundant page/calendar helper copy

All amounts, counts, statuses, headings, actions, buttons, role guards,
date filtering, payment logic, Supabase/RPCs, sidebar and login stay.
Exact literal JSX removal + scoped card spacing CSS only.
Read-only dry-run, structural checks, JSX/CSS preflight, backup+rollback.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess, sys, tempfile, re

ROOT=Path('/workspaces/Jauhar')
APPDIR=ROOT/'app'
SRC=APPDIR/'src'
MAIN=SRC/'main.jsx'
PV=SRC/'PaymentVoucher.jsx'
BOARD=SRC/'JIMSPaymentProcessBoard.jsx'
CAL=SRC/'JIMSPaymentCalendar57D5.jsx'
CSS=SRC/'JIMS57D6C7ZeroRedundantCopy.css'
BRANCH='jsync-gui-revamp-20261029'
REMOTE='gui-patches/57D/JIMS57D6C7ZeroRedundantCopy.css'
IMPORT="import './JIMS57D6C7ZeroRedundantCopy.css'"
FALLBACK="import './JIMS57D6C4MobileDashboardActions.css'"
AFTER_C6="import './JIMS57D6C6PageContentMinimal.css'"
MARKER='JIMS_STEP57D6C7_ZERO_REDUNDANT_COPY'
DRY='--dry-run' in sys.argv

def stop(reason):
    sys.exit('STOP: '+str(reason)+' — no app files modified.')
def git(*argv):
    return subprocess.check_output(['git',*argv],cwd=ROOT,text=True)
if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch; expected '+BRANCH)
for f in (MAIN,PV,BOARD,CAL):
    if not f.is_file():stop('Required installed JIMS GUI file missing: '+str(f))
if CSS.exists():stop('57D6C7 already installed or customized; no overwrite.')
old_main=MAIN.read_text(encoding='utf-8')
if IMPORT in old_main:stop('57D6C7 import already mounted.')
anchor=AFTER_C6 if AFTER_C6 in old_main else FALLBACK
if old_main.count(anchor)!=1:stop('Prior GUI stylesheet import absent or duplicated.')

RULES={
 PV:[
   ('<p>Closed-loop PVs only. Fully Approved but unpaid PVs remain in Payment Process.</p>',''),
   ('<small>Full payment recorded with final bank receipt</small>',''),
   ('<small>Approval ended without payment</small>',''),
   ('<p>Payment executions with final receipt. Not included in active initiation or verification queues.</p>',''),
   ('<small>View payment records and receipt details</small>',''),
 ],
 BOARD:[
   ('<small>{item.hint}</small>',''),
   ('<small>Approved vouchers awaiting initiation or resubmission</small>',''),
   ('<small>Completed Full Payments only</small>',''),
   ('<small>Settled partial installments only</small>',''),
   ('<small>Total outstanding across all approved PVs</small>',''),
   ('<h2>Payment Process Dashboard</h2>',''),
   ('<p className="muted">Pending Payment → Full / Partial workflows → One Payment History</p>',''),
   ('<h3>Full Payment Status</h3>','<h3>Full Payment</h3>'),
   ('<h3>Partial Payment Status</h3>','<h3>Partial Payment</h3>'),
   ("""    {!error&&updated&&<p className="muted jims-pb-updated">
      Last refreshed: {updated.toLocaleTimeString('en-MY')} ·
      Viewing PVs permitted to your account
    </p>}""",
    """    {!error&&updated&&<p className="muted jims-pb-updated">Updated {updated.toLocaleTimeString('en-MY')}</p>}"""),
 ],
 CAL:[
   ('<p>Supplier due dates · All branches</p>',''),
   ('<small>Default: today to month end</small>',''),
   ('<span className="jims-cal-toolbar-note">Month arrows switch the due-date range</span>',''),
   ('<small>Needs payment planning</small>',''),
   ("""          <p className="jims-cal-range-note">
            Showing due dates {fmt(dueRange.from)} – {fmt(dueRange.to)}.
            <strong> Overdue is always included, even outside this date range.</strong>
          </p>""",
    """          <p className="jims-cal-range-note">Overdue included outside selected range.</p>"""),
 ],
}
old={}
updated={}
report={}
for path,rules in RULES.items():
    before=path.read_text(encoding='utf-8')
    after=before
    n=0
    for before_text,after_text in rules:
        count=after.count(before_text)
        if count>1:
            stop(path.name+': ambiguous repeated text '+repr(before_text[:70]))
        if count==1:
            after=after.replace(before_text,after_text,1)
            n+=1
    # Optional PV template/version banner removal: only if unmistakably the
    # first descriptive paragraph directly beneath the finance page heading.
    if path==PV:
        anchors=list(re.finditer(r'<p className="muted">',after))
        candidates=[]
        for match in anchors:
            end=after.find('</p>',match.end())
            if end<0 or end-match.start()>550:continue
            block=after[match.start():end+len('</p>')]
            near=after[max(0,match.start()-260):match.start()]
            if ('Official PV Template' in block and 'Revision' in block
                and ('JAUHAR' in near or 'Payment Voucher' in near or 'Payment Process' in near)):
                candidates.append((match.start(),end+len('</p>')))
        if len(candidates)>1:
            stop('Ambiguous PV template/version banners')
        if candidates:
            a,b=candidates[0]
            after=after[:a]+after[b:]
            n+=1
    # All modifications are literal user-visible copy; no logic or API change.
    protected=(
        '<button','</button>','onClick=', 'onChange=', 'onSubmit=',
        'disabled=', 'aria-label=', 'onOpenVoucher', 'openCategory(',
        '.rpc(', 'supabase.', 'useState(', 'useEffect(',
        'payment_status', 'financialSummary.', 'dashboardCounts?.',
        'countStatus(', 'updateStart(', 'updateEnd(', 'changeMonth(',
    )
    for term in protected:
        if before.count(term)!=after.count(term):
            stop(path.name+': protected action/data token changed: '+term)
    if before!=after:
        old[path]=before
        updated[path]=after
    report[path.name]=n
if report[PV.name]<3 or report[BOARD.name]<6 or report[CAL.name]<3:
    stop('Installed GUI differs too much from audited PV/Board/Calendar copy: '+str(report))

new_main=old_main.replace(anchor,anchor+'\n'+IMPORT,1)
if new_main.replace(anchor+'\n'+IMPORT,anchor,1)!=old_main:
    stop('main.jsx integration not additive')
try:styles=git('show','origin/'+BRANCH+':'+REMOTE)
except subprocess.CalledProcessError:
    stop('Remote 57D6C7 CSS missing; git fetch origin '+BRANCH)
if styles.count(MARKER)!=1:
    stop('Scoped CSS marker missing/duplicated')
for bad in ('.sidebar','.topbar','.login-page','@import','pointer-events:none','visibility:hidden'):
    if bad in styles:stop('CSS unexpectedly touches protected UI: '+bad)
with tempfile.TemporaryDirectory(prefix='jims_57d6c7_preflight_') as td:
    temp=Path(td)
    files=[]
    for file,contents in [*updated.items(),(MAIN,new_main)]:
        target=temp/file.name
        target.write_text(contents,encoding='utf-8')
        files.append(str(target))
    css=temp/CSS.name
    css.write_text(styles,encoding='utf-8')
    js=(
        "const fs=require('node:fs');"
        "Promise.all([import('vite'),import('postcss')]).then(async([v,p])=>{"
        "for(const f of process.argv.slice(1,-1))"
        "await v.transformWithOxc(fs.readFileSync(f,'utf8'),f);"
        "const c=p.default.parse(fs.readFileSync(process.argv.at(-1),'utf8'));"
        "let n=0;c.walkRules(r=>{n++;"
        "if(r.selector.split(',').some(s=>!s.trim().startsWith("
        "'.jims-shell>.content ')))"
        "throw Error('Unscoped rule '+r.selector);"
        "});"
        "if(n<5)throw Error('Incomplete compact stylesheet');"
        "console.log('JIMS 57D6C7 JSX + CSS PARSER PASS');"
        "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    preflight=subprocess.run(['node','-e',js,*files,str(css)],cwd=APPDIR,
                            capture_output=True,text=True)
    if preflight.returncode:
        stop('Preflight failed: '+(preflight.stderr or preflight.stdout)[-1800:])
    print(preflight.stdout.strip())

print('JIMS 57D6C7 FINANCE/CALENDAR COPY-ONLY SAFETY CHECK PASS')
for name,count in report.items():print('  '+name+': '+str(count)+' copy removals/shortenings')
print('Preserved: all counts, amounts, actions, statuses, warnings, filters and permissions.')
if DRY:
    print('JIMS 57D6C7 DRY RUN PASS — application files unchanged.')
    sys.exit(0)
backup=APPDIR/'gui-backups'/('57D6C7_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
for f,content in [*old.items(),(MAIN,old_main)]:
    (backup/f.name).write_text(content,encoding='utf-8')
try:
    for f,content in updated.items():f.write_text(content,encoding='utf-8')
    MAIN.write_text(new_main,encoding='utf-8')
    CSS.write_text(styles,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APPDIR,check=True)
    print('JIMS 57D6C7 BUILD PASS')
    print('Backup:',backup)
except Exception as e:
    for f,content in old.items():f.write_text(content,encoding='utf-8')
    MAIN.write_text(old_main,encoding='utf-8')
    CSS.unlink(missing_ok=True)
    sys.exit('STOP: Build failed; originals restored: '+str(e))
