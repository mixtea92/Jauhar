#!/usr/bin/env node
// JSYNC Step 48J CV receipt upload UI. Patch ONLY app/src/CashVoucher.jsx.
// Keep original XLSX and already tested Payment Voucher and Delegation flows intact.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process')
const root=process.cwd()
const target=path.join(root,'src/CashVoucher.jsx')
const helper=path.join(root,'src/cashVoucherReceipts.js')
if(!fs.existsSync(target)||!fs.existsSync(helper))
 throw Error('Run from /workspaces/Jauhar/app with cashVoucherReceipts.js installed.')
const original=fs.readFileSync(target,'utf8')
if(original.includes('JSYNC_CV_RECEIPTS_48J')){
 console.log('JSYNC CV 48J already installed. No changes made.');process.exit(0)
}
if(!original.includes('JSYNC_CV_PRINTABLE_SIGNER_V1'))
 throw Error('Install the earlier Step 48G printable signature patch before Step 48J; no changes made.')
let s=original
function once(oldText,newText,label){
 const n=s.split(oldText).length-1
 if(n!==1)throw Error(label+' anchor mismatch, found '+n+'; no changes made.')
 s=s.replace(oldText,newText)
}
once("import { downloadSignedCVExcel } from './cashVoucherPrint'",
 "import { downloadSignedCVExcel } from './cashVoucherPrint'\n"+
 "import { CV_RECEIPT_BUCKET,CV_RECEIPT_ACCEPT,validateCVReceiptFile,openPrivateCVReceipt } from './cashVoucherReceipts'\n"+
 "// JSYNC_CV_RECEIPTS_48J",
 'CV import')
once("  const [approvals,setApprovals]=useState([])",
 "  const [approvals,setApprovals]=useState([])\n  const [receipts,setReceipts]=useState([])",
 'receipt state')
once("const [vs,as]=await Promise.all([",
 "const [vs,as,rs]=await Promise.all([",
 'receipt fetch tuple')
once(".select('id,voucher_id,authority,approved_by,approved_at,approved_username,signature_png').limit(1000)\n      ])",
 ".select('id,voucher_id,authority,approved_by,approved_at,approved_username,signature_png').limit(1000),\n"+
 "        supabase.from('cash_voucher_receipts').select('id,voucher_id,line_index,storage_path,original_file_name,uploaded_at').limit(5000)\n"+
 "      ])",
 'receipt fetch')
once("if(vs.error||as.error)setError(vs.error?.message||as.error?.message)\n      else {setRows(vs.data||[]);setApprovals(as.data||[])}",
 "if(vs.error||as.error||rs.error)setError(vs.error?.message||as.error?.message||rs.error?.message)\n"+
 "      else {setRows(vs.data||[]);setApprovals(as.data||[]);setReceipts(rs.data||[])}",
 'receipt fetch response')
once("  const byId=id=>approvals.filter(a=>a.voucher_id===id)",
 "  const byId=id=>approvals.filter(a=>a.voucher_id===id)\n"+
 "  const receiptFor=(voucherId,index)=>receipts.find(r=>r.voucher_id===voucherId&&r.line_index===index)",
 'receipt lookup')
const uploadFn=[
"  async function openReceipt(receipt) {",
"    setError('')",
"    try {await openPrivateCVReceipt(supabase,receipt)}",
"    catch(err){setError(err?.message||'Unable to open private receipt')}",
"  }",
"  async function uploadReceipt(i,event) {",
"    const input=event.currentTarget",
"    const file=input.files?.[0]",
"    if(!file)return",
"    if(!isAP||isMobileUpload){setError('Receipt uploads are allowed only for Finance AP using desktop browsers.');input.value='';return}",
"    if(busy){input.value='';return}",
"    const payload=normalized(form)",
"    const index=Array.from({length:i+1},(_,k)=>({...blankCVLine(),...(form.lines?.[k]||{})})).filter(hasCVLineData).length",
"    if(index<1||!hasCVLineData({...blankCVLine(),...(form.lines?.[i]||{})})){",
"      setError('Enter the expense details before uploading its receipt.');input.value='';return",
"    }",
"    setError('');setNotice('');setBusy(true)",
"    try{",
"      const ext=validateCVReceiptFile(file)",
"      if(typeof crypto==='undefined'||typeof crypto.randomUUID!=='function')throw Error('Secure browser context is required to upload receipts.')",
"      const saved=await supabase.rpc('jsync_cv_save_draft_v1',{p_voucher_id:editingId||null,p_form:payload})",
"      if(saved.error)throw saved.error",
"      const v=saved.data",
"      if(!v?.id)throw Error('Failed to save CV Draft for receipt attachment.')",
"      setEditingId(v.id)",
"      setForm({...blankCVForm(),...payload})",
"      const objectPath=v.id+'/'+index+'/'+crypto.randomUUID()+ext",
"      const stored=await supabase.storage.from(CV_RECEIPT_BUCKET).upload(objectPath,file,{upsert:false,contentType:file.type})",
"      if(stored.error)throw stored.error",
"      const attached=await supabase.rpc('jsync_cv_attach_receipt_v1',{",
"        p_voucher_id:v.id,p_line_index:index,p_storage_path:objectPath,p_original_name:file.name",
"      })",
"      if(attached.error)throw attached.error",
"      const rec=attached.data",
"      if(!rec?.id)throw Error('Receipt upload could not be linked to the CV row.')",
"      setReceipts(prev=>[...prev.filter(r=>!(r.voucher_id===v.id&&r.line_index===index)),rec])",
"      setForm({...blankCVForm(),...payload,lines:payload.lines.map((l,j)=>j===index-1?{...l,receipt_attached:'Yes'}:l)})",
"      setNotice('Receipt uploaded and attached to expense row '+index+': '+file.name+' (private).')",
"      setRefresh(n=>n+1)",
"    }catch(err){setError(err?.message||'Receipt upload failed. Draft may have been saved, but CV cannot Submit until a receipt is attached.')}",
"    finally{setBusy(false);input.value=''}",
"  }",
""
].join('\n')
once("  async function saveDraft(){",uploadFn+"  async function saveDraft(){",'receipt handlers')
once("      <h3>Expense Details — Maximum 10 Receipt Lines</h3>",
 "      <h3>Expense Details — Maximum 10 Receipt Lines</h3>\n"+
 "      <p style={{fontSize:12}}>Every expense row requires a PDF/JPG/PNG/WEBP receipt (max 10 MB). Uploading a receipt auto-saves your Draft and marks Receipt Attached? = Yes. If you change a row after uploading, upload its receipt again before Submit. Mobile file uploads are disabled.</p>",
 'mandatory upload instruction')
once("minWidth:1050,width:'100%'","minWidth:1220,width:'100%'",'table width')
once("'Amount (RM)','Receipt Attached?'].map(h=>",
 "'Amount (RM)','Receipt Attached?','Upload Receipt *'].map(h=>",
 'header new receipt')
const uploadCell=[
"            <td style={cellStyle}>",
"              <input type=\"file\" aria-label={'Upload receipt for expense row '+(i+1)}",
"                accept={CV_RECEIPT_ACCEPT}",
"                disabled={busy||isMobileUpload||!hasCVLineData(line)}",
"                onChange={e=>uploadReceipt(i,e)}",
"                style={{maxWidth:220,fontSize:12}} />",
"              {editingId&&receiptFor(editingId,i+1)&&",
"                <div style={{marginTop:5,fontSize:12}}>",
"                  <span style={{color:'#56b78b'}}>Uploaded: </span>",
"                  <button type=\"button\" style={smallButton} onClick={()=>openReceipt(receiptFor(editingId,i+1))}>",
"                    {receiptFor(editingId,i+1).original_file_name}",
"                  </button>",
"                </div>}",
"            </td>"
].join('\n')
once("            <td style={cellStyle}>{selectCell(line,i,'receipt_attached',['Yes','No'])}</td>",
 "            <td style={cellStyle}>{selectCell(line,i,'receipt_attached',['Yes','No'])}</td>\n"+
 uploadCell,
 'upload receipt cell')
once("['Receipt Date','Receipt No.','Description','Expense Category','Branch','Amount','Attached?'].map(h=>",
 "['Receipt Date','Receipt No.','Description','Expense Category','Branch','Amount','Attached?','Receipt File'].map(h=>",
 'view receipt header')
once("          <td style={cellStyle}>{l.receipt_attached}</td>",
 "          <td style={cellStyle}>{l.receipt_attached}</td>\n"+
 "          <td style={cellStyle}>{receiptFor(selected.id,i+1)?<button type=\"button\" style={smallButton} onClick={()=>openReceipt(receiptFor(selected.id,i+1))}>View Receipt</button>:'Missing receipt'}</td>",
 'view receipt button')
if(process.argv.includes('--dry-run')){
 console.log('JSYNC CV 48J DRY-RUN PASSED. No files changed.')
 console.log('Only CashVoucher.jsx form/view is changed. Original XLSX, PV, Delegation untouched.')
 process.exit(0)
}
const backup=target+'.backup_before_cv_receipts_48J_'+new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(backup,original)
try{
 fs.writeFileSync(target,s)
 const result=cp.spawnSync('npm',['run','build'],{cwd:root,stdio:'pipe',encoding:'utf8'})
 console.log((result.stdout||'').slice(-3200))
 if(result.error||result.status!==0)throw Error((result.stderr||'').slice(-3500)||result.error?.message||'Build failed')
 console.log('JSYNC CV 48J MANDATORY RECEIPT UPLOAD PATCH AND BUILD PASSED')
 console.log('Backup: '+backup)
 console.log('Only CashVoucher.jsx patched; original Excel/PV/Delegation unchanged.')
}catch(err){
 fs.writeFileSync(target,original)
 console.error('JSYNC CV 48J ROLLBACK COMPLETED: '+err.message)
 process.exitCode=1
}
