#!/usr/bin/env python3
"""JIMS 57D5 — SAFE standalone Payment Calendar installer.
Financial Approval sidebar order: Payment Process, Payment Calendar, Payment Voucher, Petty Cash.
Only modifies App.jsx by adding one import, one guarded menu button, one title and one route.
Creates 2 standalone assets. Payment Process/Payment Voucher/Payment Planning/PC untouched.
--dry-run: NO filesystem writes. Install: backup + npm build + rollback on failure.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,re,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
APP_ROOT=ROOT/'app'
APP=APP_ROOT/'src/App.jsx'
COMP=APP_ROOT/'src/JIMSPaymentCalendar57D5.jsx'
CSS=APP_ROOT/'src/JIMSPaymentCalendar57D5.css'
BRANCH='jsync-gui-revamp-20261029'
DRY='--dry-run' in sys.argv
MARKER='JIMS_STEP57D5_CALENDAR_SIDEBAR'
SOURCE='gui-patches/57D/'

def stop(message):
    sys.exit('STOP: '+str(message)+' — local GUI files unchanged.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def exactly(content,token,label):
    n=content.count(token)
    if n!=1:stop(label+' expected exactly once; found '+str(n))

if git('branch','--show-current').strip()!=BRANCH:
    stop('Codespaces branch must be '+BRANCH)
if not APP.is_file():stop('Installed JIMS App.jsx not found')
if COMP.exists() or CSS.exists():stop('Standalone Payment Calendar assets already installed')
old=APP.read_text(encoding='utf-8')
if MARKER in old or "activePage === 'payment_calendar'" in old:
    stop('Payment Calendar already exists; no duplicate installation')

for key in (
    'JIMS_STEP_57C5S_MY_APPROVALS','JIMS_STEP57C8C_REPORT_MENU_LAST',
    "setActivePage('payment_voucher')",'payment_process',
    'Petty Cash','Payment Process',
    "activePage === 'cash_voucher'",'JIMSHistoryExports',
    "function App()", 'finance-approval-submenu'
):
    if key not in old:stop('Codespaces sidebar/routing changed; missing '+key)

widget=git('show','origin/'+BRANCH+':'+SOURCE+'JIMSPaymentCalendar57D5.jsx')
styles=git('show','origin/'+BRANCH+':'+SOURCE+'JIMSPaymentCalendar57D5.css')
for key in (
    'jims_57d5_payment_calendar_v1','JIMSPaymentPlanning57D3',
    'Overdue Payments','current_due_date','outstanding_amount',
    'missing_due','calendar_status','transaction','due_today','upcoming','paid'
):
    if key not in widget:stop('Calendar component missing '+key)
if any(key in widget for key in ('.insert(','.update(','.delete(','.upload(')):
    stop('Standalone Calendar must not directly mutate financial records')
if widget.count('export default function JIMSPaymentCalendar57D5(')!=1:
    stop('Calendar component API invalid')
if '.jims-cal-grid' not in styles or '.jims-cal-expand' not in styles:
    stop('Standalone calendar responsive styling missing')

# Resolve actual Payment Voucher sidebar button rather than replacing whole menu.
pv_label=list(re.finditer(r'(?m)^[ \t]*Payment Voucher[ \t]*$',old))
if len(pv_label)!=1:stop('Payment Voucher sidebar label is not unique')
pos=pv_label[0].start()
open_button=old.rfind('<button',max(0,pos-1600),pos)
close_before=old.rfind('</button>',max(0,pos-1600),pos)
if open_button<0 or close_before>open_button:
    stop('Cannot identify Payment Voucher sidebar button safely')
nav=old[open_button:old.find('</button>',pos)+len('</button>')]
if "setActivePage('payment_voucher')" not in nav:
    stop('Payment Voucher sidebar route does not match its label')
sidebar_start=old.find('id="finance-approval-submenu"')
if not(0<=sidebar_start<open_button):
    stop('Payment Voucher not within Finance Approval menu')
prefix=old[sidebar_start:open_button]
if 'Payment Process' not in prefix:
    stop('Payment Process must already be above Payment Voucher before inserting Calendar')
if 'Payment Calendar' in prefix:
    stop('Payment Calendar sidebar already present')

# Client menu guard mirrors server authorization; Supabase RPC remains the authority.
gate="""// JIMS 57D5: calendar menu visibility only; Supabase RPC enforces actual access.
function jimsCalendarEligible(p) {
  return p?.is_active===true && (
    ['ceo','bod','system_admin'].includes(p.role) ||
    (p.role==='manager' && p.department==='Finance') ||
    (p.role==='executive' && p.department==='Finance' &&
      p.subdepartment==='Accounts Payable')
  )
}

"""
exactly(old,'function App()','main App component')
new=old.replace('function App()',gate+'function App()',1)
exactly(new,"activePage === 'payment_voucher' ? 'Payment Voucher'",'page title')
new=new.replace(
    ": activePage === 'payment_voucher' ? 'Payment Voucher'",
    ": activePage === 'payment_calendar' ? 'Payment Calendar'\n"
    "                  : activePage === 'payment_voucher' ? 'Payment Voucher'",1
)

route_pattern=re.compile(r"\)\s*:\s*activePage\s*===\s*['\"]payment_voucher['\"]\s*\?\s*\(")
routes=list(route_pattern.finditer(new))
if len(routes)!=1:stop('Payment Voucher main page route is not unique')
route=routes[0]
route_add=""") : activePage === 'payment_calendar' ? (
              jimsCalendarEligible(profile) ? (
                <JIMSPaymentCalendar57D5 profile={profile} />
              ) : (
                <section className="panel" role="alert">
                  <h2>Access Restricted</h2>
                  <p>Payment Calendar is limited to Finance AP, Finance Manager, CEO, BOD and read-only System Admin.</p>
                </section>
              )
            ) : activePage === 'payment_voucher' ? ("""
new=new[:route.start()]+route_add+new[route.end():]

# Locate the OUTER access gate surrounding the Payment Voucher button.
# In JIMS 57C/57D, the button is inside:
#   {jimsAPModuleAccess(profile) && (
#     <button ...>Payment Voucher</button>
#   )}
# Inserting a sibling between the gate and <button> breaks JSX. Insert BEFORE
# the entire guarded block, rather than inside that conditional expression.
m=list(re.finditer(r'(?m)^[ \t]*Payment Voucher[ \t]*$',new))
if len(m)!=1:stop('PV sidebar label became ambiguous')
button_start=new.rfind('<button',max(0,m[0].start()-1600),m[0].start())
if button_start<0:stop('Could not relocate PV sidebar button')
access_rx=re.compile(r'(?m)^([ \t]*)\{jimsAPModuleAccess\(profile\)\s*&&\s*\(\s*$')
gate_hits=[]
for guard in access_rx.finditer(new,max(0,button_start-900),button_start):
    between=new[guard.end():button_start]
    # Permit whitespace and existing JSX comments only; reject nested markup.
    between=re.sub(r'\{/\*.*?\*/\}', '',between,flags=re.S)
    if not between.strip():gate_hits.append(guard)
if len(gate_hits)!=1:
    stop('Cannot safely locate outer jimsAPModuleAccess wrapper above PV button ('+
         str(len(gate_hits))+' matches). Do not install inside JSX.')
guard=gate_hits[0]
line_start=new.rfind('\n',0,guard.start())+1
indent=new[line_start:guard.start()]
if indent.strip():stop('Unexpected outer PV access gate indentation')
# JSX braces must be literal; NEVER use Python str.format on this markup.
# Prefix existing sidebar indentation line-by-line instead of escaping braces.
menu_lines=[
    '{/* JIMS_STEP57D5_CALENDAR_SIDEBAR: Process > Calendar > PV > PC */}',
    '{jimsCalendarEligible(profile) && (',
    '  <button type="button"',
    "    className={'nav-item nav-subitem '+(activePage === 'payment_calendar' ? 'nav-active' : '')}",
    '    onClick={() => {',
    "      setActivePage('payment_calendar')",
    '      setEditingUser(null)',
    '      setResetUser(null)',
    '    }}>',
    '    Payment Calendar',
    '  </button>',
    ')}',
]
menu='\n'.join(indent+line for line in menu_lines)+'\n'
new=new[:line_start]+menu+new[line_start:]
new="import JIMSPaymentCalendar57D5 from './JIMSPaymentCalendar57D5'\n"+new

for token in (
    "setActivePage('payment_voucher')", "setActivePage('cash_voucher')",
    "setActivePage('payment_process')", "setActivePage('history_exports')",
    "activePage === 'payment_process'","activePage === 'payment_voucher'",
    "activePage === 'cash_voucher'", 'jimsOwnerExportAllowed',
    'JIMS_STEP_57C5SN_APPROVAL_BADGE','JIMS_STEP57C8C_REPORT_MENU_LAST',
    'JIMSHistoryExports','JIMSPaymentProcessBoard',
    'My Approvals','Petty Cash','Payment Voucher'
):
    if new.count(token)!=old.count(token):
        stop('Existing JIMS route/approval/report behavior changed unexpectedly: '+token)
if len([line for line in new.splitlines() if 'supabase.rpc(' in line])!=len(
   [line for line in old.splitlines() if 'supabase.rpc(' in line]):
    stop('Unexpected change to Supabase RPC calls')
if new.count(MARKER)!=1 or new.count('<JIMSPaymentCalendar57D5 profile={profile} />')!=1:
    stop('Calendar mount marker duplicated/missing')
menu_pos=new.find('JIMS_STEP57D5_CALENDAR_SIDEBAR')
pv_pos=new.find('Payment Voucher',menu_pos)
if not(0<=new.find('Payment Process',new.find('finance-approval-submenu'))<menu_pos<pv_pos):
    stop('Calendar sidebar must appear after Process and before Payment Voucher')

# Syntax-parse the candidate JSX BEFORE any local files are touched.
# This catches broken conditional wrappers even when structural anchor checks pass.
parser=APP_ROOT/'node_modules/@babel/parser'
if not parser.is_dir():
    stop('JSX parser not found in app/node_modules/@babel/parser. Cannot safely verify App.jsx.')
with tempfile.TemporaryDirectory(prefix='jims_57d5_jsx_') as td:
    temp=Path(td)
    app_candidate=temp/'App.jsx'
    calendar_candidate=temp/'JIMSPaymentCalendar57D5.jsx'
    app_candidate.write_text(new,encoding='utf-8')
    calendar_candidate.write_text(widget,encoding='utf-8')
    checker=(
      "const fs=require('fs'),parser=require('@babel/parser');"
      "for(const f of process.argv.slice(1)){"
      "parser.parse(fs.readFileSync(f,'utf8'),{sourceType:'module',plugins:['jsx']});}"
      "console.log('JIMS 57D5 JSX PARSER PASS');"
    )
    verify=subprocess.run(
      ['node','-e',checker,str(app_candidate),str(calendar_candidate)],
      cwd=APP_ROOT,capture_output=True,text=True
    )
    if verify.returncode!=0:
        stop('Pre-install JSX syntax check failed: '+(verify.stderr or verify.stdout)[-1300:])
    print(verify.stdout.strip())

print('57D5 Standalone Calendar + Sidebar Position PASS')
print('Sidebar: Payment Process > Payment Calendar > Payment Voucher > Petty Cash')
print('Existing Payment Process, PV, PC, Approval and Report Generation preserved.')
if DRY:
    print('JIMS 57D5 DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=APP_ROOT/'gui-backups'/('57D5_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'App.jsx').write_text(old,encoding='utf-8')
try:
    COMP.write_text(widget,encoding='utf-8')
    CSS.write_text(styles,encoding='utf-8')
    APP.write_text(new,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP_ROOT,check=True)
    print('JIMS 57D5 BUILD PASS')
    print('Backup:',backup)
except Exception as e:
    APP.write_text(old,encoding='utf-8')
    COMP.unlink(missing_ok=True)
    CSS.unlink(missing_ok=True)
    sys.exit('STOP: build failed; restored original App.jsx and removed calendar assets: '+str(e))
