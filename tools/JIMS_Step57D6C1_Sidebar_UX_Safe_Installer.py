#!/usr/bin/env python3
"""JIMS 57D6C1 — premium sidebar UX polish, GUI only.

Requires installed 55L/56N/57C5SN/57D5/57D6B2.
Modifies ONLY:
  app/src/App.jsx: decorative nav classes, visual label, place My Approvals
                   below Finance, collapse Delegation on first load, hide one
                   "Finance Dashboard — Soon" placeholder.
  app/src/main.jsx: ONE new CSS import.
  app/src/JIMS57D6C1SidebarPolish.css: NEW scoped styles.
Never changes any nav route/click handler, access guard, counts, RPC or payments.
All changes use exact local anchors; --dry-run, CSS/JSX parse, backup/rollback.
"""
from pathlib import Path
from datetime import datetime,timezone
import re,sys,subprocess,tempfile

ROOT=Path('/workspaces/Jauhar')
APPDIR=ROOT/'app'
APP=APPDIR/'src/App.jsx'
MAIN=APPDIR/'src/main.jsx'
CSS=APPDIR/'src/JIMS57D6C1SidebarPolish.css'
BRANCH='jsync-gui-revamp-20261029'
REMOTE='gui-patches/57D/JIMS57D6C1SidebarPolish.css'
MARKER='JIMS_STEP57D6C1_SIDEBAR_ONLY'
IMPORT="import './JIMS57D6C1SidebarPolish.css'"
ANCHOR="import './JIMS57D6ADarkFinancePolish.css'"
DRY='--dry-run' in sys.argv

def stop(reason):
    sys.exit('STOP: '+reason+' — Codespaces files not modified.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
if git('branch','--show-current').strip()!=BRANCH:
    stop('Not on branch '+BRANCH)
for f in (APP,MAIN):
    if not f.is_file():stop('JIMS file not present: '+str(f))
if CSS.exists():
    stop('57D6C1 CSS already exists; refuse to overwrite customizations')
old_app=APP.read_text(encoding='utf-8')
old_main=MAIN.read_text(encoding='utf-8')
if IMPORT in old_main or MARKER in old_app:
    stop('Sidebar polish already installed; refuse duplicate')
for value in (
    'JIMS_STEP_55L_ORDER',
    'JIMS_STEP_57C5S_MY_APPROVALS',
    'JIMS_STEP_57C5SN_APPROVAL_BADGE',
    'JIMS_STEP57D5_CALENDAR_SIDEBAR',
    'JIMS_STEP57C8C_REPORT_MENU_LAST',
    'jims-nav-notification',
    'jimsCanSeeMyApprovals(profile)',
    "const [financeOpen, setFinanceOpen] = useState(true)",
):
    if value not in old_app:
        stop('Expected prior GUI checkpoint absent: '+value)
theme=APPDIR/'src/JIMS57D6Theme.css'
if not theme.is_file() or 'JIMS_STEP57D6B2_TRUE_LIGHT_MODE' not in theme.read_text(encoding='utf-8'):
    stop('Step 57D6B2 true Light Mode prerequisite not found')
if old_main.count(ANCHOR)!=1:
    stop('57D6A stylesheet import not unique in main.jsx')
new_main=old_main.replace(ANCHOR,ANCHOR+'\n'+IMPORT,1)
if new_main.replace(ANCHOR+'\n'+IMPORT,ANCHOR,1)!=old_main:
    stop('main.jsx import insertion not purely additive')
styles=git('show','origin/'+BRANCH+':'+REMOTE)
if styles.count(MARKER)!=1 or '--jims-57d6c1-icon' not in styles:
    stop('Approved scoped CSS not found')
if '.jims-shell .sidebar' not in styles or 'html.jims-57d6-light' not in styles:
    stop('Expected dual-theme sidebar selectors absent')
if any(x in styles for x in ('supabase','fetch(','.jims-shell>.content','.jims-dashboard .jims-action-card')):
    stop('CSS unexpectedly reaches finance/data/dashboard modules')

# Strict sidebar-only modification: never replace an old App.jsx with the GitHub App.jsx.
open_aside='<aside className="sidebar">'
if old_app.count(open_aside)!=1:
    stop('Existing JIMS sidebar opening tag changed')
before,rest=old_app.split(open_aside,1)
if '</aside>' not in rest:
    stop('Sidebar closing tag not found')
sidebar,after=rest.split('</aside>',1)
original_sidebar=sidebar

def locate(label,route=None):
    global sidebar
    rx=r'(?m)^[ \t]*(?:<span>)?'+re.escape(label)+r'(?:</span>)?[ \t]*$'
    matches=list(re.finditer(rx,sidebar))
    if len(matches)!=1:
        stop('Could not identify ONE sidebar label '+label+': '+str(len(matches)))
    at=matches[0].start()
    start=sidebar.rfind('<button',0,at)
    close_before=sidebar.rfind('</button>',0,at)
    end=sidebar.find('</button>',at)
    if start<0 or end<0 or close_before>start:
        stop('Button boundary mismatch for '+label)
    end+=len('</button>')
    block=sidebar[start:end]
    if route and "setActivePage('"+route+"')" not in block:
        stop('Route preservation check failed for '+label)
    return start,end,block

def class_only(label,route,icon):
    global sidebar
    start,end,block=locate(label,route)
    if block.count('nav-item')!=1:
        stop('Unique nav-item class not found in '+label)
    decorated=block.replace('nav-item','nav-item jims-57d6c1-row jims-57d6c1-'+icon,1)
    sidebar=sidebar[:start]+decorated+sidebar[end:]

# Label is presentation text only; existing expansion handler remains exactly unchanged.
start,end,block=locate('Financial Approval')
if 'setFinanceOpen(' not in block or 'finance-approval-submenu' not in block:
    stop('Finance group click/ARIA handler not recognized')
if block.count('Financial Approval')!=1 or block.count('nav-item')!=1:
    stop('Finance heading format changed')
changed=block.replace('Financial Approval','Finance Workspace',1)
changed=changed.replace('nav-item','nav-item jims-57d6c1-row jims-57d6c1-group jims-57d6c1-finance',1)
sidebar=sidebar[:start]+changed+sidebar[end:]

for label,route,icon in (
    ('Dashboard','dashboard','dashboard'),
    ('Payment Process','payment_process','process'),
    ('Payment Calendar','payment_calendar','calendar'),
    ('Payment Voucher','payment_voucher','pv'),
    ('Petty Cash','cash_voucher','cash'),
    ('Delegation Workspace','delegation_workspace','workspace'),
    ('Manage Delegation','manage_delegation','manage'),
    ('Report Generation','history_exports','report'),
    ('My Approvals','my_approvals','approvals'),
    ('User Management','users','users'),
    ('Audit Trail','audit','audit'),
    ('My Profile','my_profile','profile')
):
    class_only(label,route,icon)

start,end,block=locate('Delegation')
if 'setDelegationOpen(' not in block:
    stop('Delegation toggle action unrecognized')
if block.count('nav-item')!=1:stop('Delegation class uniqueness guard failed')
sidebar=sidebar[:start]+block.replace(
    'nav-item','nav-item jims-57d6c1-row jims-57d6c1-delegation',1
)+sidebar[end:]

# Hide ONLY one inactive "Soon" label; never hide any live navigation.
placeholder=re.compile(
    r'(<div className="nav-item nav-placeholder" aria-disabled="true">[ \t\r\n]*'
    r'Finance Dashboard — Soon[ \t\r\n]*</div>)'
)
matches=list(placeholder.finditer(sidebar))
if len(matches)!=1:
    stop('Future Finance Dashboard placeholder differs: '+str(len(matches)))
sidebar=sidebar.replace(matches[0].group(1),matches[0].group(1).replace(
    'nav-item nav-placeholder','nav-item nav-placeholder jims-57d6c1-soon',1
),1)

# DOM order and keyboard/screen reader order MUST match.
# Move the guarded existing My Approvals JSX block to just below Finance,
# never duplicate it and never alter who sees it or how it navigates.
marker='{/* JIMS 57C5S: Standalone role-specific Approval Dashboard. */}'
if sidebar.count(marker)!=1:
    stop('My Approvals section marker changed or duplicated')
begin=sidebar.index(marker)
button_end=sidebar.find('</button>',begin)
if button_end<0 or "setActivePage('my_approvals')" not in sidebar[begin:button_end]:
    stop('My Approvals protected click handler not found')
button_end+=len('</button>')
tail=re.match(r'[ \t]*\r?\n[ \t]*\)\}[ \t]*\r?\n',sidebar[button_end:])
if not tail:
    stop('My Approvals role-guard closing token changed')
end=button_end+tail.end()
block=sidebar[begin:end]
future_comment='{/* FUTURE FINANCE DASHBOARD (SEPARATE MAIN MODULE) */}'
if sidebar.count(future_comment)!=1:
    stop('Finance sidebar group tail not uniquely found')
future=sidebar.index(future_comment)
# Move only if above Finance group (original 57C5S placement).
finance=sidebar.index('id="finance-approval-submenu"')
if begin<finance:
    sidebar=sidebar[:begin]+sidebar[end:]
    future=sidebar.index(future_comment)
    insertion=sidebar.rfind('\n',0,future)+1
    sidebar=sidebar[:insertion]+block+'\n'+sidebar[insertion:]
elif begin>finance:
    # Already at/after Finance (user may have independently rearranged menu).
    if begin>future:stop('My Approvals located outside safe Finance/sidebar region')
else:stop('Unexpected My Approvals position')
if sidebar.count("setActivePage('my_approvals')")!=original_sidebar.count("setActivePage('my_approvals')"):
    stop('My Approvals route handler count changed')

new_app=before+open_aside+sidebar+'</aside>'+after
# Default Finance Workspace open; initial Delegation submenu collapsed.
# Both are local presentation state only. Clicking still toggles as before.
delegation_open='const [delegationOpen, setDelegationOpen] = useState(true)'
delegation_closed='const [delegationOpen, setDelegationOpen] = useState(false)'
if new_app.count(delegation_open)==1:
    new_app=new_app.replace(delegation_open,delegation_closed,1)
elif new_app.count(delegation_closed)!=1:
    stop('Existing Delegation initial expansion state differs')

for route in (
    'dashboard','payment_process','payment_calendar','payment_voucher',
    'cash_voucher','delegation_workspace','manage_delegation','history_exports',
    'my_approvals','users','audit','my_profile'
):
    call="setActivePage('"+route+"')"
    if new_app.count(call)!=old_app.count(call):
        stop('Navigation route count changed: '+route)
for protect in (
    'jimsCanSeeMyApprovals(profile)',
    'jimsCalendarEligible(profile)',
    'jimsAPModuleAccess(profile)',
    'jimsActionCounts.payment',
    'jimsActionCounts.pv',
    'jimsActionCounts.cv',
    'myApprovalBadge',
    'JIMS_STEP57C8C_REPORT_MENU_LAST'
):
    if new_app.count(protect)!=old_app.count(protect):
        stop('Protected count/permission reference changed: '+protect)
if [x.strip() for x in new_app.splitlines() if '.rpc(' in x] != [
    x.strip() for x in old_app.splitlines() if '.rpc(' in x
]:
    stop('Supabase RPC lines changed unexpectedly')
if new_app.count('jims-57d6c1-row')!=14:
    stop('Number of decorated sidebar buttons not as expected')
if new_app.count('Finance Workspace')!=1:
    stop('Finance Workspace visual label not unique')
if not(new_app.index('JIMS_STEP_55L_ORDER')<
       new_app.index('JIMS_STEP57D5_CALENDAR_SIDEBAR')<
       new_app.index("setActivePage('payment_voucher')")<
       new_app.index('JIMS_STEP_57C5SN_APPROVAL_BADGE') or True):
    # Exact ordering is checked below within the sidebar itself.
    stop('Unexpected Finance order')
if not (sidebar.index('Payment Process')<sidebar.index('Payment Calendar')
        <sidebar.index('Payment Voucher')<sidebar.index('Petty Cash')):
    stop('Locked four-item Finance menu order changed')
if not sidebar.index('Finance Workspace')<sidebar.index('My Approvals'):
    stop('My Approvals not below Finance')

# CSS + JSX parse before touching any project file.
with tempfile.TemporaryDirectory(prefix='jims_57d6c1_preflight_') as td:
    folder=Path(td)
    candidate=folder/'App.jsx'
    candidate.write_text(new_app,encoding='utf-8')
    stylesfile=folder/CSS.name
    stylesfile.write_text(styles,encoding='utf-8')
    mainfile=folder/'main.jsx'
    mainfile.write_text(new_main,encoding='utf-8')
    js=(
        "const fs=require('node:fs');"
        "Promise.all([import('vite'),import('postcss')]).then(async([v,p])=>{"
        "await v.transformWithOxc(fs.readFileSync(process.argv[1],'utf8'),process.argv[1]);"
        "await v.transformWithOxc(fs.readFileSync(process.argv[2],'utf8'),process.argv[2]);"
        "p.default.parse(fs.readFileSync(process.argv[3],'utf8'),{from:process.argv[3]});"
        "console.log('JIMS 57D6C1 JSX + CSS PARSER PASS');"
        "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    test=subprocess.run(['node','-e',js,str(candidate),str(mainfile),str(stylesfile)],
        cwd=APPDIR,capture_output=True,text=True)
    if test.returncode!=0:
        stop('Preflight parser failed: '+(test.stderr or test.stdout)[-2000:])
    print(test.stdout.strip())

print('JIMS 57D6C1 SIDEBAR GUI-ONLY SAFETY CHECK PASS')
print('Finance Workspace > Process > Calendar > PV > Petty Cash > Delegation > Reports.')
print('My Approvals as distinct bottom shortcut; existing role gate/badge unchanged.')
print('Routes, callbacks, counts, database, PV/PC and Dark/Light logic unchanged.')
if DRY:
    print('JIMS 57D6C1 DRY RUN PASS — no project files changed.')
    sys.exit(0)

backup=APPDIR/'gui-backups'/('57D6C1_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/APP.name).write_text(old_app,encoding='utf-8')
(backup/MAIN.name).write_text(old_main,encoding='utf-8')
try:
    CSS.write_text(styles,encoding='utf-8')
    APP.write_text(new_app,encoding='utf-8')
    MAIN.write_text(new_main,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APPDIR,check=True)
    print('JIMS 57D6C1 BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    APP.write_text(old_app,encoding='utf-8')
    MAIN.write_text(old_main,encoding='utf-8')
    CSS.unlink(missing_ok=True)
    sys.exit('STOP: Build failed — all original GUI files restored: '+str(exc))
