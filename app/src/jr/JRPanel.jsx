import { useState } from 'react'

// JAUHAR JR document and offline-meeting UI. Authentication and role decisions
// remain authoritative in Supabase RPCs, not here.
export default function JRPanel({voucher,documents,meetings,links,canUpload,
  canConfirmMeeting,uploading,opening,savingMeeting,message,onUpload,onOpen,onMeeting}) {
  const [reference,setReference] = useState('')
  const [date,setDate] = useState('')
  const [attested,setAttested] = useState(false)
  const isReturned = voucher.status === 'returned'
  const finalRole = ['T03','T07'].includes(voucher.financial_tier) ? 'ceo':'bod'
  const recorded = meetings.find(m => m.approval_round===voucher.approval_round && m.decision_tier===finalRole)
  const latest = documents[0]
  return (
    <div style={{marginTop:20}}>
      <div className="pv-section">JUSTIFICATION REPORT (JR) — REQUIRED PDF</div>
      <p className="pv-notice">Private JR PDFs are versioned and stored for audit. Uploading a JR does not mean a meeting has approved it. Final approval requires a recorded offline meeting reference.</p>
      {latest ? <p><strong>Latest JR:</strong> Version {latest.version_num} — {latest.original_filename}
        {' '}({Math.ceil(latest.size_bytes/1024)} KB)</p>
        : <p style={{color:'#b42318',fontWeight:700}}>JR PDF missing. Submit is blocked.</p>}
      {documents.map(doc => <div key={doc.id} style={{marginBottom:8}}>
        <button type="button" className="btn" style={{padding:'6px 12px'}}
          disabled={opening} onClick={()=>onOpen(doc)}>
          {opening ? 'Opening...' : `View JR PDF v${doc.version_num}`}
        </button>{' '}
        {links[doc.id] && <a target="_blank" rel="noopener noreferrer" href={links[doc.id]}>Open signed PDF (60s)</a>}
      </div>)}
      {canUpload && <div className="pv-field" style={{marginTop:10}}>
        <label htmlFor="pv-jr-file">{isReturned ? 'Upload revised JR PDF (if justification changed)' : 'Upload JR PDF *'}</label>
        <input id="pv-jr-file" type="file" accept=".pdf,application/pdf" disabled={uploading}
          onChange={event=>{const f=event.target.files?.[0];event.target.value='';if(f)onUpload(f)}} />
        <small>PDF only · maximum 5 MB · original versions are retained</small>
      </div>}
      {recorded && <p className="pv-notice"><strong>Offline meeting evidence recorded:</strong>{' '}
        {recorded.meeting_reference} — {recorded.meeting_date} (Round {recorded.approval_round}).</p>}
      {canConfirmMeeting && !recorded && <div style={{border:'1px solid #ddc481',borderRadius:8,padding:12,marginTop:14}}>
        <strong>Final Approver — Record Actual Offline JR Meeting</strong>
        <p className="muted">Only record a real meeting decision. This evidence does not itself approve the Payment Voucher.</p>
        <div className="pv-grid">
          <div className="pv-field"><label htmlFor="jr-meeting-ref">Meeting Reference *</label>
            <input id="jr-meeting-ref" maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}
              placeholder="Approved meeting minute/reference" /></div>
          <div className="pv-field"><label htmlFor="jr-meeting-date">Meeting Date *</label>
            <input type="date" id="jr-meeting-date" value={date} onChange={e=>setDate(e.target.value)} /></div>
        </div>
        <label style={{display:'flex',gap:8,margin:'12px 0'}}>
          <input type="checkbox" checked={attested} onChange={e=>setAttested(e.target.checked)} />
          I confirm this JR received actual offline meeting approval.
        </label>
        <button type="button" className="btn" disabled={savingMeeting || !attested || reference.trim().length<3 || !date}
          onClick={async()=>{await onMeeting(reference.trim(),date);setAttested(false)}}>
          {savingMeeting ? 'Saving...' : 'Record Offline Approval Evidence'}</button>
      </div>}
      {message && <p className="pv-notice" role="status">{message}</p>}
    </div>
  )
}
