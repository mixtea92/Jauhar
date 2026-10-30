#!/usr/bin/env python3
"""JIMS Step57D1T: conflict-safe TARGETED install of Petty Cash number/metadata UI.
Works with the actual locally modified CashVoucher.jsx. Never replaces the whole
component with a remote snapshot. Fails before writes if a required anchor is absent.
"""
from pathlib import Path
from datetime import datetime, timezone
import re
import subprocess
import sys
import tempfile

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
CASH=APP/'src/CashVoucher.jsx'
REPORT=APP/'src/JIMSHistoryExports.jsx'
BRANCH='jsync-gui-revamp-20261029'
REMOTE='gui-patches/57D/JIMS_CashVoucher_57D1_PettyCash_Number_Metadata.jsx'
DRY='--dry-run' in sys.argv

def stop(reason):
    sys.exit('STOP: '+reason)
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def exactly(s,token,name):
    n=s.count(token)
    if n!=1:
        stop(name+' anchor expected once; found '+str(n)+'. No project files changed.')
def extract(s,start,end,name):
    exactly(s,start,name+' start')
    i=s.index(start)
    j=s.find(end,i+len(start))
    if j<0:stop('Missing '+name+' end anchor')
    return s[i:j]
def insert_before(s,anchor,addition,label):
    exactly(s,anchor,label)
    if addition.strip() in s:
        stop(label+' appears partially installed; review manually')
    return s.replace(anchor,addition+anchor,1)
def insert_after(s,anchor,addition,label):
    exactly(s,anchor,label)
    if addition.strip() in s:
        stop(label+' appears partially installed; review manually')
    return s.replace(anchor,anchor+addition,1)
def cosmetic(s,old,new):
    # Some older JIMS GUI installers already renamed these labels.
    if old in s:
        return s.replace(old,new,1)
    return s

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch. Expected '+BRANCH)
if not CASH.is_file() or not REPORT.is_file():
    stop('CashVoucher.jsx / JIMSHistoryExports.jsx missing')

old=CASH.read_text(encoding='utf-8')
old_report=REPORT.read_text(encoding='utf-8')
if 'JIMS_STEP57D1_PC_MONTHLY_REVISION_AND_METADATA' in old:
    stop('Step57D1 metadata patch already present; nothing overwritten')
if 'Report Generation' not in old_report:
    stop('57C8B Report Generation is not installed')
source=git('show','origin/'+BRANCH+':'+REMOTE)
for required in ('jims_pc_number_status_v1','jims_pc_set_next_revision_v1',
                 'charge_subdepartment','charge_cost_center',
                 'JIMS_STEP57D1_PC_MONTHLY_REVISION_AND_METADATA'):
    if required not in source:stop('Remote patch missing '+required)

s=old
# Import must remain at top; this is a new read-only constant, not a business RPC.
s=insert_after(s,"import { supabase } from './lib/supabase'",
               "\nimport { JSYNC_SUBDEPARTMENTS } from './UserOrganizationAssignment'",
               'Sub-Department import')

# Extract the EXACT helper definitions from the new JIMS patch.
helper=extract(source,'// JIMS_STEP57D1_PC_MONTHLY_REVISION_AND_METADATA',
               '\nfunction SignaturePad(', 'PC allocation helpers')
s=insert_before(s,'function SignaturePad(',helper+'\n','PC helper injection')

# Preserve any existing AP authorization constraints, then additionally restrict
# classified AR/Strategic Finance. Do not rebuild the isAP condition.
ap_rx=re.compile(r'(?m)^([ \t]*const isAP=)([^\n]+)$')
found=list(ap_rx.finditer(s))
if len(found)!=1:stop('Could not identify one existing AP condition')
ap=found[0]
if 'isActiveAPUnit(profile)' in ap.group(2):
    stop('AP condition already patched but marker missing')
s=s[:ap.start()]+ap.group(1)+'('+ap.group(2)+') && isActiveAPUnit(profile)'+s[ap.end():]

# New hooks are inserted after existing filters, ahead of side effects.
state=extract(source,'  const [pcNumberStatus,setPcNumberStatus]=useState(null)',
              '\n  useEffect(()=>{\n    let live=true\n    const get=async()=>', 'PC numbering status state/hooks')
s=insert_after(s,"  const [filter,setFilter]=useState('all')",
               '\n'+state,'PC numbering hooks')

# Revision controls: admin-only RPC, no approval powers.
revision=extract(source,'  async function advancePCRevision(){',
                 '\n  async function action(', 'revision handler')
s=insert_before(s,'  async function action(',revision+'\n','revision handler insertion')

# Reset subdepartment when the charged department changes.
setfield="  function setField(key,value){setForm(f=>({...f,[key]:value}))}"
setfield_new="  function setField(key,value){setForm(f=>({...f,[key]:value,...(key==='department'?{charge_subdepartment:''}:{})}))}"
if setfield in s:
    s=s.replace(setfield,setfield_new,1)
else:
    # Keep custom field handlers. On every PC form's Department selection the
    # JSX below uses this explicit wrapper; no replacement of custom handler.
    if "function setField(" not in s:
        stop('Existing field setter missing')
    setter="""  function setChargeDepartment(value){
    setField('department',value)
    setField('charge_subdepartment','')
  }
"""
    s=insert_before(s,'  function setLine(',setter,'custom department setter')
    # The existing D16 field helper will be replaced below with the standard
    # JSX from 57D1, to ensure the clearing handler is actually invoked.
    departmentField="{field('Department / Applicable HOD (D16)','department','text',CV_DEPARTMENTS)}"
    exactly(s,departmentField,'D16 department field')
    customField="""<label style={{display:'flex',flexDirection:'column',gap:5,fontSize:13}}>
          <span>Department / Applicable HOD (D16)</span>
          <select style={inputStyle} value={form.department||''}
            onChange={e=>setChargeDepartment(e.target.value)}>
            <option value="">— Select Department —</option>
            {selectOptions(CV_DEPARTMENTS)}
          </select>
        </label>"""
    s=s.replace(departmentField,customField,1)

# Mandatory metadata fields (the Excel template itself remains untouched).
branchField="{field('Branch (D17)','branch','text',CV_BRANCHES)}"
requiredFields=extract(source,
    '        <label style={{display:\'flex\',flexDirection:\'column\',gap:5,fontSize:13}}>\n          <span>Charge Sub-Department (JIMS Metadata) *',
    "        {field('Claim Category (G13)','claim_category','text',CV_CLAIM_CATEGORIES)}",
    'metadata JSX form fields')
s=insert_after(s,branchField,'\n'+requiredFields.rstrip('\n'),'Sub-Department and Cost Center dropdowns')

# Only new PC numbers demand the new allocation before first submission.
submission=extract(source,
    "    if(v.cv_number?.startsWith('PC/')&&(!v.form_data?.charge_subdepartment||!v.form_data?.charge_cost_center)){",
    "    if(!window.confirm(",'PC submission allocation guard')
submit_rx=re.compile(r'(?m)^  async function submitCV\(v\)\{')
if len(list(submit_rx.finditer(s)))!=1:
    stop('Expected one submitCV function')
submit_start=s.index('  async function submitCV(v){')
confirm_pos=s.find('    if(!window.confirm(',submit_start)
if confirm_pos<0 or confirm_pos-submit_start>950:
    stop('Cannot find submission confirmation after submitCV')
if "v.form_data?.charge_subdepartment" in s[submit_start:confirm_pos]:
    stop('PC submit guard exists but patch marker missing')
s=s[:confirm_pos]+submission+s[confirm_pos:]

# Dashboard summary is a reliable placement irrespective of user-specific headings.
revUI=extract(source,'      {pcNumberStatus&&<p className="muted"',
   "      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:10,margin:'18px 0'}}>",
   'PC revision information')
home_rx=re.compile(r"mode==='home'&&<>")
if len(list(home_rx.finditer(s)))!=1:
    stop('Cannot uniquely identify Petty Cash home page')
home=s.index("mode==='home'&&<>")
summary="      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:10,margin:'18px 0'}}>"
at=s.find(summary,home)
if at<0 or at-home>1300:
    stop('Cannot identify dashboard summary section')
s=s[:at]+revUI+s[at:]

# Basic read-only explanation on the draft creation page.
formTitle=extract(source,
   "      <h3>{editingId?'Edit Petty Cash Draft':'New Petty Cash'}</h3>",
   "      <p>Enter the same fields as the official XLSX.", 'PC form title')
# Retain custom screen title but put the new explanatory note before form fields.
s=insert_before(s,"      <p>Enter the same fields as the official XLSX.",
   '      <p className="muted">PC number is system-generated on the first Draft save and cannot be edited.</p>\n',
   'PC non-editable number explanation')

s=insert_before(s,"      <p>Payment Method (G17:I17): <strong>Cash (Petty Cash)</strong></p>",
 '      <p className="muted">Charge Sub-Department and Cost Center are stored in JIMS private metadata, without changing the original one-page Excel.</p>\n',
 'allocation metadata explanation')

# Show the selected allocation in the record detail, if this standard markup is in place.
detail="['Department',selected.applicable_department],"
once=old.count(detail)
if once==1 and 'Charge Cost Center' not in s[s.index(detail):s.index(detail)+300]:
    s=s.replace(detail,detail+
      "['Charge Sub-Department',selected.form_data?.charge_subdepartment],"+
      "['Charge Cost Center',selected.form_data?.charge_cost_center],",1)

# Cosmetic labels are non-critical and may already be customized by the user.
for a,b in (
 ('Cash Voucher (Petty Cash)</h2>','Petty Cash</h2>'),
 ('+ New Cash Voucher</button>','+ New Petty Cash</button>'),
 ('<h3>Cash Voucher Records</h3>','<h3>Petty Cash Records</h3>'),
 ("'CV Number','Claimant','Department'","'PC / Legacy CV Number','Claimant','Department'"),
 ("{editingId?'Edit Cash Voucher Draft':'New Cash Voucher'}",
  "{editingId?'Edit Petty Cash Draft':'New Petty Cash'}")
):
    s=cosmetic(s,a,b)

# Patch Excel columns without changing the report engine or owner approval exports.
oldcol="['cost_center','Cost Center'],['claimant','Claimant'],['amount','Amount (RM)'],"
newcol="['cost_center','Cost Center'],['charge_subdepartment','Charge Sub-Department'],['requester_department','Requester Department'],['requester_subdepartment','Requester Sub-Department'],['requester_cost_center','Requester Cost Center'],['claimant','Claimant'],['amount','Amount (RM)'],"
if oldcol in old_report and old_report.count(oldcol)==1:
    new_report=old_report.replace(oldcol,newcol,1)
elif newcol in old_report:
    new_report=old_report
else:
    stop('Report Generation Petty Cash columns differ from known format; refusing an unsafe export change')

# Never alter existing submit/signing/storage/payment handlers except the new
# pre-submit allocation check, and never delete a workflow occurrence.
protected=('jsync_cv_save_draft_v1','jsync_cv_submit_v1',
           'jsync_cv_approve_many_v1','jsync_cv_attach_receipt_v1',
           'downloadSignedCVExcel','SignaturePad','captureSignedCVSignatures',
           'cash_voucher_approvals','cash_voucher_receipts','isMobileUpload')
for token in protected:
    if old.count(token)!=s.count(token):
        stop('Protected Cash Voucher workflow changed: '+token)
for token in ('jims_pc_number_status_v1','jims_pc_set_next_revision_v1',
              'charge_subdepartment','charge_cost_center',
              'JIMS_STEP57D1_PC_MONTHLY_REVISION_AND_METADATA'):
    if token not in s:
        stop('Required Petty Cash feature missing: '+token)
if s.count('JIMS_STEP57D1_PC_MONTHLY_REVISION_AND_METADATA')!=1:
    stop('PC targeted patch duplicated')

if (APP/'node_modules/@babel/parser').is_dir():
    with tempfile.TemporaryDirectory(prefix='jims57d1tcheck_') as temp:
        p1=Path(temp)/'CashVoucher.jsx'
        p2=Path(temp)/'JIMSHistoryExports.jsx'
        p1.write_text(s)
        p2.write_text(new_report)
        checker="""const fs=require('fs'),p=require('@babel/parser');
          for(const file of process.argv.slice(1))
            p.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']});
          console.log('JIMS 57D1 TARGETED JSX PARSER PASS')"""
        out=subprocess.run(['node','-e',checker,str(p1),str(p2)],
          cwd=APP,capture_output=True,text=True)
        if out.returncode:stop('JSX parser failed (files unchanged): '+out.stderr[-2400:])
        print(out.stdout.strip())

print('JIMS 57D1 TARGETED PATCH — '+('DRY RUN' if DRY else 'INSTALL'))
print('Existing local Petty Cash code retained; only guarded PC numbering/metadata features added.')
print('No PV / delegation / approvals / receipts logic overwritten.')
if DRY:
    print('DRY RUN PASS — existing files unchanged.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D1T_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'CashVoucher.jsx').write_text(old)
(backup/'JIMSHistoryExports.jsx').write_text(old_report)
try:
    CASH.write_text(s)
    REPORT.write_text(new_report)
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D1 TARGETED PETTY CASH — BUILD PASS')
    print('Backup:',backup)
except Exception as e:
    CASH.write_text(old)
    REPORT.write_text(old_report)
    stop('Build failed; original project files restored: '+str(e))
