#!/usr/bin/env node
// Step 49F-2 — SAFE, DUMMY-ONLY signature placement test.
// Reads JSYNC_CV_PDF_Template.xlsx, not the original FIN_FM_PC_Petty Cash.xlsx.
// Outputs a temporary test PDF with colored test stamps to public/ so Vite
// can show the page. No CV / HOD data, Supabase, PV or Delegation access.
const fs=require('node:fs')
const path=require('node:path')
const zlib=require('node:zlib')
const cp=require('node:child_process')
const ExcelJS=require('exceljs')
const {PDFDocument}=require('pdf-lib')

const root=process.cwd()
const template=path.join(root,'public/templates/JSYNC_CV_PDF_Template.xlsx')
const xlsx=path.join('/tmp','JSYNC_CV_Approval_Box_Test.xlsx')
const pdf=path.join(root,'public/__jsync_cv_alignment_test.pdf')
if(!fs.existsSync(template))throw Error('Run from app/; JSYNC_CV_PDF_Template.xlsx missing.')
function crc32(buffer){
  let crc=0xffffffff
  for(const byte of buffer){
    crc^=byte
    for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)
  }
  return (crc^0xffffffff)>>>0
}
function chunk(name,data){
  const tag=Buffer.from(name,'ascii')
  const sz=Buffer.alloc(4)
  sz.writeUInt32BE(data.length)
  const crc=Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([tag,data])))
  return Buffer.concat([sz,tag,data,crc])
}
function testStamp([red,green,blue]){
  const width=600,height=260
  const stride=width*4+1
  const raw=Buffer.alloc(stride*height)
  const dot=(x,y,a=235)=>{
    if(x<0||y<0||x>=width||y>=height)return
    const idx=y*stride+1+x*4
    raw[idx]=red;raw[idx+1]=green;raw[idx+2]=blue;raw[idx+3]=a
  }
  const thickDot=(x,y,t=3,a=220)=>{
    for(let a1=-t;a1<=t;a1++)for(let b1=-t;b1<=t;b1++)
      if(a1*a1+b1*b1<=t*t)dot(x+a1,y+b1,a)
  }
  const line=(x1,y1,x2,y2,t=3,a=220)=>{
    const steps=Math.max(1,Math.ceil(Math.hypot(x2-x1,y2-y1)*1.5))
    for(let i=0;i<=steps;i++){
      const k=i/steps
      thickDot(Math.round(x1+(x2-x1)*k),Math.round(y1+(y2-y1)*k),t,a)
    }
  }
  // Soft outline identifies precise intended image bounds.
  for(let x=4;x<width-4;x+=5){dot(x,4,65);dot(x,height-5,65)}
  for(let y=4;y<height-4;y+=5){dot(4,y,65);dot(width-5,y,65)}
  // Dummy signature with enough detail to test placement and clipping.
  const pts=[[45,135],[120,72],[152,170],[185,90],[215,145],[248,105],
    [278,145],[323,81],[352,145],[391,110],[437,135],[514,116]]
  for(let i=1;i<pts.length;i++)line(...pts[i-1],...pts[i],4,230)
  line(45,220,545,220,2,150)
  const ihdr=Buffer.alloc(13)
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4)
  ihdr[8]=8;ihdr[9]=6
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a','hex'),
    chunk('IHDR',ihdr),
    chunk('IDAT',zlib.deflateSync(raw,{level:9})),
    chunk('IEND',Buffer.alloc(0))
  ])
}
async function main(){
  const book=new ExcelJS.Workbook()
  await book.xlsx.readFile(template)
  const sheet=book.getWorksheet('PC (Digital)')
  if(book.worksheets.length!==1||!sheet)
    throw Error('This test requires exactly one PC (Digital) worksheet.')
  const images=[
    // Merged boxes from actual user's Excel:
    {id:'Applicable HOD',rgb:[27,128,112],range:'E39:E43',
     tl:{col:4.04,row:38.10},br:{col:4.96,row:42.90}},
    {id:'HOD Finance Manager',rgb:[71,97,179],range:'H39:I43',
     tl:{col:7.04,row:38.10},br:{col:8.96,row:42.90}}
  ]
  for(const item of images){
    const img=book.addImage({buffer:testStamp(item.rgb),extension:'png'})
    sheet.addImage(img,{tl:item.tl,br:item.br,editAs:'oneCell'})
    console.log('Test marker '+item.id+' -> '+item.range)
  }
  await book.xlsx.writeFile(xlsx)
  const curl=cp.spawnSync('curl',[
    '--fail-with-body','-sS','--max-time','90',
    '-F','files=@'+xlsx,
    'http://127.0.0.1:3000/forms/libreoffice/convert',
    '-o',pdf
  ],{encoding:'utf8'})
  if(curl.error||curl.status!==0)throw Error('Gotenberg conversion failed: '+(curl.stderr||curl.error?.message||'Unknown error'))
  const output=await PDFDocument.load(fs.readFileSync(pdf))
  const size=output.getPage(0).getSize()
  console.log('PDF Pages: '+output.getPageCount())
  console.log('PDF size: '+size.width.toFixed(2)+' x '+size.height.toFixed(2)+' pt')
  if(output.getPageCount()!==1)
    throw Error('Test PDF is not one page; do not integrate signature export yet.')
  console.log('ALIGNMENT TEST READY: /__jsync_cv_alignment_test.pdf')
  console.log('This is a DUMMY-ONLY PDF; no real CV data or signatures used.')
  console.log('Original three-sheet master and PDF template untouched.')
}
main().catch(err=>{console.error('49F ALIGNMENT TEST FAILED: '+err.message);process.exitCode=1})
