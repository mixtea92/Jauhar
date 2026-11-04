// JIMS Recurring Payment — FM-only workspace inside Payment Calendar.
// No direct writes to PV/payment tables. All RPCs independently enforce FM role.
import {useCallback,useEffect,useState} from 'react'
import {supabase} from './lib/supabase'
import {isFinanceManagerActual} from './lib/jimsFmPartialApprovalQueue'
import './JIMSRecurringPaymentFM.css'

const MY_MONTH=()=>new Intl.DateTimeFormat('sv-SE',{
  year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Kuala_Lumpur'
}).format(new Date()).slice(0,7)
const emptyInstruction=()=>({
  id:null,categoryId:'',supplier:'',branch:'GP',amountType:'fixed',amount:'',
  dueDay:'7',startMonth:MY_MONTH(),endMonth:'',assignedAP:'',notes:'',status:'active',
  docRequirement:'monthly_invoice',documentId:'',preset:{payment_lead_days:'1',financial_tier:'',supplier_code:'',supplier_tin:'',bank_name:'',bank_account_no:'',payment_method:'',payment_type:'',expense_nature:'',budget_classification:'',gl_code:'',line_description:''}
})
const money=value=>'RM '+Number(value||0).toLocaleString('en-MY',{
  minimumFractionDigits:2,maximumFractionDigits:2})
const branches={GP:'Gelang Patah',KM:'Kota Masai',PM:'Pulai Mutiara',TD:'Taman Daya'}
const dateText=date=>date?String(date).slice(0,10).split('-').reverse().join('/'):'—'

export default function JIMSRecurringPaymentFM({profile}){
  const allowed=isFinanceManagerActual(profile)
  const [data,setData]=useState({categories:[],instructions:[],tasks:[],ap_users:[]})
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [categoryId,setCategoryId]=useState(null)
  const [categoryName,setCategoryName]=useState('')
  const [categoryActive,setCategoryActive]=useState(true)
  const [form,setForm]=useState(emptyInstruction)
  const [section,setSection]=useState('instructions')

  const load=useCallback(async()=>{
    if(!allowed)return
    setLoading(true)
    try{
      const {data:result,error:e}=await supabase.rpc('jims_recurring_fm_dashboard_v1')
      if(e)throw e
      if(!Array.isArray(result?.categories)||!Array.isArray(result?.instructions)||
         !Array.isArray(result?.tasks)||!Array.isArray(result?.ap_users)){
        throw new Error('Recurring Payment dataset incomplete')
      }
      setData(result)
    }catch(e){setError(e?.message||'Could not load recurring payments')}
    finally{setLoading(false)}
  },[allowed])

  useEffect(()=>{void load()},[load])

  async function invoke(name,args){
    setError('')
    setNotice('')
    setBusy(true)
    try{
      const {data:result,error:e}=await supabase.rpc(name,args)
      if(e)throw e
      return result
    }finally{setBusy(false)}
  }

  async function saveCategory(event){
    event.preventDefault()
    if(!allowed||busy)return
    try{
      await invoke('jims_recurring_fm_category_save_v1',{
        p_id:categoryId,p_name:categoryName.trim(),p_is_active:categoryActive
      })
      setCategoryId(null);setCategoryName('');setCategoryActive(true)
      await load()
      setNotice('Recurring category saved.')
    }catch(e){setError(e?.message||'Could not save category')}
  }
  async function switchCategory(c){
    if(busy)return
    try{
      await invoke('jims_recurring_fm_category_save_v1',{
        p_id:c.id,p_name:c.name,p_is_active:!c.is_active
      })
      await load();setNotice(c.is_active?'Category deactivated.':'Category reactivated.')
    }catch(e){setError(e?.message||'Could not update category')}
  }
  function editCategory(c){
    setSection('categories')
    setCategoryId(c.id);setCategoryName(c.name);setCategoryActive(c.is_active)
  }
  const fromInstruction=x=>({
    id:x.id,categoryId:x.category_id,supplier:x.supplier_name,branch:x.branch_code,
    amountType:x.amount_type,amount:x.fixed_amount==null?'':String(x.fixed_amount),
    dueDay:String(x.due_day),startMonth:String(x.start_month).slice(0,7),
    endMonth:x.end_month?String(x.end_month).slice(0,7):'',
    assignedAP:x.assigned_ap_id,notes:x.notes||'',status:x.status,
    docRequirement:x.document_requirement||'monthly_invoice',
    documentId:x.supporting_document_id||'',
    preset:{...emptyInstruction().preset,...(x.pv_preset||{})}
  })
  function editInstruction(x){
    setSection('instructions')
    setForm(fromInstruction(x))
  }
  const instructionArgs=(x,status=x.status)=>({
    p_id:x.id||null,p_category_id:x.categoryId||null,
    p_supplier_name:x.supplier.trim(),p_branch_code:x.branch,
    p_amount_type:x.amountType,
    p_fixed_amount:x.amountType==='fixed'?(x.amount===''?null:Number(x.amount)):null,
    p_due_day:Number(x.dueDay),p_start_month:x.startMonth?x.startMonth+'-01':null,
    p_end_month:x.endMonth?x.endMonth+'-01':null,
    p_assigned_ap_id:x.assignedAP||null,p_notes:x.notes.trim(),p_status:status,
    p_document_requirement:x.docRequirement,
    p_supporting_document_id:x.documentId||null,
    p_pv_preset:Object.fromEntries(Object.entries(x.preset).filter(([k,v])=>String(v).trim()!==''))
  })
  async function saveInstruction(event){
    event.preventDefault()
    if(!allowed||busy)return
    if(form.amountType==='fixed'&&(!(Number(form.amount)>0)||!Number.isFinite(Number(form.amount)))){
      setError('Fixed amount must be greater than RM0.');return
    }
    if(!form.categoryId||!form.assignedAP||!form.startMonth){
      setError('Category, assigned AP and start month are mandatory.');return
    }
    if(form.docRequirement==='recurring_supporting'&&!form.documentId){
      setError('Select a document from Finance Document Archive before saving.');return
    }
    try{
      await invoke('jims_recurring_fm_instruction_save_v2',instructionArgs(form))
      setForm(emptyInstruction())
      await load()
      setNotice('Recurring instruction saved. Active instructions create an AP task for the current month and are scheduled for future months.')
    }catch(e){setError(e?.message||'Could not save recurring instruction')}
  }
  async function switchInstruction(x){
    if(busy)return
    const state=x.status==='active'?'paused':'active'
    const updated={...fromInstruction(x),status:state}
    try{
      await invoke('jims_recurring_fm_instruction_save_v2',instructionArgs(updated))
      await load()
      setNotice(state==='paused'?'Instruction paused; already submitted AP tasks remain.':'Instruction resumed.')
    }catch(e){setError(e?.message||'Could not change instruction status')}
  }
  async function regenerate(){
    if(!allowed||busy)return
    try{
      const count=await invoke('jims_recurring_fm_generate_now_v1')
      await load()
      setNotice(String(count)+' new AP task(s) generated for the current month. Existing tasks were not duplicated.')
    }catch(e){setError(e?.message||'Could not generate recurring tasks')}
  }
  if(!allowed)return <section className="panel" role="alert">
    <h2>Access Restricted</h2><p>Recurring Payment Management is for Finance Manager only.</p>
  </section>

  const activeCategories=data.categories.filter(c=>c.is_active)
  const apName=id=>data.ap_users.find(a=>a.id===id)?.username||'AP unavailable'

  return <div className="jims-recurring">
    <div className="jims-recurring-top">
      <div>
        <h2>Recurring Payment Management</h2>
        <p className="muted">FM creates categories and one-time monthly instructions. AP receives only assigned tasks.</p>
      </div>
      <button type="button" className="btn" onClick={load} disabled={busy||loading}>
        {loading?'Loading...':'Refresh'}
      </button>
    </div>
    <div className="jims-recurring-tabs" role="group" aria-label="FM recurring tools">
      <button type="button" className={section==='instructions'?'selected':''} onClick={()=>setSection('instructions')}>Recurring Instructions</button>
      <button type="button" className={section==='categories'?'selected':''} onClick={()=>setSection('categories')}>Manage Categories</button>
      <button type="button" className={section==='tasks'?'selected':''} onClick={()=>setSection('tasks')}>AP Submission History</button>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&<p className="pv-notice" role="status">{notice}</p>}
    {section==='categories'&&<div className="jims-recurring-columns">
      <form className="jims-recurring-card" onSubmit={saveCategory}>
        <h3>{categoryId?'Edit Category':'New Category'}</h3>
        <label>Category Name
          <input value={categoryName} maxLength={80} minLength={2} required
            onChange={e=>setCategoryName(e.target.value)}
            placeholder="FM decides the name" disabled={busy}/>
        </label>
        <label className="jims-recurring-check">
          <input type="checkbox" checked={categoryActive} disabled={busy}
            onChange={e=>setCategoryActive(e.target.checked)}/> Active
        </label>
        <div className="jims-recurring-actions">
          <button type="submit" className="btn" disabled={busy}>Save Category</button>
          {categoryId&&<button type="button" className="btn" disabled={busy}
            onClick={()=>{setCategoryId(null);setCategoryName('');setCategoryActive(true)}}>Cancel Edit</button>}
        </div>
        <p className="muted">Categories are not hardcoded. Old records remain if a category is deactivated.</p>
      </form>
      <section className="jims-recurring-card">
        <h3>Saved Categories ({data.categories.length})</h3>
        {data.categories.length===0&&<p className="muted">No categories yet. Create the first one.</p>}
        {data.categories.map(c=><div className="jims-recurring-item" key={c.id}>
          <div><strong>{c.name}</strong><small>{c.is_active?'Active':'Inactive'}</small></div>
          <div className="jims-recurring-actions">
            <button type="button" onClick={()=>editCategory(c)} disabled={busy}>Edit</button>
            <button type="button" onClick={()=>switchCategory(c)} disabled={busy}>{c.is_active?'Deactivate':'Activate'}</button>
          </div>
        </div>)}
      </section>
    </div>}
    {section==='instructions'&&<>
      <form className="jims-recurring-card" onSubmit={saveInstruction}>
        <div className="jims-recurring-title"><h3>{form.id?'Edit Recurring Instruction':'New Recurring Instruction'}</h3>
          {form.id&&<button className="btn" type="button" disabled={busy} onClick={()=>setForm(emptyInstruction())}>Cancel Edit</button>}
        </div>
        <div className="jims-recurring-fields">
          <label>Category *
            <select value={form.categoryId} required disabled={busy} onChange={e=>setForm(f=>({...f,categoryId:e.target.value}))}>
              <option value="">Select FM Category</option>
              {activeCategories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Supplier / Payee *
            <input required maxLength={150} value={form.supplier} disabled={busy}
              onChange={e=>setForm(f=>({...f,supplier:e.target.value}))} placeholder="Supplier name"/>
          </label>
          <label>Branch *
            <select value={form.branch} disabled={busy} onChange={e=>setForm(f=>({...f,branch:e.target.value}))}>
              {Object.entries(branches).map(([code,name])=><option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <label>Amount Type *
            <select value={form.amountType} disabled={busy}
              onChange={e=>setForm(f=>({...f,amountType:e.target.value,amount:''}))}>
              <option value="fixed">Fixed — e.g. rent</option>
              <option value="variable">Variable — e.g. utilities bill</option>
            </select>
          </label>
          {form.amountType==='fixed'&&<label>Monthly Amount (RM) *
            <input type="number" min="0.01" max="9999999999" step="0.01" required
              disabled={busy} value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/>
          </label>}
          <label>Supplier Due Day (1–31) *
            <input type="number" min="1" max="31" required disabled={busy}
              value={form.dueDay} onChange={e=>setForm(f=>({...f,dueDay:e.target.value}))}/>
          </label>
          <label>Start Month *
            <input type="month" required disabled={busy} value={form.startMonth}
              onChange={e=>setForm(f=>({...f,startMonth:e.target.value}))}/>
          </label>
          <label>End Month (Optional)
            <input type="month" disabled={busy} value={form.endMonth} min={form.startMonth}
              onChange={e=>setForm(f=>({...f,endMonth:e.target.value}))}/>
          </label>
          <label>Assign To AP Executive *
            <select required value={form.assignedAP} disabled={busy}
              onChange={e=>setForm(f=>({...f,assignedAP:e.target.value}))}>
              <option value="">Select AP</option>
              {data.ap_users.map(a=><option key={a.id} value={a.id}>{a.username}</option>)}
            </select>
          </label>
          <label>Status
            <select value={form.status} disabled={busy}
              onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
              <option value="active">Active — submit each month</option>
              <option value="paused">Paused — stop future submissions</option>
            </select>
          </label>
          <p className="muted jims-recurring-wide">
            FM submits a recurring request. AP then edits payment details and may attach supporting
            documents directly in the same task. Supporting PDF is optional during recurring setup.
          </p>
          <label className="jims-recurring-wide">Instructions / Notes
            <textarea maxLength={500} rows={2} disabled={busy} value={form.notes}
              onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/>
          </label>
        </div>
        <p className="muted">Active instructions generate this month's AP task now, then once per month automatically. Due day 29–31 uses the last day in shorter months. No PV or payment is auto-approved.</p>
        <button type="submit" className="btn" disabled={busy||loading||!activeCategories.length||!data.ap_users.length}>
          {busy?'Saving...':form.id?'Save Changes':'Save & Submit Recurring Instruction'}
        </button>
      </form>
      <section className="jims-recurring-card">
        <h3>Saved Instructions ({data.instructions.length})</h3>
        {data.instructions.length===0&&<p className="muted">No instructions yet. Create a category first, then add an instruction.</p>}
        {data.instructions.map(i=><div className="jims-recurring-item" key={i.id}>
          <div className="jims-recurring-description">
            <strong>{i.supplier_name}</strong>
            <small>{data.categories.find(c=>c.id===i.category_id)?.name||'Category'} · {branches[i.branch_code]||i.branch_code} · {i.amount_type==='fixed'?money(i.fixed_amount):'Variable bill'}</small>
            <small>Due day {i.due_day} · From {String(i.start_month).slice(0,7)} · AP: {apName(i.assigned_ap_id)} · {i.status.toUpperCase()}</small>
            <small>{i.ap_last_edited_at?'AP details completed / edited '+String(i.ap_last_edited_at).slice(0,10):'Awaiting AP details'}
              {i.supporting_document_id?' · Optional supporting file attached':' · No recurring supporting file (optional)'}</small>
          </div>
          <div className="jims-recurring-actions">
            <button type="button" onClick={()=>editInstruction(i)} disabled={busy}>Edit</button>
            <button type="button" onClick={()=>switchInstruction(i)} disabled={busy}>{i.status==='active'?'Pause':'Resume'}</button>
          </div>
        </div>)}
      </section>
    </>}
    {section==='tasks'&&<section className="jims-recurring-card">
      <div className="jims-recurring-title">
        <h3>AP Submission History ({data.tasks.length})</h3>
        <button type="button" className="btn" disabled={busy} onClick={regenerate}>
          Generate Missing This-Month Tasks
        </button>
      </div>
      <p className="muted">One task per instruction per month. This is not a Payment Voucher or confirmed bank payment. Existing AP tasks remain after an instruction is paused.</p>
      {data.tasks.length===0&&<p className="muted">No monthly AP tasks have been generated yet.</p>}
      {data.tasks.slice(0,100).map(t=><div className="jims-recurring-item" key={t.id}>
        <div className="jims-recurring-description">
          <strong>{t.supplier_name} · {String(t.period_month).slice(0,7)}</strong>
          <small>{t.category_name} · {branches[t.branch_code]||t.branch_code} · Due {dateText(t.due_date)} · {t.amount_type==='fixed'?money(t.fixed_amount):'Variable bill'}</small>
        </div>
        <span className="jims-recurring-tag">{t.status==='pv_linked'?'PV Linked':t.status==='pending_ap'?'Pending AP':'Cancelled'}</span>
      </div>)}
      {data.tasks.length>100&&<p className="muted">Showing latest 100 of {data.tasks.length} tasks.</p>}
    </section>}
  </div>
}
