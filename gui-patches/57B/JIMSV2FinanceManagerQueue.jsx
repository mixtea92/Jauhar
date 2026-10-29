import {useCallback,useEffect,useState} from 'react'
import {supabase} from './lib/supabase'

// JIMS 57B4. Actionable approvals only: the SQL RPC checks the current
// user's Finance Manager authority/delegation for each V2 installment.
// No client-side approval or document permissions are granted by this list.
export default function JIMSV2FinanceManagerQueue({onOpenVoucher,onCountChange}){
  const [items,setItems]=useState([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [lastUpdated,setLastUpdated]=useState(null)

  const reload=useCallback(async()=>{
    setLoading(true)
    setError('')
    try{
      const {data,error:e}=await supabase.rpc('jims_v2_my_fm_review_queue_v1')
      if(e)throw e
      if(!Array.isArray(data))throw new Error('Invalid V2 Finance Manager queue result')
      setItems(data)
      onCountChange?.(data.length)
      setLastUpdated(new Date())
    }catch(e){
      setItems([])
      setError(e?.message||'Queue temporarily unavailable')
      onCountChange?.(null)
    }finally{
      setLoading(false)
    }
  },[onCountChange])

  useEffect(()=>{
    reload()
    window.addEventListener('focus',reload)
    const timer=window.setInterval(reload,120000)
    return ()=>{
      window.removeEventListener('focus',reload)
      window.clearInterval(timer)
    }
  },[reload])

  return <section className="panel jims-v2-fm-queue" aria-label="Partial Payment Finance Manager Review">
    <div className="panel-head">
      <div>
        <h2>Partial Payment — Finance Manager Review</h2>
        <p className="muted">Mandatory initiation proofs awaiting your current approval authority.</p>
      </div>
      <button type="button" className="btn" disabled={loading} onClick={reload}>
        {loading?'Refreshing…':'Refresh Reviews'}
      </button>
    </div>
    {error&&<p role="alert" className="error">Unable to load Partial Payment reviews: {error}</p>}
    {!error&&<p className="pv-notice" role="status">
      <strong>{loading?'Loading…':items.length===201?'200+':items.length}</strong>
      {' '}partial installment{items.length===1?'':'s'} awaiting Finance Manager.
      {lastUpdated&&!loading&&<span className="muted"> · Updated {lastUpdated.toLocaleTimeString('en-MY')}</span>}
    </p>}
    {!loading&&!error&&items.length===0&&
      <p className="muted">No Partial Payment V2 initiations awaiting your decision.</p>}
    {items.length>0&&<div className="table-wrap">
      <table className="pv-tracking-table">
        <thead><tr><th>PV Number</th><th>Installment</th><th>Amount (RM)</th><th>Submitted</th><th>Action</th></tr></thead>
        <tbody>
          {items.slice(0,200).map(t=><tr key={t.installment_id}>
            <td><strong>{t.pv_number}</strong></td>
            <td>#{t.installment_no}</td>
            <td>{Number(t.requested_amount).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            <td>{t.initiated_at?new Date(t.initiated_at).toLocaleString('en-MY'):'—'}</td>
            <td>
              <button type="button" className="btn"
                disabled={loading}
                onClick={()=>onOpenVoucher(t.voucher_id)}>
                Open for Review
              </button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}
    {items.length===201&&<p role="alert" className="muted">
      More than 200 pending reviews. Process the visible items, then refresh.
    </p>}
  </section>
}
