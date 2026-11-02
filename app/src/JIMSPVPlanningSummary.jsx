// UAT-FIX-08: PV-level planning readout; FM can now review dates during pending Finance Manager.
import JIMSFMDateReview from './JIMSFMDateReview'
const dateMY = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''))
  return match ? match[3]+'/'+match[2]+'/'+match[1] : '—'
}
export default function JIMSPVPlanningSummary({data,loading=false,error='',onManagePlanning=null,awaitingFinalApproval=false,pendingFMReview=false,voucherId=null,onDatesSaved=null}) {
  return <section aria-label="Payment Planning" style={{border:'1px solid #9f8c5a88',
    borderRadius:10,padding:'12px 14px',margin:'14px 0',background:'var(--jims-card-bg,transparent)',color:'inherit'}}>
    <strong style={{color:'#d9b45c'}}>PAYMENT PLANNING</strong>
    {loading ? <p className="muted">Loading payment dates...</p> :
      error ? <p className="error" role="alert">Unable to load payment dates: {error}</p> :
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginTop:10}}>
        <div><small className="muted">Supplier Due Date</small>
          <div><strong>{dateMY(data?.supplier_due_date)}</strong></div>
          <small className="muted">{data?.fm_due_validated?'FM Validated':'Pending FM Validation'}</small>
        </div>
        <div><small className="muted">AP Proposed Payment Date</small>
          <div><strong>{dateMY(data?.proposed_payment_date)}</strong></div>
        </div>
        <div><small className="muted">FM-Approved Payment Date</small>
          <div><strong>{dateMY(data?.fm_approved_payment_date)}</strong></div>
        </div>
      </div>}
    <small className="muted" style={{display:'block',marginTop:9}}>
      Dates apply to this PV, not individual invoice lines. These are not actual payment dates.
    </small>
    {pendingFMReview && !loading && !error && voucherId &&
      <JIMSFMDateReview voucherId={voucherId} data={data} onSaved={onDatesSaved}/>}
    {awaitingFinalApproval && !pendingFMReview && <p className="muted">
      Payment Planning can be reviewed here. Final schedule management remains under Finance Manager.
    </p>}
    {onManagePlanning && <button type="button" className="btn" style={{marginTop:10}}
      onClick={onManagePlanning}>FM — Accept / Change Payment Date</button>}
  </section>
}
