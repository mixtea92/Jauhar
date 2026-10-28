#!/usr/bin/env node
// JSYNC CV Step 48O V2 - fix false-negative Node import test; accept US Letter PDF and convert
// signed output to A4 portrait preserving aspect ratio + both signatures.
// Only app/src/cashVoucherPDF.js changes. PV/Delegation/DB unchanged.
const fs=require('node:fs')
const path=require('node:path')
const cp=require('node:child_process')
const root=process.cwd()
const target=path.join(root,'src/cashVoucherPDF.js')
const master=path.join(root,'public/templates/FIN_FM_PC_Petty Cash.pdf')
if(!fs.existsSync(target))throw Error('Run from /workspaces/Jauhar/app with cashVoucherPDF.js installed')
const original=fs.readFileSync(target,'utf8')
const marker='JSYNC_CV_PDF_LETTER_TO_A4_48O'
if(original.includes(marker)){console.log('JSYNC CV 48O V2 already installed. No changes made.');process.exit(0)}
let s=original
function once(from,to,description){
 const matches=s.split(from).length-1
 if(matches!==1)throw Error('Expected '+description+' anchor exactly once, got '+matches+'. No changes made.')
 s=s.replace(from,to)
}
const conversion=[
 '// '+marker,
 '// Keep A4 portrait output even when Windows exports the master as US Letter.',
 'export function fitCVPageToA4Portrait(page) {',
 '  const a4w=595.2756, a4h=841.8898',
 '  const w=page.getWidth(), h=page.getHeight()',
 '  const isA4=Math.abs(w-a4w)<2&&Math.abs(h-a4h)<2',
 '  const isLetter=Math.abs(w-612)<2&&Math.abs(h-792)<2',
 '  if(isA4)return',
 "  if(!isLetter)throw Error('Only a one-page A4 or US Letter portrait PDF master is supported.')",
 '  const factor=Math.min(a4w/w,a4h/h)',
 '  const dx=(a4w-w*factor)/2, dy=(a4h-h*factor)/2',
 '  page.scaleContent(factor,factor)',
 '  page.translateContent(dx,dy)',
 '  page.setSize(a4w,a4h)',
 '}',
 ''
].join('\n')
once('function layout(grid,page) {',conversion+'function layout(grid,page) {','page transform')
once(
  "  if(W>H||Math.abs(W-595.3)>35||Math.abs(H-841.9)>35)\n    throw Error('PDF master must contain one A4 portrait page. Export original Excel as A4 portrait PDF.')",
  "  const a4=Math.abs(W-595.2756)<2&&Math.abs(H-841.8898)<2\n"+
  "  const letter=Math.abs(W-612)<2&&Math.abs(H-792)<2\n"+
  "  if(W>=H||(!a4&&!letter))\n"+
  "    throw Error('PDF master must contain one A4 or US Letter portrait page.')",
  'master size check'
)
once(
  "  drawSigner(page,await doc.embedPng(await signerStamp(b)),map,8,10,39,44)\n  const pdf=await doc.save({useObjectStreams:false})",
  "  drawSigner(page,await doc.embedPng(await signerStamp(b)),map,8,10,39,44)\n"+
  "  // Convert original single-sheet PC (Digital) page, including overlay and signatures.\n"+
  "  fitCVPageToA4Portrait(page)\n"+
  "  const pdf=await doc.save({useObjectStreams:false})",
  'signed final PDF'
)
if(process.argv.includes('--dry-run')){
 console.log('JSYNC CV 48O V2 DRY-RUN PASSED. No changes made.')
 console.log('Current PDF master: '+(fs.existsSync(master)?'FOUND':'MISSING'))
 console.log('Only cashVoucherPDF.js will change. Original templates and PV/Delegation untouched.')
 process.exit(0)
}
const backup=target+'.backup_before_48O_'+new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(backup,original)
try{
 fs.writeFileSync(target,s)
 if(!fs.existsSync(master))throw Error('Cannot find PDF master '+master)
 // The old Node ESM smoke test imported a Vite extensionless module and
 // failed despite valid frontend code. Vite is the authoritative build here.
 const pdf=fs.readFileSync(master)
 if(pdf.length<1000||pdf.subarray(0,5).toString('ascii')!=='%PDF-')
   throw Error('PDF master is missing or invalid; expected a real PDF file')
 console.log('PDF master FOUND and header verified ('+pdf.length+' bytes).')
 const build=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe'})
 console.log((build.stdout||'').slice(-2100))
 if(build.error||build.status!==0)throw Error('Build failed: '+(build.stderr||build.error?.message||'Unknown error').slice(-2800))
 console.log('JSYNC CV 48O V2 LETTER TO A4 PDF AUTOFIT AND BUILD PASSED')
 console.log('Original Excel, original PDF, CV approvals, PV and Delegation untouched.')
 console.log('Backup: '+backup)
}catch(e){
 fs.writeFileSync(target,original)
 console.error('JSYNC CV 48O V2 ROLLED BACK: '+e.message)
 process.exitCode=1
}
