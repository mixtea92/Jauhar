#!/usr/bin/env node
/*
 * JSYNC 47.6 Finance-only NEW PV frontend guard
 * Applies to real Codespaces src/PaymentVoucher.jsx.
 * Does NOT change canCreate (legacy PV / approval workflows).
 * Supports --dry-run. Makes timestamped backup and reverts on failed build.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const root=process.cwd();
const file=path.join(root,'src/PaymentVoucher.jsx');
if(!fs.existsSync(path.join(root,'package.json')) || !fs.existsSync(file)) {
  throw Error('Run from /workspaces/Jauhar/app (package.json and src/PaymentVoucher.jsx required).');
}
const before=fs.readFileSync(file,'utf8');
const marker='JSYNC_FINANCE_ONLY_NEW_PV_V1';
if(before.includes(marker)) {
  console.log('JSYNC Finance-only New PV guard is already installed. No files changed.');
  process.exit(0);
}
let after=before;
function one(oldStr,newStr,label) {
  const n=after.split(oldStr).length-1;
  if(n!==1) throw Error(label+': expected one exact anchor, found '+n+'. No files changed.');
  after=after.replace(oldStr,newStr);
}
function oneRegex(regex,replacer,label) {
  const matches=[...after.matchAll(regex)];
  if(matches.length!==1) throw Error(label+': expected one matching New PV button, found '+matches.length+'. No files changed.');
  after=after.replace(regex,replacer);
}

// Keep canCreate for existing Draft/Returned PVs; ONLY Finance Executive can raise a new PV.
one(
  "  const isAPFinance = canCreate && profile?.department === 'Finance'",
  "  const isAPFinance = canCreate && profile?.department === 'Finance'\n"+
  "  // "+marker+": new vouchers only; legacy non-Finance PV actions stay unchanged.\n"+
  "  const canRaisePV = isAPFinance && profile?.is_active === true",
  'Finance Executive permission'
);

// Prevent new mode via programmatic calls, even if UI button is not present.
one(
  "  function changeMode(nextMode) {",
  "  function changeMode(nextMode) {\n"+
  "    if (nextMode === 'new' && !canRaisePV) {\n"+
  "      setError('Only an active Finance Executive can raise a new Payment Voucher.')\n"+
  "      return false\n"+
  "    }",
  'New PV navigation guard'
);

// Preserve ability to edit an old non-Finance Draft where backend still permits it.
one(
  "    if (!canCreate || loading || importing) return",
  "    if (!canCreate || loading || importing) return\n"+
  "    if (workspaceMode === 'new' && !canRaisePV) {\n"+
  "      setError('Only an active Finance Executive can raise a new Payment Voucher.')\n"+
  "      return\n"+
  "    }",
  'New PV save guard'
);

// The two "New Payment Voucher" buttons (home page and existing-voucher listing).
oneRegex(
  /\{canCreate && (\(\s*<button type="button" className="btn" onClick=\{\(\) => changeMode\('new'\)\}>)/g,
  '{canRaisePV && $1',
  'Home New PV button'
);
oneRegex(
  /\{canCreate && (<button type="button" className="btn"\s*onClick=\{\(\) => changeMode\('new'\)\}>\+ New Payment Voucher<\/button>\})/g,
  '{canRaisePV && $1',
  'Existing PV list New PV button'
);

// Keep editing a previously-created Draft available; block new form entirely for other departments.
one(
  "{canCreate && (workspaceMode === 'new' || workspaceMode === 'edit') && (",
  "{canCreate && (workspaceMode === 'edit' || (workspaceMode === 'new' && canRaisePV)) && (",
  'New PV form render guard'
);

if(process.argv.includes('--dry-run')) {
  console.log('JSYNC FINANCE-ONLY PV V1 DRY-RUN PASSED. No files changed.');
  console.log('2 New PV buttons, new-mode navigation, new form, and new-save guarded.');
  console.log('Existing PV edit, submission, approval, tier validation unchanged.');
  process.exit(0);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=file+'.backup_before_finance_only_'+stamp;
fs.writeFileSync(backup,before);
try {
  fs.writeFileSync(file,after);
  const build=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe'});
  console.log((build.stdout||'').slice(-3500));
  if(build.error || build.status!==0) throw Error((build.stderr||'').slice(-4200) || build.error?.message || 'Build failed');
  console.log('JSYNC FINANCE-ONLY PV V1 PATCH AND BUILD PASSED.');
  console.log('Created backup: '+backup);
  console.log('Only active Finance Executives can open/save a NEW Payment Voucher.');
  console.log('Existing PV flows were not intentionally changed. No database records modified.');
} catch(err) {
  fs.writeFileSync(file,before);
  console.error('Patch rolled back; existing source restored: '+err.message);
  process.exitCode=1;
}
