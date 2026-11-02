// UAT-FIX-08: FM date decision while PV is pending Finance Manager approval.
// This is a separate audited decision from Approve/Return/Reject PV.
import {useEffect,useState} from 'react'
import {supabase} from './lib/supabase'

const field={background:'var(--jims-card-bg,transparent)',color:'inherit',
  border:'1px solid #9f8c5a',borderRadius:8,padding:'9px 11px',width:'100%',boxSizing:'border-box'}
const hint={fontSize:12,display:'block',marginBottom:5,fontWeight:600}

export default function JIMSFMDateReview({voucherId,data,onSaved}){
  const [due,setDue]=useState(data?.supplier_due_date||'')
  const [payment,setPayment]=useState(data?.proposed_payment_date||'')
  const [reason,setReason]=useState('')
  const [evidence,setEvidence]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  useEffect(()=>{
    setDue(data?.supplier_due_date||'')
    setPayment(data?.fm_approved_payment_date||data?.proposed_payment_date||'')
    setReason('')
    setEvidence('')
  },[voucherId,data?.supplier_due_date,data?.proposed_payment_date,data?.fm_approved_payment_date])

  const dueChanged=!!data?.supplier_due_date&&due!==data.supplier_due_date
  const dueEvidenceReady=!dueChanged||(reason.trim().length>=8&&evidence.trim().length>=5)
  const dateBeyondDue=!!due&&!!payment&&payment>due
  const acceptReady=!busy&&!!due&&dueEvidenceReady&&
    !!data?.proposed_payment_date&&!data?.fm_approved_payment_date&&
    (!dateBeyondDue||reason.trim().length>=8)
  const changeReady=!busy&&!!due&&!!payment&&dueEvidenceReady&&
    reason.trim().length>=8&&payment!==(data?.fm_approved_payment_date||data?.proposed_payment_date)

  async function decide(action){
    if(busy)return
    const accept=action==='accept'
    if(accept&&!acceptReady||!accept&&!changeReady)return
    setBusy(true);setError('');setNotice('')
    try{
      const {data:response,error:failed}=await supabase.rpc(
        'jims_57d8_fm_review_payment_plan_v1',{
          p_voucher_id:voucherId,
          p_action:action,
          p_due_date:due,
          p_payment_date:accept?null:payment,
          p_reason:reason.trim()||null,
          p_supplier_evidence_reference:evidence.trim()||null
        })
      if(failed)throw failed
      if(!response?.saved)throw new Error('Database did not confirm the FM date decision.')
      setNotice(accept?'Proposed Payment Date accepted by Finance Manager.':
        'FM-Approved Payment Date updated with audit.')
      await onSaved?.()
    }catch(e){setError(e?.message||'Unable to save FM Payment Planning decision')}
    finally{setBusy(false)}
  }

  return <div style={{padding:14,marginTop:12,border:'1px solid #a78b4a66',borderRadius:9}}
    aria-label="Finance Manager Payment Planning review">
    <strong style={{color:'#d9b45c'}}>FINANCE MANAGER — REVIEW PAYMENT DATES</strong>
    <p className="muted" style={{fontSize:12,margin:'8px 0 12px'}}>
      Validate the Supplier Due Date and accept AP's proposal, or approve a different date.
      This does not approve or pay the Payment Voucher.
    </p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
      <label><span style={hint}>Supplier Due Date</span>
        <input style={field} type="date" value={due} disabled={busy}
          onChange={e=>{setDue(e.target.value);setNotice('')}}/>
      </label>
      <label><span style={hint}>FM Payment Date (for Change)</span>
        <input style={field} type="date" value={payment} disabled={busy}
          onChange={e=>{setPayment(e.target.value);setNotice('')}}/>
      </label>
    </div>
    {dueChanged&&<p style={{color:'#dfb95f',fontSize:12}}>
      Supplier Due Date amendment requires a reason and supplier evidence reference.
    </p>}
    {dateBeyondDue&&<p role="status" style={{color:'#dfb95f',fontSize:12}}>
      FM Payment Date is after Supplier Due Date. Approval requires a reason;
      the payment remains flagged overdue until settled.
    </p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12,marginTop:12}}>
      <label><span style={hint}>Reason for Change / Exception</span>
        <input style={field} value={reason} maxLength={500} disabled={busy}
          placeholder="Required when changing dates (min. 8 characters)"
          onChange={e=>setReason(e.target.value)}/>
      </label>
      <label><span style={hint}>Supplier Evidence Reference (if Due Date changes)</span>
        <input style={field} value={evidence} maxLength={500} disabled={busy}
          placeholder="Required for Supplier Due Date change"
          onChange={e=>setEvidence(e.target.value)}/>
      </label>
    </div>
    <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:12}}>
      <button type="button" className="btn" disabled={!acceptReady}
        onClick={()=>decide('accept')}>{busy?'Saving...':'Accept Proposed Date'}</button>
      <button type="button" className="btn" disabled={!changeReady}
        onClick={()=>decide('change')}>{busy?'Saving...':'Change & Approve Payment Date'}</button>
    </div>
    {data?.fm_approved_payment_date&&<p className="muted" style={{fontSize:12}}>
      FM has approved a payment date. A further change requires an audited reason.
    </p>}
    {notice&&<p role="status" style={{color:'#74c69d'}}>{notice}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </div>
}
