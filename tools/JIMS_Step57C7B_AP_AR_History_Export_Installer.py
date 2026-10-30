#!/usr/bin/env python3
"""JIMS 57C7B: AP/AR sidebar segregation + authorized Excel history export.
Works on Codespaces already installed with Step57C5SN. Backend 57C7A already applied.
No changes to approval RPCs, payment posting, org assignment, or CV signed template.
"""
from pathlib import Path
from datetime import datetime,timezone
import re,subprocess,tempfile,sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
APP=ROOT/'app/src/App.jsx'
DEST=ROOT/'app/src/JIMSHistoryExports.jsx'
REMOTE='gui-patches/57C/JIMSHistoryExports.jsx'
DRY='--dry-run' in sys.argv
def stop(s):sys.exit('STOP: '+str(s))
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def one(s,anchor,label):
    c=s.count(anchor)
    if c!=1:stop(label+': expected one, found '+str(c)+'. No edits.')
def remote(path):
    try:return git('show','origin/'+BRANCH+':'+path)
    except Exception as exc:stop('Remote patch not available: '+str(exc))
if git('branch','--show-current').strip()!=BRANCH:stop('Wrong branch.')
if not APP.exists() or DEST.exists():stop('App absent or export component already installed.')
old=APP.read_text(encoding='utf-8')
if 'JIMS_STEP57C7B_AP_AR_EXPORTS' in old:stop('Step57C7B already installed.')
if 'JIMS_STEP_57C5S_MY_APPROVALS' not in old:stop('Step57C5SN must be installed first.')
component=remote(REMOTE)
for token in ('exceljs','jims_is_system_owner_v1','jims_owner_approval_history_export_v1',
              'jims_finance_ap_operational_history_export_v1','pv_history','petty_cash_history'):
    if token not in component:stop('Missing export component token: '+token)
if any(x in component for x in ('.insert(','.update(','.delete(','.upload(')):
    stop('Export must be read-only.')

new=old
import_rx=re.compile(r"(?m)^([ \t]*import[ \t]+PaymentVoucher[ \t]+from[ \t]+['\"]\./PaymentVoucher['\"];?[ \t]*)$")
m=list(import_rx.finditer(new))
if len(m)!=1:stop('PaymentVoucher App import ambiguous.')
h=m[0];new=new[:h.end()]+"\nimport JIMSHistoryExports from './JIMSHistoryExports'"+new[h.end():]

one(new,'function App()','App function')
guard="""// JIMS_STEP57C7B_AP_AR_EXPORTS — subdepartment-based AP visibility.
function jimsAPModuleAccess(p) {
  if(p?.is_active !== true) return false
  if(p.role === 'system_admin') return true // read-only oversight, no finance approvals
  return p.department === 'Finance' && ['executive','manager'].includes(p.role) &&
    (p.subdepartment == null || p.subdepartment === '' ||
      ['Accounts Payable','Accounting'].includes(p.subdepartment))
}
function jimsAPExcelAccess(p) {
  return p?.is_active === true && p.department === 'Finance' &&
    ['executive','manager'].includes(p.role) &&
    ['Accounts Payable','Accounting'].includes(p.subdepartment)
}

"""
new=new.replace('function App()',guard+'function App()',1)
state="  const [activePage, setActivePage] = useState('dashboard')"
one(new,state,'App activePage state')
logic="""
  const [jimsOwnerExportAllowed,setJimsOwnerExportAllowed] = useState(false)
  useEffect(()=>{
    let active=true
    async function checkOwner(){
      if(profile?.role!=='system_admin'||profile?.is_active!==true){
        if(active)setJimsOwnerExportAllowed(false)
        return
      }
      const {data,error:e}=await supabase.rpc('jims_is_system_owner_v1')
      if(active)setJimsOwnerExportAllowed(!e&&data===true)
    }
    void checkOwner()
    return ()=>{active=false}
  },[profile?.role,profile?.is_active])
"""
new=new.replace(state,state+logic,1)

# Module menu gating. HOD and FM preserve Petty Cash signing workflow.
for page,condition in (
    ('payment_voucher','jimsAPModuleAccess(profile)'),
    ('cash_voucher','(jimsAPModuleAccess(profile) || (profile?.is_active === true && profile?.role === "manager"))')
):
    needle="activePage === '"+page+"' ? 'nav-active' : ''"
    one(new,needle,page+' menu')
    i=new.index(needle)
    a=new.rfind('<button',0,i)
    b=new.find('</button>',i)
    if a<0 or b<0 or i-a>300 or b-i>1200:stop('Unexpected '+page+' nav button structure')
    b+=len('</button>')
    button=new[a:b]
    if "setActivePage('"+page+"')" not in button:stop('Not matching '+page+' click handler')
    new=new[:a]+'{'+condition+' && (\n              '+button+'\n              )}'+new[b:]

anchor='              {/* Step 46G: one financial-only Delegation section, reusable when Budgeting launches. */}'
one(new,anchor,'Finance submenu')
item="""              {(jimsAPExcelAccess(profile) || jimsOwnerExportAllowed) && (
                <button type="button"
                  className={'nav-item nav-subitem '+(activePage === 'history_exports' ? 'nav-active' : '')}
                  onClick={() => {
                    setActivePage('history_exports')
                    setEditingUser(null)
                    setResetUser(null)
                  }}>
                  {jimsOwnerExportAllowed ? 'History Exports (Owner)' : 'AP History Exports'}
                </button>
              )}
"""
new=new.replace(anchor,item+anchor,1)

route_rx=re.compile(r"\)\s*:\s*activePage\s*===\s*['\"]payment_voucher['\"]\s*\?\s*\(")
matches=list(route_rx.finditer(new))
if len(matches)!=1:stop('PV route ambiguous')
h=matches[0]
replacement=""") : activePage === 'history_exports' ? (
            (jimsAPExcelAccess(profile) || jimsOwnerExportAllowed) ? (
              <JIMSHistoryExports profile={profile} />
            ) : (
              <section className="panel"><h2>Access Restricted</h2>
                <p>Only AP / Accounting or designated System Owner.</p></section>
            )
          ) : activePage === 'payment_voucher' ? ("""
new=new[:h.start()]+replacement+new[h.end():]
title=": activePage === 'payment_voucher' ? 'Payment Voucher'"
one(new,title,'Page title')
new=new.replace(title,": activePage === 'history_exports' ? 'History Exports'\n                  "+title,1)

for token in ('JIMS_STEP_57C5S_MY_APPROVALS','JIMS_STEP_57C5SN_APPROVAL_BADGE',
              'jimsCanSeeMyApprovals','DelegationWorkspace','<PaymentVoucher',
              '<CashVoucher'):
    if new.count(token)!=old.count(token):stop('Protected workflow changed: '+token)
def rpc(s):return sorted(line.strip() for line in s.splitlines() if 'supabase.rpc(' in line)
if rpc(new)!=sorted(rpc(old)+["const {data,error:e}=await supabase.rpc('jims_is_system_owner_v1')"]):
    stop('Unexpected App RPC change.')
if new.count('JIMS_STEP57C7B_AP_AR_EXPORTS')!=1:stop('Duplicate installer marker')

if (ROOT/'app/node_modules/@babel/parser').is_dir():
    with tempfile.TemporaryDirectory(prefix='jims57c7_') as temp:
        f1=Path(temp)/'App.jsx';f2=Path(temp)/'JIMSHistoryExports.jsx'
        f1.write_text(new);f2.write_text(component)
        script="""const fs=require('fs'),p=require('@babel/parser');
        for(const f of process.argv.slice(1))
          p.parse(fs.readFileSync(f,'utf8'),{sourceType:'module',plugins:['jsx']});
        console.log('JIMS 57C7B JSX PARSER PASS');"""
        result=subprocess.run(['node','-e',script,str(f1),str(f2)],cwd=ROOT/'app',
                              capture_output=True,text=True)
        if result.returncode:stop('JSX error: '+result.stderr[-2500:])
        print(result.stdout.strip())
print('JIMS STEP57C7B '+('DRY RUN' if DRY else 'INSTALL'))
print('AP + Accounting can use AP modules and Excel history exports.')
print('AR + Strategic Finance: no AP module; manager approval still available.')
print('System Owner only: approval history export; no approvals granted.')
print('Finance Not Assigned: legacy workflow unchanged until System Admin assignment.')
if DRY:
    print('DRY RUN PASS — files unchanged.')
    sys.exit(0)
backup=ROOT/'app/gui-backups'/('57C7B_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'App.jsx').write_text(old)
try:
    APP.write_text(new)
    DEST.write_text(component)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP57C7B AP/AR ACCESS + XLSX HISTORY — BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    APP.write_text(old)
    DEST.unlink(missing_ok=True)
    stop('Build failed; original App restored: '+str(exc))
