import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// JAUHAR STEP 45 — Private payment initiation, Finance Manager verification, final PDF receipt.
// Authorization is enforced by Step 43B/43C Supabase storage policies and RPCs.
const INIT_BUCKET = 'jauhar-pv-payment-initiation'
const RECEIPT_BUCKET = 'jauhar-pv-receipts'
const MAX_BYTES = 5 * 1024 * 1024
const FILE_MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp'
}

function extensionOf(file) {
  const ext = file?.name?.split('.').pop()?.toLowerCase()
  return ext && FILE_MIME[ext] && (!file.type || file.type === FILE_MIME[ext]) ? ext : null
}

function myDate(value) {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-')
    return `${d}/${m}/${y}`
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(d)
}

function todayMY() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric'
  }).formatToParts(new Date())
  const get = type => parts.find(x => x.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function finalApprovedDate(value) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric'
  }).formatToParts(d)
  const get = type => parts.find(x => x.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function money(n) {
  return `RM ${Number(n || 0).toLocaleString('en-MY', {minimumFractionDigits:2,maximumFractionDigits:2})}`
}

export default function PaymentTrackingPanel({ voucher, profile, onVoucherChanged, onBusyChange, delegatedReviewPermissions = [], suspendedFinanceManager = false }) {
  const [proofs, setProofs] = useState([])
  const [proofFile, setProofFile] = useState(null)
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptPath, setReceiptPath] = useState('')
  const [proofLinks, setProofLinks] = useState({})
  const [receiptLink, setReceiptLink] = useState('')
  const [managerRemarks, setManagerRemarks] = useState('')
  const [date, setDate] = useState(todayMY)
  const [transaction, setTransaction] = useState('')
  const [amount, setAmount] = useState(() => Number(voucher?.amount || 0).toFixed(2))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])

  const financeExec = profile?.role === 'executive' && profile?.department === 'Finance'
  const financeManager = (profile?.role === 'manager' && profile?.department === 'Finance' && !suspendedFinanceManager) || delegatedReviewPermissions.length > 0
  const eligible = voucher?.status === 'fully_approved'
  const status = voucher?.payment_status
  const decision = voucher?.payment_initiation_manager_decision
  const canInitiate = eligible && financeExec && (status === 'pending_payment' ||
    (status === 'payment_initiated' && decision === 'returned'))
  const canReview = eligible && financeManager && status === 'payment_initiated' && decision === 'pending'
  const canComplete = eligible && financeExec && status === 'payment_initiated' && decision === 'approved'
  const latest = proofs[0]
  const newerProofRequired = decision === 'returned' &&
    (!latest || latest.id === voucher.payment_initiation_proof_id)
  const canReadProof = Boolean(latest) && (financeExec || financeManager ||
    ['ceo','bod','system_admin'].includes(profile?.role))

  useEffect(() => {
    let active = true
    setProofFile(null)
    setReceiptFile(null)
    setReceiptPath('')
    setProofLinks({})
    setReceiptLink('')
    setManagerRemarks('')
    setTransaction('')
    setDate(todayMY())
    setAmount(Number(voucher?.amount || 0).toFixed(2))
    setMessage('')
    setFailed(false)
    if (!voucher?.id || !eligible) { setProofs([]); return () => { active = false } }
    supabase.from('pv_payment_initiation_proofs')
      .select('id,version_num,storage_path,original_filename,mime_type,size_bytes,created_at')
      .eq('voucher_id', voucher.id).order('version_num', { ascending: false })
      .then(({data,error}) => {
        if (!active) return
        if (error) { setProofs([]); setMessage(`Unable to load initiation proofs: ${error.message}`); setFailed(true) }
        else setProofs(data || [])
      })
    return () => { active = false }
  }, [voucher?.id, eligible])

  function report(error, prefix) {
    setMessage(`${prefix}: ${error?.message || 'Unexpected error'}`)
    setFailed(true)
  }

  async function refreshProofs() {
    const {data,error} = await supabase.from('pv_payment_initiation_proofs')
      .select('id,version_num,storage_path,original_filename,mime_type,size_bytes,created_at')
      .eq('voucher_id', voucher.id).order('version_num',{ascending:false})
    if (error) throw error
    setProofs(data || [])
  }

  async function refreshVoucher() {
    const {data,error} = await supabase.from('payment_vouchers')
      .select('*').eq('id',voucher.id).single()
    if (error) throw error
    await onVoucherChanged(data)
    return data
  }

  async function uploadProof() {
    if (!canInitiate || busy || !proofFile) return
    const ext = extensionOf(proofFile)
    if (!ext || !proofFile.size || proofFile.size > MAX_BYTES) {
      setMessage('Select a nonempty PDF/JPG/PNG/WEBP file, up to 5 MB.');setFailed(true);return
    }
    setBusy(true);setMessage('Uploading private initiation evidence...');setFailed(false)
    let stored = false
    try {
      const path = `${voucher.id}/${crypto.randomUUID()}.${ext}`
      const {error:uploadError} = await supabase.storage.from(INIT_BUCKET)
        .upload(path,proofFile,{upsert:false,contentType:FILE_MIME[ext]})
      if (uploadError) throw uploadError
      stored = true
      const {error:registerError} = await supabase.rpc('register_pv_payment_initiation_proof_v1', {
        p_voucher_id:voucher.id,p_storage_path:path,p_original_filename:proofFile.name,
        p_mime_type:FILE_MIME[ext],p_size_bytes:proofFile.size,
        p_expected_updated_at:voucher.updated_at
      })
      if (registerError) throw registerError
      await refreshVoucher()
      await refreshProofs()
      setProofFile(null)
      setMessage('Initiation proof registered. Click Submit Payment Initiation.')
    } catch (e) {
      report(e, stored ? 'Proof uploaded but registration/refresh was not confirmed. Review and reopen PV before retrying' : 'Proof upload failed')
    } finally {setBusy(false)}
  }

  async function submitInitiation() {
    if (!canInitiate || busy || !latest || newerProofRequired) return
    if (!window.confirm(`Submit initiation for ${voucher.pv_number}?\nThis is NOT final bank payment.`)) return
    setBusy(true);setMessage('Submitting payment initiation...');setFailed(false)
    try {
      const {data,error} = await supabase.rpc('initiate_pv_payment_v1', {
        p_voucher_id:voucher.id,p_proof_id:latest.id,
        p_expected_updated_at:voucher.updated_at
      })
      if (error) throw error
      if (data?.payment_status !== 'payment_initiated' || data?.payment_initiation_manager_decision !== 'pending')
        throw new Error('Initiation result not confirmed; reopen PV')
      await onVoucherChanged(data)
      setMessage('Payment initiated. Waiting for Finance Manager review.')
    } catch(e) {report(e,'Initiation failed')} finally {setBusy(false)}
  }

  async function review(action) {
    if (!canReview || busy) return
    if (delegatedReviewPermissions.length && !delegatedReviewPermissions.includes(action)) {
      setMessage('This action is not in your delegated permission scope.'); setFailed(true); return
    }
    const remarks = managerRemarks.trim()
    if (action === 'return' && !remarks) {setMessage('Return reason is required.');setFailed(true);return}
    if (remarks.length > 2000) {setMessage('Remarks limit: 2000 characters.');setFailed(true);return}
    if (!window.confirm(`${action.toUpperCase()} payment initiation for ${voucher.pv_number}?`)) return
    setBusy(true);setMessage('Saving Finance Manager decision...');setFailed(false)
    try {
      const {data,error} = await supabase.rpc('review_pv_payment_initiation_v1', {
        p_voucher_id:voucher.id,p_decision:action,p_expected_updated_at:voucher.updated_at,
        p_remarks:remarks || null
      })
      if (error) throw error
      const expected = action === 'approve' ? 'approved' : 'returned'
      if (data?.payment_initiation_manager_decision !== expected) throw new Error('Review was not confirmed')
      await onVoucherChanged(data)
      setManagerRemarks('')
      setMessage(action === 'approve' ? 'Initiation approved. Executive may record completed bank payment.' :
        'Initiation returned. Executive must upload a NEW proof version before resubmitting.')
    } catch(e) {report(e,'Review failed')} finally {setBusy(false)}
  }

  async function openPrivate(bucket,path,key) {
    if (!path || busy) return
    setBusy(true);setMessage('Creating time-limited private link...');setFailed(false)
    try {
      const {data,error} = await supabase.storage.from(bucket).createSignedUrl(path,60)
      if (error) throw error
      if (!data?.signedUrl) throw new Error('Signed link missing')
      if (key === 'receipt') setReceiptLink(data.signedUrl)
      else setProofLinks(current=>({...current,[key]:data.signedUrl}))
      setMessage('Private link generated (60 seconds).')
    } catch(e) {report(e,'Cannot open private document')} finally {setBusy(false)}
  }

  async function completePayment() {
    if (!canComplete || busy) return
    const ext = extensionOf(receiptFile)
    if (!receiptPath && (!receiptFile || ext !== 'pdf' || !receiptFile.size || receiptFile.size > MAX_BYTES)) {
      setMessage('A final PDF receipt (maximum 5 MB) is required.');setFailed(true);return
    }
    const n = Number(amount)
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount.trim()) || !Number.isFinite(n) ||
        Math.round(n*100) !== Math.round(Number(voucher.amount)*100)) {
      setMessage(`Payment amount must equal approved amount ${money(voucher.amount)}.`);setFailed(true);return
    }
    if (!transaction.trim() || transaction.trim().length > 200) {
      setMessage('Enter valid receipt/transaction number (1–200 characters).');setFailed(true);return
    }
    const min = finalApprovedDate(voucher.final_approval_date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !min || date < min || date > todayMY()) {
      setMessage('Payment date must be between final approval date and today (Malaysia time).');setFailed(true);return
    }
    if (!window.confirm(`Confirm ACTUAL bank payment?\n${voucher.pv_number}\nAmount: ${money(n)}\nTransaction: ${transaction.trim()}\nDate: ${myDate(date)}`)) return
    setBusy(true);setMessage('Uploading PDF and completing payment...');setFailed(false)
    let path = receiptPath
    try {
      if (!path) {
        path = `${voucher.id}/${crypto.randomUUID()}.pdf`
        const {error:uploadError} = await supabase.storage.from(RECEIPT_BUCKET)
          .upload(path,receiptFile,{upsert:false,contentType:'application/pdf'})
        if (uploadError) throw uploadError
        setReceiptPath(path)
      }
      const {data,error} = await supabase.rpc('complete_pv_payment_v1', {
        p_voucher_id:voucher.id,p_payment_date:date,p_receipt_path:path,
        p_transaction_no:transaction.trim(),p_payment_amount:n,
        p_expected_updated_at:voucher.updated_at
      })
      if (error) throw error
      if (data?.payment_status !== 'paid') throw new Error('Paid status not confirmed; reopen voucher')
      await onVoucherChanged(data)
      setReceiptFile(null);setReceiptPath('')
      setMessage('Payment marked Paid after Finance Manager verification. Final PDF receipt saved privately.')
    } catch(e) {report(e, path ? 'Payment completion not confirmed; PDF may already be uploaded. Check PV status before retrying' : 'Payment failed')}
    finally {setBusy(false)}
  }

  if (!voucher) return null
  const statusLabel = !eligible ? 'Not eligible' : status === 'paid' ? 'Paid' :
    status === 'payment_initiated' ? `Payment Initiated — ${decision || 'pending'}` : 'Pending Payment'

  return (
    <div>
      <div className="pv-section">PAYMENT TRACKING</div>
      <p className="pv-notice"><strong>Status:</strong> {statusLabel}
        {eligible && <> · Final Approval: {myDate(voucher.final_approval_date)}</>}
        {voucher.payment_initiated_at && <> · Initiated: {myDate(voucher.payment_initiated_at)}</>}
        {voucher.payment_date && <> · Paid: {myDate(voucher.payment_date)}</>}
      </p>
      {decision === 'returned' && voucher.payment_initiation_manager_remarks &&
        <p className="pv-notice"><strong>Finance Manager Return Remarks:</strong> {voucher.payment_initiation_manager_remarks}</p>}
      {eligible && proofs.length > 0 && <div style={{marginBottom:14}}>
        <strong>Payment initiation proof history (private):</strong>
        {proofs.map(p=><div key={p.id} style={{display:'flex',alignItems:'center',gap:9,marginTop:8,flexWrap:'wrap'}}>
          <span>v{p.version_num}: {p.original_filename}</span>
          {canReadProof && <button type="button" className="btn" disabled={busy}
            onClick={()=>openPrivate(INIT_BUCKET,p.storage_path,p.id)}>View proof</button>}
          {proofLinks[p.id] && <a href={proofLinks[p.id]} target="_blank" rel="noopener noreferrer">Open private link (60s)</a>}
        </div>)}
      </div>}
      {canInitiate && <div style={{border:'1px solid #d5e2f0',borderRadius:10,padding:14,margin:'12px 0'}}>
        <h3>AP Executive — Payment Initiation</h3>
        <p className="muted">Upload proof of a payment REQUEST/INITIATION, not the final bank receipt. The payment is not yet recorded as Paid.</p>
        <div className="pv-field"><label htmlFor="pv-init-proof">Initiation proof · PDF/JPG/PNG/WEBP · max 5 MB</label>
          <input id="pv-init-proof" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
            disabled={busy} onChange={e=>setProofFile(e.target.files?.[0] || null)}/></div>
        <div className="pv-actions">
          <button type="button" className="btn" disabled={busy || !proofFile} onClick={uploadProof}>1. Upload & Register Proof</button>
          <button type="button" className="btn" disabled={busy || !latest || newerProofRequired} onClick={submitInitiation}>2. Submit Payment Initiation</button>
        </div>
        {decision === 'returned' && <p className="pv-notice">Finance Manager returned the initiation. Upload and register a NEW proof version before resubmitting.</p>}
      </div>}
      {canReview && <div style={{border:'1px solid #d5e2f0',borderRadius:10,padding:14,margin:'12px 0'}}>
        <h3>Finance Manager — Verify Payment Initiation</h3>
        <p className="muted">Review the latest initiation proof before approval. This does not mark the bank transaction as completed.</p>
        <div className="pv-field"><label htmlFor="pv-init-review-notes">Remarks (mandatory when returning)</label>
          <textarea id="pv-init-review-notes" rows={2} maxLength={2000} value={managerRemarks}
            onChange={e=>setManagerRemarks(e.target.value)} disabled={busy}/></div>
        <div className="pv-actions">
          <button type="button" className="btn" disabled={busy} onClick={()=>review('approve')}>Approve Initiation</button>
          <button type="button" className="btn" disabled={busy || !managerRemarks.trim()}
            style={{background:'#9a6700'}} onClick={()=>review('return')}>Return for Amendment</button>
        </div>
      </div>}
      {canComplete && <div style={{border:'1px solid #d5e2f0',borderRadius:10,padding:14,margin:'12px 0'}}>
        <h3>AP Executive — Complete Actual Payment</h3>
        <p className="muted">Only proceed once the bank transfer has actually completed and a genuine final receipt PDF is available.</p>
        <div className="pv-grid">
          <div className="pv-field"><label htmlFor="pv-final-date">Actual Payment Date *</label>
            <input id="pv-final-date" type="date" min={finalApprovedDate(voucher.final_approval_date)} max={todayMY()}
              value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></div>
          <div className="pv-field"><label htmlFor="pv-final-transaction">Receipt / Transaction Number *</label>
            <input id="pv-final-transaction" maxLength={200} value={transaction} disabled={busy}
              onChange={e=>setTransaction(e.target.value)}/></div>
          <div className="pv-field"><label htmlFor="pv-final-amount">Actual Payment Amount (RM) *</label>
            <input id="pv-final-amount" inputMode="decimal" value={amount} disabled={busy}
              onChange={e=>setAmount(e.target.value)}/><small>Must equal {money(voucher.amount)} (no partial payment).</small></div>
          <div className="pv-field"><label htmlFor="pv-final-pdf">Final Bank Receipt PDF *</label>
            <input id="pv-final-pdf" type="file" accept=".pdf,application/pdf" disabled={busy || Boolean(receiptPath)}
              onChange={e=>{setReceiptFile(e.target.files?.[0] || null);setReceiptPath('')}}/>
            {receiptPath && <small>PDF uploaded; retry completion without uploading again.</small>}</div>
        </div>
        <div className="pv-actions"><button type="button" className="btn" disabled={busy || (!receiptFile && !receiptPath)}
          onClick={completePayment}>Upload Final PDF & Mark Paid</button></div>
      </div>}
      {eligible && voucher.receipt_path && <div className="pv-actions">
        <button type="button" className="btn" disabled={busy}
          onClick={()=>openPrivate(RECEIPT_BUCKET,voucher.receipt_path,'receipt')}>View Final Receipt</button>
        {receiptLink && <a href={receiptLink} target="_blank" rel="noopener noreferrer">Open private receipt (60s)</a>}
      </div>}
      {status === 'paid' && <p className="pv-notice"><strong>Transaction:</strong> {voucher.transaction_cheque_no || 'Legacy payment'} · <strong>Amount:</strong> {money(voucher.payment_amount ?? voucher.amount)} · <strong>Date:</strong> {myDate(voucher.payment_date)}</p>}
      {message && <p role={failed ? 'alert' : 'status'} style={{fontWeight:600,color:failed?'#b42318':'#167347'}}>{message}</p>}
    </div>
  )
}
