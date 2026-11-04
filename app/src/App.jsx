import JIMSPaymentCalendar57D5 from './JIMSPaymentCalendar57D5'
import { useCallback, useEffect, useState, useRef } from 'react'
import JSYNCLogin from './login/JSYNCLogin'
import JIMSDashboardHome from './JIMSDashboardHome'
import './JIMSDashboardHome.css'
import './JIMSFinancialApprovalTheme.css'
import './JIMSUnifiedDarkV1.css'
import './JIMSPaymentSeparation.css'
import './JIMSClosedLoopHistory.css'
import './JIMSFinanceActionBadges.css'
import {fetchJIMSActionNotifications} from './jimsActionNotifications'
import { supabase } from './lib/supabase'
import { isFinanceManagerActual, loadPendingFmPartialApprovals } from './lib/jimsFmPartialApprovalQueue'
import './AddUser'
import './EditUser'
import './UserOrganizationAssignment'
import JSYNCUserAdminForm from './JSYNCUserAdminForm'
// JAUHAR_STEP_47_3D_INLINE
// JAUHAR_STEP_47_3B_USER_ORGANIZATION_UI
import UserStatusButton from './UserStatusButton'
import AuditTrail from './AuditTrail'
import ResetPassword from './ResetPassword'
import PaymentVoucher from './PaymentVoucher'
import JIMSHistoryExports from './JIMSHistoryExports'
import JIMSApproverSummary from './JIMSApproverSummary'
import CashVoucher from './CashVoucher'
import FinanceDocumentArchive, { canAccessFinanceDocumentArchive } from './FinanceDocumentArchive'
// JSYNC_STEP_48C_CASH_VOUCHER_FULL_STACK
import DelegationHub from './DelegationHub'
import SystemAdminDelegationViewer from './SystemAdminDelegationViewer'
import { canAccessPvManageDelegationPage } from './lib/jsyncAccess'
// JAUHAR_STEP_47_7C_ADMIN_READONLY
import DelegationWorkspace from './DelegationWorkspace'
// JAUHAR_STEP_46G_FINANCIAL_DELEGATION_WORKSPACE
// JAUHAR_STEP_46D_SEPARATE_DELEGATION_MENU

// JAUHAR_STEP_47_7B_MANAGE_DELEGATION_FINANCE_CEO_BOD
function canManagePvDelegation(profile) {
  return canAccessPvManageDelegationPage(profile)
}

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
  .jims-my-approval-badge {
    float: right; display: inline-flex; align-items: center; justify-content: center;
    min-width: 23px; height: 22px; padding: 0 7px; border-radius: 999px;
    background: #c6a15c; color: #211a10; font-size: 12px; font-weight: 800;
    line-height: 1; margin-left: 9px;
  }
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

// JIMS_STEP_57C5S_MY_APPROVALS: actual approval roles only (no System Admin).
function jimsCanSeeMyApprovals(p) {
  return p?.is_active === true && (
    p.role === 'ceo' || p.role === 'bod' ||
    (p.role === 'manager' && Boolean(p.department))
  )
}

// JIMS_STEP57C7B_AP_AR_EXPORTS — subdepartment-based AP visibility.
function jimsAPModuleAccess(p) {
  if(p?.is_active !== true) return false
  if(p.role === 'system_admin') return true // read-only oversight, no finance approvals
  if(p.role === 'manager' && p.department === 'Finance') return true // UAT-FIX-01 FM Finance access
  return p.department === 'Finance' && ['executive','manager'].includes(p.role) &&
    (p.subdepartment == null || p.subdepartment === '' ||
      ['Accounts Payable','Accounting'].includes(p.subdepartment))
}
function jimsAPExcelAccess(p) {
  return p?.is_active === true && p.department === 'Finance' &&
    (p.role === 'manager' ||
      (p.role === 'executive' && ['Accounts Payable','Accounting'].includes(p.subdepartment)))
}

// JIMS 57D5: calendar menu visibility only; Supabase RPC enforces actual access.
function jimsCalendarEligible(p) {
  return p?.is_active===true && (
    ['ceo','bod','system_admin'].includes(p.role) ||
    (p.role==='manager' && p.department==='Finance') ||
    (p.role==='executive' && p.department==='Finance' &&
      p.subdepartment==='Accounts Payable')
  )
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
  const [recurringPrepareRequest,setRecurringPrepareRequest]=useState(null)
  const prepareRecurringPV=taskId=>{
    if(!taskId)return
    setRecurringPrepareRequest({id:taskId,key:Date.now()})
    setActivePage('payment_voucher')
  }
  // JIMS_STEP57C8B_REPORT_GENERATION: shared report center, same role checks.
  const [jimsOwnerExportAllowed,setJimsOwnerExportAllowed] = useState(false)
  useEffect(()=>{
    let active=true
    async function checkOwner(){
      if(profile?.role!=='system_admin'||profile?.is_active!==true){
        if(active)setJimsOwnerExportAllowed(false)
        return
      }
      const {data,error:e}=await supabase.rpc('jims_is_system_owner_v1')
      if(active)setJimsOwnerExportAllowed(!e&&data===true)
    }
    void checkOwner()
    return ()=>{active=false}
  },[profile?.role,profile?.is_active])

  // JIMS_STEP_57C5SN_APPROVAL_BADGE — actual authority notifications only.
  const [myApprovalBadge, setMyApprovalBadge] = useState(null)
  const myApprovalBadgeSequence = useRef(0)
  const refreshMyApprovalBadge = useCallback(async () => {
    const sequence = ++myApprovalBadgeSequence.current
    if (!jimsCanSeeMyApprovals(profile)) {
      setMyApprovalBadge(null)
      return
    }
    try {
      const [summary, partialRows] = await Promise.all([
        supabase.rpc('jims_actual_approver_summary_v1'),
        isFinanceManagerActual(profile) ? loadPendingFmPartialApprovals() : Promise.resolve([])
      ])
      if (sequence !== myApprovalBadgeSequence.current) return
      if (summary.error || !Array.isArray(summary.data?.rows)) {
        setMyApprovalBadge(null)
        return
      }
      setMyApprovalBadge(summary.data.rows.length + partialRows.length)
    } catch {
      if (sequence === myApprovalBadgeSequence.current) setMyApprovalBadge(null)
    }
  }, [profile?.role, profile?.department, profile?.is_active])

  useEffect(() => {
    // Refresh on role/login, return to tab, selected page and periodically.
    if (!jimsCanSeeMyApprovals(profile)) {
      ++myApprovalBadgeSequence.current
      setMyApprovalBadge(null)
      return
    }
    void refreshMyApprovalBadge()
    const onFocus = () => void refreshMyApprovalBadge()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshMyApprovalBadge()
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshMyApprovalBadge()
    }, 60000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [profile?.role, profile?.department, profile?.is_active,
      activePage, refreshMyApprovalBadge])

  const [jimsActionCounts,setJimsActionCounts] = useState({pv:undefined,payment:undefined,cv:undefined})
  const [financeOpen, setFinanceOpen] = useState(true)
  const [delegationOpen, setDelegationOpen] = useState(false)
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

  // Step 56N — actual user actions ONLY, read through current user RLS/RPC.
  // Refresh when entering a page, returning to browser, or every 120 seconds.
  useEffect(() => {
    if (!profile || profile.role === 'non_executive' || profile.is_active === false) {
      setJimsActionCounts({pv:undefined,payment:undefined,cv:undefined})
      return
    }
    let alive = true
    const refreshJIMSBadges = () => {
      fetchJIMSActionNotifications(profile).then(counts => {
        if (alive) setJimsActionCounts(counts)
      }).catch(() => {
        if (alive) setJimsActionCounts({pv:null,payment:null,cv:null})
      })
    }
    refreshJIMSBadges()
    window.addEventListener('focus',refreshJIMSBadges)
    const poll = window.setInterval(refreshJIMSBadges,120000)
    return () => {
      alive = false
      window.removeEventListener('focus',refreshJIMSBadges)
      window.clearInterval(poll)
    }
  },[profile?.role,profile?.department,profile?.username,profile?.is_active,activePage])

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
    setRecurringPrepareRequest(null)
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

      <div className="layout jims-shell">
        <aside className="sidebar">
          <div className="jims-brand">
            <img
              className="jims-brand-logo"
              src="/branding/JIMS_Logo.png"
              alt="JIMS — JAUHAR Integrated Management System"
              onError={e => e.currentTarget.closest('.jims-brand')?.classList.add('jims-brand--text')}
            />
            <div className="jims-brand-text" aria-hidden="true">
              <strong>JIMS</strong>
              <small>JAUHAR INTEGRATED<br />MANAGEMENT SYSTEM</small>
            </div>
          </div>

          {/* MAIN DASHBOARD */}
          <button
            type="button"
            className={`nav-item jims-57d6c1-row jims-57d6c1-dashboard ${activePage === 'dashboard' ? 'nav-active' : ''}`}
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
              className={`nav-item jims-57d6c1-row jims-57d6c1-users ${activePage === 'users' ? 'nav-active' : ''}`}
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
      <button type="button" className="nav-item jims-57d6c1-row jims-57d6c1-profile"
        onClick={() => setActivePage('my_profile')}>
        My Profile
      </button>
    )}
    {profile.role !== 'non_executive' && (<>
    {/* FINANCE APPROVAL: MAIN MENU WITH SUBMENU */}
          <button
            type="button"
            className={`nav-item jims-57d6c1-row jims-57d6c1-group jims-57d6c1-finance nav-group-toggle ${
              ['payment_voucher', 'payment_process', 'cash_voucher', 'finance_document_archive', 'delegation_workspace', 'delegation_review', 'manage_delegation'].includes(activePage) ? 'nav-group-active' : ''
            }`}
            aria-expanded={financeOpen}
            aria-controls="finance-approval-submenu"
            onClick={() => setFinanceOpen(open => !open)}
          >
            <span>Finance Workspace</span>
            <span className="chevron" aria-hidden="true">
              {financeOpen ? '▼' : '▶'}
            </span>
          </button>

          {financeOpen && (
            <div id="finance-approval-submenu" className="nav-submenu">
              {/* JIMS_STEP_55L_ORDER: Payment Process first. Original route handlers retained. */}
              <button type="button"
                className={`nav-item jims-57d6c1-row jims-57d6c1-process nav-subitem jims-action-nav ${activePage === 'payment_process' ? 'nav-active' : ''}`}
                onClick={() => {
                  setActivePage('payment_process')
                  setEditingUser(null)
                  setResetUser(null)
                }}>
                Payment Process
                {jimsActionCounts.payment > 0 ? (
                  <span className="jims-nav-notification"
                    aria-label={jimsActionCounts.payment + ' pending actions'}
                    title={jimsActionCounts.payment + ' actions requiring your attention'}>
                    {jimsActionCounts.payment > 99 ? '99+' : jimsActionCounts.payment}
                  </span>
                ) : jimsActionCounts.payment === null ? (
                  <span className="jims-nav-notification jims-count-unavailable"
                    title="Action count unavailable" aria-label="Action count unavailable">—</span>
                ) : null}
              </button>
              {/* JIMS_STEP57D5_CALENDAR_SIDEBAR: Process > Calendar > PV > PC */}
              {jimsCalendarEligible(profile) && (
                <button type="button"
                  className={'nav-item jims-57d6c1-row jims-57d6c1-calendar nav-subitem '+(activePage === 'payment_calendar' ? 'nav-active' : '')}
                  onClick={() => {
                    setActivePage('payment_calendar')
                    setEditingUser(null)
                    setResetUser(null)
                  }}>
                  Payment Calendar
                </button>
              )}
              {jimsAPModuleAccess(profile) && (
              <button
                type="button"
                className={`nav-item jims-57d6c1-row jims-57d6c1-pv nav-subitem jims-action-nav ${
                  activePage === 'payment_voucher' ? 'nav-active' : ''
                }`}
                onClick={() => {
                  setActivePage('payment_voucher')
                  setEditingUser(null)
                  setResetUser(null)
                }}
              >
                Payment Voucher
                {jimsActionCounts.pv > 0 ? (
                  <span className="jims-nav-notification"
                    aria-label={jimsActionCounts.pv + ' pending actions'}
                    title={jimsActionCounts.pv + ' actions requiring your attention'}>
                    {jimsActionCounts.pv > 99 ? '99+' : jimsActionCounts.pv}
                  </span>
                ) : jimsActionCounts.pv === null ? (
                  <span className="jims-nav-notification jims-count-unavailable"
                    title="Action count unavailable" aria-label="Action count unavailable">—</span>
                ) : null}
              </button>
              )}
              {/* JSYNC_STEP_48A_CASH_VOUCHER_MENU */}
              {(jimsAPModuleAccess(profile) || (profile?.is_active === true && profile?.role === "manager")) && (
              <button
                type="button"
                className={`nav-item jims-57d6c1-row jims-57d6c1-cash nav-subitem jims-action-nav ${activePage === 'cash_voucher' ? 'nav-active' : ''}`}
                onClick={() => {
                  setActivePage('cash_voucher')
                  setEditingUser(null)
                  setResetUser(null)
                }}
              >
                Petty Cash
                {jimsActionCounts.cv > 0 ? (
                  <span className="jims-nav-notification"
                    aria-label={jimsActionCounts.cv + ' pending actions'}
                    title={jimsActionCounts.cv + ' actions requiring your attention'}>
                    {jimsActionCounts.cv > 99 ? '99+' : jimsActionCounts.cv}
                  </span>
                ) : jimsActionCounts.cv === null ? (
                  <span className="jims-nav-notification jims-count-unavailable"
                    title="Action count unavailable" aria-label="Action count unavailable">—</span>
                ) : null}
              </button>
              )}
              {canAccessFinanceDocumentArchive(profile) && (
                <button type="button"
                  className={'nav-item jims-57d6c1-row nav-subitem jims-action-nav jims-archive-nav ' + (activePage === 'finance_document_archive' ? 'nav-active' : '')}
                  onClick={() => setActivePage('finance_document_archive')}>
                  <svg className="jims-archive-nav-icon" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 8V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2" />
                    <rect x="3" y="9" width="18" height="11" rx="2" />
                    <path d="M9 13h6M11 16h2" />
                  </svg>
                  <span className="jims-archive-nav-label">Finance Document Archive</span>
                </button>
              )}

              {/* Step 46G: one financial-only Delegation section, reusable when Budgeting launches. */}
              <button type="button" className={`nav-item jims-57d6c1-row jims-57d6c1-delegation nav-subitem nav-delegation-heading ${
                ['delegation_workspace','delegation_review','manage_delegation'].includes(activePage) ? 'nav-group-active' : ''}`}
                aria-expanded={delegationOpen} aria-controls="finance-delegation-submenu"
                onClick={() => setDelegationOpen(open => !open)}>
                <span>Delegation</span>
                <span aria-hidden="true">{delegationOpen ? '▾' : '▸'}</span>
              </button>
              {delegationOpen && <div id="finance-delegation-submenu" className="nav-delegation-submenu">
                <button type="button"
                  className={`nav-item jims-57d6c1-row jims-57d6c1-workspace nav-subitem ${activePage === 'delegation_workspace' ? 'nav-active' : ''}`}
                  onClick={() => {
                    setActivePage('delegation_workspace')
                    setEditingUser(null)
                    setResetUser(null)
                  }}>
                  Delegation Workspace
                </button>
                {canManagePvDelegation(profile) && (
                <button type="button"
                  className={`nav-item jims-57d6c1-row jims-57d6c1-manage nav-subitem ${activePage === 'manage_delegation' ? 'nav-active' : ''}`}
                  onClick={() => {
                    setManageDelegationTab('request')
                    setActivePage('manage_delegation')
                    setEditingUser(null)
                    setResetUser(null)
                  }}>
                  Manage Delegation
                </button>
                )}
              </div>}
              {/* JIMS_STEP57C8C_REPORT_MENU_LAST: final Financial Approval item */}
              {(jimsAPExcelAccess(profile) || jimsOwnerExportAllowed) && (
                <button type="button"
                  className={'nav-item jims-57d6c1-row jims-57d6c1-report nav-subitem '+(activePage === 'history_exports' ? 'nav-active' : '')}
                  onClick={() => {
                    setActivePage('history_exports')
                    setEditingUser(null)
                    setResetUser(null)
                  }}>
                  Report Generation
                </button>
              )}
            </div>
          )}

          </>)}
{/* JIMS 57C5S: Standalone role-specific Approval Dashboard. */}
          {jimsCanSeeMyApprovals(profile) && (
            <button
              type="button"
              className={`nav-item jims-57d6c1-row jims-57d6c1-approvals ${activePage === 'my_approvals' ? 'nav-active' : ''}`}
              onClick={() => {
                setVoucherOpenRequest(null)
                setActivePage('my_approvals')
                setEditingUser(null)
                setResetUser(null)
              }}
            >
              <span>My Approvals</span>
              {myApprovalBadge !== null && myApprovalBadge > 0 && (
                <span className="jims-my-approval-badge"
                  aria-label={myApprovalBadge + ' pending approvals'}>
                  {myApprovalBadge >= 100 ? '99+' : myApprovalBadge}
                </span>
              )}
            </button>
          )}

{/* FUTURE FINANCE DASHBOARD (SEPARATE MAIN MODULE) */}
          <div className="nav-item nav-placeholder jims-57d6c1-soon" aria-disabled="true">
            Finance Dashboard — Soon
          </div>

          {/* SYSTEM ADMIN: AUDIT TRAIL */}
          {profile.role === 'system_admin' && (
            <button
              type="button"
              className={`nav-item jims-57d6c1-row jims-57d6c1-audit ${activePage === 'audit' ? 'nav-active' : ''}`}
              onClick={() => {
                setActivePage('audit')
                setEditingUser(null)
                setResetUser(null)
              }}
            >
              Audit Trail
            </button>
          )}
          <div className="jims-sidebar-footer">
            <span className="jims-footer-line" />
            <span>JAUHAR MEDICAL CLINIC</span>
            <small>Internal management workspace</small>
          </div>
        </aside>

        <main className={['payment_voucher', 'payment_process', 'cash_voucher', 'finance_document_archive', 'delegation_workspace', 'delegation_review', 'manage_delegation'].includes(activePage) ? 'content jims-finance-theme' : 'content'}>
          <div className="topbar">
            <div>
              <h1>
                {activePage === 'delegation_review' ? 'Delegated PV Review'
                  : activePage === 'delegation_workspace' ? 'Delegation Workspace'
                  : activePage === 'manage_delegation' ? 'Manage Delegation'
                  : activePage === 'payment_process' ? 'Payment Process'
                  : activePage === 'my_approvals' ? 'My Approvals'
                  : activePage === 'history_exports' ? 'Report Generation'
                  : activePage === 'payment_calendar' ? 'Payment Calendar'
                  : activePage === 'payment_voucher' ? 'Payment Voucher'
                  : activePage === 'finance_document_archive' ? 'Finance Document Archive'
                  : activePage === 'cash_voucher' ? 'Petty Cash'
                  : profile.role === 'system_admin' && activePage === 'users'
                    ? 'User Management'
                    : profile.role === 'system_admin' && activePage === 'audit'
                      ? 'Audit Trail'
                      : 'System Dashboard'}
              </h1>

              <p>Welcome, {profile.username} · {displayRole(profile.role)} · {displayDepartment(profile.role, profile.department)}</p>
            </div>
            <div className="jims-topbar-right">
              <div className="jims-branch-indicator">
                <span className="jims-branch-label">BRANCH</span>
                <strong>{profile.branch || 'All / Not Assigned'}</strong>
              </div>
              <button type="button" className="btn jims-logout" onClick={handleLogout}>
                <span aria-hidden="true">⇥</span> Logout
              </button>
            </div>
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
    ) : activePage === 'my_approvals' ? (
            jimsCanSeeMyApprovals(profile) ? (
              <JIMSApproverSummary
                profile={profile}
                onDecisionRecorded={refreshMyApprovalBadge}
                onOpenVoucher={id => {
                  setVoucherOpenRequest({ id, key: Date.now() })
                  setActivePage('payment_voucher')
                }}
              />
            ) : (
              <section className="panel">
                <h2>Access Restricted</h2>
                <p>This approval dashboard is available to HOD, Finance Manager, CEO and BOD only.</p>
              </section>
            )
          ) : activePage === 'history_exports' ? (
            (jimsAPExcelAccess(profile) || jimsOwnerExportAllowed) ? (
              <JIMSHistoryExports profile={profile} />
            ) : (
              <section className="panel"><h2>Access Restricted</h2>
                <p>Only AP / Accounting or designated System Owner.</p></section>
            )
          ) : activePage === 'payment_calendar' ? (
              jimsCalendarEligible(profile) ? (
                <JIMSPaymentCalendar57D5 profile={profile}
                   onPreparePV={prepareRecurringPV} />
              ) : (
                <section className="panel" role="alert">
                  <h2>Access Restricted</h2>
                  <p>Payment Calendar is limited to Finance AP, Finance Manager, CEO, BOD and read-only System Admin.</p>
                </section>
              )
            ) : activePage === 'payment_voucher' ? (
            <PaymentVoucher key="pv-approval-route" profile={profile}
              dashboardSection="approval" openRequest={voucherOpenRequest}
              onOpenRequestHandled={() => setVoucherOpenRequest(null)}
              recurringTaskRequest={recurringPrepareRequest}
              onRecurringTaskHandled={()=>setRecurringPrepareRequest(null)} />
          ) : activePage === 'payment_process' ? (
            <PaymentVoucher key="pv-payment-route" profile={profile}
              dashboardSection="payment" onPrepareRecurringTask={prepareRecurringPV} />
          ) : activePage === 'delegation_workspace' ? (
            <DelegationWorkspace profile={profile}
              onGoPaymentVoucher={() => setActivePage('payment_voucher')}
              onOpenVoucher={id => {
                setVoucherOpenRequest({id, key: Date.now()})
                setActivePage('delegation_review')
              }}
              onManage={tab => {
                if (!canManagePvDelegation(profile)) return
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
          ) : activePage === 'finance_document_archive' ? (
              canAccessFinanceDocumentArchive(profile)
                ? <FinanceDocumentArchive profile={profile} />
                : <section className="panel" role="alert">Access Restricted</section>
          ) : activePage === 'cash_voucher' ? (
            <CashVoucher profile={profile} />
          ) : activePage === 'manage_delegation' ? (
            canManagePvDelegation(profile) ? (
              profile.role === 'system_admin' ? (
                <SystemAdminDelegationViewer profile={profile} />
              ) : (
                <DelegationHub profile={profile} initialTab={manageDelegationTab} />
              )
            ) : (
              <section className="panel" role="alert">
                <h2>Access Restricted</h2>
                <p>PV Manage Delegation is restricted to Finance, CEO and BOD.</p>
              </section>
            )
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
          ) : (
            <JIMSDashboardHome
              profile={profile}
              stats={profile.role === 'system_admin' ? { totalUsers, activeUsers, disabledUsers } : null}
              canManageDelegation={canManagePvDelegation(profile)}
              onNavigate={page => {
                setActivePage(page)
                setEditingUser(null)
                setOrganizationUser(null)
                setResetUser(null)
              }}
            />
          )}
        </main>
      </div>
    </>
  )
}

export default App



