
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import {
  JSYNC_BRANCHES,
  JSYNC_SUBDEPARTMENTS
} from './UserOrganizationAssignment'

const ROLES = [
  ['executive', 'Executive'],
  ['non_executive', 'Non-Executive'],
  ['manager', 'HOD / Manager'],
  ['ceo', 'CEO'],
  ['bod', 'BOD']
]

const normalize = v => ({
  'Sales & Marketing': 'Sales and Marketing',
  'System, Project & Infra': 'System, Project & Infrastructure',
  'System, Project & Infrastructure Department':
    'System, Project & Infrastructure'
}[v] || v || '')

const JOBS = {
  'Operation|Clinical': [
    'Radiographer Cum Clinic Assistant',
    'Clinic Assistant',
    'Medical Assistant Cum Clinic Assistant'
  ],
  'Medical|Branch Medical Resident': ['Resident Doctor']
}

const field = {
  width: '100%',
  padding: 12,
  border: '1px solid #d7dfeb',
  borderRadius: 8,
  background: 'white',
  color: '#17253d'
}

export default function JSYNCUserAdminForm({
  user = null,
  organizationOnly = false,
  onSaved,
  onCancel
}) {
  const editing = Boolean(user?.id)

  const [username, setUsername] = useState(user?.username || '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(user?.role || 'executive')
  const [department, setDepartment] = useState(normalize(user?.department))
  const [sub, setSub] = useState(user?.subdepartment || '')
  const [branch, setBranch] = useState(user?.branch || '')
  const [job, setJob] = useState(user?.staff_designation || '')
  const [costCenter, setCostCenter] = useState(user?.cost_center || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const subs = JSYNC_SUBDEPARTMENTS[department] || []
  const jobs = JOBS[`${department}|${sub}`] || []

  useEffect(() => {
    setUsername(user?.username || '')
    setRole(user?.role || 'executive')
    setDepartment(normalize(user?.department))
    setSub(user?.subdepartment || '')
    setBranch(user?.branch || '')
    setJob(user?.staff_designation || '')
    setCostCenter(user?.cost_center || '')
    setPassword('')
    setError('')
    setNotice('')
  }, [user?.id])

  async function edge(body) {
    const { data, error: requestError } =
      await supabase.functions.invoke('jauhar-admin-users', { body })

    if (requestError) {
      let message = requestError.message
      try {
        message = (await requestError.context?.json())?.error || message
      } catch {}
      throw new Error(message || 'Request failed')
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Request failed')
    }
    return data
  }

  async function save(e) {
    e.preventDefault()
    if (busy) return

    setBusy(true)
    setError('')
    setNotice('')

    try {
      const name = username.trim().toLowerCase()

      if (!Object.hasOwn(JSYNC_SUBDEPARTMENTS, department)) {
        throw Error('Department is required')
      }
      if (sub && !subs.includes(sub)) {
        throw Error('Invalid Subdepartment')
      }
      if (job && !jobs.includes(job)) {
        throw Error('Invalid Staff Designation')
      }

      if (!editing) {
        if (!/^[a-z][a-z0-9_]{2,31}$/.test(name)) {
          throw Error('Invalid username')
        }
        if (password.length < 12 || password.length > 128) {
          throw Error('Password must be 12-128 characters')
        }

        const result = await edge({
          username: name,
          password,
          role,
          department,
          subdepartment: sub || null,
          branch: branch || null,
          staff_designation: job || null,
          cost_center: costCenter || null
        })

        if (result.cost_center !== (costCenter || null)) {
          throw Error('User creation returned an unexpected Cost Center. Check Staff Accounts.')
        }
        if (result.audit_logged !== true) {
          throw Error('Creation audit not confirmed. Check Staff Accounts.')
        }

        setNotice('User created successfully')
        await onSaved?.()

      } else {
        const orgChanged =
          normalize(user.department) !== department ||
          (user.subdepartment || '') !== sub ||
          (user.branch || '') !== branch ||
          (user.staff_designation || '') !== job

        const costCenterChanged =
          (user.cost_center || '') !== costCenter

        const nameChanged =
          !organizationOnly && name !== user.username

        const roleChanged =
          !organizationOnly && role !== user.role

        if (!orgChanged && !nameChanged && !roleChanged && !costCenterChanged) {
          setNotice('No changes')
          return
        }

        if (orgChanged) {
          const { data, error: rpcError } = await supabase.rpc(
            'jauhar_update_user_organization_v2',
            {
              p_user_id: user.id,
              p_department: department,
              p_subdepartment: sub || null,
              p_branch: branch || null,
              p_staff_designation: job || null
            }
          )

          if (rpcError || !data?.success) {
            throw Error(rpcError?.message || 'Organization update failed')
          }
        }

        try {
          if (nameChanged || roleChanged) {
            await edge({
              action: 'edit',
              userId: user.id,
              ...(nameChanged ? { username: name } : {}),
              ...(roleChanged ? { role } : {})
            })
          }
        } catch (err) {
          if (orgChanged) {
            throw Error(
              `Organization saved but account update failed: ${err.message}. Refresh Staff Accounts.`
            )
          }
          throw err
        }

        if (costCenterChanged) {
          const { data: cc, error: ccError } = await supabase.rpc(
            'jauhar_set_user_cost_center_v1',
            { p_user_id: user.id, p_cost_center: costCenter || null }
          )
          if (ccError || !cc?.success) {
            throw Error('Cost Center update failed. Other changes may already be saved; refresh Staff Accounts. ' + (ccError?.message || ''))
          }
          const { data: checked, error: checkError } = await supabase
            .from('user_profiles').select('cost_center').eq('id', user.id).single()
          if (checkError || checked?.cost_center !== (costCenter || null)) {
            throw Error('Cost Center verification failed. Refresh Staff Accounts before retrying.')
          }
        }

        setNotice('Changes saved')
        await onSaved?.()
      }

    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={editing ? 'panel' : ''}>
      <h2>
        {editing
          ? organizationOnly ? 'Assign User Organization' : 'Edit User'
          : 'Add New User'}
      </h2>

      <p className="muted">
        Department required. Subdepartment, Branch and
        Staff Designation and Cost Center optional.
      </p>

      <form onSubmit={save} style={{ maxWidth: 720 }}>
        {!organizationOnly && (
          <>
            <div className="field">
              <label>Username *</label>
              <input style={field} value={username}
                required disabled={busy}
                onChange={e => setUsername(e.target.value)} />
            </div>

            {!editing && (
              <div className="field">
                <label>Initial Password *</label>
                <input type="password" style={field}
                  value={password} required minLength={12}
                  autoComplete="new-password"
                  disabled={busy}
                  onChange={e => setPassword(e.target.value)} />
              </div>
            )}

            <div className="field">
              <label>Role / Access Level *</label>
              <select style={field} value={role}
                disabled={busy}
                onChange={e => setRole(e.target.value)}>
                {ROLES.map(([v, l]) =>
                  <option key={v} value={v}>{l}</option>
                )}
              </select>
            </div>
          </>
        )}

        {organizationOnly && (
          <p><strong>{user.username.toUpperCase()}</strong> · {user.role}</p>
        )}

        <div className="field">
          <label>Department *</label>
          <select style={field} required value={department}
            disabled={busy}
            onChange={e => {
              setDepartment(e.target.value)
              setSub('')
              setJob('')
            }}>
            <option value="">Select Department</option>
            {Object.keys(JSYNC_SUBDEPARTMENTS).map(d =>
              <option key={d} value={d}>{d}</option>
            )}
          </select>
        </div>

        <div className="field">
          <label>Subdepartment (Optional)</label>
          <select style={field} value={sub}
            disabled={busy || !department}
            onChange={e => {
              setSub(e.target.value)
              setJob('')
            }}>
            <option value="">Not Assigned</option>
            {subs.map(x =>
              <option key={x} value={x}>{x}</option>
            )}
          </select>
        </div>

        <div className="field">
          <label>Primary Branch (Optional)</label>
          <select style={field} value={branch}
            disabled={busy}
            onChange={e => setBranch(e.target.value)}>
            <option value="">Not Assigned / HQ</option>
            {JSYNC_BRANCHES.map(x =>
              <option key={x} value={x}>{x}</option>
            )}
          </select>
        </div>

        {jobs.length > 0 && (
          <div className="field">
            <label>Staff Designation (Optional)</label>
            <select style={field} value={job}
              disabled={busy}
              onChange={e => setJob(e.target.value)}>
              <option value="">Not Assigned</option>
              {jobs.map(x =>
                <option key={x} value={x}>{x}</option>
              )}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="jsync-cost-center">Cost Center (Optional)</label>
          <select id="jsync-cost-center" style={field} value={costCenter}
            disabled={busy} onChange={e => setCostCenter(e.target.value)}>
            <option value="">Not Assigned</option>
            <option value="Management">Management</option>
            <option value="Operation">Operation</option>
          </select>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p role="status" style={{ color: '#167347' }}>{notice}</p>}

        <button className="btn" disabled={busy} type="submit">
          {busy ? 'Saving...' : editing ? 'Save Changes' : 'Create User'}
        </button>

        {editing && (
          <button type="button" className="btn"
            disabled={busy}
            style={{ marginLeft: 8, background: '#64748b' }}
            onClick={onCancel}>
            Cancel
          </button>
        )}
      </form>
    </section>
  )
}
