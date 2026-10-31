import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// JIMS Step 57A. Read-only preview, deliberately NO partial-payment writes.
// Step 57B must implement server-side, row-locked installment RPCs before
// any partial payment can be initiated.
const money = value => 'RM ' + Number(value || 0).toLocaleString('en-MY', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
})

export default function JIMSPaymentModeSelector({ voucher, mode, onModeChange, disabled = false }) {
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [partialAmount, setPartialAmount] = useState('')

  useEffect(() => {
    let current = true
    setBalance(null)
    setLoading(true)
    setError('')
    setPartialAmount('')
    if (!voucher?.id) {
      setLoading(false)
      return () => { current = false }
    }
    supabase.from('pv_payment_balances_v2')
      .select('approved_amount,total_paid,reserved_amount,outstanding_amount,available_for_next_initiation,active_installments,legacy_payment_status')
      .eq('voucher_id', voucher.id)
      .single()
      .then(({ data, error: readError }) => {
        if (!current) return
        if (readError || !data) {
          setError(readError?.message || 'Payment balance is unavailable.')
        } else {
          setBalance(data)
        }
        setLoading(false)
      })
    return () => { current = false }
  }, [voucher?.id, voucher?.updated_at])

  if (!voucher) return null
  const approved = Number(balance?.approved_amount ?? voucher.amount ?? 0)
  const paid = Number(balance?.total_paid ?? 0)
  const outstanding = Number(balance?.outstanding_amount ?? approved)
  const available = Number(balance?.available_for_next_initiation ?? 0)
  const progress = approved > 0 ? Math.max(0, Math.min(100, (paid / approved) * 100)) : 0
  const amountIsFormatted = /^\d+(?:\.\d{1,2})?$/.test(partialAmount.trim())
  const enteredCents = Math.round(Number(partialAmount) * 100)
  const validPartial = amountIsFormatted && Number.isSafeInteger(enteredCents) &&
    enteredCents > 0 && enteredCents < Math.round(available * 100) &&
    enteredCents < Math.round(outstanding * 100)
  const projected = validPartial ? outstanding - enteredCents / 100 : outstanding

  return (
    <section className="jims-pay-mode" aria-label="Payment mode selection">
      <div className="jims-pay-mode-heading">
        <div>
          <small>STEP 57A · PAYMENT PROCESS</small>
          <h3>Choose Payment Mode</h3>
        </div>
        <span className="jims-pay-mode-approved">Fully Approved PV</span>
      </div>
      <div className="jims-pay-mode-metrics">
        <div><span>Approved Amount</span><strong>{money(approved)}</strong></div>
        <div><span>Paid So Far</span><strong>{loading ? 'Loading…' : error ? '—' : money(paid)}</strong></div>
        <div><span>Outstanding Balance</span><strong>{loading ? 'Loading…' : error ? '—' : money(outstanding)}</strong></div>
      </div>
      {!loading && !error && <div className="jims-pay-mode-progress" role="progressbar"
        aria-label="Payment progress" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(progress)}>
        <div style={{width: progress + '%'}} />
      </div>}
      <div className="jims-pay-mode-options" role="radiogroup" aria-label="Payment type">
        <label className={'jims-pay-mode-option' + (mode === 'full' ? ' selected' : '')}>
          <input type="radio" name={'jims-pay-mode-' + voucher.id} value="full"
            checked={mode === 'full'} disabled={disabled} onChange={() => onModeChange('full')}/>
          <span><strong>Full Payment</strong><small>Pay the entire outstanding amount using the existing verified process.</small></span>
        </label>
        <label className={'jims-pay-mode-option' + (mode === 'partial' ? ' selected' : '')}>
          <input type="radio" name={'jims-pay-mode-' + voucher.id} value="partial"
            checked={mode === 'partial'} disabled={disabled} onChange={() => onModeChange('partial')}/>
          <span><strong>Partial Payment</strong><small>Plan an installment and view the remaining balance.</small></span>
        </label>
      </div>
      {mode === 'full' && <p className="jims-pay-mode-note">
        Full Payment selected. Continue with the existing initiation proof, Finance Manager review and final PDF receipt below.
      </p>}
      {mode === 'partial' && <div className="jims-pay-mode-partial">
        <div className="jims-pay-mode-fields">
          <label htmlFor="jims-planned-installment">Planned Partial Payment (RM)
            <input id="jims-planned-installment" value={partialAmount}
              inputMode="decimal" placeholder="e.g. 4000.00"
              disabled={disabled || loading || Boolean(error)}
              onChange={e => setPartialAmount(e.target.value)}/>
          </label>
          <div className="jims-pay-mode-projected"><span>Remaining after this installment</span>
            <strong>{error || loading ? '—' : money(projected)}</strong>
          </div>
        </div>
        {loading && <p className="jims-pay-mode-note">Loading secure balance data…</p>}
        {error && <p className="jims-pay-mode-error" role="alert">Unable to read the payment balance: {error}</p>}
        {!loading && !error && <p className="jims-pay-mode-note">
          Available to plan: {money(available)}.
          {partialAmount && !validPartial && ' Enter an amount greater than RM0 and less than the available balance.'}
        </p>}
        <p className="jims-pay-mode-locked" role="status">
          Partial Payment is preview-only in Step 57A. No proof upload or payment submission is allowed until Step 57B secure transaction processing is installed.
        </p>
      </div>}
    </section>
  )
}
