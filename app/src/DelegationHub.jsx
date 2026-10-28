import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

// JAUHAR_STEP_46D_HUB — The database is the final authorization authority.
const panel = { border: '1px solid #d5e2f0', borderRadius: 12, padding: 18, marginTop: 14 }
const field = { width: '100%', padding: 10, border: '1px solid #cdd8e6', borderRadius: 8, marginTop: 6 }
const label = { display: 'block', fontWeight: 600, fontSize: 13, marginTop: 12 }
const NAV = [
  ['request', 'Request Delegation'], ['received', 'Delegated To Me'],
  ['given', 'Delegated By Me'], ['authorizations', 'Pending Authorization'],
  ['handover', 'Requester Handover'], ['history', 'History']
]
const roleCaption = { executive: 'Executive', manager: 'HOD / Manager', ceo: 'CEO', bod: 'BOD' }
const titleUser = row => `${(row.username || '').toUpperCase()} — ${roleCaption[row.role] || row.role}${row.department ? ` · ${row.department}` : ''}`
const asDate = val => val ? new Date(val).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) : '—'
const localDT = days => {
  const d = new Date(Date.now() + days * 86400000)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16)
}
const iso = date => {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) throw new Error('Invalid start / end date')
  return d.toISOString()
}
function Options({ choices, value, onChange, required = true, placeholder = 'Select active user' }) {
  const [query, setQuery] = useState('')
  const matches = choices.filter(r => titleUser(r).toLowerCase().includes(query.trim().toLowerCase()))
  return <>
    <input style={field} type="search" value={query} onChange={e=>setQuery(e.target.value)}
      placeholder="Search username / department / role" aria-label="Filter active staff dropdown" />
    <select style={field} value={value} required={required} onChange={e=>onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {matches.map(r=><option key={r.id} value={r.username}>{titleUser(r)}</option>)}
      {value && !matches.some(r=>r.username === value) &&
        choices.filter(r=>r.username === value).map(r=><option key={r.id} value={r.username}>{titleUser(r)}</option>)}
    </select>
    {!matches.length && <p className="muted">No eligible active staff found.</p>}
  </>
}

// JAUHAR_STEP_46M3_SMART_HANDOVER_PV_PICKER
// List is populated by the read-only SQL RPC; submission independently rechecks.
function JSYNCHandoverPVPicker({ profile, value, emergency, rows, loading, error, onPick, onRefresh }) {
  const [query, setQuery] = useState('')
  const selected = rows.find(p => p.pv_number === value) || null
  const needle = query.trim().toLowerCase()
  const found = rows.filter(p => [p.pv_number, p.payee_name, p.owner_username,
    p.status, p.origin_department].some(x => String(x ?? '').toLowerCase().includes(needle)))
  const options = selected && !found.some(p => p.pv_number === selected.pv_number)
    ? [selected, ...found] : found
  const money = n => 'RM ' + Number(n || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })
  return <div style={{marginTop:12,padding:12,border:'1px solid #d5e2f0',borderRadius:9}}>
    <label style={label} htmlFor="handover-pv-search">Search existing Draft / Returned PV</label>
    <input id="handover-pv-search" type="search" style={field} value={query}
      onChange={e => setQuery(e.target.value)}
      placeholder="Search PV number, payee, requester or status" />
    <label style={label} htmlFor="handover-pv-selection">Select Payment Voucher *</label>
    <select id="handover-pv-selection" style={field} value={value || ''} required
      disabled={loading || Boolean(error)}
      onChange={e => onPick(rows.find(p => p.pv_number === e.target.value) || null)}>
      <option value="">{loading ? 'Loading eligible PVs...' : 'Choose eligible PV...'}</option>
      {options.map(p => <option key={p.id} value={p.pv_number}>
        {p.pv_number} · {String(p.status).toUpperCase()} · {p.payee_name || 'No payee'} · {money(p.amount)}
      </option>)}
    </select>
    <button type="button" disabled={loading} style={{marginTop:8,padding:'7px 12px',borderRadius:6}}
      onClick={onRefresh}>Refresh PV List</button>
    {error && <p className="error" role="alert">{error}</p>}
    {!loading && !error && !rows.length && <p className="muted">
      {profile?.role === 'manager' && !emergency
        ? 'Tick Emergency HOD-initiated handover first to select your department’s Draft/Returned PV.'
        : 'No eligible Draft / Returned PV for this account.'}
    </p>}
    {selected && <div style={{marginTop:12,background:'#f3f6fb',borderRadius:8,padding:12,fontSize:13}}>
      <strong>Selected Payment Voucher — linked automatically</strong>
      <div>PV: {selected.pv_number} · Status: {String(selected.status).toUpperCase()}</div>
      <div>Payee: {selected.payee_name || '—'} · Amount: {money(selected.amount)}</div>
      <div>Origin Department: {selected.origin_department || '—'}</div>
      <div>Original Requester: {(selected.owner_username || '—').toUpperCase()}</div>
    </div>}
  </div>
}

export default function DelegationHub({ profile, initialTab = 'request' }) {
  const [tab, setTab] = useState(initialTab)
  const [directory, setDirectory] = useState([])
  const [records, setRecords] = useState({ authorities: [], handovers: [] })
  const [userId, setUserId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const authorityDefault = profile?.role === 'manager'
    ? (profile?.department === 'Finance' ? 'finance_manager' : 'hod')
    : profile?.role === 'ceo' ? 'ceo' : 'bod'
  const [delegation, setDelegation] = useState({
    authority: authorityDefault, department: profile?.department || 'Operation', delegate: '', principal: '',
    emergency: false, starts_at: localDT(0), ends_at: localDT(7), reason: '',
    approve: true, return: true, reject: true
  })
  const [handover, setHandover] = useState({ pv_number: '', recipient: '', emergency: false,
    starts_at: localDT(0), ends_at: localDT(7), reason: '' })
  const [handoverPVs, setHandoverPVs] = useState([])
  const [handoverLoading, setHandoverLoading] = useState(false)
  const [handoverLoadError, setHandoverLoadError] = useState('')
  const [handoverRefresh, setHandoverRefresh] = useState(0)
  const authorities = records.authorities || []
  const handovers = records.handovers || []

  async function reload() {
    const [a,b,c] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('jauhar_staff_directory_v1'),
      supabase.rpc('jauhar_delegation_dashboard_v1')
    ])
    if (a.error || b.error || c.error) throw new Error(a.error?.message || b.error?.message || c.error?.message)
    setUserId(a.data?.user?.id || null)
    setDirectory(b.data || [])
    setRecords({ authorities: c.data?.authorities || [], handovers: c.data?.handovers || [] })
  }
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [a,b,c] = await Promise.all([
          supabase.auth.getUser(), supabase.rpc('jauhar_staff_directory_v1'),
          supabase.rpc('jauhar_delegation_dashboard_v1')
        ])
        if (!alive) return
        if (a.error || b.error || c.error) throw new Error(a.error?.message || b.error?.message || c.error?.message)
        setUserId(a.data?.user?.id || null)
        setDirectory(b.data || [])
        setRecords({ authorities: c.data?.authorities || [], handovers: c.data?.handovers || [] })
      } catch(e) { if (alive) setError(e.message || 'Failed to load delegation records') }
    }
    load()
    return () => { alive = false }
  }, [profile?.role, profile?.department])
  const current = directory.find(p=>p.id===userId)
  const principal = delegation.emergency
    ? directory.find(p=>p.username===delegation.principal)
    : current
  const stage = delegation.authority
  const department = stage === 'hod' ? delegation.department :
    stage === 'finance_manager' ? 'Finance' : null
  const allowedAuthorities = delegation.emergency
    ? profile?.role === 'ceo' ? ['hod','finance_manager'] : profile?.role === 'bod' ? ['ceo','bod'] : []
    : [authorityDefault]
  const originalChoices = directory.filter(p => (
    (stage === 'hod' && p.role === 'manager' && p.department === department && department !== 'Finance') ||
    (stage === 'finance_manager' && p.role === 'manager' && p.department === 'Finance') ||
    (stage === 'ceo' && p.role === 'ceo') || (stage === 'bod' && p.role === 'bod')
  ))
  const delegates = directory.filter(p => p.id !== userId &&
    p.id !== principal?.id && p.department === (principal?.department ?? department) &&
    ['executive','manager','ceo','bod'].includes(p.role))
  const selectedHandoverPV = handoverPVs.find(v => v.pv_number === handover.pv_number) || null
  const targetDept = selectedHandoverPV?.origin_department || ''
  const handoverTargets = directory.filter(p => p.role==='executive' &&
    p.department === targetDept && p.id !== userId &&
    p.id !== selectedHandoverPV?.created_by)

  // JAUHAR_STEP_46M3 — Read candidate PVs when handover screen opens.
  // Supabase limits the list to original-requester or same-department HOD scope.
  useEffect(() => {
    if (tab !== 'handover') return
    let alive = true
    if (profile?.role !== 'executive' && profile?.role !== 'manager') {
      setHandoverPVs([])
      setHandoverLoadError('Only an Executive or HOD may request handover.')
      return
    }
    setHandoverLoading(true)
    setHandoverLoadError('')
    supabase.rpc('jauhar_handover_selectable_pvs_v1', {
      p_emergency: profile?.role === 'manager' && Boolean(handover.emergency)
    }).then(({ data, error: queryError }) => {
      if (!alive) return
      if (queryError) {
        setHandoverPVs([])
        setHandoverLoadError(queryError.message || 'Unable to list eligible PVs.')
        return
      }
      const result = Array.isArray(data) ? data : []
      setHandoverPVs(result)
      setHandover(prev => prev.pv_number && !result.some(v => v.pv_number === prev.pv_number)
        ? {...prev, pv_number:'', recipient:''} : prev)
    }).catch(e => {
      if (alive) { setHandoverPVs([]); setHandoverLoadError(e.message || 'PV lookup failed.') }
    }).finally(() => { if (alive) setHandoverLoading(false) })
    return () => { alive = false }
  }, [tab, profile?.role, profile?.department, handover.emergency, handoverRefresh])

  async function rpc(name,args) {
    const result = await supabase.rpc(name,args)
    if (result.error) throw result.error
  }
  async function submit(work, success) {
    if (busy) return
    setBusy(true);setError('');setNotice('')
    try { await work(); await reload(); setNotice(success) }
    catch(e) { setError(e.message || 'Request failed') }
    finally { setBusy(false) }
  }
  function requestDelegation(e) {
    e.preventDefault()
    submit(async()=>{
      const permissions = ['approve','return','reject'].filter(k => delegation[k])
      if (!permissions.length) throw new Error('Choose at least one permission')
      if (!delegates.some(p=>p.username===delegation.delegate)) throw new Error('Choose an eligible user from the dropdown')
      await rpc('request_pv_delegation_v1', {
        p_authority:stage,p_department:department,p_delegate_username:delegation.delegate,
        p_principal_username:delegation.emergency ? delegation.principal : null,
        p_starts_at:iso(delegation.starts_at),p_ends_at:iso(delegation.ends_at),
        p_permissions:permissions,p_reason:delegation.reason.trim(),p_emergency:delegation.emergency
      })
    }, 'Delegation saved. Ordinary requests await CEO/BOD authorization.')
  }
  function requestHandover(e) {
    e.preventDefault()
    submit(async()=>{
      if (!selectedHandoverPV || !['draft','returned'].includes(selectedHandoverPV.status)) throw new Error('Select an eligible Draft / Returned PV from the dropdown')
        if (!handoverTargets.some(p=>p.username===handover.recipient)) throw new Error('Select an eligible Executive from the dropdown')
      await rpc('request_pv_handover_v1', {
        p_pv_number:handover.pv_number.trim(),p_new_username:handover.recipient,
        p_starts_at:iso(handover.starts_at),p_ends_at:iso(handover.ends_at),
        p_reason:handover.reason.trim(),p_emergency:handover.emergency
      })
      setHandover(p=>({...p,pv_number:'',recipient:''}))
      setHandoverRefresh(n=>n+1)
    }, 'Requester handover requested. Authorization must come from the originating department HOD.')
  }
  function decide(item, approve, isHandover) {
    if (!window.confirm(`${approve ? 'Authorize' : 'Reject'} ${isHandover ? item.pv_number : item.authority} request?`)) return
    submit(()=>rpc(isHandover ? 'decide_pv_handover_v1':'decide_pv_delegation_v1',
      isHandover ? { p_handover_id:item.id,p_approve:approve,p_remarks:'Reviewed in JSYNC' }
      : { p_grant_id:item.id,p_approve:approve,p_remarks:'Reviewed in JSYNC' }),
      'Authorization decision recorded.')
  }
  function revoke(item,isHandover) {
    const reason=window.prompt('Revocation reason (minimum 10 characters):')
    if (reason === null) return
    if (reason.trim().length < 10) {setError('Reason must contain at least 10 characters');return}
    submit(()=>rpc(isHandover?'revoke_pv_handover_v1':'revoke_pv_delegation_v1',
      isHandover?{p_handover_id:item.id,p_reason:reason.trim()}:{p_grant_id:item.id,p_reason:reason.trim()}),
      'Temporary authority revoked.')
  }
  const isAuthorizer = item => item.status === 'pending' && userId !== item.delegate_id &&
    userId !== item.principal_id && (
    (['hod','finance_manager'].includes(item.authority) && profile?.role==='ceo') ||
    (['ceo','bod'].includes(item.authority) && profile?.role==='bod'))
  const isHodAuthorizer = item => item.status==='pending' && profile?.role==='manager' &&
    profile?.department === item.origin_department && userId!==item.original_requester &&
    userId!==item.new_requester
  const pendingDelegations = authorities.filter(isAuthorizer)
  const pendingHandovers = handovers.filter(isHodAuthorizer)
  const received = authorities.filter(p=>p.delegate_id===userId)
  const given = authorities.filter(p=>p.principal_id===userId)
  const allowRequest = profile?.role==='manager'||profile?.role==='ceo'||profile?.role==='bod'
  const fieldInput = (val,set,type='text',extra={}) =>
    <input style={field} type={type} value={val} onChange={e=>set(e.target.value)} {...extra}/>

  function DelegationRows({ rows, canDecide=false }) {
    return <div className="table-wrap"><table><thead><tr>
      <th>Authority</th><th>Original → Delegate</th><th>Permission</th><th>Validity</th><th>Status / Action</th>
    </tr></thead><tbody>
      {rows.map(r=><tr key={r.id}>
        <td>{r.authority?.toUpperCase()} {r.department ? `· ${r.department}`:''}</td>
        <td>{r.principal_username?.toUpperCase()} → {r.delegate_username?.toUpperCase()}{r.emergency?' (Emergency)':''}</td>
        <td>{(r.permissions||[]).join(', ')}</td>
        <td>{asDate(r.starts_at)} → {asDate(r.ends_at)}</td>
        <td>{r.status_effective||r.status}
          {canDecide && isAuthorizer(r) && <div className="pv-actions">
            <button type="button" className="btn" disabled={busy} onClick={()=>decide(r,true,false)}>Authorize</button>
            <button type="button" className="btn" disabled={busy} onClick={()=>decide(r,false,false)}>Reject</button></div>}
          {r.status==='approved' && (r.principal_id===userId ||
             (['hod','finance_manager'].includes(r.authority)?profile.role==='ceo':profile.role==='bod')) &&
            <button type="button" className="btn" disabled={busy} onClick={()=>revoke(r,false)}>Revoke</button>}
        </td>
      </tr>)}
      {!rows.length && <tr><td colSpan={5}>No records in this section.</td></tr>}
    </tbody></table></div>
  }
  function HandoverRows({ rows, canDecide=false }) {
    return <div className="table-wrap"><table><thead><tr>
      <th>PV</th><th>Original → New Requester</th><th>Validity</th><th>Status / Action</th>
    </tr></thead><tbody>
      {rows.map(h=><tr key={h.id}>
        <td>{h.pv_number}</td><td>{h.original_username?.toUpperCase()} → {h.new_username?.toUpperCase()}</td>
        <td>{asDate(h.starts_at)} → {asDate(h.ends_at)}</td>
        <td>{h.status_effective||h.status}
          {canDecide && isHodAuthorizer(h) && <div className="pv-actions">
            <button type="button" className="btn" disabled={busy} onClick={()=>decide(h,true,true)}>Authorize</button>
            <button type="button" className="btn" disabled={busy} onClick={()=>decide(h,false,true)}>Reject</button></div>}
          {h.status==='approved' && (h.original_requester===userId || isHodAuthorizer({...h,status:'pending'})) &&
            <button type="button" className="btn" disabled={busy} onClick={()=>revoke(h,true)}>Revoke</button>}
        </td>
      </tr>)}
      {!rows.length && <tr><td colSpan={4}>No records in this section.</td></tr>}
    </tbody></table></div>
  }
  return <div>
    <section className="panel">
      <div className="panel-head"><div>
        <h2>Manage Delegation &amp; Requester Handover</h2>
        <p className="muted">Separate from Payment Voucher · independent authorization · full audit trail</p>
      </div><button className="btn" type="button" disabled={busy} onClick={()=>submit(()=>Promise.resolve(), 'Refreshed')}>Refresh</button></div>
      <div className="pv-actions" style={{ flexWrap:'wrap',marginTop:12 }}>
        {NAV.map(([id,title])=><button type="button" key={id}
          className="btn" style={{ background:tab===id?'#173d70':'#68788d',marginBottom:6 }}
          onClick={()=>{setTab(id);setError('');setNotice('')}}>{title}</button>)}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="pv-success">{notice}</p>}
    </section>
    {tab==='request' && <section className="panel"><h2>Request Temporary Approval Delegation</h2>
      {!allowRequest ? <p className="muted">Your role can receive delegated approvals. Only an original approver or authorized superior may request delegation.</p>:
      <form style={panel} onSubmit={requestDelegation}>
        <p className="muted">CEO authorizes HOD / Finance Manager. Independent BOD authorizes CEO / BOD. Original authority is read-only during active delegation.</p>
        <label style={label}>Approval Authority
          <select style={field} value={stage} onChange={e=>setDelegation(p=>({...p,authority:e.target.value,delegate:'',principal:''}))}>
            {allowedAuthorities.map(a=><option key={a} value={a}>
              {({hod:'Department HOD',finance_manager:'Finance Manager',ceo:'CEO',bod:'BOD'})[a]}
            </option>)}
          </select>
        </label>
        {stage==='hod' && <label style={label}>Department
          <select style={field} value={delegation.department} onChange={e=>setDelegation(p=>({...p,department:e.target.value,delegate:'',principal:''}))}>
            {['Operation','Sales & Marketing','Medical','System, Project & Infrastructure'].map(d=><option key={d} value={d}>{d}</option>)}
          </select></label>}
        <label style={label}><input type="checkbox" checked={delegation.emergency} onChange={e=>setDelegation(p=>({...p,emergency:e.target.checked,authority:e.target.checked?(profile?.role==='ceo'?'hod':profile?.role==='bod'?'ceo':authorityDefault):authorityDefault,principal:'',delegate:''}))} /> Emergency (authorized superior only)</label>
        {delegation.emergency && <label style={label}>Original Approver
          <Options choices={originalChoices} value={delegation.principal} onChange={value=>setDelegation(p=>({...p,principal:value,delegate:''}))}/>
        </label>}
        <label style={label}>Delegate (same department, active account)
          <Options choices={delegates} value={delegation.delegate} onChange={value=>setDelegation(p=>({...p,delegate:value}))}/>
        </label>
        <div className="pv-grid"><label style={label}>Start date/time
          {fieldInput(delegation.starts_at,value=>setDelegation(p=>({...p,starts_at:value})),'datetime-local',{required:true})}</label>
          <label style={label}>End date/time
          {fieldInput(delegation.ends_at,value=>setDelegation(p=>({...p,ends_at:value})),'datetime-local',{required:true})}</label></div>
        <div style={{marginTop:14}}>Permissions: {['approve','return','reject'].map(a=><label key={a} style={{marginRight:18}}>
          <input type="checkbox" checked={delegation[a]} onChange={e=>setDelegation(p=>({...p,[a]:e.target.checked}))}/> {a}
        </label>)}</div>
        <label style={label}>Reason
          <textarea style={field} rows={3} minLength={10} maxLength={2000} required value={delegation.reason}
            onChange={e=>setDelegation(p=>({...p,reason:e.target.value}))}/></label>
        <button className="btn" type="submit" disabled={busy}>Submit Delegation Request</button>
      </form>}
      <p className="muted">BOD delegation requires a different BOD to authorize. Staff not listed are not eligible under the current same-department rule.</p>
    </section>}
    {tab==='received' && <section className="panel"><h2>Delegated To Me ({received.length})</h2><DelegationRows rows={received}/></section>}
    {tab==='given' && <section className="panel"><h2>Delegated By Me ({given.length})</h2><DelegationRows rows={given}/></section>}
    {tab==='authorizations' && <section className="panel"><h2>Pending Approval Delegation ({pendingDelegations.length})</h2>
      <DelegationRows rows={pendingDelegations} canDecide/>
      <h2 style={{marginTop:20}}>Pending Requester Handovers ({pendingHandovers.length})</h2>
      <HandoverRows rows={pendingHandovers} canDecide/></section>}
    {tab==='handover' && <section className="panel"><h2>Requester Handover — Draft / Returned Only</h2>
      <p className="muted">Executive → another active Executive in originating department. HOD of that same department must authorize. created_by remains unchanged.</p>
      <form style={panel} onSubmit={requestHandover}>
        <JSYNCHandoverPVPicker profile={profile}
            value={handover.pv_number} emergency={handover.emergency}
            rows={handoverPVs} loading={handoverLoading} error={handoverLoadError}
            onRefresh={() => setHandoverRefresh(n => n + 1)}
            onPick={pv => setHandover(p => ({...p,pv_number:pv?.pv_number || '',recipient:''}))} />

        <label style={label}>Handover To
          <Options choices={handoverTargets} value={handover.recipient} onChange={value=>setHandover(p=>({...p,recipient:value}))}/></label>
        {profile?.role === 'manager' && <label style={label}><input type="checkbox"
          checked={handover.emergency}
          onChange={e=>setHandover(p=>({...p,emergency:e.target.checked,pv_number:'',recipient:''}))} />
          Emergency HOD-initiated handover</label>}
        <div className="pv-grid"><label style={label}>Start
          {fieldInput(handover.starts_at,value=>setHandover(p=>({...p,starts_at:value})),'datetime-local',{required:true})}</label>
          <label style={label}>End
          {fieldInput(handover.ends_at,value=>setHandover(p=>({...p,ends_at:value})),'datetime-local',{required:true})}</label></div>
        <label style={label}>Reason
          <textarea style={field} rows={3} minLength={10} maxLength={2000} required value={handover.reason}
            onChange={e=>setHandover(p=>({...p,reason:e.target.value}))}/></label>
        <button className="btn" type="submit" disabled={busy}>Submit Handover Request</button>
      </form><h2 style={{marginTop:22}}>Handovers Visible To Me</h2><HandoverRows rows={handovers} canDecide/></section>}
    {tab==='history' && <section className="panel"><h2>Delegation History</h2><DelegationRows rows={authorities}/>
      <h2 style={{marginTop:24}}>Requester Handover History</h2><HandoverRows rows={handovers}/></section>}
  </div>
}
