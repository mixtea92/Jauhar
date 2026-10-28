#!/usr/bin/env node
// JSYNC CV Step 48C: wire independent Cash Voucher feature to existing menu placeholder.
// Safe against unpublished Codespaces changes: edits ONLY src/App.jsx, anchored to the
// Cash Voucher placeholder installed in Step 48A. No PV/Delegation code is rewritten.
const fs=require('node:fs')
const path=require('node:path')
const cp=require('node:child_process')
const root=process.cwd()
const app=path.join(root,'src/App.jsx')
const required=['src/CashVoucher.jsx','src/cashVoucherExcel.js','package.json']
if(!fs.existsSync(app)||required.some(p=>!fs.existsSync(path.join(root,p))))
  throw Error('Missing App.jsx or new Cash Voucher source files. Run from /workspaces/Jauhar/app.')
const original=fs.readFileSync(app,'utf8')
const marker='JSYNC_STEP_48C_CASH_VOUCHER_FULL_STACK'
if(original.includes(marker)){console.log('JSYNC CV 48C already installed. No changes made.');process.exit(0)}
let text=original
function once(oldText,newText,label){
  const n=text.split(oldText).length-1
  if(n!==1)throw Error(label+': expected exactly one anchor, found '+n+'. No changes made.')
  text=text.replace(oldText,newText)
}
once("import PaymentVoucher from './PaymentVoucher'",
"import PaymentVoucher from './PaymentVoucher'\nimport CashVoucher from './CashVoucher'\n// "+marker,
'CashVoucher import')
// Use the exact Cash Voucher placeholder created by Step 48A, never any PV branch.
const routeHead="          ) : activePage === 'cash_voucher' ? ("
const routeTail="          ) : activePage === 'manage_delegation' ? ("
const start=text.indexOf(routeHead)
const next=text.indexOf(routeTail,start+routeHead.length)
if(start<0||next<0||next-start>1300||next-start<routeHead.length)
  throw Error('Expected Cash Voucher placeholder before Manage Delegation not found. No changes made.')
const existing=text.slice(start,next)
if(!existing.includes('Cash Voucher module has been added under Financial Approval.')||
  !existing.includes('Voucher forms, numbering, payment flow and approvals have not yet been configured.'))
  throw Error('Cash Voucher page has changed since Step 48A; refusing overwrite.')
const newPart=routeHead+"\n            <CashVoucher profile={profile} />\n"
text=text.slice(0,start)+newPart+text.slice(next)
if(process.argv.includes('--dry-run')){
  console.log('JSYNC CV 48C DRY-RUN PASSED. No files changed.')
  console.log('Only App.jsx Cash Voucher placeholder will be replaced.')
  console.log('Payment Voucher, Delegation, all existing approval routes preserved.')
  process.exit(0)
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-')
const backup=app+'.backup_before_cash_voucher_fullstack_'+stamp
fs.writeFileSync(backup,original)
try{
  fs.writeFileSync(app,text)
  const build=cp.spawnSync('npm',['run','build'],{cwd:root,stdio:'pipe',encoding:'utf8'})
  console.log((build.stdout||'').slice(-3400))
  if(build.error||build.status!==0)
    throw Error((build.stderr||'').slice(-4400)||build.error?.message||'Build failed')
  console.log('JSYNC CV 48C FULL-STACK FRONTEND PATCH AND BUILD PASSED')
  console.log('Original PaymentVoucher and Delegation files unchanged.')
  console.log('Backup: '+backup)
  const template=path.join(root,'public/templates/FIN_FM_PC_Petty Cash.xlsx')
  if(fs.existsSync(template)) console.log('MASTER EXCEL TEMPLATE FOUND: '+fs.statSync(template).size+' bytes')
  else console.log('MASTER EXCEL TEMPLATE MISSING: copy original unchanged XLSX to app/public/templates/FIN_FM_PC_Petty Cash.xlsx before testing download.')
}catch(err){
  fs.writeFileSync(app,original)
  console.error('PATCH ROLLED BACK; App.jsx restored: '+err.message)
  process.exitCode=1
}
