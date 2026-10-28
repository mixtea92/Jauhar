#!/usr/bin/env node
// JSYNC Step 48N: One-click CLOSED CV PDF download from PC (Digital) ONLY.
// Touches ONLY CashVoucher.jsx, package.json and package-lock.json.
// Requires approved blank one-page PC(Digital) PDF master at public/templates.
// All mutations guarded by anchors, backups, and rollback on install/build failure.
// No PV/Delegation/approval/Storage/Supabase changes.
const fs=require('node:fs')
const path=require('node:path')
const cp=require('node:child_process')
const cwd=process.cwd()
const target=path.join(cwd,'src/CashVoucher.jsx')
const helper=path.join(cwd,'src/cashVoucherPDF.js')
const pdfMaster=path.join(cwd,'public/templates/FIN_FM_PC_Petty Cash.pdf')
const packageJson=path.join(cwd,'package.json')
const lock=path.join(cwd,'package-lock.json')
for(const p of [target,helper,packageJson])
 if(!fs.existsSync(p))throw Error('Missing '+p+'; run from /workspaces/Jauhar/app and fetch cashVoucherPDF.js first.')
const orig=fs.readFileSync(target,'utf8')
const marker='JSYNC_CV_DIRECT_DIGITAL_PDF_48N'
if(orig.includes(marker)){console.log('JSYNC CV 48N already installed. No changes made.');process.exit(0)}
if(!orig.includes('JSYNC_CV_PRINTABLE_SIGNER_V1'))
 throw Error('48G signed CV export not installed. Refusing unsafe patch.')
const files=[target,packageJson,lock].filter(fs.existsSync)
const backups=new Map(files.map(p=>[p,fs.readFileSync(p)]))
let next=orig
function once(before,after,title){
 const n=next.split(before).length-1
 if(n!==1)throw Error('Unsafe CashVoucher.jsx '+title+' anchor: found '+n+' (expected 1). No files changed.')
 next=next.replace(before,after)
}
once(
  "import { downloadSignedCVExcel } from './cashVoucherPrint'",
  "import { downloadSignedCVExcel } from './cashVoucherPrint'\n"+
  "import { CV_PDF_TEMPLATE_URL, downloadSignedCVPDF } from './cashVoucherPDF'\n// "+marker,
  'PDF import'
)
once(
  "  const [templateReady,setTemplateReady]=useState(false)",
  "  const [templateReady,setTemplateReady]=useState(false)\n"+
  "  const [pdfTemplateReady,setPdfTemplateReady]=useState(false)",
  'PDF master state'
)
once(
  "  const byId=id=>approvals.filter(a=>a.voucher_id===id)",
  [
    "  useEffect(()=>{",
    "    let active=true",
    "    fetch(CV_PDF_TEMPLATE_URL,{cache:'no-store'}).then(async response=>{",
    "      const type=response.headers.get('content-type')||''",
    "      const bytes=await response.arrayBuffer()",
    "      const isPdf=bytes.byteLength>1000 &&",
    "        String.fromCharCode(...new Uint8Array(bytes.slice(0,5)))==='%PDF-'",
    "      if(active)setPdfTemplateReady(response.ok&&!type.includes('text/html')&&isPdf)",
    "    }).catch(()=>{if(active)setPdfTemplateReady(false)})",
    "    return ()=>{active=false}",
    "  },[])",
    "",
    "  const byId=id=>approvals.filter(a=>a.voucher_id===id)"
  ].join('\n'),
  'PDF master detection'
)
once(
  "  async function downloadSigned(v) {",
  [
    "  async function downloadSignedPDF(v) {",
    "    if(busy||!v||v.status!=='closed')return",
    "    setError('');setNotice('');setBusy(true)",
    "    try {",
    "      const result=await downloadSignedCVPDF(v,byId(v.id))",
    "      setNotice(result.filename+' downloaded successfully. This is the PC (Digital) sheet only, with both HOD signatures.')",
    "    } catch(err) {setError(err?.message||'Unable to export signed CV PDF')}",
    "    finally {setBusy(false)}",
    "  }",
    "  async function downloadSigned(v) {"
  ].join('\n'),
  'direct PDF handler'
)
once(
  '        <button type="button" className="btn" disabled={busy||!templateReady} onClick={()=>downloadSigned(selected)}>\n'+
  '          Download Signed CV Excel (Print / PDF)\n'+
  '        </button>\n'+
  '        <small>Original one-page Excel print layout. HOD digital signature, username and approval date appear in the existing signature blocks. For PDF, open the signed Excel in Microsoft Excel and choose Save as PDF.</small>',
  '        {selected.status===\'closed\'&&<button type="button" className="btn" disabled={busy||!pdfTemplateReady} onClick={()=>downloadSignedPDF(selected)}>\n'+
  '          Download Signed CV PDF\n'+
  '        </button>}\n'+
  '        <small>PDF contains only the original PC (Digital) sheet, A4 portrait, with Applicable HOD and HOD FM digital signatures, usernames and dates. No other workbook sheets are included.</small>\n'+
  '        {!pdfTemplateReady&&<small style={{color:\'#ad682c\'}}>PDF master not installed. Export only the blank PC (Digital) worksheet of the original Excel as a single-page A4 PDF named FIN_FM_PC_Petty Cash.pdf, and place it in app/public/templates. Then refresh JSYNC.</small>}',
  'PDF download button'
)
if(process.argv.includes('--dry-run')){
  console.log('JSYNC CV 48N DRY-RUN PASSED. No changes were made.')
  console.log('PDF helper found. Existing 48G installer anchors verified.')
  console.log('Blank PC(Digital) PDF master: '+(fs.existsSync(pdfMaster)?'FOUND':'MISSING - add once before testing download.'))
  console.log('Only CashVoucher.jsx + npm dependency files will be changed. PV/Delegation/DB untouched.')
  process.exit(0)
}
const backupName=target+'.backup_before_48N_'+new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(backupName,orig)
try{
  fs.writeFileSync(target,next)
  const deps=JSON.parse(fs.readFileSync(packageJson,'utf8')).dependencies||{}
  if(!deps['pdf-lib']){
    console.log('Installing local PDF generator dependency pdf-lib@1.17.1...')
    const install=cp.spawnSync('npm',['install','pdf-lib@1.17.1','--save-exact','--no-audit','--no-fund'],{cwd,stdio:'pipe',encoding:'utf8',timeout:90000})
    if(install.error||install.status!==0)throw Error('Dependency install failed: '+(install.stderr||install.error?.message||'Unknown install error').slice(-2200))
  }
  const build=cp.spawnSync('npm',['run','build'],{cwd,stdio:'pipe',encoding:'utf8',timeout:90000})
  console.log((build.stdout||'').slice(-2200))
  if(build.error||build.status!==0)throw Error('Vite build failed: '+(build.stderr||build.error?.message||'No error text').slice(-3200))
  console.log('JSYNC CV 48N ONE-PAGE PC DIGITAL PDF EXPORT PATCH AND BUILD PASSED')
  if(!fs.existsSync(pdfMaster))console.log('NEXT REQUIRED: Add the BLANK original PC (Digital) one-page A4 PDF master to '+pdfMaster)
  console.log('Backup: '+backupName)
  console.log('Existing XLSX, PV, Delegation and Supabase/approvals unchanged.')
}catch(err){
  for(const [p,bytes] of backups)fs.writeFileSync(p,bytes)
  console.error('JSYNC CV 48N ROLLED BACK CODE/DEPENDENCY FILES: '+err.message)
  process.exitCode=1
}
