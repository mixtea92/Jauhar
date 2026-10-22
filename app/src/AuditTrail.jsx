
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const actionNames = {
  create: 'Create User',
  edit: 'Edit User',
  disable: 'Disable User',
  reactivate: 'Reactivate User',
  reset_password: 'Reset Password'
}

function formatDetails(log) {
  const d = log.details || {}

  if (log.action === 'create') {
    return `Username: ${d.username || '-'} | Role: ${d.role || '-'}`
  }

  if (log.action === 'edit') {
    return `Username: ${d.before?.username || '-'} → ${d.after?.username || '-'} | Role: ${d.before?.role || '-'} → ${d.after?.role || '-'}`
  }

  return d.username ? `Username: ${d.username}` : '-'
}

export default function AuditTrail({ users = [] }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadLogs = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: queryError } = await supabase
      .from('user_management_audit')
      .select('id, actor_id, target_id, action, details, created_at')
      .order('created_at', { ascending: false })
      .limit(100)

    if (queryError) {
      setError(queryError.message)
      setLogs([])
    } else {
      setLogs(data || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  function getUsername(id) {
    const user = users.find(u => u.id === id)
    return user?.username || `User ${id?.slice(0, 8) || '-'}`
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat('en-MY', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kuala_Lumpur'
    }).format(new Date(value))
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Audit Trail</h2>
          <p className="muted">
            Latest 100 user management activities
          </p>
        </div>

        <button
          className="btn"
          onClick={loadLogs}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh Logs'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date & Time (MYT)</th>
              <th>Performed By</th>
              <th>Affected User</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>

          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td>{formatDate(log.created_at)}</td>
                <td>{getUsername(log.actor_id)}</td>
                <td>{getUsername(log.target_id)}</td>
                <td>
                  <strong>
                    {actionNames[log.action] || log.action}
                  </strong>
                </td>
                <td>{formatDetails(log)}</td>
              </tr>
            ))}

            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan="5">
                  {error
                    ? 'Unable to load audit records.'
                    : 'No audit activities recorded yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
