import { useState } from 'react'
import { supabase } from './lib/supabase'

// Step 36.3: Department is separate from role.
// Do not use this field to grant finance approval permissions.
const DEPARTMENTS = [
  'Finance',
  'Operation',
  'Sales & Marketing',
  'Medical',
  'System, Project & Infrastructure Department'
]

export default function AddUser({ onCreated }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('executive')
  const [department, setDepartment] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState('')

  const requiresDepartment = role === 'executive' || role === 'manager'

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return

    setLoading(true)
    setNotice(null)
    setError('')

    try {
      const name = username.trim().toLowerCase()
      const selectedDepartment = requiresDepartment ? department : null

      if (!/^[a-z][a-z0-9_]{2,31}$/.test(name)) {
        throw new Error('Username must be 3-32 characters, starting with a letter.')
      }

      if (password.length < 12) {
        throw new Error('Password must contain at least 12 characters.')
      }

      if (requiresDepartment && !DEPARTMENTS.includes(selectedDepartment)) {
        throw new Error('Please select a valid department for Executive or HOD / Manager.')
      }

      const { data, error: requestError } = await supabase.functions.invoke(
        'jauhar-admin-users',
        {
          body: {
            username: name,
            password,
            role,
            department: selectedDepartment
          }
        }
      )

      if (requestError) {
        let detail = null
        try {
          detail = await requestError.context?.json()
        } catch {
          // Network or response parsing error
        }
        throw new Error(detail?.error || 'Unable to create user.')
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Account creation failed.')
      }

      // A successful response does not prove the Edge Function persisted the new
      // department field. Verify it so we do not silently show false success.
      const { data: savedProfile, error: verifyError } = await supabase
        .from('user_profiles')
        .select('department')
        .eq('username', name)
        .maybeSingle()

      if (verifyError || !savedProfile) {
        setNotice({
          type: 'warning',
          text: `User ${name} was created, but the Department could not be verified. Check User Management and the jauhar-admin-users Edge Function.`
        })
      } else if ((savedProfile.department ?? null) !== selectedDepartment) {
        setNotice({
          type: 'warning',
          text: `User ${name} was created, but the Department was NOT saved. The jauhar-admin-users Edge Function must be updated before assigning this account to a department.`
        })
      } else {
        setNotice({
          type: 'success',
          text: `User ${name} created successfully${selectedDepartment ? ` â€” ${selectedDepartment}` : ''}!`
        })
      }

      setUsername('')
      setPassword('')
      setRole('executive')
      setDepartment('')

      if (onCreated) {
        await onCreated()
      }
    } catch (err) {
      setError(err?.message || 'An error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '12px',
    border: '1px solid #d7dfeb',
    borderRadius: '8px',
    background: 'white',
    color: '#17253d',
    marginTop: '7px'
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2 style={{ marginBottom: 8 }}>Add New User</h2>

      <p className="muted">
        Create a staff account and assign its access role and department.
      </p>

      <div className="field">
        <label htmlFor="add-username">Username</label>
        <input
          id="add-username"
          style={inputStyle}
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="e.g. finance01"
          autoComplete="off"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="add-password">Initial Password</label>
        <input
          id="add-password"
          style={inputStyle}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          minLength={12}
          autoComplete="new-password"
          placeholder="Minimum 12 characters"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="add-role">Role / Access Level</label>
        <select
          id="add-role"
          style={inputStyle}
          value={role}
          onChange={e => {
            const nextRole = e.target.value
            setRole(nextRole)
            if (nextRole === 'ceo' || nextRole === 'bod') {
              setDepartment('')
            }
          }}
        >
          <option value="executive">Executive</option>
          <option value="manager">HOD / Manager</option>
          <option value="ceo">CEO</option>
          <option value="bod">BOD</option>
        </select>
      </div>

      {requiresDepartment ? (
        <div className="field">
          <label htmlFor="add-department">Department</label>
          <select
            id="add-department"
            style={inputStyle}
            value={department}
            onChange={e => setDepartment(e.target.value)}
            required
          >
            <option value="">-- Select Department --</option>
            {DEPARTMENTS.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      ) : (
        <p className="muted">
          CEO and BOD accounts do not require a department.
        </p>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {notice && (
        <p
          role="status"
          style={{ color: notice.type === 'warning' ? '#a65c00' : '#167347' }}
        >
          {notice.text}
        </p>
      )}

      <button type="submit" className="btn" disabled={loading}>
        {loading ? 'Creating User...' : 'Create User'}
      </button>
    </form>
  )
}
