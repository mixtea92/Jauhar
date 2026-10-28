#!/usr/bin/env node
// JSYNC Step 48G: CV HOD username/date on printed signed Excel.
// Patches ONLY CashVoucher.jsx; helper cashVoucherPrint.js is separate.
// Guarded anchors, backups and rollback on build failure.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process')
const root=process.cwd()
const target=path.join(root,'src/CashVoucher.jsx')
const dep=path.join(root,'src/cashVoucherPrint.js')
if(!fs.existsSync(target)||!fs.existsSync(dep))throw Error('Expected app/src/CashVoucher.jsx and app/src/cashVoucherPrint.js; run from /workspaces/Jauhar/app')
const original=fs.readFileSync(target,'utf8')
const flag='JSYNC_CV_PRINTABLE_SIGNER_V1'
if(original.includes(flag)){console.log('JSYNC CV 48G already installed. No changes made.');process.exit(0)}
let s=original
function once(a,b,tag) {
 const n=s.split(a).length-1
 if(n!==1)throw Error('Unsafe CashVoucher.jsx source: '+tag+' anchor count='+n+' (expected 1). No changes made.')
 s=s.replace(a,b)
}
once("} from './cashVoucherExcel'\n",
 "} from './cashVoucherExcel'\nimport { downloadSignedCVExcel } from './cashVoucherPrint'\n// "+flag+"\n",
 'import')
once(".select('id,voucher_id,authority,approved_by,approved_at,signature_png')",
 ".select('id,voucher_id,authority,approved_by,approved_at,approved_username,signature_png')",
 'select')
once("  async function inspect(v){",
 "  async function downloadSigned(v) {\n"+
 "    if(busy||!v||v.status==='draft')return\n"+
 "    setError('');setNotice('');setBusy(true)\n"+
 "    try {\n"+
 "      const result=await downloadSignedCVExcel(v,byId(v.id))\n"+
 "      setNotice(result.filename+' downloaded. Open it in Excel and choose Export / Save As PDF for the same original A4 one-page design.')\n"+
 "    } catch (err) {setError(err?.message||'Unable to export signed Cash Voucher') }\n"+
 "    finally {setBusy(false)}\n"+
 "  }\n"+
 "  async function inspect(v){",
 'export function')
once("              <p style={{fontSize:12}}>{dateLabel(approval.approved_at)}</p></>}",
 "              <div style={{fontFamily:'\"Monotype Corsiva\",\"Apple Chancery\",\"Brush Script MT\",cursive',fontSize:25,fontStyle:'italic',color:'#c5a05b',lineHeight:1.1,maxWidth:230,overflowWrap:'anywhere'}}>\n"+
 "                {approval.approved_username||'Signer username not recorded'}\n"+
 "              </div>\n"+
 "              <p style={{fontSize:12}}>Date: {new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(approval.approved_at))}</p></>}",
 'preview signature username')
once("      <h3>Digital Signatures</h3>",
 "      {selected.status!=='draft'&&<div style={{margin:'14px 0',display:'flex',flexDirection:'column',alignItems:'flex-start',gap:6}}>\n"+
 "        <button type=\"button\" className=\"btn\" disabled={busy||!templateReady} onClick={()=>downloadSigned(selected)}>\n"+
 "          Download Signed CV Excel (Print / PDF)\n"+
 "        </button>\n"+
 "        <small>Original one-page Excel print layout. HOD digital signature, username and approval date appear in the existing signature blocks. For PDF, open the signed Excel in Microsoft Excel and choose Save as PDF.</small>\n"+
 "      </div>}\n"+
 "      <h3>Digital Signatures</h3>",
 'print/export button')
if(process.argv.includes('--dry-run')){console.log('JSYNC CV 48G DRY-RUN PASSED. No files changed.');console.log('Only app/src/CashVoucher.jsx will be patched. PV/Delegation untouched.');process.exit(0)}
const backup=target+'.backup_before_cv_print_signatures_'+new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(backup,original)
try{
 fs.writeFileSync(target,s)
 const build=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe'})
 console.log((build.stdout||'').slice(-3300))
 if(build.error||build.status!==0)throw Error((build.stderr||'').slice(-4000)||build.error?.message||'Vite build failed')
 console.log('JSYNC CV 48G PRINTABLE SIGNER PATCH AND BUILD PASSED')
 console.log('Original master XLSX and all PV/Delegation files unchanged.')
 console.log('Backup: '+backup)
}catch(e){
 fs.writeFileSync(target,original)
 console.error('JSYNC CV 48G patch rolled back: '+e.message)
 process.exitCode=1
}
