#!/usr/bin/env python3
"""JIMS Step 57D2B — safe official PV PDF download installer.
- Applies ONE import and ONE guarded button to local PaymentVoucher.jsx.
- Adds a standalone renderer that calls an existing read-only Supabase snapshot.
- Installs PINNED pdfmake 0.2.23 (browser Unicode font embedding, PDF download).
- Strict dry-run: NO writes; JSX parser preflight + approval/payment guard.
- Real install: backup PV + package JSON/lock; rollback on failed npm/build.
No App/Calendar/Payment Process/Petty Cash/approval RPC changes.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,tempfile,json

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
PV=APP/'src/PaymentVoucher.jsx'
COMP=APP/'src/JIMS57D2OfficialPVDownload.jsx'
PACKAGE=APP/'package.json'
LOCK=APP/'package-lock.json'
BRANCH='jsync-gui-revamp-20261029'
SRC='gui-patches/57D/JIMS57D2OfficialPVDownload.jsx'
DRY='--dry-run' in sys.argv
MARKER='JIMS_STEP57D2_OFFICIAL_PV_PDF'
PDF_VERSION='0.2.23'

def stop(msg):
    sys.exit('STOP: '+str(msg)+' — no JIMS financial files changed.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def once(haystack,needle,label):
    n=haystack.count(needle)
    if n!=1:stop(label+' expected once but found '+str(n))

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong Codespaces branch')
if not PV.exists() or not PACKAGE.exists() or not LOCK.exists():
    stop('Missing Payment Voucher or package manifest')
if COMP.exists():stop('57D2 official PV renderer exists; no duplicate install')
old=PV.read_text(encoding='utf-8')
if MARKER in old:stop('Official PV download already installed')
manifest=json.loads(PACKAGE.read_text(encoding='utf-8'))
existing=manifest.get('dependencies',{}).get('pdfmake')
if existing and existing!=PDF_VERSION:
    stop('Different pdfmake dependency already installed: '+existing+
      '. Review before upgrading.')
component=git('show','origin/'+BRANCH+':'+SRC)
required=(
  'export default function JIMS57D2OfficialPVDownload',
  'jims_57d2_official_pv_snapshot_v1',
  "voucher.status!=='fully_approved'",
  "import('pdfmake/build/pdfmake')",
  "import('pdfmake/build/vfs_fonts')",
  "data?.voucher?.id!==voucher.id",
  "Math.abs(approved-paid-remaining)>0.011",
  "ACTUAL APPROVAL HISTORY",
  "ACTUAL PAYMENT HISTORY",
  "Only installments with status Paid",
  "pdfMake.createPdf(definition).download",
)
for needle in required:
    if needle not in component:stop('PDF component missing '+needle)
if any(x in component for x in ('.insert(','.update(','.upsert(','.delete(','.upload(')):
    stop('PDF component must be read-only')

anchor='<div className="pv-section">PAYMENT VOUCHER DETAILS</div>'
once(old,anchor,'PV detail placement')
for token in (
  'pv_approval_actions','pv_payment_transactions','PaymentTrackingPanel',
  'supabase.rpc(', 'payment_vouchers','setViewingVoucher',
  'pv_invoice_documents','approvalHistory','refreshApprovalHistory',
  'JIMS_STEP57D4_Duplicate_Invoice_UI', 'jims_57d4_preflight_submit_v1',
  'onClick={submitAndVerify}', 'onClick={closeVoucherOverview}',
  'payment_mode','payment_status','viewLines','jauhar_my_active_delegations_v1'
):
    if token not in old:stop('Expected existing PV feature missing '+token)

new="import JIMS57D2OfficialPVDownload from './JIMS57D2OfficialPVDownload'\n"+old
new=new.replace(anchor,
  '/*PLACEHOLDER*/'+anchor,1)
new=new.replace('/*PLACEHOLDER*/',
  ' {/* '+MARKER+' — official read-only approved PV PDF */}\n'
  '             <JIMS57D2OfficialPVDownload voucher={viewingVoucher} />\n'
  '             ',1)

for token in (
  'pv_approval_actions','pv_payment_transactions','PaymentTrackingPanel',
  'supabase.rpc(', 'payment_vouchers','setViewingVoucher',
  'pv_invoice_documents','approvalHistory','refreshApprovalHistory',
  'JIMS_STEP57D4_Duplicate_Invoice_UI','jims_57d4_preflight_submit_v1',
  'onClick={submitAndVerify}', 'onClick={closeVoucherOverview}',
  'payment_mode','payment_status','viewLines','jauhar_my_active_delegations_v1'
):
    if old.count(token)!=new.count(token):
        stop('Protected PV feature altered unexpectedly: '+token)
if new.count(MARKER)!=1 or new.count('<JIMS57D2OfficialPVDownload')!=1:
    stop('Official PV component mount missing/duplicated')

# Syntax check candidate React components before any local file is modified.
with tempfile.TemporaryDirectory(prefix='jims_57d2_pdf_') as td:
    t=Path(td)
    files=[]
    for name,data in [('PaymentVoucher.jsx',new),('JIMS57D2OfficialPVDownload.jsx',component)]:
        file=t/name
        file.write_text(data,encoding='utf-8')
        files.append(str(file))
    js=(
      "const fs=require('node:fs');"
      "import('vite').then(async({transformWithOxc})=>{"
      "for(const f of process.argv.slice(1))"
      "await transformWithOxc(fs.readFileSync(f,'utf8'),f);"
      "console.log('JIMS 57D2 JSX PARSER PASS');"
      "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    p=subprocess.run(['node','-e',js,*files],cwd=APP,capture_output=True,text=True)
    if p.returncode!=0:
        stop('Official PV JSX preflight failed: '+(p.stderr or p.stdout)[-1800:])
    print(p.stdout.strip())

print('JIMS 57D2 Official PV PDF SAFE UI ANCHORS PASS')
print('Read-only approved PV; approval + actual full/partial payment history.')
print('Finance & approval/payment logic unchanged.')
if DRY:
    print('JIMS 57D2 DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D2_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
original_package=PACKAGE.read_bytes()
original_lock=LOCK.read_bytes()
(backup/'PaymentVoucher.jsx').write_text(old,encoding='utf-8')
(backup/'package.json').write_bytes(original_package)
(backup/'package-lock.json').write_bytes(original_lock)
try:
    COMP.write_text(component,encoding='utf-8')
    PV.write_text(new,encoding='utf-8')
    if not existing:
        subprocess.run([
          'npm','install','--save-exact','pdfmake@'+PDF_VERSION,
          '--no-audit','--no-fund'
        ],cwd=APP,check=True)
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D2 BUILD PASS')
    print('Backup:',backup)
except Exception as e:
    PV.write_text(old,encoding='utf-8')
    COMP.unlink(missing_ok=True)
    PACKAGE.write_bytes(original_package)
    LOCK.write_bytes(original_lock)
    sys.exit('STOP: dependency/build failed; restored PV and package manifests: '+str(e))
