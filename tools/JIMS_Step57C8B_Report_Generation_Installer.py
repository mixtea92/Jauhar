#!/usr/bin/env python3
"""JIMS 57C8B — One Report Generation page for PV, Payment Process and
supporting documents. Safe upgrade of installed Step57C7B History Exports.
Does NOT change approval UI, payment logic, credentials or database rules.

Codespaces:
  python3 /tmp/JIMS_57C8B.py --dry-run && python3 /tmp/JIMS_57C8B.py
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,tempfile,sys,shutil

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
APP=ROOT/'app/src/App.jsx'
PAGE=ROOT/'app/src/JIMSHistoryExports.jsx'
PKG=ROOT/'app/package.json'
LOCK=ROOT/'app/package-lock.json'
PATCH='gui-patches/57C/JIMS_Report_Generation_Single_Center.jsx'
DRY='--dry-run' in sys.argv
def stop(m):sys.exit('STOP: '+str(m))
def git(*a):return subprocess.check_output(['git',*a],cwd=ROOT,text=True)
def one(s,token,label):
  n=s.count(token)
  if n!=1:stop(label+' expected once; found '+str(n)+'. Files untouched.')
def remote(path):
  try:return git('show','origin/'+BRANCH+':'+path)
  except Exception as e:stop('Missing patch '+path+': '+str(e))

if git('branch','--show-current').strip()!=BRANCH:
  stop('Codespaces branch must be '+BRANCH)
for f in (APP,PAGE,PKG,LOCK):
  if not f.exists():stop('Missing installed file '+str(f))
app_old=APP.read_text()
page_old=PAGE.read_text()
pkg_old=PKG.read_bytes()
lock_old=LOCK.read_bytes()

if 'JIMS_STEP57C7B_AP_AR_EXPORTS' not in app_old:
  stop('Step57C7B AP/AR history export not installed. Do not bypass.')
if 'JIMS_STEP_57C5SN_APPROVAL_BADGE' not in app_old:
  stop('Existing My Approvals notification patch missing.')
if 'JIMS_STEP57C8B_REPORT_GENERATION' in app_old:
  stop('Already installed Report Generation. No duplicate.')
for key in ('jims_is_system_owner_v1',
            'jims_owner_approval_history_export_v1',
            'jims_finance_ap_operational_history_export_v1'):
  if key not in page_old:stop('Old History Exports baseline does not have '+key)

new_page=remote(PATCH)
for feature in ('jims_ap_report_document_manifest_v1',
      'jims_finance_ap_operational_history_export_v1',
      'jims_owner_approval_history_export_v1',
      'jims_is_system_owner_v1',
      "import('exceljs')","import('jszip')",
      "supabase.storage.from(f.bucket).download(f.storage_path)",
      "JR Meeting Records","Report Generation","maxFileCount"):
  if feature not in new_page:stop('Missing Report Generation capability '+feature)
if any(k in new_page for k in ('.insert(','.update(','.delete(','.upload(')):
  stop('Report Generation must not mutate financial data or storage')
if new_page.count("export default function JIMSHistoryExports(")!=1:
  stop('Page component API changed')

title_old=": activePage === 'history_exports' ? 'History Exports'"
menu_old="{jimsOwnerExportAllowed ? 'History Exports (Owner)' : 'AP History Exports'}"
one(app_old,title_old,'History Exports page title')
one(app_old,menu_old,'History Exports menu')
app_new=app_old.replace(title_old,": activePage === 'history_exports' ? 'Report Generation'",1)
app_new=app_new.replace(menu_old,"Report Generation",1)
# Only replace the menu label, not the component route or any permissions.
app_new=app_new.replace("  const [jimsOwnerExportAllowed,setJimsOwnerExportAllowed] = useState(false)",
"""  // JIMS_STEP57C8B_REPORT_GENERATION: shared report center, same role checks.
  const [jimsOwnerExportAllowed,setJimsOwnerExportAllowed] = useState(false)""",1)
if app_new.count('JIMS_STEP57C8B_REPORT_GENERATION')!=1:stop('Marker insertion failed')
for k in ('JIMS_STEP_57C5S_MY_APPROVALS',
          'JIMS_STEP_57C5SN_APPROVAL_BADGE',
          'JIMS_STEP57C7B_AP_AR_EXPORTS',
          'jimsAPExcelAccess(profile)',
          'jimsOwnerExportAllowed',
          '<PaymentVoucher','<CashVoucher',
          'JIMSHistoryExports profile={profile}'):
  if app_new.count(k)!=app_old.count(k):
    stop('Protected authority/navigation changed: '+k)
def app_rpc(s):
  return sorted(line.strip() for line in s.splitlines() if 'supabase.rpc(' in line)
if app_rpc(app_old)!=app_rpc(app_new):
  stop('An existing App RPC changed unexpectedly')

if (ROOT/'app/node_modules/@babel/parser').is_dir():
  with tempfile.TemporaryDirectory(prefix='jims57c8check_') as temp:
    af=Path(temp)/'App.jsx';pf=Path(temp)/'JIMSHistoryExports.jsx'
    af.write_text(app_new);pf.write_text(new_page)
    checker="""const fs=require('fs'),p=require('@babel/parser');
      for(const file of process.argv.slice(1))
       p.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']});
      console.log('JIMS 57C8B JSX PARSER PASS')"""
    result=subprocess.run(['node','-e',checker,str(af),str(pf)],
      cwd=ROOT/'app',capture_output=True,text=True)
    if result.returncode:stop('Preflight JSX failed: '+result.stderr[-2400:])
    print(result.stdout.strip())

print('JIMS STEP57C8B — '+('DRY RUN' if DRY else 'INSTALL'))
print('Single Report Generation menu, report-type selection, date/PV/branch filters.')
print('Registered supporting documents ZIP with invoice/proof/receipt/JR PDFs.')
print('JR offline meeting references as evidence-register Excel (not fake PDF).')
print('Approval History remains System Owner-only.')
print('No approval, payment, Petty Cash or delegation permissions changed.')
if DRY:
  print('DRY RUN PASS — no project files modified.')
  sys.exit(0)

backup=ROOT/'app/gui-backups'/('57C8B_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'App.jsx').write_text(app_old)
(backup/'JIMSHistoryExports.jsx').write_text(page_old)
(backup/'package.json').write_bytes(pkg_old)
(backup/'package-lock.json').write_bytes(lock_old)
try:
  APP.write_text(app_new)
  PAGE.write_text(new_page)
  # JSZip is a direct dependency, not an accidental transitive one.
  subprocess.run(['npm','install','jszip@3.10.1','--save','--no-audit','--no-fund'],
    cwd=ROOT/'app',check=True)
  subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
  print('JIMS STEP57C8B REPORT GENERATION — BUILD PASS')
  print('Backup:',backup)
except Exception as e:
  APP.write_text(app_old)
  PAGE.write_text(page_old)
  PKG.write_bytes(pkg_old)
  LOCK.write_bytes(lock_old)
  stop('Installer / build failed; existing files restored: '+str(e))
