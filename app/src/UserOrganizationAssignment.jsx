import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

// JAUHAR_STEP_47_3B_USER_ORGANIZATION_ASSIGNMENT
// One shared JSYNC; branch is profile metadata, not a separate workspace.
export const JSYNC_BRANCHES = [
  'Gelang Patah', 'Kota Masai', 'Pulai Mutiara', 'Taman Daya'
]

export const JSYNC_SUBDEPARTMENTS = {
  Operation: [
    'Medication', 'Panel', 'Clinical',
    'Equipment and 3rd Party Medical Service', 'Human Resources (HR)'
  ],
  'System, Project & Infrastructure': [
    'Online Management System', 'IT Software & Hardware', 'Facility', 'Project'
  ],
  Finance: [
    'Accounting', 'Accounts Payable', 'Accounts Receivable', 'Strategic Finance'
  ],
  Medical: ['Branch Medical PIC', 'Branch Medical Resident'],
  'Sales and Marketing': ['Marketing', 'Sale']
}

const departmentalOptions = department => {
  const name = department === 'System, Project & Infra'
    ? 'System, Project & Infrastructure'
    : department === 'Sales & Marketing' ? 'Sales and Marketing' : department
  return JSYNC_SUBDEPARTMENTS[name] || []
}

export default function UserOrganizationAssignment({ user, onSaved, onCancel }) {
  const [branch, setBranch] = useState(user?.branch || '')
  const [subdepartment, setSubdepartment] = useState(user?.subdepartment || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const department = user?.department || ''
  const options = departmentalOptions(department)

  useEffect(() => {
    setBranch(user?.branch || '')
    setSubdepartment(user?.subdepartment || '')
    setError('')
    setSuccess('')
  }, [user?.id, user?.branch, user?.subdepartment])

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    setSuccess('')
    if (subdepartment && !options.includes(subdepartment)) {
      setError('Selected subdepartment does not match this department.')
      return
    }
    setBusy(true)
    try {
      const { data, error: rpcError } = await supabase.rpc(
        'jauhar_assign_user_organization_v1',
        { p_user_id: user.id, p_branch: branch || null,
          p_subdepartment: subdepartment || null }
      )
      if (rpcError) throw rpcError
      if (!data?.success) throw new Error('Assignment was not confirmed.')
      setSuccess(data.changed ? 'Branch and subdepartment saved with audit.' : 'No assignment changes.')
      await onSaved?.()
    } catch (err) {
      setError(err?.message || 'Unable to save organization assignment.')
    } finally {
      setBusy(false)
    }
  }

  const style = { width:'100%', padding:12, border:'1px solid #cad6e6',
    borderRadius:8, color:'#17253d', background:'#fff' }
  return (
    <section className="panel" aria-label="User branch and subdepartment assignment">
      <div className="panel-head">
        <h2>Assign Branch &amp; Subdepartment — {user?.username?.toUpperCase()}</h2>
      </div>
      <p className="muted">System Admin only. This changes organization metadata, not roles, existing PVs or approval authority.</p>
      <form onSubmit={submit} style={{maxWidth:720}}>
        <div className="field">
          <label htmlFor="jsync-assignment-department">Department (existing)</label>
          <input id="jsync-assignment-department" style={style}
            value={department || 'Not Assigned'} disabled readOnly />
          {!options.length && <p className="error">Assign a supported department through Edit User before selecting a subdepartment.</p>}
        </div>
        <div className="field">
          <label htmlFor="jsync-assignment-branch">Primary Branch</label>
          <select id="jsync-assignment-branch" value={branch}
            onChange={e => setBranch(e.target.value)} style={style} disabled={busy}>
            <option value="">Not Assigned / HQ</option>
            {JSYNC_BRANCHES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="jsync-assignment-subdepartment">Subdepartment</label>
          <select id="jsync-assignment-subdepartment" value={subdepartment}
            onChange={e => setSubdepartment(e.target.value)} style={style}
            disabled={busy || !options.length}>
            <option value="">Not Assigned</option>
            {options.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {success && <p style={{color:'#167347'}}>{success}</p>}
        <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Saving...' : 'Save Assignment'}
          </button>
          <button type="button" className="btn" style={{background:'#68788d'}}
            onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </section>
  )
}
