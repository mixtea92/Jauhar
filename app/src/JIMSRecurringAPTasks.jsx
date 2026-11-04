// Read-only AP inbox for FM-issued recurring obligations.
// FM category, instruction and schedule management are not exposed to AP.
import {useCallback,useEffect,useState} from 'react'
import {supabase} from './lib/supabase'
import './JIMSRecurringPaymentFM.css'
import JIMSRecurringAPDetails from './JIMSRecurringAPDetails'

const money=value=>'RM '+Number(value||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})
export default function JIMSRecurringAPTasks({profile,onPreparePV}){
  const eligible=profile?.is_active===true&&profile?.role==='executive'&&
    profile?.department==='Finance'&&profile?.subdepartment==='Accounts Payable'
  const [tasks,setTasks]=useState([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [editingTaskId,setEditingTaskId]=useState(null)
  const reload=useCallback(async()=>{
    if(!eligible)return
    setLoading(true)
    try{
      const {data,error:e}=await supabase.rpc('jims_recurring_ap_tasks_v1')
      if(e)throw e
      if(!Array.isArray(data?.tasks))throw new Error('AP tasks dataset incomplete')
      setTasks(data.tasks)
    }catch(e){setError(e?.message||'Could not load recurring AP tasks')}
    finally{setLoading(false)}
  },[eligible])
  useEffect(()=>{void reload()},[reload])
  if(!eligible)return null

  const pending=tasks.filter(t=>t.status==='pending_ap')
  const linked=tasks.filter(t=>t.status==='pv_linked')
  if(!loading&&!error&&tasks.length===0)return null
  return <section className="panel jims-recurring-ap" aria-label="FM Recurring Payment Tasks">
    <div className="jims-recurring-top">
      <div>
        <h3>Recurring Payment Tasks from FM</h3>
        <p className="muted">AP can edit details and optionally upload a supporting document, but cannot delete or cancel FM requests.</p>
      </div>
      <button className="btn" type="button" onClick={reload} disabled={loading}>
        {loading?'Loading...':'Refresh Tasks'}
      </button>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    <p className="muted">{pending.length} Assigned FM Request(s) · {linked.length} Created PV(s).
      Use Edit Recurring Details to complete the request; Save Draft auto-links the PV.</p>
    {pending.map(t=><div className="jims-recurring-item" key={t.id}>
      <div className="jims-recurring-description">
        <strong>{t.supplier_name} — {String(t.period_month).slice(0,7)}</strong>
        <small>{t.category_name} · Branch {t.branch_code} · Supplier Due {t.due_date}</small>
        <small>{t.amount_type==='fixed'?money(t.fixed_amount):'Variable: use actual monthly invoice'}</small>
        <small>Recurring supporting PDF is optional here. PV submission still requires valid financial evidence.</small>
      </div>
      <div className="jims-recurring-actions">
        <button className="btn" type="button" onClick={()=>setEditingTaskId(t.id)}>Edit Recurring Details</button>
        <button className="btn" type="button" onClick={()=>onPreparePV?.(t.id)}>+ Prepare PV (Auto-fill)</button>
      </div>
    </div>)}
    {linked.length>0&&<details>
      <summary>Linked PV History ({linked.length})</summary>
      {linked.map(t=><div className="jims-recurring-item" key={t.id}>
        <div className="jims-recurring-description">
          <strong>{t.linked_pv_number||'Linked PV'}</strong>
          <small>{t.supplier_name} · {String(t.period_month).slice(0,7)} · {t.linked_pv_status} · Payment: {t.linked_payment_status}</small>
        </div>
      </div>)}
    </details>}
    {editingTaskId&&<JIMSRecurringAPDetails taskId={editingTaskId}
      onSaved={()=>{void reload()}} onClose={()=>setEditingTaskId(null)}/>}
  </section>
}