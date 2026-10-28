// JSYNC Cash Voucher Step 49I — screenshot/CROP what the user really sees.
// No reconstructed font, no re-drawn text, no opaque white card background.
// Capture only the signature image + visible username + date area from the
// signed CV detail screen. Convert to cropped, transparent PNG for XLSX.
function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image()
    img.onload=()=>resolve(img)
    img.onerror=()=>reject(Error('Unable to capture signature image'))
    img.src=src
  })
}
async function captureOne(authority){
  const node=document.querySelector('[data-jsync-cv-signature-capture="'+authority+'"]')
  if(!node)throw Error('Open the signed CV record before downloading its Excel file.')
  if(document.fonts?.ready)await document.fonts.ready
  const {toPng}=await import('html-to-image')
  const dataUrl=await toPng(node,{
    cacheBust:true,pixelRatio:3,backgroundColor:'transparent',
    style:{backgroundColor:'transparent',boxShadow:'none'}
  })
  const image=await loadImage(dataUrl)
  const canvas=document.createElement('canvas')
  canvas.width=image.width;canvas.height=image.height
  const ctx=canvas.getContext('2d',{willReadFrequently:true})
  if(!ctx)throw Error('Image crop is not available in this browser')
  ctx.clearRect(0,0,canvas.width,canvas.height)
  ctx.drawImage(image,0,0)
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height)
  const data=pixels.data
  let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const i=(y*canvas.width+x)*4
    const r=data[i],g=data[i+1],b=data[i+2],alpha=data[i+3]
    if(alpha===0)continue
    // Older saved signature PNGs may contain pure-white opaque pixels.
    // Remove them, but preserve the original navy strokes and gold username.
    if(r>=248&&g>=248&&b>=248){data[i+3]=0;continue}
    if(r>=235&&g>=235&&b>=235&&Math.max(r,g,b)-Math.min(r,g,b)<10){
      data[i+3]=Math.round(alpha*Math.max(0,(248-Math.min(r,g,b))/13))
    }
    if(data[i+3]>12){
      if(x<minX)minX=x;if(y<minY)minY=y
      if(x>maxX)maxX=x;if(y>maxY)maxY=y
    }
  }
  if(maxX<minX||maxY<minY)throw Error('Captured HOD signature image is blank')
  ctx.putImageData(pixels,0,0)
  const pad=Math.round(8*3)
  minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad)
  maxX=Math.min(canvas.width-1,maxX+pad);maxY=Math.min(canvas.height-1,maxY+pad)
  const trimmed=document.createElement('canvas')
  trimmed.width=maxX-minX+1;trimmed.height=maxY-minY+1
  trimmed.getContext('2d').drawImage(canvas,minX,minY,trimmed.width,trimmed.height,0,0,trimmed.width,trimmed.height)
  return trimmed.toDataURL('image/png').split(',')[1]
}
export async function captureSignedCVSignatures(){
  const result={}
  for(const stage of ['applicable_hod','finance_hod'])
    result[stage]=await captureOne(stage)
  return result
}
