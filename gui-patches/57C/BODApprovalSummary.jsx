// JIMS STEP 57C4 — ACTUAL BOD only; protected decision RPCs unchanged.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './BODApprovalSummary.css'

const money = x => 'RM ' + Number(x || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const name = x => typeof x === 'string' && x.trim() ? x.trim() : 'Not Assigned'
const branches = { GP: 'Gelang Patah', KM: 'Kota Masai', PM: 'Pulai Mutiara', TD: 'Taman Daya' }
const allowedRpc = new Set(['bod_decide_department_pv_v2','bod_decide_jr_v1','bod_decide_t08_v1','bod_decide_pv'])

export default function BODApprovalSummary({ profile, onOpenVoucher, onDecisionRecorded }) {
  const [rows,setRows] = useState([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [busyId,setBusyId] = useState(null)
  const [reasonFor,setReasonFor] = useState(null)
  const [reason,setReason] = useState('')

  const reload = useCallback(async () => {
    setLoading(true);setError('')
    try {
      const {data,error:e} = await supabase.rpc('jims_bod_approval_summary_v1')
      if(e)throw e
      if(!data || !Array.isArray(data.rows))throw new Error('Invalid BOD queue result')
      setRows(data.rows)
    }catch(e){
      setError(e.message || 'Unable to load BOD approvals.');setRows([])
    }finally{setLoading(false)}
  },[])

  useEffect(() => {
    if(profile?.role==='bod' && profile?.is_active===true)reload()
  },[profile?.role,profile?.is_active,reload])

  const count=rows.length
  const total=useMemo(()=>rows.reduce((s,v)=>s+Number(v.amount||0),0),[rows])
  if(profile?.role!=='bod' || profile?.is_active!==true)return null

  async function decide(v,action){
    if(busyId || !['approve','return','reject'].includes(action))return
    if(!allowedRpc.has(v.decision_rpc)){
      setError('Unknown BOD approval route. Use View Details.');return
    }
    if((action==='approve' && (!v.can_approve || (v.jr_required && !v.jr_meeting_ready))) ||
       (action==='return' && !v.can_return) || (action==='reject' && !v.can_reject))return
    if(action!=='approve' && (reasonFor?.id!==v.id || reasonFor?.action!==action)){
      setReasonFor({id:v.id,action});setReason('');setError('');return
    }
    const remarks=action==='approve'?null:reason.trim()
    if(action!=='approve' && (!remarks || remarks.length>2000)){
      setError('Return or Reject requires a reason (maximum 2,000 characters).');return
    }
    if(!window.confirm(
      action.toUpperCase()+' '+v.pv_number+'?\n\n'+
      'Purpose: '+name(v.purpose)+'\n'+
      'Payee: '+name(v.payee_name)+'\n'+
      'Amount: '+money(v.amount)+'\n'+
      'Branch: '+(branches[v.branch] || name(v.branch))+'\n'+
      'Cost Center: '+name(v.cost_center)+'\n'+
      (remarks?'Reason: '+remarks+'\n':'Final approval does not mean bank payment.\n')+
      '\nThis decision is recorded in the approval audit trail.'
    ))return
    setBusyId(v.id);setError('');setNotice('')
    try{
      const {data,error:e}=await supabase.rpc(v.decision_rpc,{
        p_voucher_id:v.id,p_decision:action,
        p_expected_updated_at:v.updated_at,p_remarks:remarks
      })
      if(e)throw e
      const expected=action==='approve'?'fully_approved':action==='return'?'returned':'rejected'
      if(data?.id!==v.id || data.status!==expected)throw new Error('Decision not confirmed. Refresh the queue.')
      setNotice(v.pv_number+' — '+expected.replaceAll('_',' ')+'. BOD decision recorded.')
      setReasonFor(null);setReason('')
      await reload()
      await onDecisionRecorded?.()
    }catch(e){setError('Decision failed: '+(e.message||'Unknown error')+'. Refresh before retrying.')}
    finally{setBusyId(null)}
  }

  return <section className="panel jims-bod-summary" aria-label="BOD Approval Summary">
    <header className="jims-bod-heading">
      <div><small className="jims-bod-eyebrow">BOD · ACTUAL AUTHORITY ONLY</small>
        <h2>BOD Approval Summary</h2>
        <p className="muted">Key facts first. View Details is optional; approval safeguards remain enforced.</p>
      </div>
      <button type="button" className="btn" disabled={loading||!!busyId} onClick={reload}>
        {loading?'Loading...':'Refresh'}
      </button>
    </header>
    {!error && <div className="jims-bod-stats">
      <div><small>Pending BOD Decisions</small><strong>{loading?'—':count}</strong></div>
      <div><small>Total Pending Approval</small><strong>{loading?'—':money(total)}</strong></div>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="pv-success" role="status">{notice}</p>}
    <div className="table-wrap jims-bod-scroll"><table className="jims-bod-table">
      <thead><tr>
        <th>PV / Tier</th><th>Purpose / Payee</th><th>Department / Subdept</th>
        <th>Branch</th><th>Cost Center</th><th>Amount</th><th>Actions</th>
      </tr></thead>
      <tbody>
        {rows.map(v=>{
          const blocked=!!v.jr_required && !v.jr_meeting_ready
          const pending=reasonFor?.id===v.id
          return <tr key={v.id}>
            <td><strong className="jims-bod-number">{v.pv_number}</strong>
              <div className="jims-bod-muted">{name(v.financial_tier)}</div></td>
            <td><strong>{name(v.purpose)}</strong>
              <div className="jims-bod-muted">Payee: {name(v.payee_name)}</div>
              {v.invoice_count>1&&<div className="jims-bod-muted">{v.invoice_count} invoice lines</div>}</td>
            <td><strong>{name(v.origin_department)}</strong> <span className="jims-bod-muted">(Origin)</span>
              <div className="jims-bod-muted">Subdept: {name(v.requester_subdepartment)}</div>
              <div className="jims-bod-muted">Charge-to: {name(v.charge_department)}</div>
              {v.charge_subdepartment&&<div className="jims-bod-muted">Charge Subdept: {v.charge_subdepartment}</div>}</td>
            <td>{branches[v.branch]||name(v.branch)}</td>
            <td><strong>{name(v.cost_center)}</strong>
              {v.budget_code&&<div className="jims-bod-muted">Budget: {v.budget_code}</div>}</td>
            <td className="jims-bod-amount">{money(v.amount)}</td>
            <td><div className="jims-bod-actions">
              <button type="button" className="jims-bod-view" disabled={!!busyId}
                onClick={()=>onOpenVoucher(v.id)}>View Details</button>
              <button type="button" className="jims-bod-approve"
                disabled={!!busyId||!v.can_approve||blocked}
                title={blocked?'Record the required JR meeting in View Details first':'Approve BOD final'}
                onClick={()=>decide(v,'approve')}>{busyId===v.id?'Processing...':'Approve'}</button>
              <button type="button" className="jims-bod-return"
                disabled={!!busyId||!v.can_return} onClick={()=>decide(v,'return')}>Return</button>
              <button type="button" className="jims-bod-reject"
                disabled={!!busyId||!v.can_reject} onClick={()=>decide(v,'reject')}>Reject</button>
            </div>
            {blocked&&<div className="jims-bod-warning">JR meeting evidence required · View Details</div>}
            {pending&&<div className="jims-bod-reason">
              <label htmlFor={'bod-reason-'+v.id}>
                {reasonFor.action==='return'?'Return':'Reject'} reason (required)</label>
              <textarea id={'bod-reason-'+v.id} rows={2} maxLength={2000}
                placeholder="State reason..." value={reason} disabled={!!busyId}
                onChange={e=>setReason(e.target.value)} />
              <div><button type="button" className="jims-bod-confirm"
                disabled={!!busyId||!reason.trim()}
                onClick={()=>decide(v,reasonFor.action)}>Confirm</button>
                <button type="button" className="jims-bod-cancel" disabled={!!busyId}
                  onClick={()=>{setReasonFor(null);setReason('')}}>Cancel</button></div>
            </div>}
            </td>
          </tr>
        })}
        {!loading&&!error&&rows.length===0&&<tr><td colSpan={7} className="jims-bod-empty">
          No Pending BOD approvals for your account.</td></tr>}
        {loading&&!rows.length&&<tr><td colSpan={7} className="jims-bod-empty">Loading...</td></tr>}
      </tbody>
    </table></div>
    <p className="jims-bod-footnote">
      Final approval ≠ payment. JR evidence, current approval round, BOD authority,
      mandatory reasons and audit history are enforced by Supabase. Up to 300 PVs.
    </p>
  </section>
}
