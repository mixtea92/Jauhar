#!/usr/bin/env node
/*
 * JSYNC Step 47.7B — PV Manage Delegation frontend access guard.
 * Only active Finance Executive/Manager, CEO or BOD may access Manage Delegation.
 * Changes App.jsx only. Preserves Delegation Workspace, approvals, handover and audit.
 * --dry-run: verify anchors, no change. Normal: backup/build/automatic rollback.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = process.cwd();
const file = path.join(root, 'src/App.jsx');
if (!fs.existsSync(path.join(root, 'package.json')) || !fs.existsSync(file)) {
  throw Error('Run from /workspaces/Jauhar/app. Missing package.json or src/App.jsx.');
}
const original = fs.readFileSync(file, 'utf8');
const marker = 'JAUHAR_STEP_47_7B_MANAGE_DELEGATION_FINANCE_CEO_BOD';
if (original.includes(marker)) {
  console.log('JSYNC 47.7B already installed. No files changed.');
  process.exit(0);
}
let code = original;
function once(find, replace, label) {
  const n = code.split(find).length - 1;
  if (n !== 1) throw Error(label + ': expected one exact anchor, found ' + n + '. No files changed.');
  code = code.replace(find,replace);
}
const helper = [
  '// ' + marker,
  'function canManagePvDelegation(profile) {',
  '  return Boolean(profile?.is_active === true && (',
  "    (profile?.department === 'Finance' &&",
  "      ['executive','manager'].includes(profile?.role)) ||",
  "    profile?.role === 'ceo' || profile?.role === 'bod'",
  '  ))',
  '}',
  '',
  ''
].join('\n');
const tick = String.fromCharCode(96);
once('const css = ' + tick, helper + 'const css = ' + tick, 'Add role/department helper');

// Target exactly the dedicated sidebar button, not Delegation Workspace or PV actions.
const labelNeedle = '                  Manage Delegation\n                </button>';
const labelIndex = code.indexOf(labelNeedle);
if (labelIndex < 0 || code.indexOf(labelNeedle, labelIndex+1) >= 0) {
  throw Error('Manage Delegation sidebar button not uniquely identified. No files changed.');
}
const start = code.lastIndexOf('<button type="button"', labelIndex);
const end = code.indexOf('</button>', labelIndex);
if (start < 0 || end < 0 || labelIndex-start > 550 || end-labelIndex > 150) {
  throw Error('Sidebar Manage button bounds unclear. No files changed.');
}
const button = code.slice(start,end+'</button>'.length);
if (!button.includes("activePage === 'manage_delegation'") ||
    !button.includes("setActivePage('manage_delegation')")) {
  throw Error('Manage button does not have expected route. No files changed.');
}
code = code.slice(0,start) +
  '{canManagePvDelegation(profile) && (\n                ' +
  button +
  '\n                )}' +
  code.slice(end+'</button>'.length);

const callbackOld = [
  '              onManage={tab => {',
  "                setManageDelegationTab(tab || 'request')"
].join('\n');
const callbackNew = [
  '              onManage={tab => {',
  '                if (!canManagePvDelegation(profile)) return',
  "                setManageDelegationTab(tab || 'request')"
].join('\n');
once(callbackOld, callbackNew, 'Block unauthorized Workspace onManage navigation');

const pageOld = [
  "          ) : activePage === 'manage_delegation' ? (",
  '            <DelegationHub profile={profile} initialTab={manageDelegationTab} />'
].join('\n');
const pageNew = [
  "          ) : activePage === 'manage_delegation' ? (",
  '            canManagePvDelegation(profile) ? (',
  '              <DelegationHub profile={profile} initialTab={manageDelegationTab} />',
  '            ) : (',
  '              <section className="panel" role="alert">',
  '                <h2>Access Restricted</h2>',
  '                <p>PV Manage Delegation is restricted to Finance, CEO and BOD.</p>',
  '              </section>',
  '            )'
].join('\n');
once(pageOld,pageNew,'Block direct Manage Delegation page rendering');

if (process.argv.includes('--dry-run')) {
  console.log('JSYNC 47.7B DRY-RUN PASSED. No files changed.');
  console.log('Sidebar, Workspace onManage, and manage_delegation page all guarded.');
  console.log('Other PV workflows not changed.');
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const backup = file+'.backup_before_manage_delegation_47_7B_'+stamp;
fs.writeFileSync(backup,original);
try {
  fs.writeFileSync(file,code);
  const build = cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe'});
  console.log((build.stdout || '').slice(-3800));
  if (build.error || build.status !== 0) {
    throw Error((build.stderr || '').slice(-4000) || build.error?.message || 'Build failed');
  }
  console.log('JSYNC 47.7B MANAGE DELEGATION PATCH AND BUILD PASSED.');
  console.log('Backup: '+backup);
  console.log('Non-Finance, System Admin, Non-Executive: Manage Delegation hidden/blocked.');
  console.log('Finance Executive/Manager, CEO/BOD: prior authority rules preserved.');
} catch (err) {
  fs.writeFileSync(file,original);
  console.error('PATCH ROLLED BACK. App.jsx restored: ' + err.message);
  process.exitCode = 1;
}
