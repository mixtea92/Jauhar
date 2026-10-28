// JSYNC Cash Voucher 48N - direct signed PDF export using the approved
// ONE-PAGE BLANK PDF rendered ONCE from the unchanged official Excel master.
// The PDF is the print-fidelity reference; original XLSX is read for grid
// coordinates only and is not regenerated/modified.
// IMPORTANT: Put FIN_FM_PC_Petty Cash.pdf (blank master, PC Digital sheet)
// in app/public/templates/ before enabling PDF export.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import JSZip from 'jszip'
import { CV_TEMPLATE_URL } from './cashVoucherExcel'

export const CV_PDF_TEMPLATE_URL='/templates/FIN_FM_PC_Petty Cash.pdf'
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const PACK='http://schemas.openxmlformats.org/package/2006/relationships'
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const FONT_COLOR=rgb(0.10,0.16,0.25)

function getXML(raw,label){
  const doc=new DOMParser().parseFromString(raw,'application/xml')
  if(doc.getElementsByTagName('parsererror').length)
    throw Error('Cannot inspect original Excel '+label+' grid.')
  return doc
}
const els=(d,ns,n)=>Array.from(d.getElementsByTagNameNS(ns,n))
const number=(v,fallback)=>{const n=Number(v);return Number.isFinite(n)?n:fallback}
function pdfText(s){
  // Built-in PDF font is WinAnsi; replace unsupported symbols rather than failing export.
  return String(s??'').replace(/[^\x20-\x7e\u00a0-\u00ff]/g,'-').trim()
}
function dateMY(value){
  if(!value)return ''
  const d=/^\d{4}-\d{2}-\d{2}$/.test(String(value))?
    new Date(String(value)+'T12:00:00+08:00'):new Date(value)
  if(Number.isNaN(d.getTime()))return String(value)
  return new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'
  }).format(d)
}
function linkTarget(base,target){
  if(target.startsWith('/'))return target.replace(/^\/+/,'')
  const parts=(base+'/'+target).split('/')
  const out=[]
  for(const part of parts){
    if(!part||part==='.')continue
    if(part==='..'){if(!out.length)throw Error('Invalid workbook sheet path');out.pop()}
    else out.push(part)
  }
  return out.join('/')
}
async function originalGrid(){
  const response=await fetch(CV_TEMPLATE_URL,{cache:'no-cache'})
  if(!response.ok)throw Error('Original CV Excel master is unavailable.')
  const bytes=await response.arrayBuffer()
  if(bytes.byteLength<10000)throw Error('Original CV Excel master is missing.')
  const zip=await JSZip.loadAsync(bytes)
  const wb=zip.file('xl/workbook.xml')
  const relationships=zip.file('xl/_rels/workbook.xml.rels')
  if(!wb||!relationships)throw Error('Invalid original CV master workbook.')
  const doc=getXML(await wb.async('string'),'workbook')
  const rels=getXML(await relationships.async('string'),'relationships')
  const name='PC (Digital)'
  const sheet=els(doc,MAIN,'sheet').find(x=>x.getAttribute('name')===name)
  if(!sheet)throw Error('Original template is missing PC (Digital) sheet.')
  const relId=sheet.getAttributeNS(REL,'id')
  const rel=els(rels,PACK,'Relationship').find(x=>x.getAttribute('Id')===relId)
  if(!rel)throw Error('Original template has invalid sheet relationships.')
  const sheetPath=linkTarget('xl',rel.getAttribute('Target'))
  const sheetFile=zip.file(sheetPath)
  if(!sheetFile)throw Error('Original CV worksheet is missing.')
  const sx=getXML(await sheetFile.async('string'),'sheet')
  const fmt=els(sx,MAIN,'sheetFormatPr')[0]
  const defaultRowHeight=number(fmt?.getAttribute('defaultRowHeight'),15)
  const defaultColWidth=number(fmt?.getAttribute('defaultColWidth'),8.43)
  const cols=els(sx,MAIN,'col')
  const rows=new Map(els(sx,MAIN,'row').map(x=>[Number(x.getAttribute('r')),number(x.getAttribute('ht'),defaultRowHeight)]))
  const widthOf=i=>{
    const spec=cols.find(x=>number(x.getAttribute('min'),0)<=i&&number(x.getAttribute('max'),0)>=i)
    const w=number(spec?.getAttribute('width'),defaultColWidth)
    // Excel character-width unit -> points (Calibri 11 approximation).
    const pixels=Math.floor((256*w+Math.floor(128/7))/256*7)
    return pixels*0.75
  }
  // The master print area is B1:I50.
  const widths=Array.from({length:8},(_,k)=>widthOf(k+2))
  const heights=Array.from({length:50},(_,k)=>rows.get(k+1)||defaultRowHeight)
  const margins=els(sx,MAIN,'pageMargins')[0]
  const options=els(sx,MAIN,'printOptions')[0]
  return {
    widths,heights,
    margins:{
      left:number(margins?.getAttribute('left'),0.7),
      right:number(margins?.getAttribute('right'),0.7),
      top:number(margins?.getAttribute('top'),0.75),
      bottom:number(margins?.getAttribute('bottom'),0.75),
    },
    centeredX:options?.getAttribute('horizontalCentered')==='1',
    centeredY:options?.getAttribute('verticalCentered')==='1'
  }
}
function layout(grid,page) {
  const W=page.getWidth(),H=page.getHeight()
  if(W>H||Math.abs(W-595.3)>35||Math.abs(H-841.9)>35)
    throw Error('PDF master must contain one A4 portrait page. Export original Excel as A4 portrait PDF.')
  const totalW=grid.widths.reduce((a,b)=>a+b,0)
  const totalH=grid.heights.reduce((a,b)=>a+b,0)
  const margins=grid.margins
  const usableW=W-(margins.left+margins.right)*72
  const usableH=H-(margins.top+margins.bottom)*72
  if(usableW<=0||usableH<=0)throw Error('Invalid print margins in Excel master.')
  const scale=Math.min(1,usableW/totalW,usableH/totalH)
  const actualW=totalW*scale,actualH=totalH*scale
  const left=margins.left*72+(grid.centeredX?(usableW-actualW)/2:0)
  const top=H-margins.top*72-(grid.centeredY?(usableH-actualH)/2:0)
  function xAt(col){
    if(col<2||col>10)throw Error('Invalid original Excel column '+col)
    return left+grid.widths.slice(0,col-2).reduce((a,b)=>a+b,0)*scale
  }
  function yAt(row){
    if(row<1||row>51)throw Error('Invalid original Excel row '+row)
    return top-grid.heights.slice(0,row-1).reduce((a,b)=>a+b,0)*scale
  }
  function width(colA,colB){return xAt(colB)-xAt(colA)}
  function height(rowA,rowB){return yAt(rowA)-yAt(rowB)}
  return {xAt,yAt,width,height,scale}
}
function draw(page,font,map,cell,value,span=1,preferred=9){
  if(value===undefined||value===null||String(value)==='')return
  const match=cell.match(/^([B-I])(\d{1,2})$/)
  if(!match)throw Error('Invalid CV target cell '+cell)
  const c=match[1].charCodeAt(0)-64
  const row=Number(match[2])
  const str=pdfText(value)
  if(!str)return
  const width=map.width(c,Math.min(10,c+span))-5
  let size=preferred*map.scale
  while(size>5*map.scale&&font.widthOfTextAtSize(str,size)>width)size-=0.5
  let output=str
  if(font.widthOfTextAtSize(output,size)>width){
    while(output.length>3&&font.widthOfTextAtSize(output+'...',size)>width)
      output=output.slice(0,-1)
    output+='...'
  }
  const rowH=map.height(row,row+1)
  page.drawText(output,{
    x:map.xAt(c)+3*map.scale,
    y:map.yAt(row)-rowH*0.74,
    size,font,color:FONT_COLOR
  })
}
async function signerStamp(approval){
  if(!approval?.signature_png||!approval?.approved_username||!approval?.approved_at)
    throw Error('HOD signature, username or approval date is missing.')
  const sig=await new Promise((resolve,reject)=>{
    const im=new Image()
    im.onload=()=>resolve(im)
    im.onerror=()=>reject(Error('Cannot decode HOD drawn signature'))
    im.src=approval.signature_png
  })
  const cv=document.createElement('canvas')
  cv.width=840;cv.height=500
  const ctx=cv.getContext('2d')
  if(!ctx)throw Error('Cannot create signed PDF stamp.')
  ctx.fillStyle='white';ctx.fillRect(0,0,cv.width,cv.height)
  const factor=Math.min(760/sig.width,225/sig.height)
  ctx.drawImage(sig,30,0,sig.width*factor,sig.height*factor)
  const signer=String(approval.approved_username)
  const fonts='"Monotype Corsiva","Apple Chancery","Brush Script MT",cursive'
  let size=80
  while(size>28){
    ctx.font='italic '+size+'px '+fonts
    if(ctx.measureText(signer).width<770)break
    size-=3
  }
  ctx.fillStyle='#15334c';ctx.fillText(signer,30,355)
  ctx.font='32px Arial,sans-serif'
  ctx.fillStyle='#444444';ctx.fillText('Date: '+dateMY(approval.approved_at),30,437)
  return cv.toDataURL('image/png')
}
function drawSigner(page,img,map,colA,colB,rowA,rowB){
  const x=map.xAt(colA)+1*map.scale
  const top=map.yAt(rowA)-2*map.scale
  const w=map.width(colA,colB)-3*map.scale
  const h=map.height(rowA,rowB)-4*map.scale
  if(w<=0||h<=0)throw Error('Invalid signature position in original CV print layout')
  page.drawImage(img,{x,y:top-h,width:w,height:h})
}
export async function downloadSignedCVPDF(voucher,approvals){
  if(!voucher?.id||voucher.status!=='closed')
    throw Error('Direct PDF download is available after both HODs have signed and CV is CLOSED.')
  const response=await fetch(CV_PDF_TEMPLATE_URL,{cache:'no-store'})
  if(!response.ok||response.headers.get('content-type')?.includes('text/html'))
    throw Error('One-time PDF master not installed. Export BLANK original Excel PC (Digital) to PDF and place it in app/public/templates/FIN_FM_PC_Petty Cash.pdf')
  const raw=await response.arrayBuffer()
  if(raw.byteLength<1000||new TextDecoder().decode(raw.slice(0,5))!=='%PDF-')
    throw Error('PDF master missing or invalid. Upload BLANK original Excel PDF to public/templates.')
  const doc=await PDFDocument.load(raw)
  if(doc.getPageCount()!==1)
    throw Error('PDF master must be 1 page. Export only the original PC (Digital) worksheet.')
  const page=doc.getPage(0)
  const grid=await originalGrid()
  const map=layout(grid,page)
  const font=await doc.embedFont(StandardFonts.Helvetica)
  const data=voucher.form_data||{}
  // Original Excel: H10 date; D13:D17 claimant; G13/G14 claim; C18 category.
  draw(page,font,map,'H10',dateMY(data.date_of_request),2,9)
  draw(page,font,map,'D13',data.claimant_name,2,9)
  draw(page,font,map,'D14',data.staff_id,2,9)
  draw(page,font,map,'D15',data.position,2,9)
  draw(page,font,map,'D16',data.department,2,9)
  draw(page,font,map,'D17',data.branch,2,9)
  draw(page,font,map,'G13',data.claim_category,2,9)
  draw(page,font,map,'G14',data.remarks,3,8)
  draw(page,font,map,'C18',data.legacy_category,2,8)
  ;(data.lines||[]).slice(0,10).forEach((l,i)=>{
    const r=21+i
    draw(page,font,map,'C'+r,dateMY(l.receipt_date),1,8)
    draw(page,font,map,'D'+r,l.receipt_no,1,8)
    draw(page,font,map,'E'+r,l.description,1,8)
    draw(page,font,map,'F'+r,l.expense_category,1,8)
    draw(page,font,map,'G'+r,l.expenses_branch,1,8)
    if(l.amount!==''&&l.amount!=null)
      draw(page,font,map,'H'+r,Number(l.amount).toFixed(2),1,8)
    draw(page,font,map,'I'+r,l.receipt_attached,1,8)
  })
  // H31 normally contains Excel SUM. Render total directly in PDF overlay.
  draw(page,font,map,'H31',Number(voucher.total_amount||0).toFixed(2),1,9)
  const found=(Array.isArray(approvals)?approvals:[]).filter(a=>a.voucher_id===voucher.id)
  const a=found.find(x=>x.authority==='applicable_hod')
  const b=found.find(x=>x.authority==='finance_hod')
  if(!a||!b)throw Error('Both digitally signed HOD approval records required.')
  drawSigner(page,await doc.embedPng(await signerStamp(a)),map,5,6,39,44)
  drawSigner(page,await doc.embedPng(await signerStamp(b)),map,8,10,39,44)
  const pdf=await doc.save({useObjectStreams:false})
  const blob=new Blob([pdf],{type:'application/pdf'})
  const url=URL.createObjectURL(blob)
  const link=document.createElement('a')
  link.href=url
  link.download=String(voucher.cv_number||'CV').replace(/[^a-zA-Z0-9_-]/g,'_')+'_Signed.pdf'
  document.body.appendChild(link);link.click();link.remove()
  setTimeout(()=>URL.revokeObjectURL(url),60000)
  return {filename:link.download}
}
