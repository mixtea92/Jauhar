// Read-only AP inbox for FM-issued recurring obligations.
// FM category, instruction and schedule management are not exposed to AP.
import {useCallback,useEffect,useState} from 'react'
import {supabase} from './lib/supabase'
import './JIMSRecurringPaymentFM.css'

const money=value=>'RM '+Number(value||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})
export default function JIMSRecurringAPTasks({profile,onPreparePV}){
  const eligible=profile?.is_active===true&&profile?.role==='executive'&&
    profile?.department==='Finance'&&profile?.subdepartment==='Accounts Payable'
  const [tasks,setTasks]=useState([])
  const [loading,setLoading]=useState(false)
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [pvNumbers,setPvNumbers]=useState({})
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

  async function link(task){
    const pvNumber=(pvNumbers[task.id]||'').trim()
    if(!pvNumber){setError('Enter your created PV number before linking.');return}
    setBusy(task.id);setError('');setNotice('')
    try{
      const {error:e}=await supabase.rpc('jims_recurring_ap_link_pv_v1',{
        p_task_id:task.id,p_pv_number:pvNumber
      })
      if(e)throw e
      await reload()
      setNotice('Recurring task linked to your Payment Voucher. Normal PV approval still applies.')
    }catch(e){setError(e?.message||'Could not link Payment Voucher')}
    finally{setBusy('')}
  }
  const pending=tasks.filter(t=>t.status==='pending_ap')
  const linked=tasks.filter(t=>t.status==='pv_linked')
  if(!loading&&!error&&tasks.length===0)return null
  return <section className="panel jims-recurring-ap" aria-label="FM Recurring Payment Tasks">
    <div className="jims-recurring-top">
      <div>
        <h3>Recurring Payment Tasks from FM</h3>
        <p className="muted">AP can prepare and link PVs, but cannot manage FM recurring categories or instructions.</p>
      </div>
      <button className="btn" type="button" onClick={reload} disabled={loading||!!busy}>
        {loading?'Loading...':'Refresh Tasks'}
      </button>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&<p className="pv-notice" role="status">{notice}</p>}
    <p className="muted">{pending.length} Pending AP · {linked.length} Linked PV</p>
    {pending.map(t=><div className="jims-recurring-item" key={t.id}>
      <div className="jims-recurring-description">
        <strong>{t.supplier_name} — {String(t.period_month).slice(0,7)}</strong>
        <small>{t.category_name} · Branch {t.branch_code} · Supplier Due {t.due_date}</small>
        <small>{t.amount_type==='fixed'?money(t.fixed_amount):'Variable: use actual monthly invoice'}</small>
        <small>FM instruction only: AP must complete required invoice or archive-linked supporting evidence in the PV.</small>
      </div>
      <div className="jims-recurring-actions">
        <button className="btn" type="button" onClick={()=>onPreparePV?.(t.id)}>+ Prepare PV (Auto-fill)</button>
        <input aria-label={'PV number for '+t.supplier_name} placeholder="Created PV number"
          maxLength={100} value={pvNumbers[t.id]||''} disabled={!!busy}
          onChange={e=>setPvNumbers(x=>({...x,[t.id]:e.target.value}))}/>
        <button className="btn" type="button" disabled={!!busy} onClick={()=>link(t)}>
          {busy===t.id?'Linking...':'Link Created PV'}
        </button>
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
  </section>
}