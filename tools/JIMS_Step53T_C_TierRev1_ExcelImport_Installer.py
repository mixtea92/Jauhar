#!/usr/bin/env python3
"""JIMS Step 53T-C: Revision 1 Tier descriptors, authority UI, optional Excel import.
Compatible with manually installed 51M and optional 52N.
PV/JR front-end ONLY; no existing backend function or approval handler is edited.
Requires Supabase migrations 53T-A and 53T-B to be installed (done).
Backs up, builds, rolls back atomically upon any failure.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PV=ROOT/'app/src/PaymentVoucher.jsx'
JR=ROOT/'app/src/jr/JRPanel.jsx'
DRY='--dry-run' in sys.argv

def fail(message): sys.exit('STOP: '+str(message))
def one(src,old,new,label):
    n=src.count(old)
    if n!=1: fail(label+' expected 1 match but saw '+str(n)+'. No files modified.')
    return src.replace(old,new,1)
def many(src,old,new,count,label):
    n=src.count(old)
    if n!=count: fail(label+' expected '+str(count)+' matches, saw '+str(n)+'.')
    return src.replace(old,new)
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)

if git('branch','--show-current').strip()!=BRANCH:
    fail('Wrong Codespaces branch: '+BRANCH)
for p in (PV,JR):
    if not p.is_file(): fail('Missing protected component: '+str(p))
orig_pv=PV.read_text()
orig_jr=JR.read_text()
if 'Two options: Manual Entry or Excel Import.' not in orig_pv:
    fail('Step 51M manual/optional Excel entry must be installed first.')
if 'PV History' not in orig_pv and 'Payment Process Dashboard' not in orig_pv:
    fail('Step 51UI financial navigation appears missing.')
if 'JIMS Tier Revision 1' in orig_pv:
    fail('Tier Rev1 frontend patch may already be installed.')
if orig_jr.count("const finalRole = ['T03','T07'].includes(voucher.financial_tier) ? 'ceo':'bod'")!=1:
    fail('JRPanel differs from the protected baseline. Nothing changed.')

pv=orig_pv
labels={
"T01: { label: 'Fixed / recurring (budgeted)', approver: 'Finance Manager', jr: false },":
"T01: { label: 'Fixed / Recurring Monthly Payments', approver: 'Finance Manager', jr: false },",
"T02: { label: 'Variable within budget < RM10,000', approver: 'Finance Manager', jr: false },":
"T02: { label: 'Non-Fixed within approved budget <= RM10,000', approver: 'Finance Manager', jr: false },",
"T03: { label: 'Variable exceeds budget <= RM10,000', approver: 'CEO', jr: true },":
"T03: { label: 'Non-Fixed exceeds approved budget <= RM10,000', approver: 'CEO', jr: true },",
"T04: { label: 'Variable within budget > RM10,000', approver: 'CEO', jr: false },":
"T04: { label: 'Non-Fixed within approved budget > RM10,000', approver: 'CEO', jr: false },",
"T05: { label: 'Variable exceeds budget > RM10,000', approver: 'BOD', jr: true },":
"T05: { label: 'Non-Fixed exceeds approved budget > RM10,000', approver: 'BOD', jr: true },",
"T06: { label: 'Unbudgeted > RM1,000', approver: 'BOD', jr: true },":
"T06: { label: 'Unbudgeted amount <= RM1,000', approver: 'CEO', jr: true },",
"T07: { label: 'Unbudgeted <= RM1,000', approver: 'CEO', jr: true },":
"T07: { label: 'Unbudgeted amount > RM1,000', approver: 'BOD', jr: true },",
"T08: { label: 'Payroll within budget (pilot; amount limit pending Finance)', approver: 'BOD', jr: false },":
"T08: { label: 'Payroll within approved baseline', approver: 'BOD', jr: false },",
"T09: { label: 'Payroll exceeds approved budget (amount pending Finance)', approver: 'BOD', jr: true }":
"T09: { label: 'Payroll exceeds approved baseline', approver: 'BOD', jr: true }",
}
for old,new in labels.items():
    pv=one(pv,old,new,'New tier description')

pv=one(pv,
  "const JR_FINAL_CEO = ['T03','T07']",
  "const JR_FINAL_CEO = ['T03','T06']", 'CEO mapping')
pv=one(pv,
  "const JR_FINAL_BOD = ['T05','T06','T09']",
  "const JR_FINAL_BOD = ['T05','T07','T09']", 'BOD mapping')

# Preserve historical T06/T07 FINAL AUTHORITY on old PVs using the nullable
# jims_tier_policy_version introduced in migration 53T-A.
helpers="""// JIMS Tier Revision 1. NULL policy version means historical authority.
function isJRFinalCEO(v) {
  const t=v?.financial_tier
  return t==='T03' || (t==='T06' && v?.jims_tier_policy_version==='R1')
    || (t==='T07' && v?.jims_tier_policy_version!=='R1')
}
function isJRFinalBOD(v) {
  const t=v?.financial_tier
  return t==='T05' || t==='T09'
    || (t==='T07' && v?.jims_tier_policy_version==='R1')
    || (t==='T06' && v?.jims_tier_policy_version!=='R1')
}
function isCEOFinalTier(v) {
  return v?.financial_tier==='T04' || isJRFinalCEO(v)
}

"""
pv=one(pv,
  "const DEFAULT_INVOICE_LINES = 5",
  helpers+"const DEFAULT_INVOICE_LINES = 5",'Versioned authority helpers')
pv=many(pv,"['T03','T04','T07'].includes(v.financial_tier)",
  "isCEOFinalTier(v)",2,'CEO approval final stage UI')
for owner in ('voucher','v','viewingVoucher'):
    old='JR_FINAL_BOD.includes('+owner+'.financial_tier)'
    if pv.count(old)>0: pv=pv.replace(old,'isJRFinalBOD('+owner+')')
for owner in ('voucher','v','viewingVoucher'):
    old='JR_FINAL_CEO.includes('+owner+'.financial_tier)'
    if pv.count(old)>0: pv=pv.replace(old,'isJRFinalCEO('+owner+')')
if '.includes(v.financial_tier)' in pv[pv.find('function isJRFinalCEO'):pv.find('const DEFAULT_INVOICE_LINES')]:
    fail('Helper injection unexpectedly malformed')

# This is FORM revision 0001, NOT an authority/RPC version.
pv=one(pv,
  "const REQUIRED_TEMPLATE_REVISION = '0000'",
  "const REQUIRED_TEMPLATE_REVISION = '0001'",'Default new PV revision')
pv=one(pv,
  "if (workspaceMode === 'new' && form.template_version !== REQUIRED_TEMPLATE_REVISION) {",
  "if (workspaceMode === 'new' && !['0000','0001'].includes(form.template_version)) {",
  'Permit both official Excel template revisions')
pv=one(pv,
  "data.source_template_version !== REQUIRED_TEMPLATE_REVISION",
  "data.source_template_version !== form.template_version",
  'Confirm actual saved workbook revision')
old_create_rpc=(
    "supabase.rpc('create_pv_draft_v5', {"
    if "supabase.rpc('create_pv_draft_v5', {" in pv
    else "supabase.rpc('create_pv_draft_v4', {"
)
pv=one(pv,old_create_rpc,"supabase.rpc('create_pv_draft_v6', {",
       'Upgrade New PV creator to revision-aware v6')

# Add a dedicated reader for new one-sheet PV (T-Digital) workbook.
reader="""// Revision 1 official form: sheet 'PV (T-Digital)', cells E13..E23,
// tier L10, invoice rows 26..35, subtotals L36/L37/L38.
function parseRevisionOneWorkbook(sheet) {
  const lines=Array.from({length:10},(_,index)=>{
    const row=26+index
    const amount=cellText(sheet,'L'+row)
    return {
      invoice_reference:cellText(sheet,'C'+row),
      description:cellText(sheet,'F'+row),
      gl_code:cellText(sheet,'J'+row),
      amount:amount ? parseAmount(amount) : ''
    }
  })
  const check=(cell)=>/[☑✓✔xX]/.test(cellText(sheet,cell))
  const branch=cellText(sheet,'E17').replace(/^JMC[_ -]?/i,'').trim().toUpperCase()
  return {
    ...blankForm(),
    template_version:'0001',
    financial_tier:readFinancialTier(cellText(sheet,'L10')),
    payee_name:cellText(sheet,'E13'),
    supplier_code:cellText(sheet,'E14'),
    supplier_tin:'',
    bank_name:cellText(sheet,'E15'),
    bank_account_no:cellText(sheet,'E16'),
    branch_department:chooseValue(branch,choices.branch),
    payment_method:chooseValue(cellText(sheet,'E19'),choices.method),
    payment_type:chooseValue(cellText(sheet,'E21'),choices.type),
    expense_nature:chooseValue(cellText(sheet,'E22'),choices.nature),
    budget_classification:chooseValue(cellText(sheet,'E23'),choices.budget),
    lines,
    sst_amount:parseAmount(cellText(sheet,'L37'))||'0',
    supporting_types:[
      check('B40')&&'Invoice',
      check('E40')&&'Quotation',
      check('H40')&&'Payment Request Form',
      check('K40')&&'Other'
    ].filter(Boolean),
    supporting_other_text:'',
    remarks:'',
    // Official PV number and payment date are always generated/tracked by JIMS.
    source_voucher_no:'',
    source_pv_date:'',
    imported_transaction_no:cellText(sheet,'E20'),
    imported_payment_date:dateToIso(cellText(sheet,'L20'))
  }
}

"""
pv=one(pv,"function validateImportedPV(form) {",
  reader+"function validateImportedPV(form) {",'Rev1 Excel cell mapping')
pv=one(pv,
  "'Payee Name is required in Blank Form (D15).'",
  "'Payee Name is required (E13 in Rev1 / D15 in legacy template).'",
  'Import validation for Payee')
pv=one(pv,
  "'Select a valid PV Tier in Blank Form K12 (PVT01 to PVT07).'",
  "'Select Financial Tier T01–T09 (L10 in Rev1 / K12 legacy).'",
  'Import validation for Tier')
pv=one(pv,
  "'Enter at least one invoice in Blank Form rows 28–37.'",
  "'Enter at least one invoice (Rev1 rows 26–35 / legacy 28–37).'",
  'Import validation for invoice')
pv=one(pv,
  "'Invalid SST amount in Blank Form K39.'",
  "'Invalid SST amount (L37 in Rev1 / K39 legacy).'",
  'Import validation for SST')

start="      const sheet = workbook.getWorksheet('Blank Form')"
end="      // T08/T09 may now import for Draft only; Submit is independently blocked."
if pv.count(start)!=1 or pv.count(end)!=1:
    fail('Could not find the protected Excel import section.')
i=pv.index(start)
j=pv.index(end,i)
replacement="""      const revisionOneSheet=workbook.getWorksheet('PV (T-Digital)')
      let revision=''
      let parsed
      if(revisionOneSheet){
        const sheet=revisionOneSheet
        if(!cellText(sheet,'B5').toUpperCase().includes('PAYMENT VOUCHER') ||
           !cellText(sheet,'B13').toUpperCase().includes('PAYEE') ||
           !cellText(sheet,'B25').toUpperCase().includes('NO.') ||
           !cellText(sheet,'K25').toUpperCase().includes('AMOUNT')){
          throw new Error('Wrong Revision 1 layout. Use official PV (T-Digital) sheet.')
        }
        revision=cellText(sheet,'J2')
        if(revision!=='1'){
          throw new Error('Unsupported Revision 1 workbook; J2 must be 1.')
        }
        parsed=parseRevisionOneWorkbook(sheet)
      } else {
        // Keep existing legacy Excel Rev 0000 import fully compatible.
        const sheet=workbook.getWorksheet('Blank Form')
        if(!sheet || !workbook.getWorksheet('Sample PV') ||
           !workbook.getWorksheet('PV Approval Matrix') ||
           !cellText(sheet,'A5').toUpperCase().includes('PAYMENT VOUCHER') ||
           !cellText(sheet,'A26').toUpperCase().includes('PV APPROVAL TIER') ||
           !cellText(sheet,'I12').toUpperCase().includes('PV TIER') ||
           !cellText(sheet,'A27').toUpperCase().includes('NO.') ||
           !cellText(sheet,'K27').toUpperCase().includes('AMOUNT')){
          throw new Error('Unsupported Excel workbook layout; use official Rev1 or legacy template.')
        }
        revision=cellText(sheet,'I2')
        if(revision!=='0000'){
          throw new Error('Legacy template revision must be 0000.')
        }
        parsed=parseWorkbook(sheet)
      }
"""
pv=pv[:i]+replacement+pv[j:]
pv=one(pv,
  "If importing: complete the <strong>Blank Form</strong> tab and choose PV Tier in cell K12.",
  "For Rev1 Excel, use <strong>PV (T-Digital)</strong> and select PV Tier at L10. Legacy Blank Form remains accepted.",
  'Update import worksheet help')
pv=one(pv,
  "Official PV Template FM-FIN-PV_AP-0000 | Revision 0000",
  "Official PV Template FM-FIN-PV_AP-0001 | Revision 1",
  'Revision 1 header') if "Official PV Template FM-FIN-PV_AP-0000 | Revision 0000" in pv else pv

jr=one(orig_jr,
  "const finalRole = ['T03','T07'].includes(voucher.financial_tier) ? 'ceo':'bod'",
  "const finalRole = (voucher.financial_tier==='T03' || (voucher.financial_tier==='T06' && voucher.jims_tier_policy_version==='R1') || (voucher.financial_tier==='T07' && voucher.jims_tier_policy_version!=='R1')) ? 'ceo':'bod'",
  'JR meeting final approver follows correct revision')

# All previous approval actions and complete payment RPCs must remain intact.
def rpc_lines(src):
    return sorted(line.strip() for line in src.splitlines() if '.rpc(' in line)
oldrpc=rpc_lines(orig_pv)
newrpc=rpc_lines(pv)
if len(oldrpc)!=len(newrpc): fail('Protected RPC call count unexpectedly changed.')
allow=sorted(line.replace("supabase.rpc('create_pv_draft_v4', {",
                          "supabase.rpc('create_pv_draft_v6', {").replace(
                          "supabase.rpc('create_pv_draft_v5', {",
                          "supabase.rpc('create_pv_draft_v6', {") for line in oldrpc)
if allow!=newrpc:
    fail('Unexpected change to approved PV RPC set.')
for protected in ('<PaymentTrackingPanel','<JRPanel','async function handleSave(event)',
                  'async function openVoucher(voucherId)',
                  'async function handleExcelImport(event)'):
    if orig_pv.count(protected)!=pv.count(protected):
        fail('Protected PV handler changed: '+protected)
if 'isJRFinalCEO(' not in pv or 'parseRevisionOneWorkbook(sheet)' not in pv:
    fail('Revision 1 patch incomplete.')

# Syntax-validation during DRY RUN: catch JSX errors before touching live files.
# React Vite commonly includes @babel/parser through the plugin-react toolchain.
parser=ROOT/'app/node_modules/@babel/parser'
if parser.is_dir():
    with tempfile.TemporaryDirectory(prefix='jims_53t_preview_') as temp:
        temp=Path(temp)
        preview_pv=temp/'PaymentVoucher.jsx'
        preview_jr=temp/'JRPanel.jsx'
        preview_pv.write_text(pv)
        preview_jr.write_text(jr)
        parse_js="""const fs=require('fs');const parser=require('@babel/parser');
for(const f of process.argv.slice(1)){
  const code=fs.readFileSync(f,'utf8');
  parser.parse(code,{sourceType:'module',plugins:['jsx']});
}
console.log('JSX syntax check PASS');
"""
        result=subprocess.run(['node','-e',parse_js,str(preview_pv),str(preview_jr)],
             cwd=ROOT/'app',text=True,capture_output=True)
        if result.returncode!=0:
            fail('Preflight JSX parser failed: '+(result.stderr or result.stdout)[-1800:])
        print(result.stdout.strip())
else:
    print('NOTE: @babel/parser unavailable; installation uses Vite build + rollback.')

print('JIMS STEP 53T-C — '+('DRY RUN' if DRY else 'INSTALL'))
print('New Tier labels and approval hints: T06 CEO, T07 BOD. Legacy PV authority retained.')
print('Excel import: Revision 1 PV (T-Digital) plus legacy 0000 still accepted.')
print('Manual New PV: supported. New secure create draft RPC: v6.')
print('JRPanel: version-aware final approver; no workflow or DB edits.')
if DRY:
    print('DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=ROOT/('app/gui-backups/53T_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'PaymentVoucher.jsx').write_text(orig_pv)
(backup/'JRPanel.jsx').write_text(orig_jr)
try:
    PV.write_text(pv)
    JR.write_text(jr)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 53T-C TIER REVISION 1 & EXCEL IMPORT — BUILD PASS')
    print('Backups:',backup)
except Exception as e:
    PV.write_text(orig_pv)
    JR.write_text(orig_jr)
    fail('Build failed; original PV and JRPanel restored: '+str(e))
