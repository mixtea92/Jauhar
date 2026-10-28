import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

// JAUHAR_STEP_46N2D_DELEGATED_HISTORY_RENDER
const label = val => String(val || '—').replaceAll('_', ' ')
const whenMY = value => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-MY', { timeZone:'Asia/Kuala_Lumpur' }) : '—'
}

export default function PVDelegationHistory({ voucherId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const { data, error: rpcError } = await supabase.rpc('jauhar_pv_unified_history_v1', {
          p_voucher_id: voucherId
        })
        if (rpcError) throw rpcError
        if (alive) setItems(Array.isArray(data) ? data : [])
      } catch(e) {
        if (alive) { setItems([]); setError(e?.message || 'Could not load delegated history') }
      } finally { if (alive) setLoading(false) }
    }
    if (voucherId) void load()
    return () => { alive = false }
  }, [voucherId, version])

  const relevant = useMemo(() => items.filter(row =>
    (row.record_type === 'approval' && row.delegation?.grant_id) ||
    (row.record_type === 'delegation_handover' && row.action !== 'delegated_pv_decision')
  ), [items])

  return <div style={{margin:'15px 0 20px', padding:16, border:'1px solid #d5e2f0', borderRadius:12}}>
    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10}}>
      <div>
        <strong>Delegation &amp; Requester Handover Audit</strong>
        <p className="muted" style={{margin:'6px 0'}}>Part of this PV Approval History · recorded real actors and authorizers.</p>
      </div>
      <button type="button" className="btn" style={{background:'#68788d',padding:'7px 13px'}}
        disabled={loading} onClick={()=>setVersion(v=>v+1)}>
        {loading ? 'Loading...' : 'Refresh History'}
      </button>
    </div>
    {error && <p className="error" role="alert">Delegation audit unavailable: {error}</p>}
    {!loading && !error && relevant.length === 0 &&
      <p className="muted">No linked delegation/handover events for this PV. Historical delegated actions before Step 46N.2C may not have exact grant metadata.</p>}
    {relevant.length > 0 && <div className="table-wrap" style={{marginTop:12}}>
      <table><thead><tr>
        <th>Date / Time (MY)</th><th>Event</th><th>Action By</th><th>Authority / Handover</th>
      </tr></thead><tbody>
        {relevant.map((row,index) => <tr key={`${row.record_type}-${row.id || index}-${index}`}>
          <td style={{whiteSpace:'nowrap'}}>{whenMY(row.occurred_at)}</td>
          <td><strong>{label(row.action)}</strong>{row.tier ? ` · ${label(row.tier)}` : ''}</td>
          <td>{row.actor_username?.toUpperCase() || '—'}</td>
          <td>{row.record_type === 'approval' ? <>
            Acting for <strong>{row.principal_username?.toUpperCase() || String(row.delegation?.principal_id || '—')}</strong>
            <div className="muted">Authority: {label(row.delegation?.authority)} · Approved grant: {String(row.delegation?.grant_id || '—').slice(0,8)}…</div>
          </> : <>
            <strong>{row.original_username?.toUpperCase() || '—'} → {row.new_username?.toUpperCase() || '—'}</strong>
            <div className="muted">HOD Authorizer: {row.hod_authorizer_username?.toUpperCase() || 'Pending / N/A'}</div>
          </>}</td>
        </tr>)}
      </tbody></table>
    </div>}
  </div>
}
