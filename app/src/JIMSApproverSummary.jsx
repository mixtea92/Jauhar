// JIMS STEP57C5 — UNIVERSAL ACTUAL APPROVER SUMMARY
// HOD / Finance Manager / CEO / BOD ONLY. All decisions use existing secure RPCs.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './JIMSApproverSummary.css'

const rm = x => 'RM '+Number(x||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})
const show = x => typeof x==='string'&&x.trim()?x.trim():'Not Assigned'
const branch = x => ({GP:'Gelang Patah',KM:'Kota Masai',PM:'Pulai Mutiara',TD:'Taman Daya'})[x]||show(x)
const approvedRpcs = new Set([
  'hod_decide_department_pv_v1',
  'manager_decide_pv',
  'finance_manager_decide_department_pv_v2',
  'finance_manager_decide_jr_v1',
  'finance_manager_decide_t01_t02_v1',
  'finance_manager_decide_t04_v1',
  'finance_manager_decide_t08_v1',
  'ceo_decide_department_pv_v2',
  'ceo_decide_jr_v1',
  'ceo_decide_t04_v1',
  'ceo_decide_t08_v1',
  'ceo_decide_pv',
  'bod_decide_department_pv_v2',
  'bod_decide_jr_v1',
  'bod_decide_t08_v1',
  'bod_decide_pv'
])
function titleFor(profile) {
  if(profile?.role==='ceo') return 'CEO'
  if(profile?.role==='bod') return 'BOD'
  if(profile?.role==='manager'&&profile?.department==='Finance') return 'Finance Manager'
  if(profile?.role==='manager'&&profile?.department) return 'HOD'
  return null
}
const stageName = x=>({
  pending_ap_finance:'AP Finance Verification',
  pending_finance_manager:'Finance Manager',
  pending_ceo:'CEO',
  pending_bod:'BOD',
  fully_approved:'Fully Approved'
})[x]||show(x)

export default function JIMSApproverSummary({
  profile,onOpenVoucher,onDecisionRecorded,refreshKey=0
}){
  const userTitle=titleFor(profile)
  const [rows,setRows]=useState([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(null)
  const [reasonFor,setReasonFor]=useState(null)
  const [reason,setReason]=useState('')

  const load=useCallback(async()=>{
    setLoading(true);setError('')
    try{
      const {data,error:e}=await supabase.rpc('jims_actual_approver_summary_v1')
      if(e)throw e
      if(!data||!Array.isArray(data.rows))throw new Error('Unexpected approval response')
      setRows(data.rows)
    }catch(e){
      setRows([]);setError(e.message||'Failed to load your approvals')
    }finally{setLoading(false)}
  },[])

  useEffect(()=>{
    if(userTitle&&profile?.is_active===true)load()
  },[userTitle,profile?.is_active,refreshKey,load])

  const total=useMemo(()=>rows.reduce((s,v)=>s+Number(v.amount||0),0),[rows])
  if(!userTitle||profile?.is_active!==true)return null

  async function decide(v,decision){
    if(busy||!['approve','return','reject'].includes(decision))return
    if(!approvedRpcs.has(v.decision_rpc)){
      setError('Unrecognised approval route. View Details instead.');return
    }
    if(decision==='approve'&&(!v.can_approve||(v.jr_meeting_required&&!v.jr_meeting_ready))){
      setError('Approval requires a completed JR meeting. Open View Details.');return
    }
    if(decision==='return'&&!v.can_return)return
    if(decision==='reject'&&!v.can_reject)return
    if(decision!=='approve'&&(reasonFor?.id!==v.id||reasonFor?.decision!==decision)){
      setReasonFor({id:v.id,decision});setReason('');setError('');return
    }
    const remarks=decision==='approve'?null:reason.trim()
    if(decision!=='approve'&&(!remarks||remarks.length>2000)){
      setError('Reason is mandatory for Return / Reject (maximum 2,000 characters).');return
    }
    const outcome=decision==='approve'?stageName(v.approved_next_status):
      decision==='return'?'Returned for Amendment':'Rejected Permanently'
    if(!window.confirm(
      decision.toUpperCase()+' '+v.pv_number+'?\n\n'+
      'Purpose: '+show(v.purpose)+'\n'+
      'Payee: '+show(v.payee_name)+'\n'+
      'Amount: '+rm(v.amount)+'\n'+
      'Branch: '+branch(v.branch)+'\n'+
      'Cost Center: '+show(v.cost_center)+'\n'+
      'Result: '+outcome+'\n'+
      (remarks?'Reason: '+remarks+'\n':'')+
      '\nApproval does NOT mean payment has been made. JIMS will record this decision.'
    ))return
    setBusy(v.id);setError('');setNotice('')
    try{
      const {data,error:e}=await supabase.rpc(v.decision_rpc,{
        p_voucher_id:v.id,
        p_decision:decision,
        p_expected_updated_at:v.updated_at,
        p_remarks:remarks
      })
      if(e)throw e
      const expected=decision==='approve'?v.approved_next_status:decision==='return'?'returned':'rejected'
      if(!expected||data?.id!==v.id||data.status!==expected){
        throw new Error('Result was not confirmed. Refresh and reopen the voucher.')
      }
      setNotice(v.pv_number+' — '+stageName(expected)+'. Decision recorded in audit.')
      setReasonFor(null);setReason('')
      await load()
      await onDecisionRecorded?.()
    }catch(e){
      setError('Decision failed: '+(e.message||'Unknown error')+'. Refresh before retrying.')
    }finally{setBusy(null)}
  }

  return <section className="panel jims-approval-summary" aria-label="My Approval Summary">
    <div className="jims-approval-head">
      <div>
        <small className="jims-approval-overline">{userTitle.toUpperCase()} · ACTUAL APPROVAL AUTHORITY</small>
        <h2>My Approval Summary</h2>
        <p className="muted">Review here, or choose View Details for invoices, JR and approval history.</p>
      </div>
      <button type="button" className="btn" disabled={loading||!!busy} onClick={load}>
        {loading?'Loading...':'Refresh'}
      </button>
    </div>
    {!error&&<div className="jims-approval-metrics">
      <div><small>Awaiting My Decision</small><strong>{loading?'—':rows.length}</strong></div>
      <div><small>Total Awaiting Approval</small><strong>{loading?'—':rm(total)}</strong></div>
    </div>}
    {error&&<p role="alert" className="error">{error}</p>}
    {notice&&<p role="status" className="pv-success">{notice}</p>}
    <div className="table-wrap jims-approval-scroll">
      <table className="jims-approval-table">
        <thead><tr>
          <th>PV / Tier</th><th>Purpose / Payee</th>
          <th>Department / Subdept</th><th>Branch</th>
          <th>Cost Center</th><th>Amount</th><th>Action</th>
        </tr></thead>
        <tbody>
          {rows.map(v=>{
            const pending=reasonFor?.id===v.id
            const blocked=v.jr_meeting_required&&!v.jr_meeting_ready
            return <tr key={v.id}>
              <td><strong className="jims-approval-number">{v.pv_number}</strong>
                <div className="jims-approval-muted">{show(v.tier)}</div></td>
              <td><strong>{show(v.purpose)}</strong>
                <div className="jims-approval-muted">Payee: {show(v.payee_name)}</div>
                <div className="jims-approval-muted">Next if approved: {stageName(v.approved_next_status)}</div>
              </td>
              <td><strong>{show(v.origin_department)}</strong> <small>(Origin)</small>
                <div className="jims-approval-muted">Subdept: {show(v.requester_subdepartment)}</div>
                <div className="jims-approval-muted">Charge-to: {show(v.charge_department)}</div>
                {v.charge_subdepartment&&
                  <div className="jims-approval-muted">Charge Subdept: {v.charge_subdepartment}</div>}
              </td>
              <td>{branch(v.branch)}</td>
              <td><strong>{show(v.cost_center)}</strong>
                {v.budget_code&&<div className="jims-approval-muted">Budget: {v.budget_code}</div>}
              </td>
              <td className="jims-approval-money">{rm(v.amount)}</td>
              <td>
                <div className="jims-approval-actions">
                  <button type="button" className="jims-approval-view"
                    disabled={!!busy} onClick={()=>onOpenVoucher(v.id)}>View Details</button>
                  <button type="button" className="jims-approval-approve"
                    disabled={!!busy||!v.can_approve||blocked}
                    title={blocked?'Required JR meeting must be recorded in View Details first':'Approve and continue workflow'}
                    onClick={()=>decide(v,'approve')}>{busy===v.id?'Processing...':'Approve'}</button>
                  <button type="button" className="jims-approval-return"
                    disabled={!!busy||!v.can_return}
                    onClick={()=>decide(v,'return')}>Return</button>
                  <button type="button" className="jims-approval-reject"
                    disabled={!!busy||!v.can_reject}
                    onClick={()=>decide(v,'reject')}>Reject</button>
                </div>
                {blocked&&<div className="jims-approval-warning">
                  JR meeting required before final Approve · View Details
                </div>}
                {pending&&<div className="jims-approval-reason">
                  <label htmlFor={'jims-approval-reason-'+v.id}>
                    {reasonFor.decision==='return'?'Return':'Reject'} reason *</label>
                  <textarea id={'jims-approval-reason-'+v.id}
                    value={reason} disabled={!!busy} maxLength={2000} rows={2}
                    onChange={e=>setReason(e.target.value)}
                    placeholder="Enter reason for this decision" />
                  <div><button type="button" className="jims-approval-confirm"
                    disabled={!reason.trim()||!!busy}
                    onClick={()=>decide(v,reasonFor.decision)}>Confirm</button>
                    <button type="button" className="jims-approval-cancel"
                      disabled={!!busy} onClick={()=>{setReasonFor(null);setReason('')}}>Cancel</button></div>
                </div>}
              </td>
            </tr>
          })}
          {loading&&!rows.length&&<tr><td colSpan={7} className="jims-approval-empty">Loading approvals...</td></tr>}
          {!loading&&!error&&!rows.length&&<tr><td colSpan={7} className="jims-approval-empty">
            No PV awaiting your approval.</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="jims-approval-footnote">
      Only actual authority approvals are listed (delegated authority remains in Delegation Workspace).
      Current-round checks, independent approvals, JR evidence and audit trail remain enforced in Supabase.
      Maximum 300 items.
    </p>
  </section>
}
