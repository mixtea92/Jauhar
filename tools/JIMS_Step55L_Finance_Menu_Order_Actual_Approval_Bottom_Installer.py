#!/usr/bin/env python3
"""JIMS STEP 55L — reorder Finance navigation and move Actual Authority to bottom.

Build-safe, GUI-only patch on the successful Step 54H + Step 53T-C Codespaces
workspace. Changes ONLY App.jsx, JIMSDashboardHome.jsx, PaymentVoucher.jsx.
CV/Petty Cash functions and ApprovalQueues.jsx are byte-for-byte untouched.
No Supabase schema/RPC/approval workflow changes, no git reset/checkout.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
APP=ROOT/'app/src/App.jsx'
HOME=ROOT/'app/src/JIMSDashboardHome.jsx'
PV=ROOT/'app/src/PaymentVoucher.jsx'
DRY='--dry-run' in sys.argv

def stop(msg):
    sys.exit('STOP: '+str(msg))
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def one(text,old,new,label):
    n=text.count(old)
    if n!=1: stop(f'{label}: expected one anchor, got {n}; no changes made.')
    return text.replace(old,new,1)
def rpc_lines(source):
    return sorted(x.strip() for x in source.splitlines() if '.rpc(' in x)
def nav_button(source, label):
    needle='                '+label+'\n'
    if source.count(needle)!=1:
        stop('Sidebar '+label+': expected 1 unique label, got '+str(source.count(needle)))
    index=source.index(needle)
    start=source.rfind('              <button',0,index)
    finish=source.find('</button>',index)
    if start<0 or finish<0: stop('Could not locate '+label+' sidebar button')
    finish+=len('</button>')
    # Include trailing newline of the button, preserving comment between buttons.
    if source[finish:finish+1]=='\n': finish+=1
    block=source[start:finish]
    if ('activePage === '+repr({'Payment Process':'payment_process',
         'Payment Voucher':'payment_voucher','Petty Cash':'cash_voucher'}[label])) not in block:
        stop('Sidebar '+label+' route identifier changed unexpectedly')
    if 'setActivePage(' not in block: stop('Sidebar '+label+' click handler missing')
    return start,finish,block

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch; expected '+BRANCH)
for f in (APP,HOME,PV):
    if not f.is_file(): stop('Protected file missing: '+str(f))
old_app,old_home,old_pv=(APP.read_text(),HOME.read_text(),PV.read_text())

# Exact current stack must be installed, not an old GitHub source snapshot.
for marker in ("import './JIMSClosedLoopHistory.css'",
               "activePage === 'payment_process'",
               "activePage === 'cash_voucher' ? 'Petty Cash'"):
    if marker not in old_app: stop('54H/51UI App baseline missing '+marker)
for marker in ("'Petty Cash'","'Payment Process'","'Payment Voucher'"):
    if marker not in old_home: stop('54H dashboard missing '+marker)
for marker in ("aria-label=\"PV History\"",
               "aria-label=\"Payment History\"",
               "supabase.rpc('create_pv_draft_v6'",
               "parseRevisionOneWorkbook",
               'My Approvals'):
    if marker not in old_pv:
        # Actual label lives in ApprovalQueues.jsx, not in PaymentVoucher.jsx.
        if marker=='My Approvals': continue
        stop('Protected PV revision/54H history missing '+marker)
if 'JIMS_STEP_55L_ORDER' in old_app:
    stop('Step 55L may already be installed.')
if "onClick={() => openCategory('approved')}" in old_pv:
    stop('Prior PV History may contain unfinished records.')

# Sidebar: currently PV, Payment Process, Petty Cash. Move Process first.
app=old_app
pv_start,pv_end,pv_button=nav_button(app,'Payment Voucher')
process_start,process_end,process_button=nav_button(app,'Payment Process')
cash_start,cash_end,cash_button=nav_button(app,'Petty Cash')
if not (pv_start<pv_end<process_start<process_end<cash_start<cash_end):
    stop('Unexpected Finance sidebar order; refusing blind replacement.')
between=app[pv_end:process_start]
if between.count('51UI: payment dashboard')!=1:
    stop('Navigation marker between Payment Voucher and Payment Process missing.')
# Keep the 51UI code comment with the Payment Process button.
app=(app[:pv_start]+between+process_button+pv_button+app[process_end:])
app=one(app,
    "              {/* 51UI: payment dashboard, same existing PV approval/payment engine */}",
    "              {/* JIMS_STEP_55L_ORDER: Payment Process first. Original route handlers retained. */}",
    'Sidebar layout marker')

# Main dashboard: Action Required cards and Financial Workspace links.
home=old_home
lines=home.splitlines(keepends=True)
action_pv=[i for i,v in enumerate(lines) if "title:'Payment Voucher'" in v and "page:'payment_voucher'" in v]
action_pay=[i for i,v in enumerate(lines) if "title:'Payment Process'" in v and "page:'payment_process'" in v]
action_pc=[i for i,v in enumerate(lines) if "title:'Petty Cash'" in v and "page:'cash_voucher'" in v]
if any(len(v)!=1 for v in (action_pv,action_pay,action_pc)):
    stop('Main dashboard Action Required cards missing or duplicated.')
a,b,c=action_pv[0],action_pay[0],action_pc[0]
if not (b==a+1 and c==b+1):
    stop('Unexpected Action Required ordering; manual review required.')
lines[a],lines[b]=lines[b],lines[a]
home=''.join(lines)
lines=home.splitlines(keepends=True)
link_pv=[i for i,v in enumerate(lines) if '<LinkRow' in v and 'title="Payment Voucher"' in v]
link_pay=[i for i,v in enumerate(lines) if '<LinkRow' in v and 'title="Payment Process"' in v]
link_pc=[i for i,v in enumerate(lines) if '<LinkRow' in v and 'title="Petty Cash"' in v]
if any(len(v)!=1 for v in (link_pv,link_pay,link_pc)):
    stop('Financial Workspace shortcut rows missing or duplicated.')
a,b,c=link_pv[0],link_pay[0],link_pc[0]
if not (b==a+1 and c==b+1):
    stop('Unexpected Financial Workspace ordering; manual review required.')
lines[a],lines[b]=lines[b],lines[a]
home=''.join(lines)

# Payment Voucher dashboard: existing Actual Authority approval component stays
# intact; ONLY move its JSX position AFTER PV History, never change props.
pv=old_pv
approval_line='          <ApprovalQueues profile={profile} onOpenVoucher={openVoucher} mode="actual" refreshKey={allDelegationRecords.length + allHandoverRecords.length} />'
if pv.count(approval_line)!=1:
    stop('My Approvals · Actual Authority mount not found uniquely.')
history_start='<section className="panel jims-closed-history" aria-label="PV History">'
if pv.count(history_start)!=1:
    stop('PV History section missing or duplicated.')
queue_at=pv.index(approval_line)
history_at=pv.index(history_start)
if not queue_at<history_at:
    stop('Actual Authority is already at bottom; refusing to move it twice.')

# Move the one component from between dashboard and history to right after the
# closing </section> of PV History. All approval RPC handlers and component props
# remain untouched.
pv=one(pv,approval_line+'\n','', 'Detach existing Actual Authority panel')
history_at=pv.index(history_start)
history_close='          </section>'
history_end=pv.find(history_close,history_at)
if history_end<0: stop('PV History section closing tag not found')
history_end+=len(history_close)
# The section is immediately followed by the same dashboard's fragment closure.
after=pv[history_end:history_end+105]
if not after.startswith('\n        </>\n      )}'):
    stop('PV History not immediately before end of dashboard. No edits performed.')
pv=pv[:history_end]+'\n'+approval_line+pv[history_end:]
if pv.index(approval_line)<pv.index(history_start):
    stop('Actual Authority panel still before PV History.')
if pv.count('<ApprovalQueues')!=old_pv.count('<ApprovalQueues'):
    stop('ApprovalQueues mount count changed.')
if rpc_lines(pv)!=rpc_lines(old_pv):
    stop('PV Supabase RPC calls changed: protected business flow.')
if pv.count('<PaymentTrackingPanel')!=old_pv.count('<PaymentTrackingPanel'):
    stop('Payment Process engine mount changed.')
if app.count("setActivePage('payment_process')")!=old_app.count("setActivePage('payment_process')"):
    stop('Payment Process routing callback count changed.')
if app.count("setActivePage('cash_voucher')")!=old_app.count("setActivePage('cash_voucher')"):
    stop('Petty Cash routing callback count changed.')
if app.count("setActivePage('payment_voucher')")!=old_app.count("setActivePage('payment_voucher')"):
    stop('Payment Voucher routing callback count changed.')
if home.count("page:'cash_voucher'")!=old_home.count("page:'cash_voucher'"):
    stop('Petty Cash dashboard link count changed.')

print('JIMS STEP 55L — '+('DRY RUN' if DRY else 'INSTALL'))
print('Sidebar and Dashboard: Payment Process → Payment Voucher → Petty Cash')
print('Payment Voucher dashboard: My Approvals · Actual Authority LAST, below PV History')
print('No duplicate ApprovalQueues; no permissions, JR, DB, payment or Petty Cash workflow edits.')
print('Touched files: App.jsx, JIMSDashboardHome.jsx, PaymentVoucher.jsx ONLY.')
if DRY:
    print('DRY RUN PASS — no files modified.')
    sys.exit(0)

backup=ROOT/('app/gui-backups/55L_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
originals={APP:old_app,HOME:old_home,PV:old_pv}
backup.mkdir(parents=True,exist_ok=False)
for file,src in originals.items():
    (backup/file.name).write_text(src)
try:
    APP.write_text(app)
    HOME.write_text(home)
    PV.write_text(pv)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 55L NAVIGATION + APPROVAL QUEUE ORDER — BUILD PASS')
    print('Backups:',backup)
except Exception as e:
    for file,src in originals.items(): file.write_text(src)
    stop('Production build failed; all 3 original files restored. '+str(e))
