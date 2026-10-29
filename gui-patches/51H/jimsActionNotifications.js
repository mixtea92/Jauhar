// JIMS Step 51H — read-only, role-scoped ACTION notifications.
// Counts are NOT total records. No mutation, status change or new privilege.
import {supabase} from './lib/supabase'

const exact = async (makeQuery) => {
  const {count,error} = await makeQuery(
    supabase.from('payment_vouchers').select('id',{count:'exact',head:true})
      .is('archived_at',null)
  )
  if(error) throw error
  return count ?? 0
}
const done = result => Number.isSafeInteger(result) && result>0 ? result : 0

export async function fetchJIMSActionNotifications(profile) {
  const unknown = {pv:null,payment:null,cv:null}
  if(!profile?.is_active || profile.role==='non_executive' || profile.role==='system_admin') {
    return {pv:0,payment:0,cv:0}
  }

  const {data:identity,error:identityError} = await supabase.auth.getUser()
  if(identityError || !identity?.user?.id) return unknown
  const uid=identity.user.id
  const isAP = profile.role==='executive' && profile.department==='Finance'
  const isExecutive = profile.role==='executive'
  const isFinanceManager = profile.role==='manager' && profile.department==='Finance'
  const isManager = profile.role==='manager'

  let pv=null,payment=null,cv=null
  try {
    // Only securely actionable CURRENT approval queue rows, not all submitted PVs.
    const {data:queues,error} = await supabase.rpc('jauhar_my_approval_queues_v1')
    if(error) throw error
    const actual=Array.isArray(queues?.actual)?queues.actual:[]
    const queued=new Set(actual.map(r=>r.id).filter(Boolean))
    let returned=0
    if(isExecutive) {
      // Returned Draft assigned to the original requester.
      // Handover-specific work remains visible inside its existing workspace.
      returned=await exact(q=>q.eq('status','returned').eq('created_by',uid))
    }
    pv=done(queued.size+returned)
  } catch(error) {
    console.warn('JIMS PV notification unavailable:',error?.message)
  }

  try {
    if(isAP){
      const [pending,completion]=await Promise.all([
        exact(q=>q.eq('status','fully_approved').eq('payment_status','pending_payment')),
        exact(q=>q.eq('status','fully_approved').eq('payment_status','payment_initiated')
          .in('payment_initiation_manager_decision',['approved','returned']))
      ])
      payment=done(pending+completion)
    } else if(isFinanceManager){
      payment=done(await exact(q=>q.eq('status','fully_approved')
        .eq('payment_status','payment_initiated')
        .eq('payment_initiation_manager_decision','pending')))
    } else payment=0
  } catch(error){
    console.warn('JIMS payment notification unavailable:',error?.message)
  }

  try {
    if(!isManager) cv=0
    else {
      // Match CashVoucher.jsx canSign() rules; don't count all CVs in system.
      const {data:pending,error:e1}=await supabase.from('cash_vouchers')
        .select('id,applicable_department').eq('status','pending_approval').limit(1001)
      if(e1) throw e1
      if((pending||[]).length>=1001) throw new Error('CV notification page exceeds safe limit')
      if(!pending?.length) cv=0
      else{
        const ids=pending.map(v=>v.id)
        const {data:approvals,error:e2}=await supabase.from('cash_voucher_approvals')
          .select('voucher_id,authority').in('voucher_id',ids).limit(2001)
        if(e2) throw e2
        if((approvals||[]).length>=2001) throw new Error('CV approval page exceeds safe limit')
        const signed=new Set((approvals||[]).map(a=>a.voucher_id+'|'+a.authority))
        cv=done(pending.filter(v=>
          (v.applicable_department===profile.department && !signed.has(v.id+'|applicable_hod'))
          || (profile.department==='Finance' && !signed.has(v.id+'|finance_hod'))
        ).length)
      }
    }
  } catch(error){
    console.warn('JIMS CV notification unavailable:',error?.message)
  }
  return {pv,payment,cv}
}
