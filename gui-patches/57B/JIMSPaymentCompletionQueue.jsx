import {useCallback,useEffect,useState} from 'react'
import {supabase} from './lib/supabase'

// Step 57B7. Read-only queue for AP Finance; payment writes remain in secured RPCs.
const money=v=>'RM '+Number(v||0).toLocaleString('en-MY',{
  minimumFractionDigits:2,maximumFractionDigits:2
})
export default function JIMSPaymentCompletionQueue({onOpenVoucher,onSnapshot}){
  const [records,setRecords]=useState([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [updated,setUpdated]=useState(null)

  const reload=useCallback(async()=>{
    setLoading(true);setError('')
    try{
      const [{data:installments,error:installErr},{data:full,error:fullErr}]=await Promise.all([
        supabase.from('pv_payment_transactions')
          .select('id,voucher_id,installment_no,requested_amount,status,review_decision,reviewed_at')
          .in('status',['initiated','approved']).limit(1001),
        supabase.from('payment_vouchers')
          .select('id,pv_number,amount,payment_status,payment_initiation_manager_decision')
          .is('archived_at',null)
          .eq('status','fully_approved')
          .eq('payment_mode','full')
          .eq('payment_status','payment_initiated')
          .eq('payment_initiation_manager_decision','approved')
          .limit(1001)
      ])
      if(installErr||fullErr)throw installErr||fullErr
      if((installments||[]).length>=1001||(full||[]).length>=1001)
        throw new Error('Queue exceeds 1000 rows; pagination required')
      const ids=[...new Set((installments||[]).map(t=>t.voucher_id).filter(Boolean))]
      let parents=[]
      if(ids.length){
        const {data,error:e}=await supabase.from('payment_vouchers')
          .select('id,pv_number,amount,payment_status,payment_mode,status')
          .in('id',ids).is('archived_at',null)
          .eq('status','fully_approved')
          .eq('payment_status','pending_payment')
          .eq('payment_mode','partial')
        if(e)throw e
        parents=data||[]
      }
      const parentById=new Map(parents.map(v=>[v.id,v]))
      const active=(installments||[]).filter(t=>
        parentById.has(t.voucher_id)&&
        ((t.status==='initiated'&&t.review_decision==='pending')||
         (t.status==='approved'&&t.review_decision==='approved')))
      const initiated=active.filter(t=>t.status==='initiated').length
      const approved=active.filter(t=>t.status==='approved')
      const rows=[
        ...approved.map(t=>({
          key:t.id,id:t.voucher_id,
          pvNumber:parentById.get(t.voucher_id).pv_number,
          number:t.installment_no,amount:t.requested_amount,
          kind:'Partial Payment'
        })),
        ...(full||[]).map(v=>({
          key:v.id,id:v.id,pvNumber:v.pv_number,number:null,
          amount:v.amount,kind:'Full Payment'
        }))
      ]
      rows.sort((a,b)=>a.pvNumber.localeCompare(b.pvNumber)||(a.number||0)-(b.number||0))
      setRecords(rows)
      onSnapshot?.({
        partialInitiated:initiated,
        partialApproved:approved.length,
        v1Approved:(full||[]).length,
        completionCount:rows.length
      })
      setUpdated(new Date())
    }catch(e){
      setRecords([])
      setError(e.message||'Payment Completion unavailable')
      onSnapshot?.(null)
    }finally{setLoading(false)}
  },[onSnapshot])

  useEffect(()=>{
    reload()
    window.addEventListener('focus',reload)
    const timer=window.setInterval(reload,120000)
    return ()=>{
      window.removeEventListener('focus',reload)
      window.clearInterval(timer)
    }
  },[reload])

  return <section className="panel jims-v2-payment-completion" id="jims-payment-completion"
    aria-label="Payment Completion — Upload Final Proof">
    <div className="panel-head">
      <div>
        <h2>Payment Completion — Upload Final Proof</h2>
        <p className="muted">FM approved. AP Finance records the actual transaction and uploads a mandatory final bank receipt PDF before marking Paid.</p>
      </div>
      <button type="button" className="btn" disabled={loading} onClick={reload}>
        {loading?'Refreshing…':'Refresh Completion'}
      </button>
    </div>
    {error&&<p role="alert" className="error">Unable to load Payment Completion: {error}</p>}
    {!error&&<p role="status" className="pv-notice">
      {loading?'Loading completion items…':records.length+' payment(s) ready for final receipt'}
      {updated&&!loading&&<span className="muted"> · Updated {updated.toLocaleTimeString('en-MY')}</span>}
    </p>}
    {!loading&&!error&&records.length===0&&
      <p className="muted">No Finance Manager-approved payments awaiting final receipt.</p>}
    {records.length>0&&<div className="table-wrap">
      <table className="pv-tracking-table">
        <thead><tr>
          <th>PV Number</th><th>Payment Mode</th><th>Installment</th>
          <th>Amount</th><th>Current Stage</th><th>Action</th>
        </tr></thead>
        <tbody>{records.map(v=><tr key={v.key}>
          <td><strong>{v.pvNumber}</strong></td>
          <td>{v.kind}</td>
          <td>{v.number?'#'+v.number:'Full'}</td>
          <td>{money(v.amount)}</td>
          <td>FM Approved · Awaiting Final Proof</td>
          <td><button type="button" className="btn" disabled={loading}
            onClick={()=>onOpenVoucher(v.id)}>Open — Upload Final PDF</button></td>
        </tr>)}</tbody>
      </table>
    </div>}
    <p className="muted">Each partial installment requires its own final receipt PDF. The PV is Fully Paid only after the complete approved amount has been settled.</p>
  </section>
}
