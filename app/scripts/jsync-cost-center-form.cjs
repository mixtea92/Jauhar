#!/usr/bin/env node
/*
 * JSYNC Cost Center frontend patch for existing Codespaces form.
 * Run from /workspaces/Jauhar/app: node /tmp/jsync-cost-center-form.cjs
 * Changes only src/JSYNCUserAdminForm.jsx and src/App.jsx.
 * Fails closed if source is different, makes backups, restores on failed build.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const root = process.cwd();
const formPath = path.join(root, 'src', 'JSYNCUserAdminForm.jsx');
const appPath = path.join(root, 'src', 'App.jsx');
if (!fs.existsSync(path.join(root, 'package.json')) ||
    !fs.existsSync(formPath) || !fs.existsSync(appPath)) {
  throw new Error('Open /workspaces/Jauhar/app before running. Existing JSYNCUserAdminForm.jsx, App.jsx and package.json are required.');
}
const originalForm = fs.readFileSync(formPath, 'utf8');
const originalApp = fs.readFileSync(appPath, 'utf8');
if (!originalForm.includes('JAUHAR_STEP_47_3D_ADMIN_USER_FORM')) {
  throw new Error('Unrecognized JSYNCUserAdminForm version. No files changed.');
}
if (originalForm.includes('id="usr-cost-center"')) {
  console.log('Cost Center dropdown is already present. No files changed.');
  process.exit(0);
}
function once(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': expected one exact match. No files changed.');
  }
  return source.slice(0,first) + after + source.slice(first + before.length);
}
let form = originalForm;
form = once(form,
  "  const [staffDesignation,setStaffDesignation] = useState(user?.staff_designation || '')",
  "  const [staffDesignation,setStaffDesignation] = useState(user?.staff_designation || '')\n" +
  "  const [costCenter,setCostCenter] = useState(user?.cost_center || '')",
  'Cost Center state'
);
form = once(form,
  "    setStaffDesignation(user?.staff_designation || '')",
  "    setStaffDesignation(user?.staff_designation || '')\n" +
  "    setCostCenter(user?.cost_center || '')",
  'Reset Cost Center on user change'
);
form = once(form,
  "          staff_designation:staffDesignation || null})",
  "          staff_designation:staffDesignation || null,\n" +
  "          cost_center:costCenter || null})",
  'Create-user payload'
);
form = once(form,
  "        setSubdepartment(''); setBranch(''); setStaffDesignation('')",
  "        setSubdepartment(''); setBranch(''); setStaffDesignation(''); setCostCenter('')",
  'Reset Add User'
);
form = once(form,
  "      const roleChanged = !organizationOnly && role !== user.role",
  "      const costCenterChanged = (user.cost_center || '') !== costCenter\n" +
  "      const roleChanged = !organizationOnly && role !== user.role",
  'Edit User diff'
);
form = once(form,
  "      if (!orgChanged && !roleChanged && !nameChanged) {",
  "      if (!orgChanged && !roleChanged && !nameChanged && !costCenterChanged) {",
  'Detect Cost Center-only changes'
);
form = once(form,
  "      setNotice('User profile updated. Organization audit saved where changes occurred.')",
  "      if (costCenterChanged) {\n" +
  "        const {data:result,error:costError} = await supabase.rpc('jauhar_set_user_cost_center_v1', {\n" +
  "          p_user_id:user.id,p_cost_center:costCenter || null\n" +
  "        })\n" +
  "        if (costError || !result?.success) {\n" +
  "          throw new Error('Cost Center not saved. Earlier organization or role changes may already be saved. Refresh before retrying. ' + (costError?.message || ''))\n" +
  "        }\n" +
  "      }\n" +
  "      setNotice('User profile updated. Audit saved for organization and Cost Center changes.')",
  'Update Cost Center through audited System Admin RPC'
);
form = once(form,
  '      {error && <p className="error" role="alert">{error}</p>}',
  '      <div className="field"><label htmlFor="usr-cost-center">Cost Center (Optional)</label>\n' +
  '        <select style={textField} id="usr-cost-center" value={costCenter} disabled={busy}\n' +
  '          onChange={e=>setCostCenter(e.target.value)}>\n' +
  '          <option value="">Not Assigned</option>\n' +
  '          <option value="Management">Management</option>\n' +
  '          <option value="Operation">Operation</option>\n' +
  '        </select></div>\n' +
  '      {error && <p className="error" role="alert">{error}</p>}',
  'Cost Center dropdown after optional Staff Designation'
);
form = once(form,
  'Subdepartment, Branch and Staff Designation are optional.',
  'Subdepartment, Branch, Staff Designation and Cost Center are optional.',
  'Helper copy'
);

let app = originalApp;
// Cost Center must be present on user objects during editing to show existing value.
const listProjection = /\.select\('id,\s*username,\s*role,\s*department,[^']*created_at'\)/g;
const projections = [...app.matchAll(listProjection)];
if (projections.length !== 1) {
  throw new Error('Unable to uniquely find user list projection in App.jsx. No files changed.');
}
const oldProjection = projections[0][0];
const fields = oldProjection.slice(".select('".length, -2).split(',').map(s=>s.trim());
if (!fields.includes('cost_center')) {
  const at = fields.indexOf('is_active');
  if (at<0) throw new Error('Missing is_active field in user list. No files changed.');
  fields.splice(at,0,'cost_center');
  app=once(app,oldProjection,".select('" + fields.join(', ') + "')",'User list projection');
}

const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const backupForm = formPath + '.backup_before_cost_center_' + stamp;
const backupApp = appPath + '.backup_before_cost_center_' + stamp;
fs.writeFileSync(backupForm,originalForm);
fs.writeFileSync(backupApp,originalApp);
try {
  fs.writeFileSync(formPath,form);
  fs.writeFileSync(appPath,app);
  const build = cp.spawnSync('npm',['run','build'],{cwd:root,encoding:'utf8',stdio:'pipe'});
  console.log((build.stdout || '').slice(-2800));
  if (build.status!==0) throw new Error((build.stderr || '').slice(-2800) || 'npm build failed');
  console.log('JSYNC Cost Center: PATCH AND BUILD PASSED.');
  console.log('Dropdown is LAST in Add User/Edit User; manual selection only.');
  console.log('Refresh JSYNC browser to test. No existing users were modified.');
} catch(err) {
  fs.writeFileSync(formPath,originalForm);
  fs.writeFileSync(appPath,originalApp);
  console.error('Changes rolled back: ' + err.message);
  process.exitCode=1;
}
