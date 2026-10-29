import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase'

// JIMS 57B2: Draft-only client. All writes go through the audited 57B1 RPCs.
// Partial initiation, reviews, storage and settlement remain disabled.
const money = v => 'RM ' + Number(v || 0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})

export default function JIMSPaymentModeSelector({voucher,mode,onModeChange,onDraftChanged,disabled=false}){
  const [balance,setBalance]=useState(null)
  const [ledger,setLedger]=useState([])
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [amount,setAmount]=useState('')
  const [reason,setReason]=useState('')
  const requestKey=useRef(crypto.randomUUID())

  useEffect(()=>{
    let alive=true
    setLoading(true);setError('')
    Promise.all([
      supabase.from('pv_payment_balances_v2')
        .select('approved_amount,total_paid,outstanding_amount,available_for_next_initiation')
        .eq('voucher_id',voucher.id).single(),
      supabase.from('pv_payment_transactions')
        .select('id,installment_no,requested_amount,status,created_by')
        .eq('voucher_id',voucher.id)
        .order('installment_no',{ascending:false}).limit(100)
    ]).then(([b,t])=>{
      if(!alive)return
      if(b.error||t.error||!b.data){
        setError(b.error?.message||t.error?.message||'Payment balance unavailable')
        setBalance(null);setLedger([])
      }else{
        setBalance(b.data);setLedger(t.data||[])
      }
      setLoading(false)
    }).catch(e=>{if(alive){setError(e.message);setLoading(false)}})
    return ()=>{alive=false}
  },[voucher.id,voucher.updated_at])

  const partialLocked=voucher.payment_mode==='partial'
  const approved=Number(balance?.approved_amount??voucher.amount??0)
  const paid=Number(balance?.total_paid??0)
  const outstanding=Number(balance?.outstanding_amount??approved)
  const available=Number(balance?.available_for_next_initiation??0)
  const active=ledger.find(t=>['draft','initiated','returned','approved'].includes(t.status))
  const cents=Math.round(Number(amount)*100)
  const maxCents=Math.min(Math.round(available*100),Math.round(outstanding*100))
  const valid=/^[0-9]+(?:\.[0-9]{1,2})?$/.test(amount.trim()) &&
    Number.isSafeInteger(cents) && cents>0 && cents<=maxCents &&
    (partialLocked||cents<maxCents)
  const createEnabled=mode==='partial'&&!loading&&!error&&!busy&&!disabled&&
    !active&&valid&&voucher.payment_status==='pending_payment'
  const cancelEnabled=partialLocked&&active?.status==='draft'&&!loading&&!error&&
    !busy&&!disabled&&reason.trim().length>0&&reason.trim().length<=1000

  async function reloadVoucher(){
    const {data,error:e}=await supabase.from('payment_vouchers')
      .select('*').eq('id',voucher.id).single()
    if(e)throw e
    await onDraftChanged?.(data)
    return data
  }
  async function createDraft(){
    if(!createEnabled)return
    if(!window.confirm('Create partial-payment DRAFT for '+voucher.pv_number+
       ' — '+money(cents/100)+'?\nNo bank payment will be initiated.'))return
    setBusy(true);setError('');setNotice('')
    try{
      const {data,error:e}=await supabase.rpc('jims_v2_create_payment_draft_v1',{
        p_voucher_id:voucher.id,p_requested_amount:cents/100,
        p_request_key:requestKey.current,p_expected_updated_at:voucher.updated_at
      })
      if(e)throw e
      if(data?.status!=='draft'||data?.voucher_id!==voucher.id||!data?.id)
        throw new Error('Draft creation not confirmed by database')
      await reloadVoucher()
      requestKey.current=crypto.randomUUID()
      setAmount('')
      onModeChange('partial')
      setNotice('Partial installment draft saved. No payment has been initiated.')
    }catch(e){setError((e.message||'Could not confirm draft')+
      '. Reopen the PV before retrying if the result is uncertain.')}
    finally{setBusy(false)}
  }
  async function cancelDraft(){
    if(!cancelEnabled)return
    if(!window.confirm('Cancel installment draft #'+active.installment_no+
      '?\nReason: '+reason.trim()))return
    setBusy(true);setError('');setNotice('')
    try{
      const {data,error:e}=await supabase.rpc('jims_v2_cancel_payment_draft_v1',{
        p_transaction_id:active.id,p_reason:reason.trim(),
        p_expected_updated_at:voucher.updated_at
      })
      if(e)throw e
      if(data?.status!=='voided'||data?.id!==active.id)
        throw new Error('Cancellation not confirmed')
      const updated=await reloadVoucher()
      if(updated.payment_mode==='full')onModeChange('full')
      setReason('')
      setNotice('Draft cancelled with audit history preserved.')
    }catch(e){setError(e.message||'Cancellation failed')}
    finally{setBusy(false)}
  }

  return <section className="jims-pay-mode" aria-label="Payment mode selection">
    <div className="jims-pay-mode-heading"><div>
      <small>STEP 57B.2 · PAYMENT PROCESS</small>
      <h3>Choose Payment Mode</h3>
    </div><span className="jims-pay-mode-approved">Fully Approved PV</span></div>
    <div className="jims-pay-mode-metrics">
      <div><span>Approved Amount</span><strong>{money(approved)}</strong></div>
      <div><span>Paid So Far</span><strong>{loading||error?'—':money(paid)}</strong></div>
      <div><span>Outstanding Balance</span><strong>{loading||error?'—':money(outstanding)}</strong></div>
    </div>
    {!loading&&!error&&<div className="jims-pay-mode-progress" role="progressbar"
      aria-label="Payment progress" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={approved>0?Math.round(Math.max(0,Math.min(100,paid/approved*100))):0}>
      <div style={{width:(approved>0?Math.max(0,Math.min(100,paid/approved*100)):0)+'%'}}/>
    </div>}
    <div className="jims-pay-mode-options" role="radiogroup" aria-label="Payment type">
      <label className={'jims-pay-mode-option'+(mode==='full'?' selected':'')}>
        <input type="radio" name={'jims-pay-mode-'+voucher.id} value="full"
          checked={mode==='full'} disabled={disabled||busy||partialLocked}
          onChange={()=>onModeChange('full')}/>
        <span><strong>Full Payment</strong><small>Existing full-payment workflow.</small></span>
      </label>
      <label className={'jims-pay-mode-option'+(mode==='partial'?' selected':'')}>
        <input type="radio" name={'jims-pay-mode-'+voucher.id} value="partial"
          checked={mode==='partial'} disabled={disabled||busy}
          onChange={()=>onModeChange('partial')}/>
        <span><strong>Partial Payment</strong><small>Manage installment drafts and outstanding balance.</small></span>
      </label>
    </div>
    {mode==='full'&&<p className="jims-pay-mode-note">
      Full Payment selected. Existing initiation proof and Finance Manager review remain unchanged.
    </p>}
    {mode==='partial'&&<div className="jims-pay-mode-partial">
      {partialLocked&&<p className="jims-pay-mode-note"><strong>Partial mode locked.</strong> Legacy Full Payment is disabled for this PV.</p>}
      <div className="jims-pay-mode-fields">
        <label htmlFor="jims-next-installment">Next Installment (RM)
          <input id="jims-next-installment" value={amount} inputMode="decimal"
            placeholder="e.g. 40.00"
            disabled={disabled||busy||loading||Boolean(error)||Boolean(active)}
            onChange={e=>setAmount(e.target.value)}/>
        </label>
        <div className="jims-pay-mode-projected"><span>Projected outstanding after settlement</span>
          <strong>{loading||error?'—':money(valid?outstanding-cents/100:outstanding)}</strong>
        </div>
      </div>
      {loading&&<p className="jims-pay-mode-note">Loading live payment ledger…</p>}
      {!loading&&!error&&<p className="jims-pay-mode-note">
        Available for next installment: {money(available)}.
        {!!amount&&!valid&&!active&&' Enter an amount above RM0 and within the available balance.'}
      </p>}
      {!active&&<button type="button" className="jims-partial-draft-button"
        disabled={!createEnabled} onClick={createDraft}>
        {busy?'Saving…':'Create Partial Payment Draft'}
      </button>}
      {active&&<div className="jims-partial-draft-current">
        <strong>Installment #{active.installment_no}: {money(active.requested_amount)}</strong>
        <span>Status: {active.status.toUpperCase()}</span>
        {active.status==='draft'&&<div className="jims-partial-draft-cancel">
          <label htmlFor="jims-cancel-reason">Cancellation Reason (audit required)
            <input id="jims-cancel-reason" value={reason} maxLength={1000}
              disabled={disabled||busy} placeholder="Enter reason"
              onChange={e=>setReason(e.target.value)}/>
          </label>
          <button type="button" disabled={!cancelEnabled}
            onClick={cancelDraft}>Cancel Draft</button>
        </div>}
      </div>}
      {!!ledger.length&&<div className="jims-partial-draft-list">
        <strong>Installment History</strong>
        {ledger.map(t=><div key={t.id}>
          <span>#{t.installment_no} · {t.status.toUpperCase()}</span>
          <strong>{money(t.requested_amount)}</strong>
        </div>)}
      </div>}
      <p className="jims-pay-mode-locked">Drafts only at Step 57B.2.
        Upload proof, Finance Manager approval and Paid settlement stay locked until Step 57B.3.
      </p>
    </div>}
    {!!error&&<p className="jims-pay-mode-error" role="alert">{error}</p>}
    {!!notice&&<p className="jims-partial-draft-notice" role="status">{notice}</p>}
  </section>
}
