import {useCallback,useEffect,useMemo,useState} from 'react'
import {supabase} from './lib/supabase'

// JIMS STEP 57D3 — Obligation / schedule management; no change to PV approvals or payments.
// Server-side RPCs check actual JIMS roles; button visibility is not authorization.
const input={width:'100%',padding:'9px 11px',border:'1px solid #9f8c5a',borderRadius:8,
  background:'var(--jims-card-bg,transparent)',color:'inherit',colorScheme:'dark'}
const fmt=d=>d?String(d).split('-').reverse().join('/'):'Not recorded'
const fmtAt=d=>d?new Intl.DateTimeFormat('en-MY',{
  timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'
}).format(new Date(d)):'—'
const todayMY=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const delay=(date,now)=>date&&now>date

export default function JIMSPaymentPlanning57D3({voucher,profile,transactions=[],initialTransactionId=null,onClose}){
  const [data,setData]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [due,setDue]=useState('')
  const [newDue,setNewDue]=useState('')
  const [dueReason,setDueReason]=useState('')
  const [supplierEvidence,setSupplierEvidence]=useState('')
  const [schedule,setSchedule]=useState('')
  const [txn,setTxn]=useState(initialTransactionId||'')
  const [reason,setReason]=useState('')
  const [revision,setRevision]=useState(0)
  const myToday=todayMY()
  const id=voucher?.id
  const refresh=useCallback(()=>setRevision(n=>n+1),[])
  useEffect(()=>{
    if(!id)return
    let active=true
    setLoading(true)
    setError('')
    supabase.rpc('jims_57d3_get_planning_v1',{p_voucher_id:id})
      .then(({data:result,error:e})=>{
        if(!active)return
        if(e)throw e
        setData(result)
        setDue(result?.due?.current_due_date||'')
        setNewDue(result?.due?.current_due_date||'')
        setSchedule('')
        setLoading(false)
      }).catch(e=>{if(active){setError(e.message||String(e));setLoading(false)}})
    return()=>{active=false}
  },[id,revision])
  const r=data?.role
  const canAP=r==='ap_executive' && data?.payment_status!=='paid'
  const canFM=r==='finance_manager' && data?.payment_status!=='paid'
  const selected=useMemo(()=>data?.schedules?.find(
    s=>(s.transaction_id||'')===(txn||'')),[data,txn])
  const activeTransactions=transactions.filter(t=>t.voucher_id===id &&
    !['paid','voided','cancelled','completed'].includes(t.status))
  async function save(name,args,successText){
    if(busy||!id)return
    setBusy(true);setError('');setNotice('')
    try{
      const {data:result,error:e}=await supabase.rpc(name,{p_voucher_id:id,...args})
      if(e)throw e
      setData(result)
      setDue(result?.due?.current_due_date||'')
      setNewDue(result?.due?.current_due_date||'')
      setNotice(successText)
      setReason('');setDueReason('');setSupplierEvidence('')
      refresh()
    }catch(e){setError(e.message||String(e))}
    finally{setBusy(false)}
  }
  if(!voucher)return null
  return <div role="dialog" aria-modal="true" aria-label="Payment Planning"
    style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,.72)',overflowY:'auto',padding:'24px 12px'}}>
    <section className="panel" style={{maxWidth:830,margin:'auto',padding:24,
      border:'1px solid #9d823f',borderRadius:14,color:'inherit'}}>
      <div style={{display:'flex',alignItems:'start',justifyContent:'space-between',gap:12}}>
        <div>
          <h2 style={{margin:'0 0 5px'}}>Payment Planning</h2>
          <strong>{voucher.pv_number||data?.pv_number||'PV'}</strong>
          <p className="muted" style={{margin:'5px 0'}}>{voucher.payee_name||data?.payee_name||'—'}</p>
        </div>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      <p className="muted">Step 57D3 · Supplier Due Date is the contractual obligation.
        FM-approved schedule is a separate plan, not a replacement due date.</p>
      {error&&<p role="alert" style={{color:'#ed927f'}}>{error}</p>}
      {notice&&<p role="status" style={{color:'#74c69d'}}>{notice}</p>}
      {loading&&<p>Loading payment planning...</p>}
      {!loading&&data&&<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,margin:'15px 0'}}>
          <div style={{padding:12,border:'1px solid #65552d',borderRadius:10}}>
            <small>Supplier Due Date</small>
            <h3>{fmt(data.due?.current_due_date)}</h3>
            <small>{data.due?.fm_validated_at?'FM Verified':'FM Validation Pending'}</small>
          </div>
          <div style={{padding:12,border:'1px solid #65552d',borderRadius:10}}>
            <small>FM-Approved Schedule</small>
            <h3>{fmt(selected?.approved_date)}</h3>
            <small>{selected?.proposed_date?'New AP proposal awaiting FM':''}</small>
          </div>
          <div style={{padding:12,border:'1px solid #65552d',borderRadius:10}}>
            <small>Obligation status</small>
            <h3 style={{color:data.payment_status==='paid'?'#74c69d':
              delay(data.due?.current_due_date,myToday)?'#ee8a7b':
              data.due?.current_due_date===myToday?'#dfb95f':'#74c69d'}}>
              {data.payment_status==='paid'?'Paid':
                !data.due?'Due date missing':
                delay(data.due.current_due_date,myToday)?'Overdue':
                data.due.current_due_date===myToday?'Due Today':'Within Terms'}
            </h3>
          </div>
        </div>
        {data.due?.original_due_date!==data.due?.current_due_date&&
          <p className="muted">Original due date (retained for audit): {fmt(data.due?.original_due_date)}</p>}
        {canAP&&!data.due&&<div style={{padding:12,border:'1px solid #65552d',borderRadius:9,marginBottom:14}}>
          <h3>AP — Record Supplier Due Date</h3>
          <label>Payment must be completed on or before
            <input style={input} type="date" value={due} onChange={e=>setDue(e.target.value)}/>
          </label>
          <button type="button" className="btn" style={{marginTop:10}} disabled={busy||!due}
            onClick={()=>save('jims_57d3_record_due_v1',{p_due_date:due},'Obligation recorded. Waiting FM validation.')}>
            Record Obligation
          </button>
        </div>}
        {canFM&&<div style={{padding:12,border:'1px solid #65552d',borderRadius:9,marginBottom:14}}>
          <h3>Finance Manager — Validate / Amend Due Date</h3>
          {!data.due?<p className="muted">AP must record a due date first (or FM can use Record Obligation below).</p>:<>
            <label>Current contractual due date
              <input style={input} type="date" value={newDue} onChange={e=>setNewDue(e.target.value)}/>
            </label>
            {newDue!==data.due?.current_due_date&&<>
              <label>Reason for change (mandatory)
                <input style={input} value={dueReason} onChange={e=>setDueReason(e.target.value)} maxLength={500}/>
              </label>
              <label>Supplier agreement / evidence reference (mandatory)
                <input style={input} value={supplierEvidence} onChange={e=>setSupplierEvidence(e.target.value)} maxLength={500}/>
              </label>
            </>}
            <button type="button" className="btn" style={{marginTop:10}} disabled={busy||!newDue||
              (newDue!==data.due?.current_due_date&&(dueReason.trim().length<8||supplierEvidence.trim().length<5))}
              onClick={()=>save('jims_57d3_manager_due_v1',{
                p_due_date:newDue,p_reason:dueReason,p_supplier_evidence_reference:supplierEvidence
              },newDue===data.due?.current_due_date?'Due date validated by Finance Manager.':'Due date amendment recorded with evidence.')}>
              {newDue===data.due?.current_due_date?'Validate Due Date':'Approve Due Date Amendment'}
            </button>
          </>}
          {!data.due&&<><input style={input} type="date" value={due} onChange={e=>setDue(e.target.value)}/>
            <button className="btn" type="button" disabled={busy||!due}
              onClick={()=>save('jims_57d3_record_due_v1',{p_due_date:due},'FM entered initial due date.')} >Record Obligation</button></>}
        </div>}
        <div style={{padding:12,border:'1px solid #65552d',borderRadius:9,marginBottom:14}}>
          <h3>Payment Schedule {canAP?'— AP Proposal':canFM?'— FM Authority':'— Read-only'}</h3>
          {data.payment_mode==='partial'&&<label>Schedule applies to
            <select style={input} value={txn} onChange={e=>{setTxn(e.target.value);setSchedule('')}}>
              <option value="">Whole PV / General Plan</option>
              {activeTransactions.map(t=><option value={t.id} key={t.id}>Tranche #{t.installment_no} — {t.status}</option>)}
            </select>
          </label>}
          <p className="muted">AP proposed: {fmt(selected?.proposed_date)} · FM approved: {fmt(selected?.approved_date)}
            {selected?.first_approved_date&&<> · First approved: {fmt(selected.first_approved_date)}</>}</p>
          {(canAP||canFM)&&<>
            <label>{canAP?'Proposed Payment Date':'FM Approved Payment Date'}
              <input style={input} type="date" value={schedule}
                onChange={e=>setSchedule(e.target.value)}/>
            </label>
            {canFM&&<label>FM reason (required if rescheduled or later than due date)
              <input style={input} value={reason} maxLength={500}
                onChange={e=>setReason(e.target.value)}/>
            </label>}
            {schedule&&data.due?.current_due_date&&schedule>data.due.current_due_date&&
              <p style={{color:'#dfb95f'}}>Scheduled date exceeds contractual due date.
                The PV will still be flagged overdue until settled.</p>}
            <button type="button" className="btn" style={{marginTop:10}} disabled={busy||!data.due||!schedule||
              (canFM&&((selected?.approved_date&&selected.approved_date!==schedule)||
                (schedule>data.due.current_due_date))&&reason.trim().length<8)}
              onClick={()=>save(canAP?'jims_57d3_propose_schedule_v1':'jims_57d3_manager_schedule_v1',
                {p_scheduled_date:schedule,p_transaction_id:txn||null,...(canFM?{p_reason:reason}:{})},
                canAP?'Schedule proposed to Finance Manager.':'Finance Manager schedule approved and audit saved.')}>
              {busy?'Saving...':canAP?'Submit Schedule Proposal':'Approve / Reschedule'}
            </button>
          </>}
        </div>
        <details>
          <summary style={{cursor:'pointer',fontWeight:600}}>Payment Planning Audit History ({data.audit?.length||0})</summary>
          <div style={{maxHeight:240,overflow:'auto',marginTop:12}}>
            {(data.audit||[]).map((a,i)=><p key={i} className="muted" style={{fontSize:12}}>
              {fmtAt(a.created_at)} · {a.actor_role} · {a.event_type} ·
              {fmt(a.old_value)} → {fmt(a.new_value)}
              {a.reason?' · '+a.reason:''}
              {a.supplier_evidence_reference?' · Supplier ref: '+a.supplier_evidence_reference:''}
            </p>)}
          </div>
        </details>
      </>}
      <small className="muted" style={{display:'block',marginTop:13}}>
        Stored by role-checked Supabase RPCs. KPI-ready history is captured automatically.
        This feature does not mark a PV paid or change approval authority.
      </small>
    </section>
  </div>
}
