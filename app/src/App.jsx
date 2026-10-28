import { useCallback, useEffect, useState } from 'react'
import JSYNCLogin from './login/JSYNCLogin'
import { supabase } from './lib/supabase'
import AddUser from './AddUser'
import EditUser from './EditUser'
import UserOrganizationAssignment from './UserOrganizationAssignment'
import JSYNCUserAdminForm from './JSYNCUserAdminForm'
// JAUHAR_STEP_47_3D_INLINE
// JAUHAR_STEP_47_3B_USER_ORGANIZATION_UI
import UserStatusButton from './UserStatusButton'
import AuditTrail from './AuditTrail'
import ResetPassword from './ResetPassword'
import PaymentVoucher from './PaymentVoucher'
import DelegationHub from './DelegationHub'
import DelegationWorkspace from './DelegationWorkspace'
// JAUHAR_STEP_46G_FINANCIAL_DELEGATION_WORKSPACE
// JAUHAR_STEP_46D_SEPARATE_DELEGATION_MENU

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
  .nav-delegation-heading { display:flex; justify-content:space-between; align-items:center; font-weight:700; margin-top:5px; }
  .nav-delegation-submenu { margin:3px 0 12px 10px; padding-left:12px; border-left:2px solid #7893b7; }
  .nav-delegation-submenu .nav-subitem { font-size:13px; padding:10px 11px; }
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
  if(role === 'non_executive') return 'Non-Executive'
return role === 'manager' ? 'HOD / Manager' : String(role || '').replaceAll('_', ' ')
}

function displayDepartment(role, department) {
  if (role === 'system_admin') return 'All Departments'

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
  const [activePage, setActivePage] = useState('dashboard')
  const [financeOpen, setFinanceOpen] = useState(true)
  const [delegationOpen, setDelegationOpen] = useState(true)
  const [manageDelegationTab, setManageDelegationTab] = useState('request')
  const [voucherOpenRequest, setVoucherOpenRequest] = useState(null)
  // JAUHAR_STEP_46H_SEPARATE_DELEGATED_REVIEW
  const [editingUser, setEditingUser] = useState(null)
  const [organizationUser, setOrganizationUser] = useState(null)
  const [resetUser, setResetUser] = useState(null)

  useEffect(() => {
    let mounted = true

    async function restoreLogin() {
      try {
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) return

        const { data, error: profileError } = await supabase
          .from('user_profiles')
          .select('username, role, department, branch, subdepartment, staff_designation, is_active')
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
      .select('id, username, role, department, branch, subdepartment, staff_designation, cost_center, is_active, created_at')
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
          .select('username, role, department, branch, subdepartment, staff_designation, is_active')
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

          {profile.role === 'non_executive' && (
      <button type="button" className="nav-item"
        onClick={() => setActivePage('my_profile')}>
        My Profile
      </button>
    )}
    {profile.role !== 'non_executive' && (<>
    {/* FINANCE APPROVAL: MAIN MENU WITH SUBMENU */}
          <button
            type="button"
            className={`nav-item nav-group-toggle ${
              ['payment_voucher', 'delegation_workspace', 'delegation_review', 'manage_delegation'].includes(activePage) ? 'nav-group-active' : ''
            }`}
            aria-expanded={financeOpen}
            aria-controls="finance-approval-submenu"
            onClick={() => setFinanceOpen(open => !open)}
          >
            <span>Financial Approval</span>
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
              {/* Step 46G: one financial-only Delegation section, reusable when Budgeting launches. */}
              <button type="button" className={`nav-item nav-subitem nav-delegation-heading ${
                ['delegation_workspace','delegation_review','manage_delegation'].includes(activePage) ? 'nav-group-active' : ''}`}
                aria-expanded={delegationOpen} aria-controls="finance-delegation-submenu"
                onClick={() => setDelegationOpen(open => !open)}>
                <span>Delegation</span>
                <span aria-hidden="true">{delegationOpen ? '▾' : '▸'}</span>
              </button>
              {delegationOpen && <div id="finance-delegation-submenu" className="nav-delegation-submenu">
                <button type="button"
                  className={`nav-item nav-subitem ${activePage === 'delegation_workspace' ? 'nav-active' : ''}`}
                  onClick={() => {
                    setActivePage('delegation_workspace')
                    setEditingUser(null)
                    setResetUser(null)
                  }}>
                  Delegation Workspace
                </button>
                <button type="button"
                  className={`nav-item nav-subitem ${activePage === 'manage_delegation' ? 'nav-active' : ''}`}
                  onClick={() => {
                    setManageDelegationTab('request')
                    setActivePage('manage_delegation')
                    setEditingUser(null)
                    setResetUser(null)
                  }}>
                  Manage Delegation
                </button>
              </div>}
            </div>
          )}

          </>)}
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
                {activePage === 'delegation_review' ? 'Delegated PV Review'
                  : activePage === 'delegation_workspace' ? 'Delegation Workspace'
                  : activePage === 'manage_delegation' ? 'Manage Delegation'
                  : activePage === 'payment_voucher' ? 'Payment Voucher'
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

          {profile.role === 'non_executive' ? (
      <section className="panel">
        <h2>My Profile</h2>
        <p>Username: {profile.username}</p>
        <p>Role: Non-Executive</p>
        <p>Department: {profile.department || 'Not Assigned'}</p>
        <p>Subdepartment: {profile.subdepartment || 'Not Assigned'}</p>
        <p>Branch: {profile.branch || 'Not Assigned'}</p>
        <p>Staff Designation: {profile.staff_designation || 'Not Assigned'}</p>
      </section>
    ) : activePage === 'payment_voucher' ? (
            <PaymentVoucher profile={profile} openRequest={voucherOpenRequest}
              onOpenRequestHandled={() => setVoucherOpenRequest(null)} />
          ) : activePage === 'delegation_workspace' ? (
            <DelegationWorkspace profile={profile}
              onGoPaymentVoucher={() => setActivePage('payment_voucher')}
              onOpenVoucher={id => {
                setVoucherOpenRequest({id, key: Date.now()})
                setActivePage('delegation_review')
              }}
              onManage={tab => {
                setManageDelegationTab(tab || 'request')
                setActivePage('manage_delegation')
              }} />
          ) : activePage === 'delegation_review' ? (
            <PaymentVoucher profile={profile} reviewMode="delegated"
              openRequest={voucherOpenRequest}
              onReviewClose={() => {
                setVoucherOpenRequest(null)
                setActivePage('delegation_workspace')
              }} />
          ) : activePage === 'manage_delegation' ? (
            <DelegationHub profile={profile} initialTab={manageDelegationTab} />
          ) : profile.role === 'system_admin' && activePage === 'audit' ? (
            <AuditTrail users={users} />
          ) : profile.role === 'system_admin' && activePage === 'users' ? (
            <>
              {/* User Management forms: show one at a time */}
              {organizationUser ? (
                <JSYNCUserAdminForm organizationOnly
                  key={organizationUser.id}
                  user={users.find(u => u.id === organizationUser.id) || organizationUser}
                  onSaved={async () => { await loadUsers(); setOrganizationUser(null) }}
                  onCancel={() => setOrganizationUser(null)}
                />
              ) : editingUser ? (
                <JSYNCUserAdminForm
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
                  <JSYNCUserAdminForm onSaved={loadUsers} />
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

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Role</th>
                        <th>Department</th>
                        <th>Branch</th>
                        <th>Subdepartment</th>
<th>Staff Designation</th>
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
                          <td>{user.branch || 'Not Assigned'}</td>
                          <td>{user.subdepartment || 'Not Assigned'}</td>
<td>{user.staff_designation || 'Not Assigned'}</td>
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
                                    setOrganizationUser(null)
                                    setEditingUser(user)
                                    setActivePage('users')
                                  }}
                                >
                                  Edit
                                </button>

                                <button type="button" className="btn"
                                  style={{background:'#42637b'}}
                                  onClick={() => {
                                    setEditingUser(null)
                                    setResetUser(null)
                                    setOrganizationUser(user)
                                    setActivePage('users')
                                  }}>
                                  Assign Branch / Subdepartment
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
                                    setOrganizationUser(null)
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
                          <td colSpan="9">
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



