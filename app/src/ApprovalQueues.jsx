import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

// JAUHAR_STEP_46D_SPLIT_APPROVAL_QUEUES — actual vs delegated, RPC-authorized.
export default function ApprovalQueues({ profile, onOpenVoucher, refreshKey = 0, mode = 'all' }) {
  const [lane,setLane] = useState('actual')
  const [data,setData] = useState({ actual:[], delegated:[] })
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  async function reload() {
    setLoading(true);setError('')
    try {
      const {data: rows,error: err} = await supabase.rpc('jauhar_my_approval_queues_v1')
      if (err) throw err
      setData({actual:rows?.actual||[],delegated:rows?.delegated||[]})
    } catch(e){setError(e.message || 'Failed to load approval queue')}
    finally {setLoading(false)}
  }
  useEffect(()=>{ let cancelled=false
    setLoading(true)
    supabase.rpc('jauhar_my_approval_queues_v1').then(({data:rows,error:err})=>{
      if(cancelled)return
      if(err)setError(err.message)
      else {setError('');setData({actual:rows?.actual||[],delegated:rows?.delegated||[]})}
    }).catch(e=>{if(!cancelled)setError(e.message)}).finally(()=>{if(!cancelled)setLoading(false)})
    return ()=>{cancelled=true}
  },[profile?.role,profile?.department,refreshKey])
  const selectedLane = mode === 'actual' ? 'actual' : lane
  const rows=data[selectedLane]||[]
  return <section className="panel">
    <div className="panel-head"><div><h2>{mode === 'actual' ? 'My Approvals · Actual Authority' : 'Approval Queues'}</h2>
      <p className="muted">Own approval authority and delegated authority are always shown separately.</p></div>
      <button type="button" className="btn" disabled={loading} onClick={reload}>{loading?'Loading...':'Refresh Queues'}</button>
    </div>
    <div className="pv-actions" style={{marginBottom:15}}>
      {mode !== 'actual' && <button type="button" className="btn" style={{background:lane==='actual'?'#173d70':'#68788d'}}
        onClick={()=>setLane('actual')}>My Approvals ({data.actual.length})</button>}
      {mode !== 'actual' && <button type="button" className="btn" style={{background:lane==='delegated'?'#173d70':'#68788d'}}
        onClick={()=>setLane('delegated')}>Delegated Approvals ({data.delegated.length})</button>}
    </div>
    {selectedLane==='delegated' && <p className="pv-notice">Acting Authority — approvals executed using someone else's temporary authorization. Your own login is recorded in audit.</p>}
    {selectedLane==='actual' && <p className="muted">Actual Authority — approvals belonging to your own role. Original approval is read-only during active delegation.</p>}
    {error && <p role="alert" className="error">{error}. Do not interpret the queue count as zero.</p>}
    <div className="table-wrap"><table><thead><tr>
      <th>PV Number</th><th>Tier</th><th>Department</th><th>Approval Stage</th>
      {selectedLane==='delegated' && <th>Acting For</th>}<th>Payee</th><th>Amount</th><th>Action</th>
    </tr></thead><tbody>
      {rows.map(v=><tr key={v.id}>
        <td>{v.pv_number}</td><td>{v.financial_tier||'—'}</td>
        <td>{v.origin_department||'—'}</td><td>{(v.authority||'').replaceAll('_',' ').toUpperCase()}
          {v.self_review_exception && <div className="pv-notice" style={{marginTop:5,fontSize:12}}>
            Own PV · Acting HOD exception · Finance review mandatory
          </div>}{/* JAUHAR_STEP_46E_NONFINANCE_ACTING_HOD_EXCEPTION */}</td>
        {selectedLane==='delegated' && <td>{v.original_approver?.toUpperCase()||'—'}</td>}
        <td>{v.payee_name}</td><td>RM {Number(v.amount||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td><button className="btn" type="button" onClick={()=>onOpenVoucher(v.id)}>
          Open PV</button></td>
      </tr>)}
      {!rows.length && <tr><td colSpan={selectedLane==='delegated'?8:7}>
        {loading?'Loading...':'No actionable approvals in this category.'}</td></tr>}
    </tbody></table></div>
    <p className="muted" style={{marginTop:12}}>Shows up to 300 actionable PVs. Use Payment Voucher's full list for historical tracking.</p>
  </section>
}
