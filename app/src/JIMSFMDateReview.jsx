// UAT-FIX-09: FM-only reviewed Supplier Due Date changes must have real evidence.
// This page does not approve the PV or change the FM authority model.
import {useEffect,useState} from 'react'
import {supabase} from './lib/supabase'
import {isMobileUploadBlocked} from './lib/mobileUploadGuard'

const field={background:'var(--jims-card-bg,transparent)',color:'inherit',
  border:'1px solid #9f8c5a',borderRadius:8,padding:'9px 11px',
  width:'100%',boxSizing:'border-box'}
const hint={fontSize:12,display:'block',marginBottom:5,fontWeight:600}
const dateMY = d => {
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d||''))
  return m ? m[3]+'/'+m[2]+'/'+m[1] : '—'
}
const fileExt = f => {
  const ext=(String(f?.name||'').split('.').pop()||'').toLowerCase()
  return ext==='jpeg'?'jpg':ext
}
const mimeForExt = {pdf:'application/pdf',jpg:'image/jpeg',
  png:'image/png',webp:'image/webp'}
const BUCKET='jauhar-pv-due-evidence'

export default function JIMSFMDateReview({
  voucherId,data,onSaved,invoiceDocuments=[],invoiceLines=[]
}){
  const [due,setDue]=useState(data?.supplier_due_date||'')
  const [payment,setPayment]=useState(data?.proposed_payment_date||'')
  const [reason,setReason]=useState('')
  const [supplierRef,setSupplierRef]=useState('')
  const [mode,setMode]=useState('')
  const [invoiceDocId,setInvoiceDocId]=useState('')
  const [file,setFile]=useState(null)
  const [uploadedPath,setUploadedPath]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [history,setHistory]=useState([])
  const [historyError,setHistoryError]=useState('')
  const [link,setLink]=useState(null)
  const mobileBlocked=isMobileUploadBlocked()

  useEffect(()=>{
    setDue(data?.supplier_due_date||'')
    setPayment(data?.fm_approved_payment_date||data?.proposed_payment_date||'')
    setReason('')
    setSupplierRef('')
    setMode('')
    setInvoiceDocId('')
    setFile(null)
    setUploadedPath('')
  },[voucherId,data?.supplier_due_date,data?.proposed_payment_date,data?.fm_approved_payment_date])

  useEffect(()=>{
    if(!voucherId)return
    let active=true
    setHistoryError('')
    supabase.rpc('jims_57d8_due_evidence_history_v1',{p_voucher_id:voucherId})
      .then(({data:rows,error:e})=>{
        if(!active)return
        if(e)throw e
        setHistory(Array.isArray(rows)?rows:[])
      }).catch(e=>{if(active)setHistoryError(e?.message||'Could not load evidence history')})
    return ()=>{active=false}
  },[voucherId,data?.supplier_due_date,data?.fm_approved_payment_date])

  const dueChanged=Boolean(data?.supplier_due_date && due!==data.supplier_due_date)
  const evidenceReady=!dueChanged || (mode==='invoice'
    ? invoiceDocuments.some(d=>d.id===invoiceDocId)
    : mode==='upload' && !mobileBlocked && Boolean(file||uploadedPath))
  const dueReady=Boolean(due) && (!dueChanged || (reason.trim().length>=8 && evidenceReady))
  const acceptBeyondDue=Boolean(due && data?.proposed_payment_date && data.proposed_payment_date>due)
  const changeBeyondDue=Boolean(due && payment && payment>due)
  const acceptReady=!busy&&dueReady&&!!data?.proposed_payment_date&&!data?.fm_approved_payment_date &&
    (!acceptBeyondDue||reason.trim().length>=8)
  const changeReady=!busy&&dueReady&&!!payment&&reason.trim().length>=8 &&
    payment!==(data?.fm_approved_payment_date||data?.proposed_payment_date)

  async function save(action){
    const accept=action==='accept'
    if(busy || (accept?!acceptReady:!changeReady))return
    setBusy(true);setError('');setNotice('');setLink(null)
    try{
      let verified=null
      if(dueChanged){
        if(mode==='invoice'){
          const doc=invoiceDocuments.find(d=>d.id===invoiceDocId)
          if(!doc)throw new Error('Select an attached invoice as evidence.')
          verified={source:'invoice',invoice_document_id:doc.id,
            reference:supplierRef.trim()||null}
        }else if(mode==='upload'){
          if(mobileBlocked)throw new Error('Desktop browser required for file uploads.')
          let path=uploadedPath
          if(!path){
            if(!file)throw new Error('Choose a PDF or image evidence file.')
            const ext=fileExt(file)
            if(!mimeForExt[ext] ||
               (file.type && file.type!==mimeForExt[ext]) ||
               file.size<1 || file.size>5*1024*1024)
              throw new Error('Evidence must be PDF/JPG/PNG/WEBP, maximum 5 MB.')
            const {data:auth,error:authError}=await supabase.auth.getUser()
            if(authError||!auth?.user?.id)throw authError||new Error('Login session required.')
            path=voucherId+'/'+auth.user.id+'/'+crypto.randomUUID()+'.'+ext
            const {error:uploadError}=await supabase.storage.from(BUCKET)
              .upload(path,file,{contentType:mimeForExt[ext],upsert:false})
            if(uploadError)throw uploadError
            setUploadedPath(path)
          }
          verified={source:'upload',storage_path:path,
            reference:supplierRef.trim()||null}
        }else throw new Error('Choose Existing Invoice or Upload New Evidence.')
      }
      const {data:response,error:saveError}=await supabase.rpc(
        'jims_57d8_fm_review_payment_plan_v1',{
          p_voucher_id:voucherId,p_action:action,p_due_date:due,
          p_payment_date:accept?null:payment,
          p_reason:reason.trim()||null,
          p_supplier_evidence_reference:verified?JSON.stringify(verified):null
        })
      if(saveError)throw saveError
      if(!response?.saved)throw new Error('FM decision was not confirmed by the database.')
      setNotice(accept?'Proposed Payment Date accepted with audit.':
        'FM Payment Date changed and approved with audit.')
      await onSaved?.()
    }catch(e){setError(e?.message||'Could not save Finance Manager date review')}
    finally{setBusy(false)}
  }

  async function generateSecureLink(bucket,path){
    setError('');setLink(null)
    if(!path){setError('Evidence file is unavailable.');return}
    try{
      const {data:result,error:e}=await supabase.storage.from(bucket)
        .createSignedUrl(path,60)
      if(e)throw e
      if(!result?.signedUrl)throw new Error('Secure link unavailable')
      setLink({url:result.signedUrl,label:'Open evidence (60 seconds)'})
    }catch(e){setError(e?.message||'Cannot access this evidence')}
  }
  function viewExisting(docId){
    const doc=invoiceDocuments.find(d=>d.id===docId)
    if(!doc){setError('Invoice document is not available.');return}
    void generateSecureLink('jauhar-pv-invoices',doc.storage_path)
  }
  const invoiceLabel=doc=>{
    const line=invoiceLines.find(l=>l.id===doc.line_item_id)
    return (line?.invoice_reference||'Invoice')+' — '+doc.id.slice(0,8)
  }

  return <div style={{padding:14,marginTop:12,border:'1px solid #a78b4a66',borderRadius:9}}
    aria-label="Finance Manager Payment Planning review">
    <strong style={{color:'#d9b45c'}}>FINANCE MANAGER — REVIEW PAYMENT DATES</strong>
    <p className="muted" style={{fontSize:12,margin:'8px 0 12px'}}>
      PAYMENT PROCESS — Validate Supplier Due Date, then accept AP proposed date or
      change the payment plan before FM approves Payment Initiation. This review does
      not confirm that the bank payment has been completed.
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
    {dueChanged&&<section style={{marginTop:12,padding:12,border:'1px solid #9f8c5a66',borderRadius:8}}
      aria-label="Supplier Due Date amendment evidence">
      <strong style={{color:'#dfb95f'}}>Supplier Due Date changed — supporting evidence required</strong>
      <p className="muted" style={{fontSize:12}}>
        Use the existing invoice if it proves the correct due date, or upload a supplier
        letter/email/WhatsApp screenshot. The evidence source will be recorded in audit history.
      </p>
      <label style={{display:'block',marginTop:10}}>
        <span style={hint}>Evidence Source *</span>
        <select style={field} value={mode} disabled={busy} onChange={e=>{
          setMode(e.target.value);setInvoiceDocId('');setFile(null);setUploadedPath('');setLink(null)
        }}>
          <option value="">Select evidence source</option>
          <option value="invoice" disabled={!invoiceDocuments.length}>Use Existing Invoice</option>
          <option value="upload" disabled={mobileBlocked}>Upload New Evidence</option>
        </select>
      </label>
      {mode==='invoice'&&<div style={{marginTop:10}}>
        <label><span style={hint}>Choose Attached Invoice *</span>
          <select style={field} value={invoiceDocId} disabled={busy}
            onChange={e=>{setInvoiceDocId(e.target.value);setLink(null)}}>
            <option value="">Select invoice</option>
            {invoiceDocuments.map(d=><option key={d.id} value={d.id}>{invoiceLabel(d)}</option>)}
          </select>
        </label>
        {invoiceDocId&&<button type="button" className="btn" style={{marginTop:8}}
          disabled={busy} onClick={()=>viewExisting(invoiceDocId)}>View Attached Invoice</button>}
      </div>}
      {mode==='upload'&&<label style={{display:'block',marginTop:10}}>
        <span style={hint}>Upload Supplier Evidence * (PDF, JPG, PNG, WEBP — maximum 5 MB)</span>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
          disabled={busy||mobileBlocked} onChange={e=>{
            const next=e.target.files?.[0]||null
            setFile(next);setUploadedPath('');setLink(null)
          }}/>
        <small className="muted" style={{display:'block'}}>File uploads when you save the FM decision.</small>
      </label>}
      <label style={{display:'block',marginTop:10}}>
        <span style={hint}>Supplier Evidence Reference (Optional)</span>
        <input style={field} value={supplierRef} disabled={busy}
          maxLength={200} placeholder="Email subject, invoice reference, letter number"
          onChange={e=>setSupplierRef(e.target.value)}/>
      </label>
      {mobileBlocked&&<p className="muted">New file upload is disabled on mobile; use an existing invoice or desktop browser.</p>}
    </section>}
    {(acceptBeyondDue||changeBeyondDue)&&<p style={{color:'#dfb95f',fontSize:12}}>
      FM planned payment date exceeds Supplier Due Date. A reason is required; overdue status remains.
    </p>}
    <label style={{display:'block',marginTop:12}}>
      <span style={hint}>Reason for Change / Exception {dueChanged?'*':''}</span>
      <input style={field} value={reason} maxLength={500} disabled={busy}
        placeholder="Required for any date change (minimum 8 characters)"
        onChange={e=>setReason(e.target.value)}/>
    </label>
    <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:12}}>
      <button type="button" className="btn" disabled={!acceptReady}
        onClick={()=>save('accept')}>{busy?'Saving...':'Accept Proposed Date'}</button>
      <button type="button" className="btn" disabled={!changeReady}
        onClick={()=>save('change')}>{busy?'Saving...':'Change & Approve Payment Date'}</button>
    </div>
    {data?.fm_approved_payment_date&&<p className="muted">
      FM date already approved. Further payment date changes require an audited reason.
    </p>}
    {notice&&<p role="status" style={{color:'#74c69d'}}>{notice}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
    {link&&<p><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></p>}
    <details style={{marginTop:12}}>
      <summary style={{cursor:'pointer'}}>Supplier Due Date Evidence History ({history.length})</summary>
      {historyError&&<p role="alert" className="error">{historyError}</p>}
      {!history.length&&<p className="muted">No evidence-linked due date amendments yet.</p>}
      {history.map(h=><div key={h.audit_id} style={{padding:'8px 0',borderBottom:'1px solid #9f8c5a33'}}>
        <div><strong>{dateMY(h.old_due_date)} → {dateMY(h.new_due_date)}</strong></div>
        <small className="muted">{h.evidence_source==='invoice'?'Existing invoice':'Uploaded evidence'}
          {h.supplier_reference?' · '+h.supplier_reference:''}
          {h.recorded_at?' · '+new Date(h.recorded_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}):''}
        </small>
        <div><button type="button" className="btn" style={{marginTop:5}}
          onClick={()=>{
            if(h.evidence_source==='invoice')viewExisting(h.invoice_document_id)
            else void generateSecureLink(BUCKET,h.storage_path)
          }}>View Evidence</button></div>
      </div>)}
    </details>
  </div>
}
