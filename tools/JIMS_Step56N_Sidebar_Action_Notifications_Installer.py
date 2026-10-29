#!/usr/bin/env python3
"""JIMS Step 56N: role-scoped sidebar action notification numbers.

Requires successful 51UI + 53T-C + 54H + 55L Codespaces stack.
Patches ONLY app/src/App.jsx; installs two new standalone read-only files.
Keeps three-item Finance order, PV/Petty Cash Histories, and My Approvals at
bottom unchanged. No backend/Supabase/business logic or repo reset.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess,sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
APP=ROOT/'app/src/App.jsx'
PV=ROOT/'app/src/PaymentVoucher.jsx'
CV=ROOT/'app/src/CashVoucher.jsx'
BADGE_HELPER=ROOT/'app/src/jimsActionNotifications.js'
BADGE_CSS=ROOT/'app/src/JIMSFinanceActionBadges.css'
DRY='--dry-run' in sys.argv

def stop(msg): sys.exit('STOP: '+str(msg))
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(path):
    try: return git('show','origin/'+BRANCH+':'+path)
    except Exception as e: stop('Cannot fetch remote asset '+path+'; run git fetch. '+str(e))
def one(source,before,after,label):
    n=source.count(before)
    if n!=1: stop(label+' expected exactly 1 match; got '+str(n)+'. Files untouched.')
    return source.replace(before,after,1)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch. Current branch must be '+BRANCH)
for f in (APP,PV,CV):
    if not f.is_file(): stop('Protected JIMS file missing: '+str(f))
if BADGE_HELPER.exists() or BADGE_CSS.exists():
    stop('Notification files already exist. No overwriting.')
old=APP.read_text()
pv=PV.read_text()
cv=CV.read_text()
for x in (
 "JIMS_STEP_55L_ORDER",
 "import './JIMSClosedLoopHistory.css'",
 "activePage === 'cash_voucher' ? 'Petty Cash'",
 "activePage === 'payment_process'",
 'className="layout jims-shell"'
):
    if x not in old: stop('Step 55L dark GUI baseline differs: '+x)
for x in ("aria-label=\"PV History\"",
          "aria-label=\"Payment History\"",
          "supabase.rpc('create_pv_draft_v6'",
          "parseRevisionOneWorkbook"):
    if x not in pv: stop('Protected Step 53T-C/54H PV source missing: '+x)
if "Petty Cash History" not in cv: stop('Protected Step 54H Petty Cash history missing.')
if 'jims-nav-notification' in old or 'jims-action-nav' in old:
    stop('Sidebar badges may already be installed. No duplicate.')
if "useEffect" not in old or "const [activePage, setActivePage] = useState('dashboard')" not in old:
    stop('Expected App.jsx hook anchors missing.')

# Confirm preserved Step 55L sidebar order before changing style.
start=old.index('JIMS_STEP_55L_ORDER')
stop_at=old.find('{/* Step 46G:',start)
if stop_at<0: stop('Finance sidebar closing marker missing.')
sidebar=old[start:stop_at]
labels=['                Payment Process\n','                Payment Voucher\n','                Petty Cash\n']
if any(sidebar.count(label)!=1 for label in labels):
    stop('Current Finance sidebar labels changed. No guesswork.')
if not (sidebar.index(labels[0])<sidebar.index(labels[1])<sidebar.index(labels[2])):
    stop('Step 55L menu order unexpectedly changed.')

helper=remote('gui-patches/51H/jimsActionNotifications.js')
css=remote('gui-patches/56N/JIMSFinanceActionBadges.css')
for marker in (
 'jauhar_my_approval_queues_v1',
 'cash_voucher_approvals',
 'payment_initiation_manager_decision',
 'created_by',
 'isAP',
 'const actual=',
 "return {pv,payment,cv}"
):
    if marker not in helper: stop('Read-only notification source incomplete: '+marker)
if "insert(" in helper or "update(" in helper or "delete(" in helper:
    stop('Notification source must not mutate data.')
if '.jims-nav-notification' not in css:
    stop('Notification CSS missing.')

app=old
app=one(app,
    "import './JIMSClosedLoopHistory.css'",
    "import './JIMSClosedLoopHistory.css'\n"+
    "import './JIMSFinanceActionBadges.css'\n"+
    "import {fetchJIMSActionNotifications} from './jimsActionNotifications'",
    'Badge stylesheet and read-only helper imports')

app=one(app,
    "  const [activePage, setActivePage] = useState('dashboard')",
    "  const [activePage, setActivePage] = useState('dashboard')\n"+
    "  const [jimsActionCounts,setJimsActionCounts] = useState({pv:undefined,payment:undefined,cv:undefined})",
    'Sidebar notification state')

effect="""  // Step 56N — actual user actions ONLY, read through current user RLS/RPC.
  // Refresh when entering a page, returning to browser, or every 120 seconds.
  useEffect(() => {
    if (!profile || profile.role === 'non_executive' || profile.is_active === false) {
      setJimsActionCounts({pv:undefined,payment:undefined,cv:undefined})
      return
    }
    let alive = true
    const refreshJIMSBadges = () => {
      fetchJIMSActionNotifications(profile).then(counts => {
        if (alive) setJimsActionCounts(counts)
      }).catch(() => {
        if (alive) setJimsActionCounts({pv:null,payment:null,cv:null})
      })
    }
    refreshJIMSBadges()
    window.addEventListener('focus',refreshJIMSBadges)
    const poll = window.setInterval(refreshJIMSBadges,120000)
    return () => {
      alive = false
      window.removeEventListener('focus',refreshJIMSBadges)
      window.clearInterval(poll)
    }
  },[profile?.role,profile?.department,profile?.username,profile?.is_active,activePage])

"""
app=one(app,'  async function handleLogin(e) {',effect+'  async function handleLogin(e) {',
        'Read-only badge refresh lifecycle')

# Preserve button routes, order, and click handlers; only add a flex class.
app=one(app,
 "className={\`nav-item nav-subitem \${activePage === 'payment_process' ? 'nav-active' : ''}\`}",
 "className={\`nav-item nav-subitem jims-action-nav \${activePage === 'payment_process' ? 'nav-active' : ''}\`}",
 'Payment Process sidebar layout')
app=one(app,
 "className={\`nav-item nav-subitem \${\n                  activePage === 'payment_voucher' ? 'nav-active' : ''\n                }\`}",
 "className={\`nav-item nav-subitem jims-action-nav \${\n                  activePage === 'payment_voucher' ? 'nav-active' : ''\n                }\`}",
 'Payment Voucher sidebar layout')
app=one(app,
 "className={\`nav-item nav-subitem \${activePage === 'cash_voucher' ? 'nav-active' : ''}\`}",
 "className={\`nav-item nav-subitem jims-action-nav \${activePage === 'cash_voucher' ? 'nav-active' : ''}\`}",
 'Petty Cash sidebar layout')

for title,key in (('Payment Process','payment'),('Payment Voucher','pv'),('Petty Cash','cv')):
    insertion="""                {jimsActionCounts.KEY > 0 ? (
                  <span className="jims-nav-notification"
                    aria-label={jimsActionCounts.KEY + ' pending actions'}
                    title={jimsActionCounts.KEY + ' actions requiring your attention'}>
                    {jimsActionCounts.KEY > 99 ? '99+' : jimsActionCounts.KEY}
                  </span>
                ) : jimsActionCounts.KEY === null ? (
                  <span className="jims-nav-notification jims-count-unavailable"
                    title="Action count unavailable" aria-label="Action count unavailable">—</span>
                ) : null}
""".replace('KEY',key)
    app=one(app,'                '+title+'\n              </button>',
        '                '+title+'\n'+insertion+'              </button>',
        title+' notification badge')

sidebar_after=app[app.index('JIMS_STEP_55L_ORDER'):app.index('{/* Step 46G:',app.index('JIMS_STEP_55L_ORDER'))]
if any(sidebar_after.count(l)!=1 for l in labels):
    stop('Existing sidebar labels changed.')
if not (sidebar_after.index(labels[0])<sidebar_after.index(labels[1])<sidebar_after.index(labels[2])):
    stop('Sidebar order changed unexpectedly.')
for x in ("setActivePage('payment_process')","setActivePage('payment_voucher')",
          "setActivePage('cash_voucher')","<PaymentVoucher","<CashVoucher","<DelegationWorkspace"):
    if old.count(x)!=app.count(x):
        stop('Protected route/mount count changed unexpectedly: '+x)
if [s.strip() for s in old.splitlines() if '.rpc(' in s]!=[
    s.strip() for s in app.splitlines() if '.rpc(' in s]:
    stop('Protected App RPC call lines changed.')
if app.count('jims-nav-notification')!=6:
    stop('Unexpected number of badge markup components.')
if 'JIMS_STEP_55L_ORDER' not in app:
    stop('Protected Step 55L marker removed.')

print('JIMS STEP 56N — '+('DRY RUN' if DRY else 'INSTALL'))
print('Finance sidebar: Payment Process > Payment Voucher > Petty Cash (order unchanged)')
print('Badges: real role-specific ACTION REQUIRED counts only. Zero hidden.')
print('On data error: grey dash, never falsely report zero. Updates on focus/page change/2 minutes.')
print('No changes to PV, Petty Cash, ApprovalQueues, History, JR, DB, payment or delegation.')
print('Touched: App.jsx + NEW notification helper/CSS only. Existing 55L remains protected.')
if DRY:
    print('DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=ROOT/('app/gui-backups/56N_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'App.jsx').write_text(old)
created=[]
try:
    with BADGE_HELPER.open('x') as f:
        f.write(helper)
    created.append(BADGE_HELPER)
    with BADGE_CSS.open('x') as f:
        f.write(css)
    created.append(BADGE_CSS)
    APP.write_text(app)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 56N SIDEBAR ACTION NOTIFICATIONS — BUILD PASS')
    print('Backups:',backup)
except Exception as e:
    APP.write_text(old)
    for p in created: p.unlink(missing_ok=True)
    stop('Build/install failed. Original App.jsx restored, new files removed. '+str(e))
