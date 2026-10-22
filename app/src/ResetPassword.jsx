
import { useState } from 'react'
import { supabase } from './lib/supabase'

export default function ResetPassword({ user, onClose }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (password.length < 12 || password.length > 128) {
      setError('Password must contain 12-128 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    const confirmed = window.confirm(
      `Reset password for ${user.username}?`
    )

    if (!confirmed) return

    setLoading(true)

    try {
      const { data, error: requestError } =
        await supabase.functions.invoke(
          'jauhar-admin-users',
          {
            body: {
              action: 'reset_password',
              userId: user.id,
              password
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

        throw new Error(
          details?.error || 'Unable to reset password.'
        )
      }

      if (!data?.success) {
        throw new Error(
          data?.error || 'Password reset failed.'
        )
      }

      setPassword('')
      setConfirmPassword('')

      setMessage(
        data.audit_logged === false
          ? 'Password updated, but audit logging failed.'
          : 'Password reset successfully!'
      )

    } catch (err) {
      setError(err.message || 'An error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="panel">
      <h2>Reset Staff Password</h2>

      <p className="muted">
        Set a new password for {user.username}.
      </p>

      <form onSubmit={handleReset} autoComplete="off">
        <div className="field">
          <label>Username</label>
          <input
            value={user.username}
            disabled
          />
        </div>

        <div className="field">
          <label>New Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            placeholder="Minimum 12 characters"
            required
          />
        </div>

        <div className="field">
          <label>Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            placeholder="Re-enter new password"
            required
          />
        </div>

        {error && <p className="error">{error}</p>}

        {message && (
          <p style={{ color: '#167347' }}>{message}</p>
        )}

        <div style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap'
        }}>
          <button
            className="btn"
            disabled={loading}
            type="submit"
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '12px 18px',
              border: '1px solid #ddd',
              borderRadius: 8,
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
