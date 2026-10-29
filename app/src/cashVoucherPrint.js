// JSYNC Cash Voucher Signed Excel Export (2026-10-28)
// Uses the *unmodified original XLSX binary* as the one-page print master.
// Prints original sheet + HOD signature, signer username and signed date.
// Never mutates the official file stored in /public/templates.
import { CV_TEMPLATE_URL } from './cashVoucherExcel'
import { downloadSignedCVExcel as downloadSignedCVExcelOOXML } from './cashVoucherPrintOOXML'
// JSYNC_CV_LOSSLESS_OOXML_EXPORT_48M

function dateMY(iso) {
  if (!iso) return ''
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(iso))
    ? new Date(String(iso)+'T12:00:00+08:00') : new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'
  }).format(d)
}
function text(v) { return String(v??'').trim() }
function set(sheet,addr,val) {
  if (val!==undefined && val!==null && val!=='') sheet.getCell(addr).value=val
}
function putReceiptRows(sheet,lines=[]) {
  lines.slice(0,10).forEach((l,i)=>{
    const row=i+21
    set(sheet,'C'+row,dateMY(l.receipt_date))
    set(sheet,'D'+row,text(l.receipt_no))
    set(sheet,'E'+row,text(l.description))
    set(sheet,'F'+row,text(l.expense_category))
    set(sheet,'G'+row,text(l.expenses_branch))
    if (text(l.amount)!=='') {
      const amount=Number(l.amount)
      if (!Number.isFinite(amount) || amount<0) throw Error('Invalid stored CV amount')
      sheet.getCell('H'+row).value=amount
    }
    set(sheet,'I'+row,text(l.receipt_attached))
  })
}
// This embeds a rasterized name/date and actual drawn signature in the
// Excel signature box so PDF export does not depend on a cursive font installed
// on the computer which opens the XLSX.
async function imageFromDataURL(url) {
  return new Promise((resolve,reject)=>{
    const im=new Image()
    im.onload=()=>resolve(im)
    im.onerror=()=>reject(Error('Stored HOD signature image could not be decoded'))
    im.src=url
  })
}
async function makeSignatureStamp(approval,stage) {
  if (!approval?.signature_png || !approval?.approved_username || !approval?.approved_at)
    return null
  const username=text(approval.approved_username)
  if (!username) return null
  const canvas=document.createElement('canvas')
  canvas.width=720; canvas.height=400
  const ctx=canvas.getContext('2d')
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.fillStyle='#344054'
  ctx.font='500 22px Arial, sans-serif'
  ctx.fillText(stage==='applicable_hod'?'HOD VERIFIED & SIGNED':'FINANCE MANAGER VERIFIED',20,33)
  const signature=await imageFromDataURL(approval.signature_png)
  // Scale drawing within the top half of the existing 5-row signature panel.
  const maxWidth=590, maxHeight=143
  const ratio=Math.min(maxWidth/signature.width,maxHeight/signature.height)
  const iw=signature.width*ratio,ih=signature.height*ratio
  ctx.drawImage(signature,20,45,iw,ih)
  // Prefer Monotype Corsiva when available; raster ensures stable PDF output.
  const fonts=['"Monotype Corsiva"','"Apple Chancery"','"Brush Script MT"','cursive'].join(', ')
  let size=58
  while(size>26){
    ctx.font='italic '+size+'px '+fonts
    if(ctx.measureText(username).width<665)break
    size-=2
  }
  ctx.fillStyle='#132c47'
  ctx.fillText(username,20,273)
  ctx.strokeStyle='#d0d5dd';ctx.lineWidth=1
  ctx.beginPath();ctx.moveTo(18,290);ctx.lineTo(684,290);ctx.stroke()
  ctx.fillStyle='#344054'
  ctx.font='400 28px Arial, sans-serif'
  ctx.fillText('Date: '+dateMY(approval.approved_at),20,342)
  return canvas.toDataURL('image/png')
}

export async function downloadSignedCVExcel(voucher,approvalRecords,capturedImages) {
  // Keep ExcelJS import used elsewhere; bypass its parser for exporting original master.
  return downloadSignedCVExcelOOXML(voucher,approvalRecords,capturedImages)
  if (!voucher?.id) throw Error('Open a saved Cash Voucher first.')
  const response=await fetch(CV_TEMPLATE_URL,{cache:'no-cache'})
  if (!response.ok || (response.headers.get('content-type')||'').includes('text/html'))
    throw Error('Original Cash Voucher template was not found in /public/templates.')
  const bytes=await response.arrayBuffer()
  if(bytes.byteLength<10000)throw Error('Original Cash Voucher template is missing or corrupted.')
  const ExcelJS=(await import('exceljs')).default
  const book=new ExcelJS.Workbook()
  await book.xlsx.load(bytes)
  const form=voucher.form_data||{}
  const sheetName=form.source_sheet==='PC (Manual)'?'PC (Manual)':'PC (Digital)'
  const sheet=book.getWorksheet(sheetName)
  if(!sheet || text(sheet.getCell('B5').value)!=='TITLE: PETTY CASH CLAIM FORM')
    throw Error('Unexpected original XLSX template version; cannot safely print.')
  // Populate only the original mapped form cells, no merge or print-area edits.
  set(sheet,'H10',dateMY(form.date_of_request))
  set(sheet,'D13',text(form.claimant_name))
  set(sheet,'D14',text(form.staff_id))
  set(sheet,'D15',text(form.position))
  set(sheet,'D16',text(form.department))
  set(sheet,'D17',text(form.branch))
  set(sheet,'G13',text(form.claim_category))
  set(sheet,'G14',text(form.remarks))
  set(sheet,'C18',text(form.legacy_category))
  putReceiptRows(sheet,form.lines||[])

  const signed=Array.isArray(approvalRecords)?approvalRecords.filter(a=>a.voucher_id===voucher.id):[]
  for (const stage of ['applicable_hod','finance_hod']) {
    const approval=signed.find(a=>a.authority===stage)
    if (!approval)continue
    const png=await makeSignatureStamp(approval,stage)
    if (!png)throw Error('Missing signer username/date or drawing for '+stage)
    // Endorsed HOD: E39:E43. Finance Manager: H39:I43.
    const isHOD=stage==='applicable_hod'
    const anchor=isHOD?'E39':'H39'
    const left=isHOD?4.04:7.04
    const width=isHOD?182:186
    // Cover original blank placeholder within the existing merged signature box.
    // No layout dimensions, page setup or original print area are modified.
    const c=sheet.getCell(anchor)
    c.value=''
    const imageId=book.addImage({base64:png,extension:'png'})
    sheet.addImage(imageId,{
      tl:{col:left,row:38.08},
      ext:{width,height:112},
      editAs:'oneCell'
    })
  }

  // Explicitly preserve original one-page A4 portrait print setup.
  // The original Excel workbook has its own print area and paper-scale settings.
  const blob=new Blob([await book.xlsx.writeBuffer()],{
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  const link=document.createElement('a')
  const href=URL.createObjectURL(blob)
  link.href=href
  link.download=(text(voucher.cv_number)||'CV')+'_Signed.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(()=>URL.revokeObjectURL(href),60000)
  return {filename:link.download,hasBothSignatures:signed.some(x=>x.authority==='applicable_hod')&&signed.some(x=>x.authority==='finance_hod')}
}
