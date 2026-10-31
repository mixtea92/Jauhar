#!/usr/bin/env python3
"""JIMS 57D6C8 REVISED — go-live minimal copy, RESTORE ACTION CLARITY.

Rule: do NOT remove button/card explanations (Draft, Submitted, Add User etc.).
Keep ALL warnings, mandatory input rules, payment/approval distinctions,
security explanations and statuses. Remove only shortlisted redundant
marketing/developer prose. Restore hints lost in prior 57D6C5/C6/C7 patches.
Scan all installed JSX pages for remaining long copy and launch risks.
Pure GUI copy + new scoped CSS; no handlers, routes, Supabase or business rules.
Supports --dry-run and --audit-only; full backup, parser and build rollback.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys
import tempfile
import re
import json

ROOT=Path('/workspaces/Jauhar')
SRC=ROOT/'app/src'
APP=ROOT/'app'
MAIN=SRC/'main.jsx'
BRANCH='jsync-gui-revamp-20261029'
CSS=SRC/'JIMS57D6C8ContextRestored.css'
REMOTE='gui-patches/57D/JIMS57D6C8ContextRestored.css'
CSS_IMPORT="import './JIMS57D6C8ContextRestored.css'"
CSS_MARKER='JIMS_STEP57D6C8_CONTEXT_RESTORED'
DRY='--dry-run' in sys.argv
AUDIT_ONLY='--audit-only' in sys.argv

def stop(reason):
    sys.exit('STOP: '+str(reason)+' — app source unchanged.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch; expected '+BRANCH)
if not MAIN.exists() or not (SRC/'App.jsx').exists():
    stop('Missing JIMS app')
if CSS.exists() or CSS_IMPORT in MAIN.read_text(encoding='utf-8'):
    stop('57D6C8 may already be installed; do not overwrite')
original_main=MAIN.read_text(encoding='utf-8')
anchors=[
    "import './JIMS57D6C7ZeroRedundantCopy.css'",
    "import './JIMS57D6C6PageContentMinimal.css'",
    "import './JIMS57D6C5MinimalButtonCopy.css'",
    "import './JIMS57D6C4MobileDashboardActions.css'",
]
found=[x for x in anchors if x in original_main]
if not found:stop('Earlier mobile GUI stylesheet import missing')
anchor=found[0]
if original_main.count(anchor)!=1:stop('Ambiguous existing GUI stylesheet import')

# STRICT whitelist of text that adds no operational decision-making information.
# No action-card hint, no field instruction, no warning, no approval/payment rule.
CUT={
 'PaymentVoucher.jsx':[
   '<p className="muted">Counters reflect vouchers visible to your login. Select a card to open its filtered list.</p>',
 ],
 'JIMSPaymentProcessBoard.jsx':[
   '<p className="muted">Pending Payment → Full / Partial workflows → One Payment History</p>',
 ],
 'JIMSPaymentCalendar57D5.jsx':[
   '<span className="jims-cal-toolbar-note">Month arrows switch the due-date range</span>',
   '<p>Supplier due dates · All branches</p>',
 ],
 'DelegationHub.jsx':[
   '<p className="muted">Separate from Payment Voucher · independent authorization · full audit trail</p>',
 ],
 'CashVoucher.jsx':[
   '<p>Original workbook, unchanged: PC (Digital), PC (Manual), List Expenses Category; A4 portrait one-page print areas.</p>',
 ],
 'JIMS_Report_Generation_Single_Center.jsx':[
   '<p className="muted">Select reports and supporting documents to download. Original files remain private.</p>',
 ],
}
# Shorten only non-alert non-action display text while retaining the key rule.
SHORTEN={
 'CashVoucher.jsx':[
   ('<h2 style={{marginBottom:5}}>Cash Voucher (Petty Cash)</h2>',
    '<h2 style={{marginBottom:5}}>Petty Cash</h2>'),
   ('<h2 style={{marginBottom:5}}>Petty Cash (Petty Cash)</h2>',
    '<h2 style={{marginBottom:5}}>Petty Cash</h2>'),
   ('<p style={{marginTop:0}}>Post-disbursement recording, dual HOD approval with digital signatures, then CLOSED.</p>',
    '<p style={{marginTop:0}}>Post-disbursement record · HOD + Finance HOD approval.</p>'),
   ('<p>Each selected CV receives a separate approval record and digital signature. Both stages must be signed before CLOSED.</p>',
    '<p>HOD + Finance HOD signatures required.</p>'),
 ],
}

source_files=sorted(p for p in SRC.rglob('*.jsx')
    if 'node_modules' not in p.parts and
    'login' not in p.parts and p.name not in ('App.jsx','main.jsx','JSYNCLogin.jsx'))
before_files={}
after_files={}
log=[]

def literal_once_or_skip(body,old,new,filename):
    count=body.count(old)
    if count>1:stop(filename+' ambiguous copy anchor: '+repr(old[:70]))
    if count==1:return body.replace(old,new,1),1
    return body,0

def restore_dashboard_home(body):
    n=0
    # 57D6C5 removed the helpful subtitle beneath clickable action cards.
    subtitle='    <span className="jims-action-desc">{subtitle}</span>\n'
    title='    <strong className="jims-action-title">{title}</strong>\n'
    if subtitle not in body and title in body:
        body,k=literal_once_or_skip(body,title,title+subtitle,'JIMSDashboardHome.jsx')
        n+=k
    # 57D6C5 also removed the context beneath Financial Workspace shortcuts.
    missing='<span className="jims-link-copy"><strong>{title}</strong></span>'
    full='<span className="jims-link-copy"><strong>{title}</strong><small>{desc}</small></span>'
    body,k=literal_once_or_skip(body,missing,full,'JIMSDashboardHome.jsx')
    n+=k
    return body,n

def restore_pv_home(body):
    # Only matches button cards where the description is already absent.
    pattern=r'(<span>\{card\.label\} ↗</span>)(\s*)(</button>)'
    matches=list(re.finditer(pattern,body))
    if len(matches)>2:stop('PaymentVoucher.jsx: unexpected card loop count')
    def insert(m):
        return m.group(1)+'\n                  <small>{card.hint}</small>'+m.group(2)+m.group(3)
    body,n=re.subn(pattern,insert,body)
    return body,n

def restore_process_cards(body):
    # Keep the short explanation of each payable status category.
    pattern=r'(<span className="jims-pb-card-name">\{item.title\}</span>)(\s*)(</button>)'
    matches=list(re.finditer(pattern,body))
    if len(matches)>1:stop('PaymentProcessBoard: unexpected card markup')
    return re.subn(pattern,
        lambda m:m.group(1)+'\n      <small>{item.hint}</small>'+m.group(2)+m.group(3),body)

def restore_delegation_cards(body):
    pattern=r'(<span style=\{\{fontWeight:700,display:\x27block\x27,margin:\x276px 0\x27\}\}>\{m.label\} ↗</span>)(\s*)(</button>)'
    matches=list(re.finditer(pattern,body))
    if len(matches)>1:stop('DelegationWorkspace: unexpected button markup')
    return re.subn(pattern,lambda m:m.group(1)+'\n          <span className="muted">{m.hint}</span>'+m.group(2)+m.group(3),body)

def restore_pv_history(body):
    n=0
    entries=[
     ('Paid · Closed Loop','Full payment recorded with final bank receipt'),
     ('Rejected Permanently','Approval ended without payment'),
    ]
    for title,desc in entries:
        pat=r'(<strong>'+re.escape(title)+r'</strong>)(\s*)(<em>)'
        if len(re.findall(pat,body))>1:
            stop('Ambiguous history card for '+title)
        body,count=re.subn(pat,lambda m:m.group(1)+'\n                <small>'+desc+'</small>'+m.group(2)+m.group(3),body)
        n+=count
    return body,n

def restore_amount_clarifiers(body):
    # Interpretations of money totals are important, not marketing filler.
    n=0
    for target,note in [
        ('money(financialSummary.fullPaid)','Completed Full Payments only'),
        ('money(financialSummary.partialPaid)','Settled partial installments only'),
        ('money(financialSummary.leftToPay)','Total outstanding across all approved PVs'),
    ]:
        pattern=r'(<strong>\{loading\|\|error\?\x27—\x27:'+re.escape(target)+r'\}</strong>)(\s*)(</div>)'
        if len(re.findall(pattern,body))>1:
            stop('Ambiguous payment total card '+target)
        body,c=re.subn(pattern,lambda m:m.group(1)+'\n          <small>'+note+'</small>'+m.group(2)+m.group(3),body)
        n+=c
    return body,n

RESTORE={
 'JIMSDashboardHome.jsx':restore_dashboard_home,
 'PaymentVoucher.jsx':lambda b: (lambda a,n1:(lambda c,n2:(c,n1+n2))(*restore_pv_history(a)))(*restore_pv_home(b)),
 'JIMSPaymentProcessBoard.jsx':lambda b: (lambda a,n1:(lambda c,n2:(c,n1+n2))(*restore_amount_clarifiers(a)))(*restore_process_cards(b)),
 'DelegationWorkspace.jsx':restore_delegation_cards,
}

# Verify no operational code or warning has been removed; the only restored
# markup may add <span>/<small> but cannot change button counts or callbacks.
PROTECTED=[
 '<button','</button>', '<input', '<select','<textarea',
 'onClick=', 'onChange=', 'onSubmit=', 'disabled=',
 'role="alert"', "role='alert'", 'role="status"',
 'supabase.', '.rpc(', 'payment_status',
 'financial_tier', 'onNavigate(', 'openCategory(', 'useState('
]
for path in source_files:
    old=path.read_text(encoding='utf-8')
    new=old
    removed=0
    restored=0
    for x in CUT.get(path.name,[]):
        new,k=literal_once_or_skip(new,x,'',path.name)
        removed+=k
    for old_text,new_text in SHORTEN.get(path.name,[]):
        new,k=literal_once_or_skip(new,old_text,new_text,path.name)
        removed+=k
    if path.name in RESTORE:
        new,restored=RESTORE[path.name](new)
    if new!=old:
        for token in PROTECTED:
            if old.count(token)!=new.count(token):
                stop(path.name+' protected code marker changed: '+token)
        before_files[path]=old
        after_files[path]=new
    if removed or restored:
        log.append((path.name,removed,restored))

if not after_files:stop('No matching safe edits/context restoration; check current local files')

new_main=original_main.replace(anchor,anchor+'\n'+CSS_IMPORT,1)
if new_main.replace(anchor+'\n'+CSS_IMPORT,anchor,1)!=original_main:
    stop('main.jsx addition not reversible')
try:styles=git('show','origin/'+BRANCH+':'+REMOTE)
except subprocess.CalledProcessError:
    stop('57D6C8 stylesheet not found on remote; git fetch origin '+BRANCH)
if styles.count(CSS_MARKER)!=1:
    stop('Restore-context stylesheet marker missing')

# Scan ALL installed component JSX files for developer/test phrases.
audit_after={p:after_files.get(p,p.read_text(encoding='utf-8')) for p in source_files}
launch_phrases=[
 'preview only','temporarily disabled','upcoming step','upcoming document',
 'pilot','drafts only at step','will be integrated','not installed',
 'step 36.4','step 46f sql','future integration'
]
launch_flags=[]
for p,body in audit_after.items():
    for i,line in enumerate(body.splitlines(),1):
        s=line.strip()
        if s.startswith(('//','*')):continue
        if any(flag in s.lower() for flag in launch_phrases):
            launch_flags.append((str(p.relative_to(SRC)),i,s[:200]))

# All planned JSX candidates are syntax checked in-memory before file writes.
with tempfile.TemporaryDirectory(prefix='jims_57d6c8_review_') as td:
    directory=Path(td)
    transformed=[]
    for index,(p,s) in enumerate(after_files.items()):
        target=directory/(str(index)+'_'+p.name)
        target.write_text(s,encoding='utf-8')
        transformed.append(str(target))
    main_candidate=directory/'main.jsx'
    main_candidate.write_text(new_main,encoding='utf-8')
    transformed.append(str(main_candidate))
    css_candidate=directory/CSS.name
    css_candidate.write_text(styles,encoding='utf-8')
    js=(
       "const fs=require('node:fs');"
       "Promise.all([import('vite'),import('postcss')]).then(async([v,p])=>{"
       "for(const f of process.argv.slice(1,-1))"
       "await v.transformWithOxc(fs.readFileSync(f,'utf8'),f);"
       "const css=p.default.parse(fs.readFileSync(process.argv.at(-1),'utf8'));"
       "let n=0;css.walkRules(rule=>{n++;"
       "if(rule.selector.split(',').some(s=>"
       "!s.trim().startsWith('.jims-shell')))throw Error('Unscoped CSS');"
       "});if(n<5)throw Error('Incomplete CSS');"
       "console.log('JIMS 57D6C8 JSX + CSS PARSER PASS');"
       "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    checked=subprocess.run(['node','-e',js,*transformed,str(css_candidate)],
       cwd=APP,capture_output=True,text=True)
    if checked.returncode:
        stop('JSX parser preflight failed: '+(checked.stderr or checked.stdout)[-2000:])
    print(checked.stdout.strip())

print('JIMS 57D6C8 BUTTON CONTEXT + WARNINGS SAFETY PASS')
print('Inspected '+str(len(source_files))+' installed JSX pages/subpages.')
for f,r,k in log:
    print(f+': '+str(r)+' filler removals/shortenings; '+str(k)+' help labels restored')
print('Go-live review flags (NOT HIDDEN): '+str(len(launch_flags)))
print('Sidebar, warnings, controls, access, workflow and Supabase untouched.')
if DRY or AUDIT_ONLY:
    for f,line,s in launch_flags[:20]:
        print('GO-LIVE REVIEW '+f+':'+str(line)+' '+s)
    print('JIMS 57D6C8 '+('AUDIT ONLY' if AUDIT_ONLY else 'DRY RUN')+' PASS — no application files modified.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D6C8_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
for p,content in [*before_files.items(),(MAIN,original_main)]:
    target=backup/p.relative_to(SRC)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(content,encoding='utf-8')
report=[
 'JIMS 57D6C8 GO-LIVE COPY AUDIT',
 'Reviewed JSX files: '+str(len(source_files)),
 'Button help restored; warnings and rules retained',
 'Changes (file, removed, restored): '+json.dumps(log),
 'REVIEW GO-LIVE BLOCKERS (content left visible):',
]
report+=['{}:{} {}'.format(*entry) for entry in launch_flags]
(backup/'57D6C8_GoLive_Copy_Audit.txt').write_text('\n'.join(report)+'\n',encoding='utf-8')
try:
    for p,content in after_files.items():
        p.write_text(content,encoding='utf-8')
    MAIN.write_text(new_main,encoding='utf-8')
    CSS.write_text(styles,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D6C8 BUILD PASS')
    print('Backup/audit:',backup)
except Exception as exc:
    for p,content in before_files.items():p.write_text(content,encoding='utf-8')
    MAIN.write_text(original_main,encoding='utf-8')
    CSS.unlink(missing_ok=True)
    sys.exit('STOP: Build failed; all original files restored: '+str(exc))
