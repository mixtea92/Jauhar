#!/usr/bin/env node
// JSYNC 47.7C — System Admin view-all, Manage Delegation READ ONLY.
// Requires previously installed 47.7B patch in Codespaces. App.jsx only.
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process')
const root=process.cwd(), file=path.join(root,'src/App.jsx')
if(!fs.existsSync(path.join(root,'package.json'))||!fs.existsSync(file))
  throw Error('Run from /workspaces/Jauhar/app')
const original=fs.readFileSync(file,'utf8')
const marker='JAUHAR_STEP_47_7C_ADMIN_READONLY'
if(original.includes(marker)){console.log('Already installed');process.exit(0)}
if(!original.includes('JAUHAR_STEP_47_7B_MANAGE_DELEGATION_FINANCE_CEO_BOD'))
  throw Error('Step 47.7B missing. No files changed.')
let source=original
function one(oldText,newText,label){
  const occurrences=source.split(oldText).length-1
  if(occurrences!==1)throw Error(label+': expected one anchor, got '+occurrences+'. No files changed.')
  source=source.replace(oldText,newText)
}
one("import DelegationHub from './DelegationHub'",
  "import DelegationHub from './DelegationHub'\nimport SystemAdminDelegationViewer from './SystemAdminDelegationViewer'\nimport { canAccessPvManageDelegationPage } from './lib/jsyncAccess'\n// "+marker,
  'Imports')
const helperOld=[
  'function canManagePvDelegation(profile) {',
  '  return Boolean(profile?.is_active === true && (',
  "    (profile?.department === 'Finance' &&",
  "      ['executive','manager'].includes(profile?.role)) ||",
  "    profile?.role === 'ceo' || profile?.role === 'bod'",
  '  ))',
  '}'
].join('\n')
one(helperOld,
  'function canManagePvDelegation(profile) {\n  return canAccessPvManageDelegationPage(profile)\n}',
  'Role checker')
one('              <DelegationHub profile={profile} initialTab={manageDelegationTab} />',
  "              profile.role === 'system_admin' ? (\n"+
  "                <SystemAdminDelegationViewer profile={profile} />\n"+
  "              ) : (\n"+
  "                <DelegationHub profile={profile} initialTab={manageDelegationTab} />\n"+
  "              )",
  'System Admin isolated viewer')
if(process.argv.includes('--dry-run')){
  console.log('JSYNC 47.7C DRY-RUN PASSED. No source changed.');process.exit(0)
}
const backup=file+'.backup_before_admin_viewonly_47_7C_'+new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(backup,original)
try {
  fs.writeFileSync(file,source)
  const b=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe'})
  console.log((b.stdout||'').slice(-2500))
  if(b.error||b.status!==0)throw Error((b.stderr||'').slice(-3000)||b.error?.message||'Build failed')
  console.log('JSYNC 47.7C ADMIN READ-ONLY PATCH AND BUILD PASSED')
  console.log('Existing DelegationHub and other operational workflows unchanged.')
  console.log('Backup: '+backup)
}catch(e){
  fs.writeFileSync(file,original)
  console.error('App.jsx rolled back: '+e.message)
  process.exitCode=1
}
