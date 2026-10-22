
import { useState } from 'react'
import { supabase } from './lib/supabase'

export default function UserStatusButton({ user, onUpdated }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function changeStatus() {
    const action = user.is_active ? 'disable' : 'reactivate'

    const confirmed = window.confirm(
      `Are you sure you want to ${action} ${user.username}?`
    )

    if (!confirmed) return

    setLoading(true)
    setError('')
    setMessage('')

    try {
      const { data, error: requestError } =
        await supabase.functions.invoke(
          'jauhar-admin-users',
          {
            body: {
              action,
              userId: user.id
            }
          }
        )

      if (requestError) {
        let detail = null
        try {
          detail = await requestError.context?.json()
        } catch {
          // Response may not contain JSON
        }

        throw new Error(
          detail?.error || requestError.message
        )
      }

      if (!data?.success) {
        throw new Error(
          data?.error || 'Unable to update account status'
        )
      }

      await onUpdated?.()

      setMessage(
        data.audit_logged === false
          ? 'Status updated, but audit logging failed.'
          : `Account ${action} successful.`
      )
    } catch (err) {
      setError(err.message || 'An error occurred')
      await onUpdated?.()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        className="btn"
        disabled={loading}
        onClick={changeStatus}
        style={{
          background: user.is_active ? '#b42318' : '#167347'
        }}
      >
        {loading
          ? 'Processing...'
          : user.is_active
            ? 'Disable'
            : 'Reactivate'}
      </button>

      {error && (
        <p className="error" role="alert">{error}</p>
      )}

      {message && (
        <p className="muted" role="status">{message}</p>
      )}
    </div>
  )
}
