import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import JSYNCDelegationUnifiedOverview from './JSYNCDelegationUnifiedOverview'
// JAUHAR_STEP_46N1_UNIFIED_WORKSPACE

// JAUHAR_STEP_46G_FINANCIAL_DELEGATION_WORKSPACE
// Future financial modules can add their own queue source. No Budgeting permissions/RPCs exist yet.
const departments = ['Operation', 'Sales & Marketing', 'Medical', 'System, Project & Infrastructure']
const money = amount => `RM ${Number(amount || 0).toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2})}`
const stamp = value => value ? new Date(value).toLocaleString('en-MY', {timeZone:'Asia/Kuala_Lumpur'}) : '—'
const activeGrant = grant => {
  const now = Date.now()
  return grant?.status === 'approved' && !grant.revoked_at &&
    new Date(grant.starts_at).getTime() <= now && now < new Date(grant.ends_at).getTime()
}
const cardStyle = {minWidth:0, border:'1px solid #d5e2f0', borderRadius:12,
  padding:'20px 18px', background:'#fff', textAlign:'left'}
const titleStyle = {fontSize:28, fontWeight:800, fontVariantNumeric:'tabular-nums', display:'block'}
const scopeStyle = {display:'flex', flexWrap:'wrap', alignItems:'center', gap:10, margin:'16px 0 22px'}
const infoStyle = {background:'#f2f6fc', borderRadius:10, padding:'12px 15px', marginBottom:18}

export default function DelegationWorkspace({ profile, onOpenVoucher, onManage, onGoPaymentVoucher }) {
  const [queues, setQueues] = useState(null)
  const [records, setRecords] = useState(null)
  const [userId, setUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [department, setDepartment] = useState('all')
  const [busyVoucher, setBusyVoucher] = useState(null)

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const [identity, queueResult, dashboardResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc('jauhar_my_approval_queues_v1'),
        supabase.rpc('jauhar_delegation_dashboard_v1')
      ])
      const err = identity.error || queueResult.error || dashboardResult.error
      if (err) throw err
      setUserId(identity.data?.user?.id || null)
      setQueues({actual:queueResult.data?.actual || [], delegated:queueResult.data?.delegated || []})
      setRecords({authorities:dashboardResult.data?.authorities || [],
        handovers:dashboardResult.data?.handovers || []})
    } catch (e) {
      // Crucial: never show a false zero if the RPC failed (Step 46F fix is required).
      setQueues(null)
      setRecords(null)
      setError(e.message || 'Delegation dashboard could not be loaded')
    } finally {setLoading(false)}
  }
  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true);setError('')
      try {
        const [identity, queueResult, dashboardResult] = await Promise.all([
          supabase.auth.getUser(), supabase.rpc('jauhar_my_approval_queues_v1'),
          supabase.rpc('jauhar_delegation_dashboard_v1')
        ])
        if (!alive) return
        const err = identity.error || queueResult.error || dashboardResult.error
        if (err) throw err
        setUserId(identity.data?.user?.id || null)
        setQueues({actual:queueResult.data?.actual || [], delegated:queueResult.data?.delegated || []})
        setRecords({authorities:dashboardResult.data?.authorities || [],
          handovers:dashboardResult.data?.handovers || []})
      } catch(e) {
        if(alive) {setQueues(null);setRecords(null);setError(e.message || 'Delegation dashboard unavailable')}
      } finally {if (alive) setLoading(false)}
    }
    run()
    return () => {alive = false}
  }, [profile?.role, profile?.department])
  const authorities = records?.authorities || []
  const handovers = records?.handovers || []
  const delegated = queues?.delegated || []
  const active = authorities.filter(grant => grant.delegate_id === userId && activeGrant(grant))
  const pendingAuthorities = authorities.filter(grant => grant.status === 'pending' &&
    grant.principal_id !== userId && grant.delegate_id !== userId &&
    ((['hod', 'finance_manager'].includes(grant.authority) && profile?.role === 'ceo') ||
     (['ceo', 'bod'].includes(grant.authority) && profile?.role === 'bod')))
  const pendingHandovers = handovers.filter(h => h.status === 'pending' &&
    profile?.role === 'manager' && profile?.department === h.origin_department &&
    userId !== h.original_requester && userId !== h.new_requester)
  const pendingTotal = pendingAuthorities.length + pendingHandovers.length
  const activeHandovers = handovers.filter(h => activeGrant(h) &&
    (h.original_requester === userId || h.new_requester === userId))
  const visible = useMemo(() => delegated.filter(v =>
    (department === 'all' || v.origin_department === department) &&
    (!q.trim() || [v.pv_number, v.payee_name, v.original_approver, v.origin_department]
      .some(s => String(s || '').toLowerCase().includes(q.trim().toLowerCase())))),
    [delegated,department,q])
  const metrics = [
    {key:'pv', label:'Delegated PV Approvals', value:queues ? delegated.length : null,
      hint:'Payment Vouchers waiting for your acting authority', action:()=>document.getElementById('delegation-pv-inbox')?.scrollIntoView({behavior:'smooth',block:'start'})},
    {key:'active', label:'Active Authority Grants', value:records ? active.length : null,
      hint:'Authorized delegations currently in effect', action:()=>document.getElementById('delegation-active-authorities')?.scrollIntoView({behavior:'smooth',block:'start'})},
    {key:'authorise', label:'Pending Authorization', value:records ? pendingTotal : null,
      hint:'Delegation and handover requests requiring your decision', action:()=>onManage?.('authorizations')},
    {key:'handover', label:'Active Handovers', value:records ? activeHandovers.length : null,
      hint:'Your active requester handover responsibilities', action:()=>document.getElementById('delegation-active-handovers')?.scrollIntoView({behavior:'smooth',block:'start'})}
  ]

  return <div className="jsync-delegation-workspace">
    <section className="panel" style={{padding:'26px 24px'}}>
      <div className="panel-head" style={{flexWrap:'wrap'}}>
        <div>
          <span className="muted">FINANCIAL APPROVAL / DELEGATION</span>
          <h2 style={{fontSize:25,marginTop:8}}>Delegation Workspace</h2>
          <p className="muted">All delegated financial approvals in one place. Your own approval authority stays in Payment Voucher.</p>
        </div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button type="button" className="btn" onClick={()=>onManage?.('request')}>Manage Delegation</button>
          <button type="button" className="btn" style={{background:'#68788d'}} disabled={loading}
            onClick={fetchData}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>
      </div>
      <div style={scopeStyle}>
        <span style={{fontWeight:700,fontSize:13}}>Financial modules:</span>
        <span style={{background:'#e8eef7',padding:'7px 13px',borderRadius:18,fontSize:13,fontWeight:700}}>Payment Voucher · Active</span>
        <span style={{border:'1px dashed #b8c6d6',padding:'7px 13px',borderRadius:18,fontSize:13,color:'#65748b'}}>Budgeting · Phase 2 (not active)</span>
      </div>
      {error && <p className="error" role="alert" style={infoStyle}>
        Unable to load approval counters: {error}. Do not rely on zero counts until the RPC is fixed.
        {' '}If you have not run the Step 46F SQL fix, run it first.</p>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(195px,1fr))',gap:14}}>
        {metrics.map(m=><button type="button" key={m.key} style={cardStyle} onClick={m.action}>
          <strong style={titleStyle}>{loading || m.value == null ? '—' : m.value}</strong>
          <span style={{fontWeight:700,display:'block',margin:'6px 0'}}>{m.label} ↗</span>
          <span className="muted">{m.hint}</span>
        </button>)}
      </div>
      <p className="muted" style={{marginTop:14}}>Only authority that has passed independent authorization, valid dates and database permission checks is actionable. Acting decisions use your real login in the audit trail.</p>
    </section>

    <JSYNCDelegationUnifiedOverview authorities={authorities} handovers={handovers}
      userId={userId} delegated={delegated} onManage={onManage}
      onGoPaymentVoucher={onGoPaymentVoucher} section="authorities" />

    <section className="panel" id="delegation-pv-inbox" style={{scrollMarginTop:22}}>
      <div className="panel-head" style={{flexWrap:'wrap'}}>
        <div>
          <h2>Delegated PV Inbox ({queues ? delegated.length : '—'})</h2>
          <p className="muted">Approve / Return / Reject only where the delegated permission allows. Open a PV to make a decision.</p>
        </div>
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',margin:'0 0 18px'}}>
        <label style={{fontSize:13,fontWeight:700,flex:'1 1 240px'}}>Search PV / payee / original approver
          <input type="search" value={q} onChange={e=>setQ(e.target.value)}
            placeholder="Search delegated approvals" style={{display:'block',width:'100%',padding:11,border:'1px solid #ccd7e6',borderRadius:8,marginTop:6}}/>
        </label>
        <label style={{fontSize:13,fontWeight:700,flex:'1 1 210px'}}>Department
          <select value={department} onChange={e=>setDepartment(e.target.value)}
            style={{display:'block',width:'100%',padding:11,border:'1px solid #ccd7e6',borderRadius:8,marginTop:6}}>
            <option value="all">All departments</option>
            {departments.map(d=><option key={d} value={d}>{d}</option>)}
            <option value="Finance">Finance</option>
          </select>
        </label>
      </div>
      <div className="table-wrap"><table><thead><tr>
        <th>PV Number</th><th>Tier</th><th>Department</th><th>Acting For</th>
        <th>Approval Gate</th><th>Payee</th><th>Amount</th><th>Action</th>
      </tr></thead><tbody>
        {visible.map(v=><tr key={v.id}>
          <td><strong>{v.pv_number}</strong></td><td>{v.financial_tier || '—'}</td>
          <td>{v.origin_department || '—'}</td><td>{v.original_approver?.toUpperCase() || '—'}</td>
          <td>{(v.authority || '').replaceAll('_',' ').toUpperCase()}
            {v.self_review_exception && <small style={{display:'block',marginTop:6,color:'#a46300'}}>
              Own PV · Acting HOD exception · Independent Finance checks required
            </small>}
          </td><td>{v.payee_name || '—'}</td><td>{money(v.amount)}</td>
          <td><button type="button" className="btn" disabled={busyVoucher===v.id}
            onClick={()=>{setBusyVoucher(v.id);onOpenVoucher?.(v.id)}}>
            Open PV</button></td>
        </tr>)}
        {!visible.length && <tr><td colSpan={8}>
          {loading ? 'Loading delegated approvals...' : error ? 'Unable to load approvals — see error above.' :
            q || department !== 'all' ? 'No approvals match the current filter.' :
              'No delegated PV approvals currently require action.'}</td></tr>}
      </tbody></table></div>
      <p className="muted" style={{marginTop:14}}>Showing up to 300 actionable Payment Vouchers, as returned by the authorization RPC. Budget delegation will be integrated after the Budget Dashboard is developed.</p>
    </section>

    <JSYNCDelegationUnifiedOverview authorities={authorities} handovers={handovers}
      userId={userId} delegated={delegated} onManage={onManage}
      onGoPaymentVoucher={onGoPaymentVoucher} section="other" />

    <section className="panel" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:14,flexWrap:'wrap'}}>
      <div><h2>Manage Delegation &amp; Handover</h2>
        <p className="muted">Request, authorize, revoke, track expiry, and review delegation history.</p></div>
      <button className="btn" type="button" onClick={()=>onManage?.('request')}>Open Manage Delegation</button>
    </section>
  </div>
}
