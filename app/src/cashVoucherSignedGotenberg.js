// JSYNC Step 49G — CLOSED CV -> one-sheet signed Excel -> Gotenberg PDF.
// Browser only prepares workbook in memory. The private Codespaces Vite
// endpoint verifies signed CLOSED CV and proxies to localhost Gotenberg.
// Production must replace the Vite-only pilot with a protected backend service.
import { supabase } from './lib/supabase'
const MASTER_URL='/templates/JSYNC_CV_PDF_Template.xlsx'
const EXPORT_PATH='/api/jsync/documents/cv-pdf'
const fmt=(v)=>String(v??'').trim()
function dateMY(value){
 if(!value)return ''
 const d=/^\d{4}-\d{2}-\d{2}$/.test(String(value))
   ?new Date(String(value)+'T12:00:00+08:00'):new Date(value)
 if(Number.isNaN(d.getTime()))return String(value)
 return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(d)
}
function drawStampImage(approval){
 return new Promise((resolve,reject)=>{
  const url=approval?.signature_png
  if(!url?.startsWith('data:image/png;base64,')||!approval?.approved_username||!approval?.approved_at){
   reject(Error('Signed CV requires recorded signature, username and date for both HODs.'))
   return
  }
  const img=new Image()
  img.onload=()=>{
   try{
    const canvas=document.createElement('canvas')
    canvas.width=720;canvas.height=405
    const ctx=canvas.getContext('2d')
    if(!ctx)throw Error('Unable to render digital signature.')
    ctx.clearRect(0,0,720,405)
    // Preserve transparent background so original "Name / Signature / Date"
    // labels and borders remain visible beneath our actual signoff.
    const scale=Math.min(620/img.width,172/img.height)
    const x=35+(620-img.width*scale)/2
    ctx.drawImage(img,x,15,img.width*scale,img.height*scale)
    const name=fmt(approval.approved_username)
    const font='"Monotype Corsiva","Apple Chancery","Brush Script MT",cursive'
    let size=69
    while(size>28){
      ctx.font='italic '+size+'px '+font
      if(ctx.measureText(name).width<630)break
      size-=3
    }
    ctx.fillStyle='#17344a'
    ctx.fillText(name,45,290)
    ctx.font='26px Arial,sans-serif'
    ctx.fillStyle='#323c46'
    ctx.fillText('Date: '+dateMY(approval.approved_at),45,366)
    resolve(canvas.toDataURL('image/png'))
   }catch(e){reject(e)}
  }
  img.onerror=()=>reject(Error('Stored HOD signature image cannot be decoded.'))
  img.src=url
 })
}
const bind=(sheet,addr,value)=>{
 if(value!==undefined&&value!==null&&value!=='')
   sheet.getCell(addr).value=value
}
export async function generateSignedCVSingleSheet(voucher,approvals){
 if(!voucher?.id||voucher.status!=='closed')throw Error('Only CLOSED Cash Vouchers can export signed PDFs.')
 const list=(approvals||[]).filter(a=>a.voucher_id===voucher.id)
 const hod=list.find(a=>a.authority==='applicable_hod')
 const fm=list.find(a=>a.authority==='finance_hod')
 if(!hod||!fm)throw Error('Both Applicable HOD and Finance Manager must digitally approve first.')
 const response=await fetch(MASTER_URL,{cache:'no-store'})
 if(!response.ok||response.headers.get('content-type')?.includes('text/html'))
   throw Error('One-sheet JSYNC_CV_PDF_Template.xlsx missing in public/templates.')
 const bytes=await response.arrayBuffer()
 if(bytes.byteLength<10000)throw Error('One-sheet CV PDF template missing or corrupted.')
 const ExcelJS=(await import('exceljs')).default
 const book=new ExcelJS.Workbook()
 try{await book.xlsx.load(bytes)}catch(e){throw Error('Could not read the one-sheet CV PDF template: '+(e?.message||e))}
 if(book.worksheets.length!==1||book.worksheets[0].name!=='PC (Digital)')
  throw Error('Signed PDF export requires exactly one sheet named PC (Digital).')
 const sheet=book.worksheets[0]
 const data=voucher.form_data||{}
 bind(sheet,'H10',dateMY(data.date_of_request))
 bind(sheet,'D13',fmt(data.claimant_name))
 bind(sheet,'D14',fmt(data.staff_id))
 bind(sheet,'D15',fmt(data.position))
 bind(sheet,'D16',fmt(data.department))
 bind(sheet,'D17',fmt(data.branch))
 bind(sheet,'G13',fmt(data.claim_category))
 bind(sheet,'G14',fmt(data.remarks))
 bind(sheet,'C18',fmt(data.legacy_category))
 ;(data.lines||[]).slice(0,10).forEach((l,i)=>{
  const r=21+i
  bind(sheet,'C'+r,dateMY(l.receipt_date))
  bind(sheet,'D'+r,fmt(l.receipt_no))
  bind(sheet,'E'+r,fmt(l.description))
  bind(sheet,'F'+r,fmt(l.expense_category))
  bind(sheet,'G'+r,fmt(l.expenses_branch))
  if(l.amount!==''&&l.amount!==undefined&&l.amount!==null){
   const n=Number(l.amount)
   if(!Number.isFinite(n)||n<0)throw Error('Invalid CV amount at expense row '+(i+1))
   sheet.getCell('H'+r).value=n
  }
  bind(sheet,'I'+r,fmt(l.receipt_attached))
 })
 const total=Number(voucher.total_amount)
 if(!Number.isFinite(total))throw Error('Saved CV total amount is invalid.')
 sheet.getCell('H31').value={formula:'SUM(H21:H30)',result:total}
 // Coordinates confirmed by the 49F-V2 visual alignment test.
 const signerPositions=[
   {approval:hod,tl:{col:4.18,row:38.10},ext:{width:150,height:102}},
   {approval:fm,tl:{col:7.04,row:38.10},br:{col:8.96,row:42.90}}
 ]
 for(const item of signerPositions){
  const png=await drawStampImage(item.approval)
  const id=book.addImage({base64:png,extension:'png'})
  sheet.addImage(id,{tl:item.tl,...(item.ext?{ext:item.ext}:{br:item.br}),editAs:'oneCell'})
 }
 return new Blob([await book.xlsx.writeBuffer()],{
  type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
 })
}
export async function downloadSignedCVViaGotenberg(voucher,approvals){
 const {data:{session},error:sessionError}=await supabase.auth.getSession()
 if(sessionError||!session?.access_token)throw Error('Your session expired. Please log in again.')
 const workbook=await generateSignedCVSingleSheet(voucher,approvals)
 const response=await fetch(EXPORT_PATH,{
  method:'POST',
  headers:{
   'Authorization':'Bearer '+session.access_token,
   'X-JSYNC-CV-ID':voucher.id,
   'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  },
  body:workbook,
  cache:'no-store'
 })
 if(!response.ok){
  const type=response.headers.get('content-type')||''
  let message='Document conversion failed (HTTP '+response.status+').'
  if(type.includes('application/json')){
   const result=await response.json().catch(()=>null)
   if(result?.error)message=result.error
  }
  else if(response.status===404)message='Development PDF conversion endpoint is not installed. Restart Vite.'
  throw Error(message)
 }
 if(!response.headers.get('content-type')?.includes('application/pdf'))
  throw Error('The document engine did not return a PDF.')
 const pdf=await response.blob()
 if(pdf.size<1000)throw Error('PDF document returned by engine is empty.')
 const uri=URL.createObjectURL(pdf)
 const link=document.createElement('a')
 link.href=uri
 link.download=String(voucher.cv_number||'CV').replace(/[^A-Za-z0-9_-]/g,'_')+'_Signed.pdf'
 document.body.appendChild(link)
 link.click()
 link.remove()
 setTimeout(()=>URL.revokeObjectURL(uri),60000)
 return {filename:link.download}
}
