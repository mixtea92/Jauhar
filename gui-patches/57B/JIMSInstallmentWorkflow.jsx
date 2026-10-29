import {useEffect,useMemo,useState} from 'react'
import {supabase} from '../lib/supabase'

// JIMS Step 57B3: each installment has mandatory, distinct private evidence.
// Frontend never marks a payment Paid directly; only secured Supabase RPCs can.
const INIT='jauhar-pv-payment-initiation'
const RECEIPT='jauhar-pv-receipts'
const MAX=5*1024*1024
const MONEY=v=>'RM '+Number(v||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})
const FORMAT={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}
function malaysiaToday(){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const part=name=>parts.find(x=>x.type===name)?.value
  return part('year')+'-'+part('month')+'-'+part('day')
}
function checkFile(file,receipt=false){
  if(!file||!file.size||file.size>MAX)throw new Error('Select a file between 1 byte and 5 MB')
  const ext=file.name.split('.').pop()?.toLowerCase()
  if(!FORMAT[ext]||(receipt&&ext!=='pdf')||(file.type&&file.type!==FORMAT[ext]))
    throw new Error(receipt?'Final bank receipt must be PDF (max 5 MB)':'Proof must be PDF/JPG/PNG/WEBP (max 5 MB)')
  return {ext,mime:FORMAT[ext]}
}
export default function JIMSInstallmentWorkflow({
  voucher,ledger=[],onUpdated,canAP=false,canFM=false,disabled=false
}){
  const [docs,setDocs]=useState([])
  const [proof,setProof]=useState(null)
  const [receipt,setReceipt]=useState(null)
  const [paymentDate,setPaymentDate]=useState(malaysiaToday)
  const [bankRef,setBankRef]=useState('')
  const [reason,setReason]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [signed,setSigned]=useState({})
  const isMobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1) ||
    window.matchMedia('(max-width: 767px)').matches
  const active=useMemo(()=>ledger.find(t=>['draft','initiated','returned','approved'].includes(t.status)),[ledger])

  useEffect(()=>{
    let alive=true
    setDocs([]);setSigned({});setProof(null);setReceipt(null);setReason('')
    setBankRef('');setPaymentDate(malaysiaToday())
    supabase.from('jims_v2_payment_documents')
      .select('id,transaction_id,kind,storage_path,mime_type,created_at')
      .eq('voucher_id',voucher.id).order('created_at',{ascending:false}).limit(200)
      .then(({data,error:e})=>{
        if(!alive)return
        if(e)setError('Cannot load installment evidence history: '+e.message)
        else setDocs(data||[])
      })
    return ()=>{alive=false}
  },[voucher.id,voucher.updated_at])

  async function refresh(){
    await onUpdated?.()
  }
  async function run(task,label){
    if(busy||disabled)return
    setBusy(true);setError('');setNotice('')
    try{await task();setNotice(label)}
    catch(e){setError((e?.message||'Operation not confirmed')+
      '. Reopen this PV and check history before repeating an upload.')}
    finally{setBusy(false)}
  }
  async function upload(bucket,file,tx){
    const {ext,mime}=checkFile(file,bucket===RECEIPT)
    const path=voucher.id+'/'+tx.id+'/'+crypto.randomUUID()+'.'+ext
    const {error:e}=await supabase.storage.from(bucket).upload(path,file,
      {upsert:false,contentType:mime})
    if(e)throw e
    return path
  }
  function submit(){
    if(!canAP||!active||!['draft','returned'].includes(active.status))return
    if(isMobile){setError('File uploads are available from desktop browser only');return}
    if(!proof){setError('Initiation proof is MANDATORY for every installment');return}
    if(!window.confirm('Submit installment #'+active.installment_no+' ('+
      MONEY(active.requested_amount)+') to Finance Manager with a NEW proof?'))return
    run(async()=>{
      const path=await upload(INIT,proof,active)
      const {data,error:e}=await supabase.rpc('jims_v2_submit_installment_v1',{
        p_transaction_id:active.id,p_storage_path:path,
        p_expected_updated_at:voucher.updated_at
      })
      if(e)throw e
      if(data?.status!=='initiated'||data?.review_decision!=='pending')
        throw new Error('Finance Manager submission not confirmed')
      setProof(null)
      await refresh()
    },'Installment submitted to Finance Manager with mandatory initiation proof.')
  }
  function review(action){
    if(!canFM||active?.status!=='initiated')return
    const trimmed=reason.trim()
    if(action==='return'&&!trimmed){setError('Return remarks are mandatory');return}
    if(trimmed.length>2000){setError('Remarks too long');return}
    if(!window.confirm(action.toUpperCase()+' installment #'+active.installment_no+'?'))return
    run(async()=>{
      const {data,error:e}=await supabase.rpc('jims_v2_review_installment_v1',{
        p_transaction_id:active.id,p_decision:action,p_remarks:trimmed||null,
        p_expected_updated_at:voucher.updated_at
      })
      if(e)throw e
      if(data?.status!==(action==='approve'?'approved':'returned'))
        throw new Error('Finance Manager decision not confirmed')
      await refresh()
    },'Finance Manager decision recorded: '+action.toUpperCase())
  }
  function settle(){
    if(!canAP||active?.status!=='approved')return
    if(isMobile){setError('File uploads are available from desktop browser only');return}
    if(!receipt){setError('Final bank receipt PDF is MANDATORY');return}
    if(!bankRef.trim()){setError('Actual transaction number is required');return}
    if(!paymentDate){setError('Actual payment date is required');return}
    if(!window.confirm('Confirm actual bank payment for installment #'+
      active.installment_no+' ('+MONEY(active.requested_amount)+')?\n'+bankRef.trim()+
      '\nThis records real payment, not merely initiation.'))return
    run(async()=>{
      const path=await upload(RECEIPT,receipt,active)
      const {data,error:e}=await supabase.rpc('jims_v2_complete_installment_v1',{
        p_transaction_id:active.id,p_payment_date:paymentDate,
        p_transaction_no:bankRef.trim(),p_receipt_path:path,
        p_expected_updated_at:voucher.updated_at
      })
      if(e)throw e
      if(data?.status!=='paid'||Number(data?.settled_amount)!==Number(active.requested_amount))
        throw new Error('Bank payment completion not confirmed by database')
      setReceipt(null)
      await refresh()
    },'Installment Paid, verified bank PDF receipt recorded. Outstanding updated.')
  }
  function openDoc(doc){
    run(async()=>{
      const bucket=doc.kind==='final_receipt'?RECEIPT:INIT
      const {data,error:e}=await supabase.storage.from(bucket)
        .createSignedUrl(doc.storage_path,60)
      if(e)throw e
      if(!data?.signedUrl)throw new Error('Private evidence link unavailable')
      setSigned(old=>({...old,[doc.id]:data.signedUrl}))
    },'Private evidence link available for 60 seconds.')
  }
  return <section className="jims-v2-evidence" aria-label="Per-installment evidence">
    <h4>Installment Evidence & Finance Manager Verification</h4>
    {active?.status==='draft'&&<p className="jims-v2-flag">
      Installment draft saved. Mandatory initiation proof must be uploaded before submission to Finance Manager.
    </p>}
    {active?.status==='returned'&&<p className="jims-v2-flag">
      Returned for amendment. A DIFFERENT new initiation proof is compulsory before re-submission.
      {active.review_remarks&&<span> Return reason: {active.review_remarks}</span>}
    </p>}
    {active?.status==='initiated'&&<p className="jims-v2-flag">
      Submitted to Finance Manager. Waiting for verification.
    </p>}
    {active?.status==='approved'&&<p className="jims-v2-flag">
      Finance Manager approved. Actual payment can be recorded with mandatory final bank PDF.
    </p>}
    {canAP&&active&&['draft','returned'].includes(active.status)&&
      <div className="jims-v2-fieldset">
        <label htmlFor="jims-v2-init">Initiation Proof — compulsory PDF / JPG / PNG / WEBP (max 5 MB)</label>
        <input id="jims-v2-init" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
          disabled={busy||disabled||isMobile} onChange={e=>setProof(e.target.files?.[0]||null)}/>
        <button disabled={busy||disabled||isMobile||!proof} onClick={submit} type="button">
          Upload Proof & Submit to Finance Manager
        </button>
      </div>}
    {canFM&&active?.status==='initiated'&&<div className="jims-v2-fieldset">
      <label htmlFor="jims-v2-return">Finance Manager Remarks (mandatory if Return)</label>
      <textarea id="jims-v2-return" value={reason} maxLength={2000} rows={2}
        disabled={busy||disabled} onChange={e=>setReason(e.target.value)}/>
      <div className="jims-v2-actions">
        <button disabled={busy||disabled} onClick={()=>review('approve')} type="button">Approve Initiation</button>
        <button disabled={busy||disabled||!reason.trim()} onClick={()=>review('return')} type="button">
          Return for Amendment
        </button>
      </div>
    </div>}
    {canAP&&active?.status==='approved'&&<div className="jims-v2-fieldset">
      <label htmlFor="jims-v2-paydate">Actual Payment Date</label>
      <input id="jims-v2-paydate" type="date" value={paymentDate}
        max={malaysiaToday()} disabled={busy||disabled}
        onChange={e=>setPaymentDate(e.target.value)}/>
      <label htmlFor="jims-v2-bankref">Bank Transaction / Receipt Number</label>
      <input id="jims-v2-bankref" value={bankRef} maxLength={200}
        disabled={busy||disabled} onChange={e=>setBankRef(e.target.value)}/>
      <label htmlFor="jims-v2-receipt">Final Bank Receipt PDF — mandatory for THIS installment (max 5 MB)</label>
      <input id="jims-v2-receipt" type="file" accept=".pdf,application/pdf"
        disabled={busy||disabled||isMobile} onChange={e=>setReceipt(e.target.files?.[0]||null)}/>
      <button type="button" disabled={busy||disabled||isMobile||!receipt||!bankRef.trim()}
        onClick={settle}>Upload Final PDF & Mark Installment Paid</button>
    </div>}
    {isMobile&&<p className="jims-v2-flag">File uploads are disabled on mobile browsers. Use desktop for evidence uploads.</p>}
    <h4>Documents & Payment History</h4>
    {ledger.map(t=>{
      const files=docs.filter(d=>d.transaction_id===t.id)
      return <div className="jims-v2-history" key={t.id}>
        <div><strong>#{t.installment_no} · {MONEY(t.requested_amount)}</strong>
          <span>{t.status.toUpperCase()}</span></div>
        {t.status==='paid'&&<small>Payment: {t.payment_date||'—'} · Ref: {t.bank_transaction_reference||'—'}</small>}
        {files.map(doc=><div key={doc.id} className="jims-v2-docrow">
          <span>{doc.kind==='initiation'?'Initiation Proof':'Final Bank Receipt'} · {new Date(doc.created_at).toLocaleString('en-MY')}</span>
          <button type="button" disabled={busy||disabled} onClick={()=>openDoc(doc)}>
            View Private Evidence
          </button>
          {signed[doc.id]&&<a href={signed[doc.id]} target="_blank" rel="noopener noreferrer">Open 60s Link</a>}
        </div>)}
        {!files.length&&<small>No registered evidence yet.</small>}
      </div>
    })}
    {error&&<p className="jims-pay-mode-error" role="alert">{error}</p>}
    {notice&&<p className="jims-partial-draft-notice" role="status">{notice}</p>}
  </section>
}
