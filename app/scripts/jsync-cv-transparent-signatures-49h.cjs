#!/usr/bin/env node
// JSYNC Step 49H: remove white rectangle behind HOD signatures.
// ONLY CV stamp-rendering helpers. Preserves approval records, layout, Excel,
// Gotenberg, Supabase, Payment Voucher and Delegation. Backup + rollback.
const fs=require('node:fs')
const path=require('node:path')
const cp=require('node:child_process')
const root=process.cwd()
const live=path.join(root,'src/cashVoucherSignedGotenberg.js')
const legacy=path.join(root,'src/cashVoucherPDF.js')
for(const p of [live,legacy])
 if(!fs.existsSync(p))throw Error('Expected CV helper missing: '+p+'. Run from /workspaces/Jauhar/app.')
const originals=new Map([[live,fs.readFileSync(live,'utf8')],[legacy,fs.readFileSync(legacy,'utf8')]])
const marker='JSYNC_CV_TRANSPARENT_SIGNATURES_49H'
if(originals.get(live).includes(marker)){
 console.log('JSYNC CV 49H already installed. No changes made.');process.exit(0)
}
let current=originals.get(live), oldPdf=originals.get(legacy)
function patch(text,needle,replacement,file){
 const count=text.split(needle).length-1
 if(count!==1)throw Error('Cannot safely patch '+file+'. Exact anchor count: '+count+'. No changes made.')
 return text.replace(needle,replacement)
}
// Even if old saved signature PNG itself has opaque white pixels, erase those
// pixels in the *output stamp* before drawing the account username/date.
const search=[
 "    ctx.drawImage(img,x,15,img.width*scale,img.height*scale)",
 "    const name=fmt(approval.approved_username)"
].join('\n')
const replacement=[
 "    ctx.drawImage(img,x,15,img.width*scale,img.height*scale)",
 "    // "+marker,
 "    // Some stored HOD signatures include an opaque white canvas.",
 "    // Convert only the white/near-white background pixels to transparent.",
 "    // This keeps the original printed Excel Name/Signature/Date labels visible.",
 "    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height)",
 "    const rgba=pixels.data",
 "    for(let i=0;i<rgba.length;i+=4){",
 "      if(rgba[i+3]===0)continue",
 "      const r=rgba[i],g=rgba[i+1],b=rgba[i+2]",
 "      const lightest=Math.min(r,g,b),darkest=Math.max(r,g,b)",
 "      if(lightest>=248){rgba[i+3]=0;continue}",
 "      if(lightest>230 && darkest-lightest<16){",
 "        const fraction=Math.max(0,Math.min(1,(248-lightest)/18))",
 "        rgba[i+3]=Math.round(rgba[i+3]*fraction)",
 "      }",
 "    }",
 "    ctx.putImageData(pixels,0,0)",
 "    const name=fmt(approval.approved_username)"
].join('\n')
current=patch(current,search,replacement,'cashVoucherSignedGotenberg.js')
// The older direct PDF route may still be used by a stale tab or old build.
// Its explicit white fill was a second reason opaque boxes could appear.
oldPdf=patch(oldPdf,
 "  ctx.fillStyle='white';ctx.fillRect(0,0,cv.width,cv.height)",
 "  ctx.clearRect(0,0,cv.width,cv.height)",
 'cashVoucherPDF.js')
if(process.argv.includes('--dry-run')){
 console.log('JSYNC CV 49H DRY-RUN PASSED. No files changed.')
 console.log('White backgrounds removed in CV signature rendering only.')
 console.log('Approved E39/H39 alignment, signed CV data, original Excel, PV and Delegation untouched.')
 process.exit(0)
}
const suffix='.backup_before_49H_'+new Date().toISOString().replace(/[:.]/g,'-')
for(const [file,data] of originals)fs.writeFileSync(file+suffix,data)
try{
 fs.writeFileSync(live,current)
 fs.writeFileSync(legacy,oldPdf)
 const build=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe',timeout:90000})
 console.log((build.stdout||'').slice(-2000))
 if(build.error||build.status!==0)throw Error((build.stderr||build.error?.message||'Vite build failed').slice(-3000))
 console.log('JSYNC CV 49H TRANSPARENT SIGNATURES PATCH AND BUILD PASSED')
 console.log('Only two CV signature renderer files patched. Master templates and records unchanged.')
}catch(err){
 for(const [file,data] of originals)fs.writeFileSync(file,data)
 console.error('JSYNC CV 49H ROLLED BACK: '+err.message)
 process.exitCode=1
}
