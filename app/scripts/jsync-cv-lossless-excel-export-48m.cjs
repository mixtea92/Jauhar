#!/usr/bin/env node
// JSYNC 48M: repair "Cannot read properties of undefined (reading 'sheets')"
// by switching ONLY CV signed export from ExcelJS parser to lossless OOXML patching.
// Preflight exact anchors, backup, automatic rollback on build failure.
const fs=require('node:fs')
const path=require('node:path')
const cp=require('node:child_process')
const root=process.cwd()
const target=path.join(root,'src/cashVoucherPrint.js')
const replacement=path.join(root,'src/cashVoucherPrintOOXML.js')
if(!fs.existsSync(target)||!fs.existsSync(replacement))throw Error('Run from /workspaces/Jauhar/app; install src/cashVoucherPrintOOXML.js first.')
try{require.resolve('jszip',{paths:[root]})}
catch{throw Error('JSZip dependency missing. Do not patch; inspect installed npm dependencies first.')}
const old=fs.readFileSync(target,'utf8')
const flag='JSYNC_CV_LOSSLESS_OOXML_EXPORT_48M'
if(old.includes(flag)){
 console.log('JSYNC 48M already installed. No changes made.');process.exit(0)
}
function hasOnce(text){return old.split(text).length===2}
const importAnchor="import { CV_TEMPLATE_URL } from './cashVoucherExcel'"
const functionAnchor="export async function downloadSignedCVExcel(voucher,approvalRecords) {"
if(!hasOnce(importAnchor)||!hasOnce(functionAnchor))throw Error('CV Excel export source has changed. Safe installer refused to patch.')
let next=old.replace(importAnchor,importAnchor+
 "\nimport { downloadSignedCVExcel as downloadSignedCVExcelOOXML } from './cashVoucherPrintOOXML'\n// "+flag)
next=next.replace(functionAnchor,functionAnchor+
 "\n  // Keep ExcelJS import used elsewhere; bypass its parser for exporting original master.\n  return downloadSignedCVExcelOOXML(voucher,approvalRecords)")
if(process.argv.includes('--dry-run')){
 console.log('JSYNC 48M DRY-RUN PASSED. Only src/cashVoucherPrint.js will be patched.')
 console.log('Original master XLSX, Cash Voucher signatures/data, PV and Delegation unchanged.')
 process.exit(0)
}
const backup=target+'.backup_before_48M_'+new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(backup,old)
try{
 fs.writeFileSync(target,next)
 const result=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe'})
 console.log((result.stdout||'').slice(-2600))
 if(result.error||result.status!==0)throw Error((result.stderr||'').slice(-3500)||result.error?.message||'Vite build failed')
 console.log('JSYNC CV 48M OOXML EXPORT FIX AND BUILD PASSED')
 console.log('Backup: '+backup)
 console.log('Original Excel, PV, Delegation, backend and CV approvals untouched.')
}catch(err){
 fs.writeFileSync(target,old)
 console.error('JSYNC 48M patch rolled back: '+err.message)
 process.exitCode=1
}
