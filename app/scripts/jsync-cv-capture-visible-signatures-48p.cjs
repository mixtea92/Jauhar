#!/usr/bin/env node
// JSYNC Step 48M+ : export the ACTUAL shown HOD signature/name/date as cropped PNG.
// Preserve current 3-sheet original XLSX and all CV/PV/Delegation workflows.
// Guards exact anchors; creates backups; auto-reverts modified files on build fail.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process')
const root=process.cwd()
const jsxPath=path.join(root,'src/CashVoucher.jsx')
const printPath=path.join(root,'src/cashVoucherPrint.js')
const ooxmlPath=path.join(root,'src/cashVoucherPrintOOXML.js')
const capturePath=path.join(root,'src/cashVoucherCapture.js')
const pkgPath=path.join(root,'package.json'),lockPath=path.join(root,'package-lock.json')
for(const p of [jsxPath,printPath,ooxmlPath,capturePath,pkgPath])
 if(!fs.existsSync(p))throw Error('Missing '+p+'. Run from /workspaces/Jauhar/app and fetch capture helper first.')
const originals=new Map([jsxPath,printPath,ooxmlPath,pkgPath,lockPath].filter(fs.existsSync).map(p=>[p,fs.readFileSync(p)]))
const marker='JSYNC_CV_CAPTURE_VISIBLE_SIGNATURE_48P'
const sourceJSX=originals.get(jsxPath).toString('utf8')
if(sourceJSX.includes(marker)){console.log('JSYNC 48P already installed. No changes made.');process.exit(0)}
if(!sourceJSX.includes('JSYNC_CV_PRINTABLE_SIGNER_V1')||!sourceJSX.includes('JSYNC_CV_RECEIPTS_48J'))
 throw Error('Expected existing CV signed-export and mandatory-receipt components. No changes made.')
const originalPrint=originals.get(printPath).toString('utf8')
const originalOOXML=originals.get(ooxmlPath).toString('utf8')
if(!originalPrint.includes('JSYNC_CV_LOSSLESS_OOXML_EXPORT_48M'))
 throw Error('Step 48M XLSX export not found. No changes made.')
if(sourceJSX.includes('JSYNC_CV_GOTENBERG_ONE_SHEET_49G'))
 throw Error('PDF integration is still active. Restore the pre-PDF 48M version before installing this XLSX-only patch.')
let jsx=sourceJSX,print=originalPrint,ooxml=originalOOXML
function once(text,from,to,label){
 const count=text.split(from).length-1
 if(count!==1)throw Error('Unsafe '+label+' anchor count='+count+' (expected 1). No changes made.')
 return text.replace(from,to)
}
// 1) Increase only the two requested visible text sizes. Capture ONLY body.
// No header, border, or 'Approved & Signed' text is included in Excel image.
jsx=once(jsx,
 "import { downloadSignedCVExcel } from './cashVoucherPrint'",
 "import { downloadSignedCVExcel } from './cashVoucherPrint'\n"+
 "import { captureSignedCVSignatures } from './cashVoucherCapture'\n"+
 "// "+marker,
 'CV capture import')
jsx=once(jsx,
 "const result=await downloadSignedCVExcel(v,byId(v.id))",
 "const visibleImages=await captureSignedCVSignatures()\n"+
 "      const result=await downloadSignedCVExcel(v,byId(v.id),visibleImages)",
 'CV download handler')
jsx=once(jsx,
 "{approval&&<><img alt={'Digital signature '+authority} src={approval.signature_png}",
 "{approval&&<div data-jsync-cv-signature-capture={authority} style={{display:'flex',flexDirection:'column',alignItems:'center',background:'transparent',width:'100%',gap:0}}><img alt={'Digital signature '+authority} src={approval.signature_png}",
 'visible signature screenshot target')
jsx=once(jsx,
 "style={{maxWidth:220,maxHeight:90,background:'#fff'}}",
 "style={{maxWidth:220,maxHeight:90,background:'transparent'}}",
 'remove white img background')
jsx=once(jsx,
 "fontSize:25,fontStyle:'italic',color:'#c5a05b'",
 "fontSize:26,fontStyle:'italic',color:'#c5a05b'",
 'username 25 to 26')
jsx=once(jsx,
 "<p style={{fontSize:12}}>Date: {new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(approval.approved_at))}</p></>}",
 "<p style={{fontSize:16,margin:'4px 0 0'}}>Date: {new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(approval.approved_at))}</p></div>}",
 'date 12 to 16 and capture target end')
// 2) Forward the screenshots through the 48M lossless exporter.
print=once(print,
 "export async function downloadSignedCVExcel(voucher,approvalRecords) {",
 "export async function downloadSignedCVExcel(voucher,approvalRecords,capturedImages) {",
 'XLSX facade signature')
print=once(print,
 "return downloadSignedCVExcelOOXML(voucher,approvalRecords)",
 "return downloadSignedCVExcelOOXML(voucher,approvalRecords,capturedImages)",
 'XLSX facade forwarding')
// 3) Inject exactly the captured cropped PNG without re-creating name/date.
ooxml=once(ooxml,
 "export async function downloadSignedCVExcel(voucher,approvals){",
 "export async function downloadSignedCVExcel(voucher,approvals,capturedImages){",
 'OOXML signature')
ooxml=once(ooxml,
 "    const stamp=await signerStamp(signed[i],stage)",
 "    const stamp=capturedImages?.[stage]\n"+
 "    if(!stamp?.base64||!stamp?.width||!stamp?.height)\n"+
 "      throw Error('Visible '+stage+' signature screenshot could not be captured.')",
 'OOXML actual captured PNG')
const start='function appendSignatureDrawing(drawDoc,relDoc,stage,base64){'
const end='function validateZip(zip){'
const begin=ooxml.indexOf(start),finish=ooxml.indexOf(end)
if(begin<0||finish<0||begin>=finish||ooxml.indexOf(start,begin+1)!==-1)
 throw Error('Unable to patch original OOXML drawing. No changes made.')
const drawingFn=[
 "function appendSignatureDrawing(drawDoc,relDoc,stage,capture){",
 "  const rels=nodes(relDoc,P,'Relationship')",
 "  let maxRel=0",
 "  rels.forEach(r=>{const n=Number((r.getAttribute('Id')||'').match(/^rId(\\d+)$/)?.[1]);if(n>maxRel)maxRel=n})",
 "  const relId='rId'+(maxRel+1)",
 "  const rel=relDoc.createElementNS(P,'Relationship')",
 "  rel.setAttribute('Id',relId)",
 "  rel.setAttribute('Type',IMGREL)",
 "  const filename='jsync-cv-visible-'+stage+'.png'",
 "  rel.setAttribute('Target','../media/'+filename)",
 "  relDoc.documentElement.appendChild(rel)",
 "  const existing=nodes(drawDoc,X,'cNvPr').map(x=>Number(x.getAttribute('id')||0))",
 "  const drawingId=Math.max(2,...existing)+1",
 "  const isHOD=stage==='applicable_hod'",
 "  // Same approved boxes: E39:E43 for HOD and H39:I43 for HOD FM.",
 "  // Images are cropped with transparent pixels and fit proportionally.",
 "  const maxWidth=isHOD?150:173,maxHeight=96",
 "  const scale=Math.min(maxWidth/capture.width,maxHeight/capture.height)",
 "  const w=Math.max(1,Math.round(capture.width*scale))",
 "  const h=Math.max(1,Math.round(capture.height*scale))",
 "  const anchor=node(drawDoc,X,'xdr','oneCellAnchor')",
 "  const from=child(drawDoc,anchor,X,'xdr','from')",
 "  child(drawDoc,from,X,'xdr','col',isHOD?4:7)",
 "  // Offset within the worksheet column in English Metric Units.",
 "  child(drawDoc,from,X,'xdr','colOff',isHOD?160000:55000)",
 "  child(drawDoc,from,X,'xdr','row',38)",
 "  child(drawDoc,from,X,'xdr','rowOff',23000)",
 "  const size=child(drawDoc,anchor,X,'xdr','ext')",
 "  size.setAttribute('cx',String(w*9525))",
 "  size.setAttribute('cy',String(h*9525))",
 "  const pic=child(drawDoc,anchor,X,'xdr','pic')",
 "  const nv=child(drawDoc,pic,X,'xdr','nvPicPr')",
 "  const cn=child(drawDoc,nv,X,'xdr','cNvPr')",
 "  cn.setAttribute('id',String(drawingId))",
 "  cn.setAttribute('name','JSYNC Captured '+(isHOD?'Applicable HOD':'Finance HOD')+' signature/name/date')",
 "  child(drawDoc,nv,X,'xdr','cNvPicPr')",
 "  const fill=child(drawDoc,pic,X,'xdr','blipFill')",
 "  const blip=child(drawDoc,fill,A,'a','blip')",
 "  blip.setAttributeNS(R,'r:embed',relId)",
 "  const stretch=child(drawDoc,fill,A,'a','stretch')",
 "  child(drawDoc,stretch,A,'a','fillRect')",
 "  const sp=child(drawDoc,pic,X,'xdr','spPr')",
 "  const transform=child(drawDoc,sp,A,'a','xfrm')",
 "  const off=child(drawDoc,transform,A,'a','off')",
 "  off.setAttribute('x','0');off.setAttribute('y','0')",
 "  const ext=child(drawDoc,transform,A,'a','ext')",
 "  ext.setAttribute('cx',String(w*9525));ext.setAttribute('cy',String(h*9525))",
 "  const geom=child(drawDoc,sp,A,'a','prstGeom')",
 "  geom.setAttribute('prst','rect')",
 "  child(drawDoc,geom,A,'a','avLst')",
 "  child(drawDoc,anchor,X,'xdr','clientData')",
 "  drawDoc.documentElement.appendChild(anchor)",
 "  return {filename,base64:capture.base64}",
 "}",
 ""
].join('\n')
ooxml=ooxml.slice(0,begin)+drawingFn+ooxml.slice(finish)
if(process.argv.includes('--dry-run')){
 console.log('JSYNC CV 48P DRY-RUN PASSED. No changes made.')
 console.log('HOD username 25 -> 26 px, date 12 -> 16 px.')
 console.log('Excel will embed cropped visible signature+username+date as transparent PNG.')
 console.log('Only CashVoucher.jsx, cashVoucherPrint.js and cashVoucherPrintOOXML.js will be patched.')
 console.log('No PDF engine, no Supabase/PV/Delegation/master Excel changes.')
 process.exit(0)
}
const backups=[]
const suffix='.backup_before_48P_'+new Date().toISOString().replace(/[:.]/g,'-')
for(const f of [jsxPath,printPath,ooxmlPath]){
 const backup=f+suffix
 fs.writeFileSync(backup,originals.get(f))
 backups.push(backup)
}
try{
 fs.writeFileSync(jsxPath,jsx)
 fs.writeFileSync(printPath,print)
 fs.writeFileSync(ooxmlPath,ooxml)
 const deps=JSON.parse(fs.readFileSync(pkgPath,'utf8')).dependencies||{}
 if(!deps['html-to-image']){
  console.log('Installing html-to-image for exact on-screen signature capture...')
  const install=cp.spawnSync('npm',['install','html-to-image@1.11.13','--save-exact','--no-audit','--no-fund'],{cwd:root,encoding:'utf8',stdio:'pipe',timeout:90000})
  if(install.error||install.status!==0)throw Error('html-to-image install failed: '+(install.stderr||install.error?.message||'Unknown').slice(-3500))
 }
 const build=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe',timeout:90000})
 console.log((build.stdout||'').slice(-2500))
 if(build.error||build.status!==0)throw Error('Build failed: '+(build.stderr||build.error?.message||'Unknown').slice(-3500))
 console.log('JSYNC CV 48P SCREENSHOT-TO-EXCEL PATCH AND BUILD PASSED')
 console.log('No PDF conversion was added. Original Excel, signed CV records, receipt upload, PV and Delegation untouched.')
 console.log('Backups: '+backups.join(' ; '))
}catch(e){
 for(const [p,data] of originals)fs.writeFileSync(p,data)
 console.error('JSYNC CV 48P ROLLED BACK: '+e.message)
 process.exitCode=1
}
