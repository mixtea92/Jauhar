import { useMemo } from 'react'

// JAUHAR_STEP_46N_UNIFIED_WORKSPACE
// Display-only: authorization, actionable queues and handover RPCs are unchanged.
const asLocal = value => value ? new Date(value).toLocaleString('en-MY', {timeZone:'Asia/Kuala_Lumpur'}) : '—'
const active = row => row?.status === 'approved' && !row.revoked_at &&
  new Date(row.starts_at).getTime() <= Date.now() && Date.now() < new Date(row.ends_at).getTime()
const card = {border:'1px solid #e0d6bd',borderRadius:12,padding:16,background:'#fff',minWidth:0}
const status = row => active(row) ? 'ACTIVE' : row?.status_effective || row?.status || 'UNKNOWN'
const heading = {margin:'0 0 8px',fontSize:19,color:'#243047'}
const muted = {fontSize:12,color:'#64748b'}
const upper = value => String(value || '—').replaceAll('_',' ').toUpperCase()
const headline = {display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:14}

export default function JSYNCDelegationUnifiedOverview({authorities=[],handovers=[],userId,delegated=[],onManage,onGoPaymentVoucher,section = 'authorities'}) {
  const myGrants = authorities.filter(g => g.delegate_id === userId && active(g))
  const myHandovers = handovers.filter(h => active(h) &&
    (h.original_requester === userId || h.new_requester === userId))
  const activity = useMemo(() => [
    ...authorities.map(a => ({id:'auth-'+a.id,kind:'Authority',subject:upper(a.authority) + (a.department ? ' · '+a.department : ''),
      change:upper(a.principal_username)+' → '+upper(a.delegate_username), when:a.starts_at, state:status(a)})),
    ...handovers.map(h => ({id:'handover-'+h.id,kind:'Requester Handover',subject:h.pv_number || '—',
      change:upper(h.original_username)+' → '+upper(h.new_username),when:h.starts_at,state:status(h)}))
  ].sort((a,b) => new Date(b.when || 0) - new Date(a.when || 0)).slice(0,20),[authorities,handovers])

  return <>
    {section === 'authorities' && <section className="panel" id="delegation-active-authorities" style={{scrollMarginTop:22}}>
      <div style={headline}>
        <div><h2 style={heading}>My Active Authorities ({myGrants.length})</h2>
          <p style={muted}>Your current independently-authorized approval authority. The matching pending PVs are in Delegated PV Inbox directly below.</p></div>
        <button type="button" className="btn" onClick={() => onManage?.('received')}>View All Authority Records</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:12}}>
        {myGrants.map(g => {
          return <div key={g.id} style={card}>
            <div style={{display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
              <strong>{upper(g.authority)} {g.department ? '· '+g.department : ''}</strong>
              <strong style={{fontSize:12,color:'#197447'}}>ACTIVE</strong>
            </div>
            <p style={{fontSize:13,margin:'9px 0'}}>Acting for: <strong>{upper(g.principal_username)}</strong></p>
            <p style={muted}>Permissions: {(g.permissions || []).join(' / ') || 'As authorized'}</p>
            <p style={muted}>Valid until: {asLocal(g.ends_at)}</p>
            <p style={{fontSize:13}}><strong>{delegated.length} delegated PV(s)</strong> in your overall approval inbox</p>
            <button type="button" className="btn" onClick={() => document.getElementById('delegation-pv-inbox')?.scrollIntoView({behavior:'smooth',block:'start'})}>
              See Delegated PVs
            </button>
          </div>
        })}
        {!myGrants.length && <div style={{...card,gridColumn:'1/-1'}}>
          No active approval authority for your account. You may still have a requester handover below.
        </div>}
      </div>
    </section>}

    {section === 'other' && <section className="panel" id="delegation-active-handovers" style={{scrollMarginTop:22}}>
      <div style={headline}>
        <div><h2 style={heading}>Handed Over PVs ({myHandovers.length})</h2>
          <p style={muted}>Draft / Returned work assigned to or handed over by you. This is editing authority, not approval authority.</p></div>
        <button className="btn" type="button" onClick={() => onManage?.('handover')}>Manage Handover</button>
      </div>
      <div className="table-wrap"><table><thead><tr>
        <th>PV Number</th><th>Original → New Requester</th><th>Your Position</th><th>Validity</th><th>Actions</th>
      </tr></thead><tbody>
        {myHandovers.map(h => <tr key={h.id}>
          <td><strong>{h.pv_number || '—'}</strong></td>
          <td>{upper(h.original_username)} → {upper(h.new_username)}</td>
          <td>{h.new_requester === userId ? 'Receiving Executive' : 'Original Requester'}</td>
          <td>{asLocal(h.starts_at)} → {asLocal(h.ends_at)}</td>
          <td><button type="button" className="btn" onClick={() => onGoPaymentVoucher ? onGoPaymentVoucher() : onManage?.('handover')}>
            Go to Payment Voucher
          </button></td>
        </tr>)}
        {!myHandovers.length && <tr><td colSpan={5}>No currently active requester handovers for this account.</td></tr>}
      </tbody></table></div>
      <p style={muted}>For the transferred PV, use Payment Voucher to open and edit. Original created_by remains unchanged. The receiving Executive must not be allowed to delete the draft; that backend rule requires separate verification.</p>
    </section>}

    {section === 'other' && <section className="panel" id="delegation-activity">
      <div style={headline}>
        <div><h2 style={heading}>Delegation Activity ({activity.length} latest records)</h2>
          <p style={muted}>Delegation / handover history from the existing authorized dashboard. PV-level approval history is a separate audit control.</p></div>
        <button type="button" className="btn" onClick={() => onManage?.('history')}>Full History</button>
      </div>
      <div className="table-wrap"><table><thead><tr>
        <th>Type</th><th>Scope / PV</th><th>From → To</th><th>Effective From</th><th>Status</th>
      </tr></thead><tbody>
        {activity.map(a => <tr key={a.id}>
          <td>{a.kind}</td><td>{a.subject}</td><td>{a.change}</td>
          <td>{asLocal(a.when)}</td><td>{a.state}</td>
        </tr>)}
        {!activity.length && <tr><td colSpan={5}>No delegation activity visible to this account.</td></tr>}
      </tbody></table></div>
    </section>}
  </>
}
