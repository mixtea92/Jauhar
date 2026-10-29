#!/usr/bin/env python3
"""JIMS 51H GUI-only: action-count badges, PV/CV/Payment history.
Exact-baseline safeguards, backup, build and rollback.
NEVER changes PaymentTrackingPanel, Supabase, business logic or statuses.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
APP=ROOT/'app/src/App.jsx'
PV=ROOT/'app/src/PaymentVoucher.jsx'
CV=ROOT/'app/src/CashVoucher.jsx'
TRACK=ROOT/'app/src/payment/PaymentTrackingPanel.jsx'
BADGES=ROOT/'app/src/jimsActionNotifications.js'
STYLE=ROOT/'app/src/JIMSActionHistory.css'
DRY='--dry-run' in sys.argv

def stop(message): sys.exit('STOP: '+str(message))
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(name):
    try: return git('show','origin/'+BRANCH+':'+name)
    except Exception as e: stop('Fetch missing '+name+'. Run git fetch first. '+str(e))
def once(s,old,new,label):
    n=s.count(old)
    if n!=1: stop(label+' expected exactly one unique anchor; found '+str(n))
    return s.replace(old,new,1)

if git('branch','--show-current').strip()!=BRANCH: stop('Wrong branch '+BRANCH)
for f in (APP,PV,CV,TRACK):
    if not f.is_file(): stop('Protected source missing: '+str(f))
if BADGES.exists() or STYLE.exists(): stop('51H theme already exists; no overwrite.')

old_app,old_pv,old_cv=[f.read_text() for f in (APP,PV,CV)]
if old_pv.strip()!=remote('gui-patches/51UI/PaymentVoucher.jsx').strip():
    stop('Local PV differs from Step 51UI baseline. No overwrite.')
if old_cv.strip()!=remote('app/src/CashVoucher.jsx').strip():
    stop('Local CV differs from protected baseline. No overwrite.')
for token in ("import './JIMSUnifiedDarkV1.css'",
              "import './JIMSPaymentSeparation.css'",
              'jims-finance-theme','dashboardSection="payment"'):
    if token not in old_app: stop('Required 50E/51UI setup missing: '+token)
if 'JIMSActionHistory.css' in old_app: stop('51H may already be installed.')

new_pv=remote('gui-patches/51H/PaymentVoucher.jsx')
new_cv=remote('gui-patches/51H/CashVoucher.jsx')
new_js=remote('gui-patches/51H/jimsActionNotifications.js')
new_css=remote('gui-patches/51H/JIMSActionHistory.css')
for token in ('PV History','Payment History','jims-history-section'):
    if token not in new_pv: stop('PV history patch incomplete.')
for token in ('CV History','historyRows','jims-inline-notification'):
    if token not in new_cv: stop('CV history patch incomplete.')
for token in ('jauhar_my_approval_queues_v1','cash_voucher_approvals','payment_initiation_manager_decision'):
    if token not in new_js: stop('Action-only counter module incomplete.')
if '.jims-nav-notification' not in new_css: stop('New CSS is incomplete.')
def rpc_lines(s): return sorted(line.strip() for line in s.splitlines() if '.rpc(' in line)
if rpc_lines(old_pv)!=rpc_lines(new_pv) or rpc_lines(old_cv)!=rpc_lines(new_cv):
    stop('PV/CV RPC integration changed. No modifications allowed.')
if old_pv.count('<PaymentTrackingPanel')!=new_pv.count('<PaymentTrackingPanel'):
    stop('Protected PaymentTrackingPanel mount changed.')
if 'initiate_pv_payment_v1' not in TRACK.read_text():
    stop('Protected Full Payment engine missing.')

new_app=once(old_app,"import './JIMSPaymentSeparation.css'",
    "import './JIMSPaymentSeparation.css'\n"
    "import './JIMSActionHistory.css'\n"
    "import {fetchJIMSActionNotifications} from './jimsActionNotifications'",
    'notification imports')
new_app=once(new_app,
    "  const [activePage, setActivePage] = useState('dashboard')",
    "  const [activePage, setActivePage] = useState('dashboard')\n"
    "  const [jimsActionCounts,setJimsActionCounts] = useState({pv:undefined,payment:undefined,cv:undefined})",
    'action state')
effect="""  // Step 51H: action-only notification numbers, read under current user RLS.
  useEffect(() => {
    if (!profile || profile.role === 'non_executive') return
    let alive = true
    const refreshActions = () => {
      fetchJIMSActionNotifications(profile)
        .then(counts => {if(alive) setJimsActionCounts(counts)})
        .catch(() => {if(alive) setJimsActionCounts({pv:null,payment:null,cv:null})})
    }
    refreshActions()
    window.addEventListener('focus',refreshActions)
    const poll=window.setInterval(refreshActions,120000)
    return () => {
      alive=false
      window.removeEventListener('focus',refreshActions)
      window.clearInterval(poll)
    }
  },[profile?.role,profile?.department,profile?.username,profile?.is_active,activePage])

"""
new_app=once(new_app,'  async function handleLogin(e) {',effect+'  async function handleLogin(e) {','notification effect')
new_app=once(new_app,
    "className={`nav-item nav-subitem ${\n                  activePage === 'payment_voucher' ? 'nav-active' : ''\n                }`}",
    "className={`nav-item nav-subitem jims-action-nav ${\n                  activePage === 'payment_voucher' ? 'nav-active' : ''\n                }`}",
    'PV nav class')
new_app=once(new_app,
    "className={`nav-item nav-subitem ${activePage === 'payment_process' ? 'nav-active' : ''}`}",
    "className={`nav-item nav-subitem jims-action-nav ${activePage === 'payment_process' ? 'nav-active' : ''}`}",
    'Payment nav class')
new_app=once(new_app,
    "className={`nav-item nav-subitem ${activePage === 'cash_voucher' ? 'nav-active' : ''}`}",
    "className={`nav-item nav-subitem jims-action-nav ${activePage === 'cash_voucher' ? 'nav-active' : ''}`}",
    'CV nav class')
for title,key in (('Payment Voucher','pv'),('Payment Process','payment'),('Cash Voucher','cv')):
    original='                '+title+'\n              </button>'
    replacement='                '+title+'''
                {jimsActionCounts.'''+key+''' > 0 ? (
                  <span className="jims-nav-notification" aria-label={jimsActionCounts.'''+key+'''+ ' outstanding actions'}>{jimsActionCounts.'''+key+'''}</span>
                ) : jimsActionCounts.'''+key+''' === null ? (
                  <span className="jims-nav-notification" title="Action count unavailable">—</span>
                ) : null}
              </button>'''
    new_app=once(new_app,original,replacement,title+' action badge')
if new_app.count("setActivePage('payment_process')")!=old_app.count("setActivePage('payment_process')"):
    stop('Payment Process callback changed.')

print('JIMS STEP 51H —', 'DRY RUN' if DRY else 'INSTALL')
print('PV: Action Queue above, PV History below (Approved / Rejected)')
print('Payment: Active payments above, Paid History below')
print('CV: Active work above, Closed CV History below')
print('Sidebar badges: only role-specific outstanding actions, not total records')
print('Protected: PV/CV workflows, original payment RPCs, Supabase, login, delegation')
if DRY:
    print('DRY RUN PASS — no files changed.')
    sys.exit(0)

original={APP:old_app,PV:old_pv,CV:old_cv}
backup=ROOT/('app/gui-backups/51H_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
for f,c in original.items(): (backup/f.name).write_text(c)
created=[]
try:
    with BADGES.open('x') as f: f.write(new_js)
    created.append(BADGES)
    with STYLE.open('x') as f: f.write(new_css)
    created.append(STYLE)
    APP.write_text(new_app)
    PV.write_text(new_pv)
    CV.write_text(new_cv)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 51H INSTALLED — BUILD PASS')
    print('Backups:',backup)
except Exception as e:
    for f,c in original.items(): f.write_text(c)
    for f in created: f.unlink(missing_ok=True)
    stop('Build/install failed, originals restored: '+str(e))
