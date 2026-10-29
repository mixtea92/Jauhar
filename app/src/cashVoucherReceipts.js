// JSYNC CV 48J: private receipt upload/preview helpers.
// Only JPG, PNG, WEBP, PDF. Max 10 MB per expense row. Desktop browsers only.
export const CV_RECEIPT_BUCKET='jsync-cv-receipts'
export const CV_RECEIPT_MAX_BYTES=10*1024*1024
const types={
 'application/pdf':'.pdf','image/jpeg':'.jpg',
 'image/png':'.png','image/webp':'.webp'
}
export const CV_RECEIPT_ACCEPT='application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp'
export function validateCVReceiptFile(file) {
 if(!file)throw Error('Choose a receipt file first.')
 if(!Object.hasOwn(types,file.type))throw Error('Receipt must be PDF, JPG, PNG or WEBP.')
 if(file.size<1||file.size>CV_RECEIPT_MAX_BYTES)throw Error('Receipt file must be between 1 byte and 10 MB.')
 const ext=(file.name.match(/\.([^.]+)$/)?.[1]||'').toLowerCase()
 if(!['pdf','jpg','jpeg','png','webp'].includes(ext))throw Error('Receipt must have a PDF, JPG, JPEG, PNG or WEBP extension.')
 if(ext==='pdf'&&file.type!=='application/pdf' ||
    (ext==='jpg'||ext==='jpeg')&&file.type!=='image/jpeg' ||
    ext==='png'&&file.type!=='image/png' ||
    ext==='webp'&&file.type!=='image/webp')throw Error('Receipt file format does not match its extension.')
 return types[file.type]
}
export async function openPrivateCVReceipt(supabase,receipt) {
 if(!receipt?.storage_path)throw Error('No uploaded receipt available for this row.')
 const tab=window.open('about:blank','_blank')
 try {
   const {data,error}=await supabase.storage.from(CV_RECEIPT_BUCKET)
     .createSignedUrl(receipt.storage_path,120)
   if(error)throw error
   if(tab)tab.location.replace(data.signedUrl)
   else {
     const link=document.createElement('a')
     link.href=data.signedUrl
     link.target='_blank'
     link.rel='noopener noreferrer'
     document.body.appendChild(link)
     link.click()
     link.remove()
   }
 }catch(e) {
   if(tab)tab.close()
   throw e
 }
}
