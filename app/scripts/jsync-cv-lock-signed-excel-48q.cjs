#!/usr/bin/env node
// JSYNC Step 48Q — Protect downloaded Signed Cash Voucher Excel, view + print.
// Guarded installer for ONLY app/src/cashVoucherPrintOOXML.js.
// Keeps original 3-sheet master, screenshots, receipt uploads, approvals,
// Payment Voucher and Delegation unchanged. Build/rollback safety.
const fs=require('node:fs')
const path=require('node:path')
const cp=require('node:child_process')
const root=process.cwd()
const target=path.join(root,'src/cashVoucherPrintOOXML.js')
const helper=path.join(root,'src/cashVoucherPrintProtection.js')
if(!fs.existsSync(target)||!fs.existsSync(helper))
 throw Error('Run from /workspaces/Jauhar/app after fetching cashVoucherPrintProtection.js.')
const original=fs.readFileSync(target,'utf8')
const marker='JSYNC_CV_SIGNED_XLSX_PROTECTED_48Q'
if(original.includes(marker)){console.log('JSYNC CV 48Q already installed. No changes made.');process.exit(0)}
if(!original.includes("import { CV_TEMPLATE_URL } from './cashVoucherExcel'"))
 throw Error('Expected original CV OOXML exporter import missing. Nothing changed.')
if(!original.includes('capturedImages?.[stage]'))
 throw Error('Step 48P Screenshot-to-Excel must remain installed. No changes made.')
let updated=original
function once(from,to,label){
 const count=updated.split(from).length-1
 if(count!==1)throw Error(label+' anchor count='+count+' (expected 1). No changes made.')
 updated=updated.replace(from,to)
}
once(
 "import { CV_TEMPLATE_URL } from './cashVoucherExcel'",
 "import { CV_TEMPLATE_URL } from './cashVoucherExcel'\n"+
 "import { lockSignedCVWorkbook } from './cashVoucherPrintProtection'\n"+
 "// "+marker,
 'import protected workbook'
)
once(
 "  const out=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}})",
 "  // Lock only the generated Signed CV XLSX AFTER populating data and screenshots.\n"+
 "  // This is Excel edit/structure protection; printing remains enabled.\n"+
 "  const locking=await lockSignedCVWorkbook(zip,work,workRels,normalPath)\n"+
 "  if(locking.protectedSheets<1)throw Error('No signed CV sheets were protected')\n"+
 "  const out=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}})",
 'protection before final ZIP'
)
if(process.argv.includes('--dry-run')){
 console.log('JSYNC CV 48Q DRY-RUN PASSED. Nothing modified.')
 console.log('Only exported Signed CV Excel will get sheet and workbook protection.')
 console.log('All 3 exported sheets locked; open and print enabled; no actual file encryption.')
 console.log('No changes to original master, CV data, PV or Delegation.')
 process.exit(0)
}
const backup=target+'.backup_before_48Q_'+new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(backup,original)
try{
 fs.writeFileSync(target,updated)
 const result=cp.spawnSync('npm',['run','build'],{cwd:root,stdio:'pipe',encoding:'utf8',timeout:90000})
 console.log((result.stdout||'').slice(-2800))
 if(result.error||result.status!==0)
  throw Error('Build failed: '+(result.stderr||result.error?.message||'unknown error').slice(-4000))
 console.log('JSYNC CV 48Q SIGNED XLSX EDIT-PROTECTED AND BUILD PASSED')
 console.log('Backup: '+backup)
 console.log('Original Excel master, PV, Delegation and Supabase approvals unchanged.')
}catch(err){
 fs.writeFileSync(target,original)
 console.error('JSYNC CV 48Q ROLLBACK COMPLETE: '+err.message)
 process.exitCode=1
}
