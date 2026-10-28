#!/usr/bin/env node
// JSYNC Cash Voucher Step 48I: four-department dropdown only.
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process')
const target=path.join(process.cwd(),'src/cashVoucherExcel.js')
if(!fs.existsSync(target))throw Error('Run this script from /workspaces/Jauhar/app')
const prior=fs.readFileSync(target,'utf8')
const old="export const CV_DEPARTMENTS = ['Finance','Operation','Sales & Marketing','Sales and Marketing','Medical','System, Project & Infrastructure','System, Project & Infra','System, Project & Infrastructure Department']"
const updated="export const CV_DEPARTMENTS = ['Operation','Medical','System, Project & Infrastructure','Sales & Marketing']"
if(prior.includes(updated)){
  console.log('JSYNC CV 48I already installed. Four department dropdown found. No changes made.')
  process.exit(0)
}
if(prior.split(old).length!==2)throw Error('Unexpected CV departments anchor. No changes made.')
if(process.argv.includes('--dry-run')){
  console.log('JSYNC CV 48I DRY-RUN PASSED. Only cashVoucherExcel.js department dropdown will change.')
  process.exit(0)
}
const backup=target+'.backup_before_48I_'+new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(backup,prior)
try{
  fs.writeFileSync(target,prior.replace(old,updated))
  const build=cp.spawnSync('npm',['run','build'],{encoding:'utf8',stdio:'pipe'})
  console.log((build.stdout||'').slice(-2200))
  if(build.error||build.status!==0)throw Error((build.stderr||'').slice(-3000)||build.error?.message||'Build failed')
  console.log('JSYNC CV 48I FOUR-DEPARTMENT DROPDOWN PATCH AND BUILD PASSED')
  console.log('Master Excel, CV approvals, PV, Delegation and backend unchanged. Backup: '+backup)
}catch(e){
  fs.writeFileSync(target,prior)
  console.error('JSYNC CV 48I rolled back: '+e.message)
  process.exitCode=1
}