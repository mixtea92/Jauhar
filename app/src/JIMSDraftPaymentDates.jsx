// UAT-FIX-02: capture existing Payment Planning dates alongside Invoice Details.
// Uses the existing PV-level 57D3 due/schedule tables via an additive Staging RPC.
// No change to FM validation, approval routing or payment execution.
import {useEffect,useState} from 'react'
import {supabase} from './lib/supabase'

const field={
  width:'100%',boxSizing:'border-box',padding:'9px 11px',borderRadius:8,
  border:'1px solid #9f8c5a',background:'var(--jims-card-bg,transparent)',color:'inherit'
}

export default function JIMSDraftPaymentDates({voucherId}){
  const [due,setDue]=useState('')
  const [proposed,setProposed]=useState('')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [validated,setValidated]=useState(false)

  useEffect(()=>{
    let alive=true
    setLoading(true)
    setError('')
    supabase.rpc('jims_57d8_draft_payment_dates_v1',{p_voucher_id:voucherId})
      .then(({data,error:failure})=>{
        if(!alive)return
        if(failure)throw failure
        setDue(data?.due_date||'')
        setProposed(data?.proposed_payment_date||'')
        setValidated(Boolean(data?.fm_validated||data?.fm_approved_date))
      }).catch(e=>{if(alive)setError(e?.message||'Unable to load dates')})
      .finally(()=>{if(alive)setLoading(false)})
    return()=>{alive=false}
  },[voucherId])

  async function save(){
    if(saving||loading||!due||!proposed||validated)return
    setSaving(true);setError('');setNotice('')
    try{
      const {data,error:failure}=await supabase.rpc('jims_57d8_draft_payment_dates_v1',{
        p_voucher_id:voucherId,p_save:true,p_due_date:due,
        p_proposed_date:proposed||null
      })
      if(failure)throw failure
      setDue(data?.due_date||'')
      setProposed(data?.proposed_payment_date||'')
      setNotice('Payment dates saved with audit trail.')
    }catch(e){setError(e?.message||'Could not save payment dates')}
    finally{setSaving(false)}
  }

  return <section aria-label="Payment Planning within Invoice Details"
    className="pv-action-panel" style={{padding:16,margin:'14px 0',
      border:'1px solid #9f8c5a66',borderRadius:11}}>
    <h4 style={{margin:'0 0 8px'}}>Payment Planning</h4>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
      <label style={{fontSize:13,fontWeight:600}}>
        Supplier Due Date *
        <input type="date" required style={{...field,marginTop:5}} value={due}
          disabled={loading||saving||validated}
          onChange={e=>{setDue(e.target.value);setNotice('')}}/>
      </label>
      <label style={{fontSize:13,fontWeight:600}}>
        Proposed Payment Date *
        <input type="date" required style={{...field,marginTop:5}} value={proposed}
          disabled={loading||saving||validated}
          onChange={e=>{setProposed(e.target.value);setNotice('')}}/>
      </label>
    </div>
    <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginTop:10}}>
      <button type="button" className="btn" onClick={save}
        disabled={loading||saving||validated||!due||!proposed}>
        {saving?'Saving...':'Save Payment Dates'}
      </button>
      <small className="muted">Both dates are required. FM validation remains unchanged.</small>
    </div>
    {loading&&<p className="muted">Loading payment dates...</p>}
    {validated&&<p className="muted">Finance Manager has already validated these dates.</p>}
    {notice&&<p role="status" style={{color:'#198754'}}>{notice}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </section>
}
