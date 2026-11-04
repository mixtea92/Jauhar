// AP edits details of an existing FM recurring request. Never exposes deletion or FM controls.
import {useEffect,useState} from 'react'
import {supabase} from './lib/supabase'
import {isMobileUploadBlocked,MOBILE_UPLOAD_NOTICE} from './lib/mobileUploadGuard'
import './JIMSRecurringAPDetails.css'

const branches={GP:'Gelang Patah',KM:'Kota Masai',PM:'Pulai Mutiara',TD:'Taman Daya'}
const blank=()=>({
  supplier:'',branch:'GP',amountType:'fixed',amount:'',dueDay:'7',notes:'',
  preset:{financial_tier:'',payment_lead_days:'1',supplier_code:'',supplier_tin:'',
    bank_name:'',bank_account_no:'',payment_method:'',payment_type:'',expense_nature:'Recurring',
    budget_classification:'',gl_code:'',line_description:''}
})
const choices={
  financial_tier:['','T01','T02','T03','T04','T05','T06','T07','T08','T09'],
  payment_method:['','Online Transfer','Cash','Cheque'],
  payment_type:['','Supplier','Staff Reimbursement','Staff Advance','Other'],
  expense_nature:['','Recurring','Ad Hoc'],
  budget_classification:['','Budgeted','Unbudgeted']
}
const labels={
  financial_tier:'Financial Tier',
  supplier_code:'Supplier Code',supplier_tin:'Supplier TIN',bank_name:'Bank Name',
  bank_account_no:'Bank Account No.',payment_method:'Payment Method',
  payment_type:'Payment Type',expense_nature:'Expense Nature',
  budget_classification:'Budget Classification',
  gl_code:'GL Code',line_description:'PV Line Description'
}
export default function JIMSRecurringAPDetails({taskId,onSaved,onClose}){
  const [task,setTask]=useState(null)
  const [form,setForm]=useState(blank)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [file,setFile]=useState(null)
  const [documentName,setDocumentName]=useState('')
  const [validFrom,setValidFrom]=useState('')
  const [validTo,setValidTo]=useState('')
  const [fileKey,setFileKey]=useState(0)
  useEffect(()=>{
    let active=true
    setLoading(true);setTask(null);setError('');setNotice('')
    supabase.rpc('jims_recurring_ap_prepare_v1',{p_task_id:taskId})
      .then(({data,error:e})=>{
        if(!active)return
        if(e)throw e
        if(data?.status!=='pending_ap')throw Error('FM request is no longer editable. Open the linked PV instead.')
        const p=data.pv_preset||{}
        setTask(data)
        setForm({
          supplier:data.supplier_name||'',branch:data.branch_code||'GP',
          amountType:data.amount_type||'fixed',
          amount:data.fixed_amount==null?'':String(data.fixed_amount),
          dueDay:String(data.due_day||Number(String(data.due_date).slice(-2))||7),
          notes:data.ap_notes||'',
          preset:{...blank().preset,...p}
        })
      })
      .catch(e=>{if(active)setError(e.message||'Could not load AP recurring details')})
      .finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[taskId])
  const setPreset=(key,value)=>setForm(f=>({...f,preset:{...f.preset,[key]:value}}))
  async function save(event){
    event.preventDefault()
    if(busy||loading||!task||task.status!=='pending_ap')return
    const ext=file?.name.split('.').pop()?.toLowerCase()||''
    if(file&&(!['pdf','png','jpg','jpeg','webp'].includes(ext)||file.size<=0||file.size>10485760)){
      setError('Supporting Document must be PDF/image, maximum 10 MB.');return
    }
    if(file&&documentName.trim().length<3){
      setError('Document Name is required when a supporting file is attached.');return
    }
    if(file&&isMobileUploadBlocked()){setError(MOBILE_UPLOAD_NOTICE);return}
    if(form.amountType==='fixed'&&(!Number.isFinite(Number(form.amount))||Number(form.amount)<=0)){
      setError('Enter a valid fixed amount.');return
    }
    if(Number(form.preset.payment_lead_days)<1||Number(form.preset.payment_lead_days)>28){
      setError('Proposed payment must be at least 1 day before Supplier Due Date.');return
    }
    setBusy(true);setError('');setNotice('')
    let detailsSaved=false
    try{
      const {error:e}=await supabase.rpc('jims_recurring_ap_update_details_v1',{
        p_task_id:taskId,p_supplier:form.supplier.trim(),p_branch:form.branch,
        p_amount_type:form.amountType,
        p_amount:form.amountType==='fixed'?Number(form.amount):null,
        p_due_day:Number(form.dueDay),
        p_preset:Object.fromEntries(Object.entries(form.preset).filter(([,v])=>String(v).trim()!=='')),
        p_notes:form.notes.trim()
      })
      if(e)throw e
      detailsSaved=true
      if(file){
        setNotice('Recurring details saved. Uploading supporting document...')
        const {data:prep,error:pe}=await supabase.rpc('jims_recurring_ap_document_prepare_v1',{
          p_task_id:taskId,p_name:documentName.trim(),p_original_filename:file.name,
          p_from:validFrom||null,p_to:validTo||null,p_ext:ext
        })
        if(pe)throw pe
        if(!prep?.id||!prep?.path)throw Error('Document registration was not returned')
        const contentType=file.type||(ext==='pdf'?'application/pdf':
          ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg')
        const {error:ue}=await supabase.storage.from('jauhar-recurring-supporting')
          .upload(prep.path,file,{upsert:false,contentType})
        if(ue)throw ue
        const {error:ce}=await supabase.rpc('jims_recurring_ap_document_confirm_v1',{p_id:prep.id})
        if(ce)throw ce
      }
      setFile(null);setDocumentName('');setValidFrom('');setValidTo('');setFileKey(k=>k+1)
      onSaved?.()
      onClose?.()
    }catch(e){
      setError((detailsSaved?'Recurring details were saved, but document attachment was not completed: ':
        'Recurring details not saved: ')+(e?.message||'Unknown error'))
      setNotice('')
    }finally{setBusy(false)}
  }
  return <div className="jims-rad-overlay">
    <section className="jims-rad-panel" role="dialog" aria-modal="true" aria-label="Edit Recurring Payment Details">
      <div className="jims-rad-head">
        <div>
          <h2>Edit Recurring Details — AP</h2>
          <p>FM request stays active. You can complete and correct payment details; you cannot delete or cancel this request.</p>
        </div>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Close</button>
      </div>
      {loading&&<p>Loading assigned recurring request...</p>}
      {error&&<p className="jims-rad-error" role="alert">{error}</p>}
      {notice&&<p className="jims-rad-status" role="status">{notice}</p>}
      {task&&!loading&&<form onSubmit={save} className="jims-rad-form">
        <div className="jims-rad-info">
          <strong>FM Request — {task.category_name}</strong>
          <span>Recurring month: {String(task.period_month).slice(0,7)} · Supplier Due: {task.due_date}</span>
          {task.fm_notes&&<span>FM Instructions: {task.fm_notes}</span>}
          <small>FM-assigned request, category, AP assignee and active/paused status cannot be changed here.</small>
        </div>
        <h3>Payment Details</h3>
        <div className="jims-rad-grid">
          <label>Supplier / Payee *
            <input required maxLength={150} value={form.supplier} onChange={e=>setForm(f=>({...f,supplier:e.target.value}))}/>
          </label>
          <label>Branch *
            <select value={form.branch} onChange={e=>setForm(f=>({...f,branch:e.target.value}))}>
              {Object.entries(branches).map(([code,name])=><option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          <label>Amount Type *
            <select value={form.amountType} onChange={e=>setForm(f=>({...f,amountType:e.target.value,amount:''}))}>
              <option value="fixed">Fixed</option>
              <option value="variable">Variable (actual amount from monthly bill)</option>
            </select>
          </label>
          {form.amountType==='fixed'&&<label>Recurring Amount (RM) *
            <input required type="number" step="0.01" min="0.01" max="9999999999"
              value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/>
          </label>}
          <label>Supplier Due Day (1–31) *
            <input required type="number" min="1" max="31" value={form.dueDay}
              onChange={e=>setForm(f=>({...f,dueDay:e.target.value}))}/>
          </label>
        </div>
        <h3>PV Autofill Details</h3>
        <div className="jims-rad-grid">
          {Object.entries(labels).map(([key,label])=><label key={key}>{label}
            {choices[key]?<select value={form.preset[key]||''} onChange={e=>setPreset(key,e.target.value)}>
              {choices[key].map(val=><option key={val||'empty'} value={val}>{val||'Select / leave for AP to complete in PV'}</option>)}
            </select>:<input maxLength={200} value={form.preset[key]||''}
              onChange={e=>setPreset(key,e.target.value)}/>}
          </label>)}
          <label>AP Payment Lead Days (before due date) *
            <input type="number" required min="1" max="28"
              value={form.preset.payment_lead_days||'1'}
              onChange={e=>setPreset('payment_lead_days',e.target.value)}/>
          </label>
        </div>
        <label>AP Notes (Optional)
          <textarea rows={2} maxLength={500} value={form.notes}
            onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/>
        </label>
        <h3>Recurring Payment Supporting Documents — Optional</h3>
        {task.supporting_document_name&&<p className="jims-rad-info">
          Current Archive Document: <strong>{task.supporting_document_name}</strong>
          {task.supporting_document_valid?' · Valid':' · Check validity'}
        </p>}
        <p>You may save without a file. If uploading, give the document a custom name. The file will automatically appear in Finance Document Archive.</p>
        <div className="jims-rad-grid">
          <label>Attach PDF / Image (Optional, max 10 MB)
            <input key={fileKey} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
              disabled={isMobileUploadBlocked()||busy} onChange={e=>setFile(e.target.files?.[0]||null)}/>
          </label>
          {file&&<>
            <label>Document Name * (Required if uploading)
              <input required minLength={3} maxLength={120} value={documentName}
                placeholder="e.g. Tenancy Agreement" onChange={e=>setDocumentName(e.target.value)}/>
            </label>
            <label>Document Valid From (Optional)
              <input type="date" value={validFrom} onChange={e=>setValidFrom(e.target.value)}/>
            </label>
            <label>Document Valid Until (Optional)
              <input type="date" value={validTo} min={validFrom||undefined}
                onChange={e=>setValidTo(e.target.value)}/>
            </label>
          </>}
        </div>
        {isMobileUploadBlocked()&&<small>{MOBILE_UPLOAD_NOTICE}</small>}
        <p className="jims-rad-hint">No supporting PDF is required to save recurring details. When submitting the PV, the normal invoice or valid linked supporting-document evidence rules still apply. JR and payment proofs remain in their usual sections.</p>
        <div className="jims-rad-actions">
          <button className="btn" type="submit" disabled={busy}>
            {busy?'Saving...':'Save Recurring Details'+(file?' + Upload Document':'')}
          </button>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel Edit</button>
        </div>
      </form>}
    </section>
  </div>
}
