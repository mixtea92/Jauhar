#!/usr/bin/env node
/*
 * JSYNC Step 47.6E: Update V1 Finance-only PV guard to Finance TEAM (Executive & Manager).
 * Requires installed V1 patch. Keeps AP payment powers exclusive to Finance Executive.
 * Supports --dry-run, preflight checks, timestamped backup, build and rollback.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const root=process.cwd();
const file=path.join(root,'src/PaymentVoucher.jsx');
if(!fs.existsSync(path.join(root,'package.json')) || !fs.existsSync(file)) {
  throw Error('Run from /workspaces/Jauhar/app.');
}
const original=fs.readFileSync(file,'utf8');
const marker='JSYNC_FINANCE_TEAM_NEW_PV_V2';
if(original.includes(marker)) {
  console.log('Finance Team V2 is already installed. No files changed.');
  process.exit(0);
}
if(!original.includes('JSYNC_FINANCE_ONLY_NEW_PV_V1')) {
  throw Error('Finance-only V1 is missing. Stop; no files changed.');
}
let code=original;
function one(a,b,label){
  const count=code.split(a).length-1;
  if(count!==1)throw Error(label+': expected one exact source anchor, found '+count+'. No files changed.');
  code=code.replace(a,b);
}
one(
  "  const canRaisePV = isAPFinance && profile?.is_active === true",
  "  // "+marker+": Finance Executive and Finance HOD/Manager may raise their own PV.\n"+
  "  const canRaisePV = profile?.department === 'Finance' && profile?.is_active === true &&\n"+
  "    (profile?.role === 'executive' || profile?.role === 'manager')",
  'Finance team create permission'
);
one(
  "    canCreate && currentUserId && voucher && !isHandoverOriginalSuspended(voucher) &&",
  "    (canCreate || (canRaisePV && voucher?.created_by === currentUserId)) && currentUserId && voucher && !isHandoverOriginalSuspended(voucher) &&",
  'Manager may act as requester only on own Finance PV'
);
one(
  "    if (!canCreate || !voucher || !['draft', 'returned'].includes(voucher.status) || submittingVoucher) return",
  "    if (!(canCreate || (canRaisePV && voucher?.created_by === currentUserId)) || !voucher || !['draft', 'returned'].includes(voucher.status) || submittingVoucher) return",
  'Finance Manager may submit their own PV'
);
one(
  "    if (!canCreate || loading || importing) return",
  "    if (!(canCreate || canRaisePV) || loading || importing) return",
  'Manager may save new PV or own Draft'
);
one(
  "{canCreate && (workspaceMode === 'edit' || (workspaceMode === 'new' && canRaisePV)) && (",
  "{(canCreate || canRaisePV) && (workspaceMode === 'edit' || (workspaceMode === 'new' && canRaisePV)) && (",
  'Finance Manager may open New PV form'
);
if(process.argv.includes('--dry-run')){
  console.log('JSYNC FINANCE TEAM PV V2 DRY-RUN PASSED. No files changed.');
  console.log('Finance Executive + Finance Manager may create PV; non-Finance blocked.');
  console.log('AP payment authority and legacy non-Finance approvals untouched.');
  process.exit(0);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=file+'.backup_before_finance_team_v2_'+stamp;
fs.writeFileSync(backup,original);
try{
  fs.writeFileSync(file,code);
  const build=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe'});
  console.log((build.stdout||'').slice(-3800));
  if(build.error || build.status!==0)throw Error((build.stderr||'').slice(-4400)||build.error?.message||'Build failed');
  console.log('JSYNC FINANCE TEAM PV V2 PATCH AND BUILD PASSED.');
  console.log('Backup: '+backup);
  console.log('Finance Exec + Finance HOD/Manager can raise PV. Other departments cannot.');
  console.log('No database records changed by this installer.');
}catch(err){
  fs.writeFileSync(file,original);
  console.error('PATCH ROLLED BACK: '+err.message);
  process.exitCode=1;
}
