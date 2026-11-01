// JIMS 57D7C7 - F5B final OFFLINE pre-integration gate.
// Run only from feature worktree /app:
// node tests/invoiceDetailsFinalGateF5B.mjs
// This runs existing real offline test suites and Vite build only.
// Never connects to Supabase Cloud or changes Integration/Staging/Production.
// Requires @electric-sql/pglite already installed locally (from F3/F4).
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const root=resolve(app,'..')
function run(command,args,cwd=root){
 const r=spawnSync(command,args,{cwd,encoding:'utf8',stdio:'pipe',maxBuffer:12*1024*1024})
 if(r.error)throw r.error
 if(r.status!==0){
  process.stdout.write(r.stdout||'')
  process.stderr.write(r.stderr||'')
  throw new Error(command+' '+args.join(' ')+' exited '+r.status)
 }
 return (r.stdout||'')+'\n'+(r.stderr||'')
}
function check(condition,reason){
 assert.ok(condition,reason)
}
try{
 console.log('F5B: checking feature worktree and source safety...')
 const branch=run('git',['branch','--show-current']).trim()
 check(branch==='jims-feature-invoice-details-57d7c7','Refusing to run outside designated feature branch')
 const base='9e55decf1ddf2280b932888b23276e20a0429b1e'
 run('git',['merge-base','--is-ancestor',base,'HEAD'])
 const dirty=run('git',['status','--porcelain','--untracked-files=no']).trim()
 check(!dirty,'Tracked files modified locally. Resolve before final audit:\n'+dirty)
 const current=run('git',['rev-parse','--short','HEAD']).trim()
 console.log('Feature commit: '+current)
 const suites=[
  {title:'F1 - ExcelJS / UI / static validation',args:['--test','tests/invoiceDetailsFeatureSmoke.test.mjs'],patterns:[/tests 6(?:\r?\n)/,/pass 6(?:\r?\n)/,/fail 0(?:\r?\n)/]},
  {title:'F3 - real SQL PGlite isolated DB',args:['tests/invoiceDetailsIsolatedDbF3.mjs'],pattern:/F3 isolated PostgreSQL: 14\/14 checks PASS/},
  {title:'F4 - isolated role and RLS',args:['tests/invoiceDetailsPermissionsF4.mjs'],pattern:/F4 role\/RLS checks: 20\/20 PASS/},
  {title:'F5A - unchanged PV/payment regression sources',args:['--test','tests/invoiceDetailsRegressionF5.test.mjs'],patterns:[/tests 15(?:\r?\n)/,/pass 15(?:\r?\n)/,/fail 0(?:\r?\n)/]}
 ]
 for(const s of suites){
  console.log('\nRunning '+s.title+'...')
  const output=run('node',s.args,app)
  const expected=s.patterns||[s.pattern]
  if(expected.some(p=>!p.test(output))){
   console.log(output)
   throw new Error('Expected PASS count not found in '+s.title)
  }
  console.log('PASS '+s.title)
 }
 console.log('\nBuilding app...')
 const build=run('npm',['run','build'],app)
 check(build.includes('built in'),'Vite build did not return expected success marker')
 console.log('PASS Vite build')
 console.log('\nF5B OFFLINE GATE: PASS (55 automated checks + Vite build)')
 console.log('LIMITATION: This does not prove actual Supabase Cloud schema/RLS or end-to-end approvals.')
 console.log('NO merge / staging or production action performed.')
}catch(e){
 console.error('\nF5B OFFLINE GATE: BLOCKED — '+e.message)
 process.exitCode=1
}
