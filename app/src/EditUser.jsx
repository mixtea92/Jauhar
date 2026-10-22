import { useState } from 'react'
import { supabase } from './lib/supabase'

// Step 36.5 — Match these values exactly with the Supabase SQL constraint
// and the jauhar-admin-users Edge Function.
const DEPARTMENTS = [
  'Finance',
  'Operation',
  'Sales & Marketing',
  'Medical',
  'System, Project & Infrastructure Department'
]

const inputStyle = {
  width: '100%',
  padding: 12,
  border: '1px solid #d7dfeb',
  borderRadius: 8,
  background: 'white',
  color: '#17253d'
}

export default function EditUser({ user, onSaved, onCancel }) {
  const [username, setUsername] = useState(user.username)
  const [role, setRole] = useState(user.role)
  const [department, setDepartment] = useState(user.department || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const requiresDepartment = role === 'executive' || role === 'manager'

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const newUsername = username.trim().toLowerCase()
      const selectedDepartment = requiresDepartment ? department : null

      if (!/^[a-z][a-z0-9_]{2,31}$/.test(newUsername)) {
        throw new Error('Invalid username format. Use 3–32 characters, starting with a letter.')
      }

      if (requiresDepartment && !DEPARTMENTS.includes(selectedDepartment)) {
        throw new Error('Please select a valid Department for Executive or HOD / Manager.')
      }

      const { data, error: requestError } = await supabase.functions.invoke(
        'jauhar-admin-users',
        {
          body: {
            action: 'edit',
            userId: user.id,
            username: newUsername,
            role,
            department: selectedDepartment
          }
        }
      )

      if (requestError) {
        let details = null
        try {
          details = await requestError.context?.json()
        } catch {
          // Response may not contain JSON
        }

        throw new Error(details?.error || 'Unable to update user.')
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Update failed.')
      }

      // Prevent a false success if the older Edge Function is still deployed
      // and ignores the department submitted by this form.
      const { data: savedUser, error: verifyError } = await supabase
        .from('user_profiles')
        .select('username, role, department')
        .eq('id', user.id)
        .single()

      if (verifyError || !savedUser) {
        throw new Error(
          'Update was accepted, but the saved Department could not be verified. ' +
          'Check Supabase and refresh User Management before trying again.'
        )
      }

      if (
        savedUser.department !== selectedDepartment ||
        savedUser.role !== role ||
        savedUser.username !== newUsername
      ) {
        throw new Error(
          'Update was accepted, but the saved details do not match. ' +
          'Confirm that Step 36.4 jauhar-admin-users has been deployed.'
        )
      }

      setMessage(
        data.audit_logged === false
          ? 'User updated, but audit logging failed. Please check Supabase.'
          : 'User updated successfully!'
      )

      if (onSaved) await onSaved()
    } catch (err) {
      setError(err?.message || 'An error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="panel">
      <h2>Edit User</h2>
      <p className="muted">
        Update staff username, role and department. CEO and BOD do not require a department.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="edit-username">Username</label>
          <input
            id="edit-username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={inputStyle}
            autoComplete="off"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="edit-role">Role / Access Level</label>
          <select
            id="edit-role"
            value={role}
            onChange={e => {
              const newRole = e.target.value
              setRole(newRole)
              if (newRole === 'ceo' || newRole === 'bod') {
                setDepartment('')
              }
            }}
            style={inputStyle}
          >
            <option value="executive">Executive</option>
            <option value="manager">HOD / Manager</option>
            <option value="ceo">CEO</option>
            <option value="bod">BOD</option>
          </select>
        </div>

        {requiresDepartment ? (
          <div className="field">
            <label htmlFor="edit-department">Department</label>
            <select
              id="edit-department"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              style={inputStyle}
              required
            >
              <option value="">-- Select Department --</option>
              {DEPARTMENTS.map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            {!user.department && (
              <p className="muted" style={{ marginTop: 7 }}>
                This account is currently Not Assigned. Choose a department before saving.
              </p>
            )}
          </div>
        ) : (
          <p className="muted">Department: Not applicable to CEO / BOD.</p>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        {message && <p style={{ color: '#167347' }} role="status">{message}</p>}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '12px 18px',
              borderRadius: 8,
              border: '1px solid #ddd',
              background: 'white',
              color: '#17253d',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </form>
    </section>
  )
}

