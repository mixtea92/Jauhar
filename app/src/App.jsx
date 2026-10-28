import { useCallback, useEffect, useState } from 'react'
import JSYNCLogin from './login/JSYNCLogin'
import { supabase } from './lib/supabase'
import AddUser from './AddUser'
import EditUser from './EditUser'
import UserStatusButton from './UserStatusButton'
import AuditTrail from './AuditTrail'
import ResetPassword from './ResetPassword'
import PaymentVoucher from './PaymentVoucher'

const css = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f3f6fb; font-family: Arial, sans-serif; color: #17253d; }
  button, input, select, textarea { font: inherit; }
  button { cursor: pointer; }
  .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .login-box { background: white; padding: 40px; width: 100%; max-width: 400px; border-radius: 16px; box-shadow: 0 8px 35px #182b4515; }
  .brand { font-size: 34px; font-weight: 800; letter-spacing: 2px; color: #173d70; }
  .subtitle { color: #64748b; font-size: 14px; }
  .field { margin: 20px 0; }
  .field label { display: block; margin-bottom: 8px; font-weight: 600; font-size: 13px; }
  .field input, .field select, .field textarea { width: 100%; padding: 13px; border: 1px solid #d7dfeb; border-radius: 8px; background: white; color: #17253d; }
  .btn { background: #173d70; color: white; border: none; padding: 12px 18px; border-radius: 8px; font-weight: 600; }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .layout { display: flex; min-height: 100vh; }
  .sidebar { width: 260px; background: #112c50; color: white; padding: 30px 20px; flex-shrink: 0; }
  .sidebar-title { font-size: 27px; font-weight: 800; letter-spacing: 2px; }
  .sidebar-sub { color: #aac0dc; font-size: 12px; margin-top: 5px; margin-bottom: 35px; }
  .nav-item { padding: 13px; margin-bottom: 9px; border-radius: 8px; color: #b9cce5; font-size: 14px;  display: block; width: 100%; border: none; background: transparent; text-align: left; cursor: pointer; }
  .nav-item:hover { background: #21466f; color: white; }
  .nav-active { background: #28517d; color: white; font-weight: 700; }
  /* FINANCE APPROVAL: expandable main menu with indented child items */
  .nav-group-toggle { font-size: 18px; font-weight: 800; color: white; display: flex; align-items: center; justify-content: space-between; margin-top: 18px; }
  .nav-group-toggle .chevron { font-size: 16px; color: #c9daee; }
  .nav-group-active { background: #21466f; }
  .nav-submenu { margin: 2px 0 16px 17px; padding-left: 12px; border-left: 2px solid #54759b; }
  .nav-subitem { font-size: 14px; margin: 4px 0; padding: 12px 13px; }
  .nav-placeholder { color: #849cb9; cursor: default; }
  .nav-placeholder:hover { background: transparent; color: #849cb9; }
  .content { padding: 35px; flex: 1; min-width: 0; }
  .topbar { display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-bottom: 30px; }
  .topbar h1 { margin: 0 0 8px; font-size: 27px; }
  .topbar p { margin: 0; color: #64748b; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 28px; }
  .card { background: white; border-radius: 12px; padding: 24px; border: 1px solid #e4eaf2; }
  .card-label { color: #64748b; font-size: 13px; margin-bottom: 12px; }
  .card-value { font-size: 32px; font-weight: 800; }
  .panel { background: white; border: 1px solid #e4eaf2; border-radius: 12px; padding: 24px; margin-bottom: 25px; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
  .panel h2 { font-size: 19px; margin: 0; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th { background: #f5f7fb; color: #586981; font-size: 12px; padding: 14px; }
  td { padding: 15px 14px; border-bottom: 1px solid #edf1f5; font-size: 14px; }
  .status { padding: 6px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .active { background: #e7f7ee; color: #167347; }
  .disabled { background: #fce9e9; color: #ad3434; }
  .modules { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 20px; }
  .module { padding: 20px; border: 1px solid #e4eaf2; border-radius: 10px; }
  .module p { font-size: 12px; color: #64748b; }
  .muted { color: #64748b; font-size: 13px; }
  .error { color: #b42318; font-size: 13px; }
  @media (max-width: 850px) {
    .layout { flex-direction: column; }
    .sidebar { width: 100%; padding: 20px; }
    .sidebar-sub { margin-bottom: 15px; }
    .content { padding: 20px; }
    .cards, .modules { grid-template-columns: 1fr; }
    .topbar { flex-wrap: wrap; }
  }
`

// Step 36: Department is profile metadata. Existing permissions stay unchanged.
function displayRole(role) {
  return role === 'manager' ? 'HOD / Manager' : String(role || '').replaceAll('_', ' ')
}

function displayDepartment(role, department) {
  if (role === 'system_admin') return 'All Departments'
  if (role === 'ceo' || role === 'bod') return '—'
  return department || 'Not Assigned'
}

function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [profile, setProfile] = useState(null)
  const [users, setUsers] = useState([])
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState(false)
  const [usersLoading, setUsersLoading] = useState(false)
  const [error, setError] = useState('')
  const [usersError, setUsersError] = useState('')
  const [costCenterEdits, setCostCenterEdits] = useState({})
  const [costCenterSaving, setCostCenterSaving] = useState(null)
  const [costCenterNotice, setCostCenterNotice] = useState('')
  const [activePage, setActivePage] = useState('dashboard')
  const [financeOpen, setFinanceOpen] = useState(true)
  const [editingUser, setEditingUser] = useState(null)
  const [resetUser, setResetUser] = useState(null)

  useEffect(() => {
    let mounted = true

    async function restoreLogin() {
      try {
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) return

        const { data, error: profileError } = await supabase
          .from('user_profiles')
          .select('username, role, department, is_active')
          .eq('id', user.id)
          .single()

        if (profileError || !data?.is_active) {
          await supabase.auth.signOut()
          return
        }

        if (mounted) setProfile(data)
      } catch {
        if (mounted) setError('Unable to restore session.')
      } finally {
        if (mounted) setChecking(false)
      }
    }

    restoreLogin()
    return () => { mounted = false }
  }, [])

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    setUsersError('')

    const { data, error: queryError } = await supabase
      .from('user_profiles')
      .select('id, username, role, department, cost_center, is_active, created_at')
      .order('username')

    if (queryError) {
      setUsersError(queryError.message)
      setUsers([])
    } else {
      setUsers(data || [])
    }

    setUsersLoading(false)
  }, [])

  useEffect(() => {
    if (profile?.role === 'system_admin') {
      loadUsers()
    }
  }, [profile?.role, loadUsers])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data, error: loginError } =
        await supabase.functions.invoke('jauhar-login', {
          body: {
            username: username.trim().toLowerCase(),
            password
          }
        })

      if (loginError || !data?.access_token || !data?.refresh_token) {
        throw new Error('Invalid credentials')
      }

      const { data: session, error: sessionError } =
        await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token
        })

      if (sessionError || !session.user) {
        throw new Error('Session failed')
      }

      const { data: userProfile, error: profileError } =
        await supabase
          .from('user_profiles')
          .select('username, role, department, is_active')
          .eq('id', session.user.id)
          .single()

      if (profileError || !userProfile?.is_active) {
        await supabase.auth.signOut()
        throw new Error('Account unavailable')
      }

      setProfile(userProfile)
      setPassword('')
    } catch {
      setError('Login failed. Check username or password.')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    const { error: logoutError } = await supabase.auth.signOut()

    if (logoutError) {
      setError('Logout failed. Please try again.')
      return
    }

    setProfile(null)
    setUsers([])
    setEditingUser(null)
    setResetUser(null)
    setFinanceOpen(true)
    setActivePage('dashboard')
    setUsername('')
    setPassword('')
    setError('')
  }

  async function saveCostCenter(user) {
    if (profile?.role !== 'system_admin' || user.role === 'system_admin' || costCenterSaving) return
    const selected = Object.prototype.hasOwnProperty.call(costCenterEdits, user.id)
      ? costCenterEdits[user.id] : (user.cost_center || '')
    setCostCenterSaving(user.id)
    setCostCenterNotice('')
    setUsersError('')
    try {
      const { data, error: updateError } = await supabase.rpc('jauhar_set_user_cost_center_v1', {
        p_user_id: user.id,
        p_cost_center: selected || null
      })
      if (updateError || !data?.success) throw new Error(updateError?.message || 'Cost Center update failed')
      const { data: saved, error: verifyError } = await supabase.from('user_profiles')
        .select('cost_center').eq('id', user.id).single()
      if (verifyError || saved?.cost_center !== (selected || null)) {
        throw new Error('Cost Center was not verified. Refresh users and retry.')
      }
      setCostCenterEdits(prev => {
        const next = { ...prev }
        delete next[user.id]
        return next
      })
      setCostCenterNotice('Cost Center saved for ' + user.username)
      await loadUsers()
    } catch (err) {
      setUsersError(err?.message || 'Unable to update Cost Center')
    } finally {
      setCostCenterSaving(null)
    }
  }

  const totalUsers = users.length
  const activeUsers = users.filter(u => u.is_active).length
  const disabledUsers = totalUsers - activeUsers

  if (checking) {
    return <><style>{css}</style><div className="login-page">Loading Jauhar...</div></>
  }

  if (!profile) {
    return (
      <>
        <style>{css}</style>
        <JSYNCLogin
          username={username}
          password={password}
          onUsernameChange={setUsername}
          onPasswordChange={setPassword}
          onSubmit={handleLogin}
          loading={loading}
          error={error}
        />
      </>
    )
  }

  return (
    <>
      <style>{css}</style>

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-title">JAUHAR MEDICAL CLINIC</div>
          <div className="sidebar-sub">STAFF DASHBOARD SYSTEM</div>

          {/* MAIN DASHBOARD */}
          <button
            type="button"
            className={`nav-item ${activePage === 'dashboard' ? 'nav-active' : ''}`}
            onClick={() => {
              setActivePage('dashboard')
              setEditingUser(null)
              setResetUser(null)
            }}
          >
            Dashboard
          </button>

          {/* SYSTEM ADMIN: USER MANAGEMENT */}
          {profile.role === 'system_admin' && (
            <button
              type="button"
              className={`nav-item ${activePage === 'users' ? 'nav-active' : ''}`}
              onClick={() => {
                setActivePage('users')
                setEditingUser(null)
                setResetUser(null)
              }}
            >
              User Management
            </button>
          )}

          {/* FINANCE APPROVAL: MAIN MENU WITH SUBMENU */}
          <button
            type="button"
            className={`nav-item nav-group-toggle ${
              activePage === 'payment_voucher' ? 'nav-group-active' : ''
            }`}
            aria-expanded={financeOpen}
            aria-controls="finance-approval-submenu"
            onClick={() => setFinanceOpen(open => !open)}
          >
            <span>Finance Approval</span>
            <span className="chevron" aria-hidden="true">
              {financeOpen ? '▼' : '▶'}
            </span>
          </button>

          {financeOpen && (
            <div id="finance-approval-submenu" className="nav-submenu">
              <button
                type="button"
                className={`nav-item nav-subitem ${
                  activePage === 'payment_voucher' ? 'nav-active' : ''
                }`}
                onClick={() => {
                  setActivePage('payment_voucher')
                  setEditingUser(null)
                  setResetUser(null)
                }}
              >
                Payment Voucher
              </button>
            </div>
          )}

          {/* FUTURE FINANCE DASHBOARD (SEPARATE MAIN MODULE) */}
          <div className="nav-item nav-placeholder" aria-disabled="true">
            Finance Dashboard — Soon
          </div>

          {/* SYSTEM ADMIN: AUDIT TRAIL */}
          {profile.role === 'system_admin' && (
            <button
              type="button"
              className={`nav-item ${activePage === 'audit' ? 'nav-active' : ''}`}
              onClick={() => {
                setActivePage('audit')
                setEditingUser(null)
                setResetUser(null)
              }}
            >
              Audit Trail
            </button>
          )}
        </aside>

        <main className="content">
          <div className="topbar">
            <div>
              <h1>
                {activePage === 'payment_voucher'
                  ? 'Payment Voucher'
                  : profile.role === 'system_admin' && activePage === 'users'
                    ? 'User Management'
                    : profile.role === 'system_admin' && activePage === 'audit'
                      ? 'Audit Trail'
                      : 'System Dashboard'}
              </h1>

              <p>Welcome, {profile.username} · {displayRole(profile.role)} · {displayDepartment(profile.role, profile.department)}</p>
            </div>
            <button className="btn" onClick={handleLogout}>Logout</button>
          </div>

          {activePage === 'payment_voucher' ? (
            <PaymentVoucher profile={profile} />
          ) : profile.role === 'system_admin' && activePage === 'audit' ? (
            <AuditTrail users={users} />
          ) : profile.role === 'system_admin' && activePage === 'users' ? (
            <>
              {/* User Management forms: show one at a time */}
              {editingUser ? (
                <EditUser
                  key={editingUser.id}
                  user={editingUser}
                  onSaved={async () => {
                    await loadUsers()
                    setEditingUser(null)
                  }}
                  onCancel={() => setEditingUser(null)}
                />
              ) : resetUser ? (
                <ResetPassword
                  key={resetUser.id}
                  user={resetUser}
                  onClose={() => setResetUser(null)}
                />
              ) : (
                <section className="panel">
                  <AddUser onCreated={loadUsers} />
                </section>
              )}

              <section className="panel">
                <div className="panel-head">
                  <h2>Staff Accounts</h2>
                  <button
                    type="button"
                    className="btn"
                    onClick={loadUsers}
                    disabled={usersLoading}
                  >
                    {usersLoading ? 'Loading...' : 'Refresh Users'}
                  </button>
                </div>

                {usersError && <p className="error">{usersError}</p>}
                  {costCenterNotice && <p role="status">{costCenterNotice}</p>}

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Role</th>
                        <th>Department</th>
                        <th>Cost Center</th>
                        <th>Status</th>
                        <th>Created At</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(user => (
                        <tr key={user.id}>
                          <td><strong>{user.username}</strong></td>
                          <td>{displayRole(user.role)}</td>
                          <td>{displayDepartment(user.role, user.department)}</td>
                          <td>
                            {user.role === 'system_admin' ? (
                              <span className="muted">Protected</span>
                            ) : (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <select
                                  aria-label={'Cost Center for ' + user.username}
                                  value={Object.prototype.hasOwnProperty.call(costCenterEdits, user.id)
                                    ? costCenterEdits[user.id] : (user.cost_center || '')}
                                  disabled={costCenterSaving !== null}
                                  onChange={e => setCostCenterEdits(prev => ({ ...prev, [user.id]: e.target.value }))}
                                >
                                  <option value="">Not Assigned</option>
                                  <option value="Management">Management</option>
                                  <option value="Operation">Operation</option>
                                </select>
                                <button type="button" className="btn"
                                  disabled={costCenterSaving !== null ||
                                    !Object.prototype.hasOwnProperty.call(costCenterEdits, user.id) ||
                                    costCenterEdits[user.id] === (user.cost_center || '')}
                                  onClick={() => saveCostCenter(user)}>
                                  {costCenterSaving === user.id ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`status ${user.is_active ? 'active' : 'disabled'}`}>
                              {user.is_active ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td>
                            {user.created_at
                              ? new Date(user.created_at).toLocaleDateString('en-MY')
                              : '-'}
                          </td>

                          <td>
                            {user.role === 'system_admin' ? (
                              <span className="muted">Protected</span>
                            ) : (
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 8,
                                  alignItems: 'center',
                                  flexWrap: 'wrap'
                                }}
                              >
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => {
                                    setResetUser(null)
                                    setEditingUser(user)
                                    setActivePage('users')
                                  }}
                                >
                                  Edit
                                </button>

                                <UserStatusButton
                                  user={user}
                                  onUpdated={loadUsers}
                                />

                                <button
                                  type="button"
                                  className="btn"
                                  style={{ background: '#56657a' }}
                                  onClick={() => {
                                    setEditingUser(null)
                                    setResetUser(user)
                                    setActivePage('users')
                                  }}
                                >
                                  Reset Password
                                </button>
                              </div>
                            )}
                          </td>

                        </tr>
                      ))}
                      {!usersLoading && users.length === 0 && (
                        <tr>
                          <td colSpan="7">
                            {usersError ? 'Unable to load users.' : 'No users found.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : profile.role === 'system_admin' ? (
            <>
              <div className="cards">
                <div className="card">
                  <div className="card-label">Total Users</div>
                  <div className="card-value">{totalUsers}</div>
                </div>
                <div className="card">
                  <div className="card-label">Active Users</div>
                  <div className="card-value">{activeUsers}</div>
                </div>
                <div className="card">
                  <div className="card-label">Disabled Users</div>
                  <div className="card-value">{disabledUsers}</div>
                </div>
              </div>

              <section className="panel">
                <h2>Jauhar Modules</h2>
                <div className="modules">
                  <div className="module">
                    <strong>Approval Dashboard</strong>
                    <p>View all finance approval requests.</p>
                    <span className="muted">Coming soon</span>
                  </div>
                  <div className="module">
                    <strong>Finance Dashboard</strong>
                    <p>Financial reports and summaries.</p>
                    <span className="muted">Coming soon</span>
                  </div>
                  <div className="module">
                    <strong>Audit Trail</strong>
                    <p>View user activities and approval history.</p>
                    <span className="muted">Available via sidebar</span>
                  </div>
                </div>
              </section>

              <p className="muted">
                System Admin has full visibility but no finance approval authority.
              </p>
            </>
          ) : (
            <section className="panel">
              <h2>Finance Workspace</h2>
              <p className="muted">
                Role: {profile.role}. Finance approval modules are being developed.
              </p>
            </section>
          )}
        </main>
      </div>
    </>
  )
}

export default App



