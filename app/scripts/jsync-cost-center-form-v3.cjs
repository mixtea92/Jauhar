#!/usr/bin/env node
/*
 * JSYNC Cost Center patch v3.
 * Targets the actual JSYNCUserAdminForm.jsx with [job,setJob] and [busy,setBusy].
 * Safe: strict source anchors, --dry-run, timestamped backups, npm build, rollback.
 * Touches only src/JSYNCUserAdminForm.jsx and, if necessary, App.jsx user projection.
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const root=process.cwd();
const fPath=path.join(root,'src/JSYNCUserAdminForm.jsx');
const aPath=path.join(root,'src/App.jsx');
if(!fs.existsSync(path.join(root,'package.json')) || !fs.existsSync(fPath) || !fs.existsSync(aPath)) {
  throw Error('Run from /workspaces/Jauhar/app; expected JSYNCUserAdminForm.jsx and App.jsx');
}
const fOriginal=fs.readFileSync(fPath,'utf8');
const aOriginal=fs.readFileSync(aPath,'utf8');
const ccExists=fOriginal.includes('id="jsync-cost-center"');
if(ccExists) {
  console.log('Cost Center dropdown already installed in this form. No files changed.');
  process.exit(0);
}
const need=[
  'export default function JSYNCUserAdminForm',
  "const [job, setJob] = useState(user?.staff_designation || '')",
  "const [busy, setBusy] = useState(false)",
  "setJob(user?.staff_designation || '')",
  "jauhar_update_user_organization_v2",
  "staff_designation: job || null",
  "if (!orgChanged && !nameChanged && !roleChanged)",
  "setNotice('Changes saved')",
  'Staff Designation (Optional)'
];
const missing=need.filter(x=>!fOriginal.includes(x));
if(missing.length) {
  throw Error('Actual form has changed. Missing: '+missing.join('; ')+'. No files changed.');
}
function replaceOnce(source,needle,replacement,label) {
  const first=source.indexOf(needle);
  if(first<0 || source.indexOf(needle,first+needle.length)>=0) {
    throw Error(label+': expected exactly one source anchor. No files changed.');
  }
  return source.slice(0,first)+replacement+source.slice(first+needle.length);
}

let f=fOriginal;
f=replaceOnce(f,
 "  const [job, setJob] = useState(user?.staff_designation || '')",
 "  const [job, setJob] = useState(user?.staff_designation || '')\n"+
 "  const [costCenter, setCostCenter] = useState(user?.cost_center || '')",
 'State');
f=replaceOnce(f,
 "    setJob(user?.staff_designation || '')",
 "    setJob(user?.staff_designation || '')\n"+
 "    setCostCenter(user?.cost_center || '')",
 'State reset');

f=replaceOnce(f,
 "          staff_designation: job || null\n        })",
 "          staff_designation: job || null,\n"+
 "          cost_center: costCenter || null\n        })",
 'Create user persistence');
f=replaceOnce(f,
 "        if (result.audit_logged !== true) {",
 "        if (result.cost_center !== (costCenter || null)) {\n"+
 "          throw Error('User creation returned an unexpected Cost Center. Check Staff Accounts.')\n"+
 "        }\n"+
 "        if (result.audit_logged !== true) {",
 'Create user result check');

f=replaceOnce(f,
 "        const nameChanged =\n          !organizationOnly && name !== user.username",
 "        const costCenterChanged =\n"+
 "          (user.cost_center || '') !== costCenter\n\n"+
 "        const nameChanged =\n"+
 "          !organizationOnly && name !== user.username",
 'Cost Center difference');
f=replaceOnce(f,
 "        if (!orgChanged && !nameChanged && !roleChanged) {",
 "        if (!orgChanged && !nameChanged && !roleChanged && !costCenterChanged) {",
 'Cost Center only save');
f=replaceOnce(f,
 "        setNotice('Changes saved')",
 "        if (costCenterChanged) {\n"+
 "          const { data: cc, error: ccError } = await supabase.rpc(\n"+
 "            'jauhar_set_user_cost_center_v1',\n"+
 "            { p_user_id: user.id, p_cost_center: costCenter || null }\n"+
 "          )\n"+
 "          if (ccError || !cc?.success) {\n"+
 "            throw Error('Cost Center update failed. Other changes may already be saved; refresh Staff Accounts. ' + (ccError?.message || ''))\n"+
 "          }\n"+
 "          const { data: checked, error: checkError } = await supabase\n"+
 "            .from('user_profiles').select('cost_center').eq('id', user.id).single()\n"+
 "          if (checkError || checked?.cost_center !== (costCenter || null)) {\n"+
 "            throw Error('Cost Center verification failed. Refresh Staff Accounts before retrying.')\n"+
 "          }\n"+
 "        }\n\n"+
 "        setNotice('Changes saved')",
 'Audited edit user Cost Center');
f=replaceOnce(f,
 "        Staff Designation optional.",
 "        Staff Designation and Cost Center optional.",
 'Optional fields description');
f=replaceOnce(f,
 '        {error && <p className="error" role="alert">{error}</p>}',
 '        <div className="field">\n'+
 '          <label htmlFor="jsync-cost-center">Cost Center (Optional)</label>\n'+
 '          <select id="jsync-cost-center" style={field} value={costCenter}\n'+
 '            disabled={busy} onChange={e => setCostCenter(e.target.value)}>\n'+
 '            <option value="">Not Assigned</option>\n'+
 '            <option value="Management">Management</option>\n'+
 '            <option value="Operation">Operation</option>\n'+
 '          </select>\n'+
 '        </div>\n\n'+
 '        {error && <p className="error" role="alert">{error}</p>}',
 'Cost Center after Staff Designation');

let a=aOriginal;
const projection=/\.select\(\s*['"]id,\s*username,\s*role,\s*department,[^'"]*created_at['"]\s*\)/g;
const matches=[...a.matchAll(projection)];
if(matches.length!==1)throw Error('App.jsx user list query could not be uniquely located ('+matches.length+'). No files changed.');
const old=matches[0][0];
const quote=old.match(/\.select\(\s*(['"])/)[1];
const body=old.slice(old.indexOf(quote)+1,old.lastIndexOf(quote));
const fields=body.split(',').map(s=>s.trim());
if(!fields.includes('cost_center')) {
  const pos=fields.indexOf('is_active');
  if(pos<0)throw Error('App.jsx user list query has no is_active field. No files changed.');
  fields.splice(pos,0,'cost_center');
  a=replaceOnce(a,old,'.select('+quote+fields.join(', ')+quote+')','User list query');
}
const changes={form:true,app:a!==aOriginal};
if(process.argv.includes('--dry-run')) {
  console.log('JSYNC COST CENTER V3 DRY-RUN PASSED. No files changed.',changes);
  process.exit(0);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backupForm=fPath+'.backup_before_cost_center_'+stamp;
const backupApp=aPath+'.backup_before_cost_center_'+stamp;
fs.writeFileSync(backupForm,fOriginal);
fs.writeFileSync(backupApp,aOriginal);
try {
 fs.writeFileSync(fPath,f);
 if(changes.app)fs.writeFileSync(aPath,a);
 const build=cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe'});
 console.log((build.stdout||'').slice(-4500));
 if(build.error || build.status!==0) throw Error((build.stderr||'').slice(-4000) || build.error?.message || 'Build failed');
 console.log('JSYNC COST CENTER V3 PATCH AND BUILD PASSED');
 console.log('Cost Center is the LAST field in Add/Edit User, default Not Assigned.');
 console.log('No user profiles were modified. Please refresh the JSYNC browser.');
} catch(err) {
 fs.writeFileSync(fPath,fOriginal);
 fs.writeFileSync(aPath,aOriginal);
 console.error('BUILD FAILED; sources restored from backups: '+err.message);
 process.exitCode=1;
}
