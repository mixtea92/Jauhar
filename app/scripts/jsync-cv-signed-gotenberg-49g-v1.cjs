#!/usr/bin/env node
// JSYNC Step 49G: CLOSED CV -> one-sheet signed XLSX -> Gotenberg PDF.
// Guarded edits ONLY vite.config.js + CashVoucher.jsx; helpers separate.
// Development-only endpoint; restart Vite. Auto rollback on build failure.
const fs=require('node:fs')
const path=require('node:path')
const cp=require('node:child_process')
const root=process.cwd()
const cvFile=path.join(root,'src/CashVoucher.jsx')
const viteFile=path.join(root,'vite.config.js')
const devService=path.join(root,'server/jsyncDocumentDevPlugin.js')
const clientHelper=path.join(root,'src/cashVoucherSignedGotenberg.js')
const oneSheet=path.join(root,'public/templates/JSYNC_CV_PDF_Template.xlsx')
const original=path.join(root,'public/templates/FIN_FM_PC_Petty Cash.xlsx')
for(const f of [cvFile,viteFile,devService,clientHelper,oneSheet,original])
 if(!fs.existsSync(f))throw Error('Required JSYNC 49G file missing: '+f)
const originals=new Map([[cvFile,fs.readFileSync(cvFile,'utf8')],[viteFile,fs.readFileSync(viteFile,'utf8')]])
const marker='JSYNC_CV_GOTENBERG_ONE_SHEET_49G'
const prev=originals.get(cvFile)
const configBefore=originals.get(viteFile)
if(prev.includes(marker)){console.log('JSYNC 49G already installed. No changes made.');process.exit(0)}
if(!prev.includes('JSYNC_CV_DIRECT_DIGITAL_PDF_48N'))
 throw Error('CashVoucher.jsx is missing prior Step 48N PDF UI; safe installer cannot patch.')
let cv=prev,vite=configBefore
function once(label,oldStr,newStr,which){
 const src=which==='vite'?vite:cv
 const count=src.split(oldStr).length-1
 if(count!==1)throw Error('Unsafe '+label+' anchor, '+count+' matches. No modifications made.')
 if(which==='vite')vite=src.replace(oldStr,newStr)
 else cv=src.replace(oldStr,newStr)
}
once('PDF helper import',
 "import { CV_PDF_TEMPLATE_URL, downloadSignedCVPDF } from './cashVoucherPDF'",
 "import { CV_PDF_TEMPLATE_URL, downloadSignedCVPDF } from './cashVoucherPDF'\n"+
 "import { downloadSignedCVViaGotenberg } from './cashVoucherSignedGotenberg'\n"+
 "// "+marker,'cv')
once('new PDF converter invocation',
 "const result=await downloadSignedCVPDF(v,byId(v.id))",
 "const result=await downloadSignedCVViaGotenberg(v,byId(v.id))",'cv')
once('PDF button master-readiness',
 "disabled={busy||!pdfTemplateReady} onClick={()=>downloadSignedPDF(selected)}",
 "disabled={busy||!templateReady} onClick={()=>downloadSignedPDF(selected)}",'cv')
once('PDF template warning',
 "        {!pdfTemplateReady&&<small style={{color:'#ad682c'}}>PDF master not installed. Export only the blank PC (Digital) worksheet of the original Excel as a single-page A4 PDF named FIN_FM_PC_Petty Cash.pdf, and place it in app/public/templates. Then refresh JSYNC.</small>}",
 "        <small>One-sheet JSYNC_CV_PDF_Template.xlsx is converted using local Gotenberg in Codespaces. Both actual HOD approvals are required.</small>",
 'cv')
once('Vite plugin import',
 "import { defineConfig } from 'vite'",
 "import { defineConfig } from 'vite'\n"+
 "import { jsyncDocumentDevPlugin } from './server/jsyncDocumentDevPlugin.js'",
 'vite')
once('Vite plugin list',
 "  plugins: [react()],",
 "  plugins: [react(), jsyncDocumentDevPlugin()],",
 'vite')
if(process.argv.includes('--dry-run')){
 console.log('JSYNC 49G DRY-RUN PASSED — no files modified.')
 console.log('Only vite.config.js + CashVoucher.jsx will be patched; backups and build rollback.')
 console.log('Original CV Excel master and one-sheet PDF template both present.')
 console.log('PV, Delegation, Supabase and HOD signatures untouched.')
 process.exit(0)
}
const suffix='.backup_before_49G_'+new Date().toISOString().replace(/[:.]/g,'-')
const backups=[]
for(const [file,data] of originals){
 const backup=file+suffix
 fs.writeFileSync(backup,data)
 backups.push(backup)
}
try{
 fs.writeFileSync(cvFile,cv)
 fs.writeFileSync(viteFile,vite)
 const build=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe',timeout:90000})
 console.log((build.stdout||'').slice(-3500))
 if(build.error||build.status!==0)throw Error('Vite build failed: '+(build.stderr||build.error?.message||'Unknown').slice(-5000))
 console.log('JSYNC 49G CLOSED CV TO SIGNED XLSX TO GOTENBERG PDF PATCH AND BUILD PASSED')
 console.log('Dev endpoint: /api/jsync/documents/cv-pdf (authenticated CLOSED CV only).')
 console.log('Original Excel/PDF master, PV, Delegation and approvals untouched.')
 console.log('Backups: '+backups.join(' ; '))
 console.log('Restart Vite dev server after modifying vite.config.js.')
}catch(err){
 for(const [file,data] of originals)fs.writeFileSync(file,data)
 console.error('JSYNC 49G ROLLBACK COMPLETED: '+err.message)
 process.exitCode=1
}
