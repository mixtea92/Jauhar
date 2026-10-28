// JSYNC Cash Voucher 48M — signed XLSX export via OOXML/ZIP patching.
// Preserves the original Excel master's printer settings, logo, print area,
// formulas, data validations, drawings and unrelated worksheets byte-for-byte
// within the ZIP. Never edits the source file on the server.
import JSZip from 'jszip'
import { CV_TEMPLATE_URL } from './cashVoucherExcel'

const S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const P='http://schemas.openxmlformats.org/package/2006/relationships'
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const X='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
const A='http://schemas.openxmlformats.org/drawingml/2006/main'
const IMGREL=R+'/image'
const enc=new XMLSerializer()

function xml(value,label){
  const d=new DOMParser().parseFromString(value,'application/xml')
  if(d.querySelector('parsererror'))throw Error('Invalid original XLSX '+label+' XML. No changes were saved.')
  return d
}
function nodes(doc,ns,name){return Array.from(doc.getElementsByTagNameNS(ns,name))}
function node(doc,ns,prefix,name,content){
  const e=doc.createElementNS(ns,prefix+':'+name)
  if(content!==undefined&&content!==null)e.textContent=String(content)
  return e
}
function child(doc,parent,ns,prefix,name,value){
  const e=node(doc,ns,prefix,name,value);parent.appendChild(e);return e
}
function normalPath(root,target){
  if(target.startsWith('/'))return target.replace(/^\/+/,'')
  const all=(root+'/'+target).split('/')
  const result=[]
  for(const x of all){
    if(!x||x==='.')continue
    if(x==='..'){if(!result.length)throw Error('Invalid XLSX package path');result.pop()}
    else result.push(x)
  }
  return result.join('/')
}
function setCell(doc,addr,value,numeric=false,optional=false){
  if(value===undefined||value===null||value==='')return
  const c=nodes(doc,S,'c').find(x=>x.getAttribute('r')===addr)
  if(!c){
    if(optional)return
    throw Error('Expected original Excel cell '+addr+' was missing; export stopped to protect layout.')
  }
  while(c.firstChild)c.removeChild(c.firstChild)
  if(numeric){
    const n=Number(value)
    if(!Number.isFinite(n)||n<0)throw Error('Invalid CV amount in '+addr)
    c.removeAttribute('t')
    child(doc,c,S,'x','v',String(n))
  }else{
    c.setAttribute('t','inlineStr')
    const is=child(doc,c,S,'x','is')
    const t=child(doc,is,S,'x','t',String(value))
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve')
  }
}
function dateMY(iso){
  if(!iso)return ''
  const d=/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ?
    new Date(String(iso)+'T12:00:00+08:00') : new Date(iso)
  if(Number.isNaN(d.getTime()))return String(iso)
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(d)
}
async function imageFromDataURL(url){
  return new Promise((resolve,reject)=>{
    const im=new Image()
    im.onload=()=>resolve(im)
    im.onerror=()=>reject(Error('Stored HOD signature image cannot be decoded'))
    im.src=url
  })
}
async function signerStamp(approval,stage){
  if(!approval?.signature_png||!approval?.approved_at||!approval?.approved_username)
    throw Error('Missing original digital signature, username or approval date for '+stage)
  const username=String(approval.approved_username).trim()
  const canvas=document.createElement('canvas')
  canvas.width=720;canvas.height=400
  const ctx=canvas.getContext('2d')
  if(!ctx)throw Error('Unable to draw CV signature stamp in this browser')
  ctx.fillStyle='#ffffff'
  ctx.fillRect(0,0,canvas.width,canvas.height)
  const sig=await imageFromDataURL(approval.signature_png)
  const ratio=Math.min(620/sig.width,190/sig.height)
  ctx.drawImage(sig,30,4,Math.round(sig.width*ratio),Math.round(sig.height*ratio))
  let size=66
  const fonts='"Monotype Corsiva","Apple Chancery","Brush Script MT",cursive'
  while(size>24){
    ctx.font='italic '+size+'px '+fonts
    if(ctx.measureText(username).width<670)break
    size-=2
  }
  ctx.fillStyle='#13334e';ctx.fillText(username,30,286)
  ctx.fillStyle='#333b45';ctx.font='30px Arial, sans-serif'
  ctx.fillText('Date: '+dateMY(approval.approved_at),30,348)
  return canvas.toDataURL('image/png').split(',')[1]
}
function relTarget(rels,id){
  const r=nodes(rels,P,'Relationship').find(e=>e.getAttribute('Id')===id)
  if(!r)throw Error('Master workbook missing expected relationship '+id)
  return r.getAttribute('Target')
}
function appendSignatureDrawing(drawDoc,relDoc,stage,base64){
  const rels=nodes(relDoc,P,'Relationship')
  let maxRel=0
  rels.forEach(r=>{const x=Number((r.getAttribute('Id')||'').match(/^rId(\d+)$/)?.[1]);if(x>maxRel)maxRel=x})
  const relId='rId'+(maxRel+1)
  const rel=relDoc.createElementNS(P,'Relationship')
  rel.setAttribute('Id',relId)
  rel.setAttribute('Type',IMGREL)
  const filename='jsync-cv-signed-'+stage+'.png'
  rel.setAttribute('Target','../media/'+filename)
  relDoc.documentElement.appendChild(rel)

  const existingIds=nodes(drawDoc,X,'cNvPr').map(x=>Number(x.getAttribute('id')||0))
  const drawingId=Math.max(2,...existingIds)+1
  const approvedByHOD=stage==='applicable_hod'
  const fromCol=approvedByHOD?4:7
  const toCol=approvedByHOD?5:9
  const anchor=node(drawDoc,X,'xdr','twoCellAnchor')
  anchor.setAttribute('editAs','oneCell')
  const start=child(drawDoc,anchor,X,'xdr','from')
  child(drawDoc,start,X,'xdr','col',fromCol)
  child(drawDoc,start,X,'xdr','colOff',57000)
  child(drawDoc,start,X,'xdr','row',38)
  child(drawDoc,start,X,'xdr','rowOff',28000)
  const finish=child(drawDoc,anchor,X,'xdr','to')
  child(drawDoc,finish,X,'xdr','col',toCol)
  child(drawDoc,finish,X,'xdr','colOff',0)
  child(drawDoc,finish,X,'xdr','row',43)
  child(drawDoc,finish,X,'xdr','rowOff',0)

  const pic=child(drawDoc,anchor,X,'xdr','pic')
  const nv=child(drawDoc,pic,X,'xdr','nvPicPr')
  const cn=child(drawDoc,nv,X,'xdr','cNvPr')
  cn.setAttribute('id',String(drawingId))
  cn.setAttribute('name','JSYNC '+(approvedByHOD?'Applicable HOD':'Finance Manager')+' verified digital signature')
  child(drawDoc,nv,X,'xdr','cNvPicPr')
  const fill=child(drawDoc,pic,X,'xdr','blipFill')
  const blip=child(drawDoc,fill,A,'a','blip')
  blip.setAttributeNS(R,'r:embed',relId)
  const stretch=child(drawDoc,fill,A,'a','stretch')
  child(drawDoc,stretch,A,'a','fillRect')
  const sp=child(drawDoc,pic,X,'xdr','spPr')
  const transform=child(drawDoc,sp,A,'a','xfrm')
  const off=child(drawDoc,transform,A,'a','off')
  off.setAttribute('x','0');off.setAttribute('y','0')
  const ext=child(drawDoc,transform,A,'a','ext')
  ext.setAttribute('cx',String((approvedByHOD?185:185)*9525))
  ext.setAttribute('cy',String(112*9525))
  const geom=child(drawDoc,sp,A,'a','prstGeom')
  geom.setAttribute('prst','rect')
  child(drawDoc,geom,A,'a','avLst')
  child(drawDoc,anchor,X,'xdr','clientData')
  drawDoc.documentElement.appendChild(anchor)
  return {filename,base64}
}
function validateZip(zip){
  for(const part of ['xl/workbook.xml','xl/_rels/workbook.xml.rels','[Content_Types].xml']){
    if(!zip.file(part))throw Error('Original CV Excel workbook missing '+part)
  }
}
export async function downloadSignedCVExcel(voucher,approvals){
  if(!voucher?.id||voucher.status!=='closed')
    throw Error('Download Signed CV is available only for a CLOSED Cash Voucher.')
  const response=await fetch(CV_TEMPLATE_URL,{cache:'no-cache'})
  if(!response.ok||response.headers.get('content-type')?.includes('text/html'))
    throw Error('Original official CV template is missing from public/templates.')
  const bytes=await response.arrayBuffer()
  if(bytes.byteLength<10000)throw Error('Original CV master XLSX is missing or truncated.')
  let zip
  try{zip=await JSZip.loadAsync(bytes,{checkCRC32:true})}
  catch(err){throw Error('Original CV Excel is not a valid XLSX ZIP: '+(err?.message||err))}
  validateZip(zip)

  const work=xml(await zip.file('xl/workbook.xml').async('string'),'workbook')
  const workRels=xml(await zip.file('xl/_rels/workbook.xml.rels').async('string'),'workbook relationships')
  const chosen=voucher.form_data?.source_sheet==='PC (Manual)'?'PC (Manual)':'PC (Digital)'
  const sh=nodes(work,S,'sheet').find(e=>e.getAttribute('name')===chosen)
  if(!sh)throw Error('Original template missing worksheet '+chosen)
  const sheetRel=sh.getAttributeNS(R,'id')
  const sheetPath=normalPath('xl',relTarget(workRels,sheetRel))
  if(!zip.file(sheetPath))throw Error('Original template missing '+sheetPath)
  const sheet=xml(await zip.file(sheetPath).async('string'),chosen)
  const data=voucher.form_data||{}
  setCell(sheet,'H10',dateMY(data.date_of_request))
  setCell(sheet,'D13',data.claimant_name)
  setCell(sheet,'D14',data.staff_id)
  setCell(sheet,'D15',data.position)
  setCell(sheet,'D16',data.department)
  setCell(sheet,'D17',data.branch)
  setCell(sheet,'G13',data.claim_category)
  setCell(sheet,'G14',data.remarks)
  setCell(sheet,'C18',data.legacy_category,false,true)
  ;(data.lines||[]).slice(0,10).forEach((l,i)=>{
    const r=21+i
    setCell(sheet,'C'+r,dateMY(l.receipt_date))
    setCell(sheet,'D'+r,l.receipt_no)
    setCell(sheet,'E'+r,l.description)
    setCell(sheet,'F'+r,l.expense_category)
    setCell(sheet,'G'+r,l.expenses_branch)
    setCell(sheet,'H'+r,l.amount,true)
    setCell(sheet,'I'+r,l.receipt_attached)
  })
  zip.file(sheetPath,enc.serializeToString(sheet))

  const available=Array.isArray(approvals)?approvals.filter(a=>a.voucher_id===voucher.id):[]
  const signed=[
    available.find(a=>a.authority==='applicable_hod'),
    available.find(a=>a.authority==='finance_hod')
  ]
  if(signed.some(a=>!a))throw Error('Both HOD approval records required to print a CLOSED CV.')
  const sheetFile=sheetPath.split('/').pop()
  const sheetDir=sheetPath.split('/').slice(0,-1).join('/')
  const sheetRelPath=sheetDir+'/_rels/'+sheetFile+'.rels'
  if(!zip.file(sheetRelPath))throw Error('Original XLSX missing worksheet drawing relationships')
  const sheetRels=xml(await zip.file(sheetRelPath).async('string'),'sheet relationships')
  const dr=nodes(sheet,S,'drawing')[0]
  const drawingRelId=dr?.getAttributeNS(R,'id')
  if(!drawingRelId)throw Error('Original XLSX has no logo drawing to attach signatures to.')
  const drawingPath=normalPath(sheetDir,relTarget(sheetRels,drawingRelId))
  if(!zip.file(drawingPath))throw Error('Original Excel logo drawing missing: '+drawingPath)
  const drawing=xml(await zip.file(drawingPath).async('string'),'logo drawing')
  const drawingParts=drawingPath.split('/')
  const drawingRelsPath=drawingParts.slice(0,-1).join('/')+'/_rels/'+drawingParts.at(-1)+'.rels'
  if(!zip.file(drawingRelsPath))throw Error('Original Excel drawing has no relationships.')
  const drawingRels=xml(await zip.file(drawingRelsPath).async('string'),'drawing relationships')
  for(let i=0;i<signed.length;i++){
    const stage=i===0?'applicable_hod':'finance_hod'
    const stamp=await signerStamp(signed[i],stage)
    const image=appendSignatureDrawing(drawing,drawingRels,stage,stamp)
    zip.file('xl/media/'+image.filename,image.base64,{base64:true})
  }
  zip.file(drawingPath,enc.serializeToString(drawing))
  zip.file(drawingRelsPath,enc.serializeToString(drawingRels))
  const out=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}})
  if(out.size<10000)throw Error('Export failed: resulting workbook is unexpectedly small.')
  const href=URL.createObjectURL(out)
  const link=document.createElement('a')
  link.href=href
  link.download=String(voucher.cv_number||'CV').replace(/[^a-z0-9-]/gi,'_')+'_Signed.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(()=>URL.revokeObjectURL(href),60000)
  return {filename:link.download,hasBothSignatures:true}
}
