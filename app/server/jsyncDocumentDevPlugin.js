// JSYNC Step 49G — development-only document conversion endpoint.
// DO NOT expose Gotenberg port 3000 publicly. The Vite app proxies it locally.
// Security: authenticated user, active user profile, CLOSED and readable CV,
// both actual HOD approvals with signed timestamps, one-sheet XLSX, size limit.
// This is a Codespaces pilot, not the production document engine.
import { createClient } from '@supabase/supabase-js'
const API='/api/jsync/documents/cv-pdf'
const MAX_XLSX=6*1024*1024

function fail(res,status,message){
  res.statusCode=status
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control','no-store')
  res.end(JSON.stringify({error:message}))
}
async function bufferBody(req){
  const length=Number(req.headers['content-length']||0)
  if(length>MAX_XLSX)throw Object.assign(Error('Signed workbook exceeds 6 MB'),{status:413})
  const chunks=[]
  let size=0
  for await(const chunk of req){
    size+=chunk.length
    if(size>MAX_XLSX)throw Object.assign(Error('Signed workbook exceeds 6 MB'),{status:413})
    chunks.push(chunk)
  }
  if(size<1000)throw Object.assign(Error('Signed workbook is empty'),{status:400})
  return Buffer.concat(chunks)
}
function envValue(server,k){
 return server.config.env?.[k]||process.env[k]||''
}
export function jsyncDocumentDevPlugin(){
 return {
  name:'jsync-document-conversion-dev',
  apply:'serve',
  configureServer(server){
   server.middlewares.use(async(req,res,next)=>{
    if(req.url?.split('?')[0]!==API)return next()
    res.setHeader('Cache-Control','no-store, max-age=0')
    res.setHeader('X-Content-Type-Options','nosniff')
    if(req.method!=='POST'){res.setHeader('Allow','POST');return fail(res,405,'Use POST to export signed CV PDF')}
    const authorization=req.headers.authorization||''
    const token=authorization.match(/^Bearer\s+(\S+)$/i)?.[1]
    const voucherId=req.headers['x-jsync-cv-id']
    if(!token)return fail(res,401,'Sign in before requesting CV PDF.')
    if(typeof voucherId!=='string'||!(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i).test(voucherId))
      return fail(res,400,'Invalid Cash Voucher ID')
    const url=envValue(server,'VITE_SUPABASE_URL')
    const key=envValue(server,'VITE_SUPABASE_PUBLISHABLE_KEY')
    if(!url||!key)return fail(res,503,'Development Supabase configuration missing')
    try{
     const client=createClient(url,key,{
      global:{headers:{Authorization:'Bearer '+token}},
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
     })
     const {data:auth,error:authError}=await client.auth.getUser(token)
     if(authError||!auth?.user)return fail(res,401,'Session invalid or expired. Login again.')
     const [{data:profile,error:profileError},{data:v,error:voucherError}]=await Promise.all([
      client.from('user_profiles').select('id,role,department,is_active').eq('id',auth.user.id).single(),
      client.from('cash_vouchers').select('id,cv_number,status,applicable_department').eq('id',voucherId).single()
     ])
     if(profileError||!profile?.is_active||voucherError||!v)
       return fail(res,403,'You do not have permission to export this Cash Voucher.')
     if(v.status!=='closed')return fail(res,409,'Only a CLOSED CV can be exported with both signatures.')
     const {data:approvals,error:approvalError}=await client.from('cash_voucher_approvals')
       .select('authority,approved_at,approved_username,signature_png').eq('voucher_id',voucherId)
     if(approvalError)return fail(res,403,'Unable to verify signed approvals.')
     for(const stage of ['applicable_hod','finance_hod']){
      if(!approvals?.some(a=>a.authority===stage&&a.signature_png?.startsWith('data:image/png;base64,')&&a.approved_at&&a.approved_username))
        return fail(res,409,'Both HOD digital signatures are required.')
     }
     if(!String(req.headers['content-type']||'').includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
       return fail(res,415,'Only the official .xlsx source is supported.')
     const xlsx=await bufferBody(req)
     if(xlsx[0]!==80||xlsx[1]!==75)return fail(res,400,'Invalid XLSX format')
     // Pilot sanity check. Prevent accidental whole-workbook exports.
     const {default:ExcelJS}=await import('exceljs')
     const workbook=new ExcelJS.Workbook()
     await workbook.xlsx.load(xlsx)
     if(workbook.worksheets.length!==1||workbook.worksheets[0].name!=='PC (Digital)')
       return fail(res,400,'Only the single PC (Digital) sheet can be converted.')
     const form=new FormData()
     form.append('files',new Blob([xlsx],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'JSYNC_CV_PDF_Template.xlsx')
     const target='http://127.0.0.1:3000/forms/libreoffice/convert'
     const controller=new AbortController()
     const timer=setTimeout(()=>controller.abort(),60000)
     let converted
     try{converted=await fetch(target,{method:'POST',body:form,signal:controller.signal})}
     finally{clearTimeout(timer)}
     if(!converted.ok)
       throw Object.assign(Error('Gotenberg conversion failed (HTTP '+converted.status+'). Check Docker container.'),{status:502})
     const pdf=Buffer.from(await converted.arrayBuffer())
     if(pdf.byteLength<1000||pdf.subarray(0,5).toString('ascii')!=='%PDF-')
       throw Object.assign(Error('Gotenberg returned an invalid PDF'),{status:502})
     const {PDFDocument}=await import('pdf-lib')
     const verify=await PDFDocument.load(pdf)
     const p=verify.getPages()[0]
     const width=p?.getWidth()||0,height=p?.getHeight()||0
     if(verify.getPageCount()!==1||Math.abs(width-595.28)>3||Math.abs(height-841.89)>3)
       throw Object.assign(Error('Conversion produced wrong print size or page count. Original 1-sheet A4 template required.'),{status:422})
     const filename=String(v.cv_number||'CV').replace(/[^A-Za-z0-9_-]/g,'_')+'_Signed.pdf'
     res.statusCode=200
     res.setHeader('Content-Type','application/pdf')
     res.setHeader('Content-Disposition','attachment; filename="'+filename+'"')
     res.setHeader('Content-Length',String(pdf.length))
     res.end(pdf)
    }catch(err){
     const status=Number(err?.status)||502
     fail(res,status,err?.name==='AbortError'?'Document engine timed out':(err?.message||'Signed CV PDF conversion failed.'))
    }
   })
  }
 }
}
