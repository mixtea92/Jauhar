import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export default function SystemAdminDelegationViewer({ profile }) {
  const [items,setItems]=useState([])
  const [audits,setAudits]=useState([])
  const [handovers,setHandovers]=useState([])
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const [refresh,setRefresh]=useState(0)
  useEffect(()=>{
    if(profile?.role!=='system_admin'||profile?.is_active!==true)return
    let active=true
    Promise.all([
      supabase.from('pv_authority_delegations').select('*').order('created_at',{ascending:false}).limit(500),
      supabase.from('pv_delegation_audit_events').select('*').order('created_at',{ascending:false}).limit(500),
      supabase.from('pv_requester_handovers').select('*').order('created_at',{ascending:false}).limit(500)
    ]).then(([d,a,h])=>{
      if(!active)return
      if(d.error||a.error||h.error)setError(d.error?.message||a.error?.message||h.error?.message)
      else{setItems(d.data||[]);setAudits(a.data||[]);setHandovers(h.data||[])}
      setLoading(false)
    }).catch(e=>{if(active){setError(e.message);setLoading(false)}})
    return ()=>{active=false}
  },[profile?.role,profile?.is_active,refresh])
  if(profile?.role!=='system_admin'||profile?.is_active!==true)return <p>Access Restricted</p>
  return <section className="panel">
    <h2>Manage Delegation — Read Only</h2>
    <p>System Admin may view all delegation records and audit events. No operational actions are available.</p>
    <button type="button" className="btn" disabled={loading} onClick={()=>{setLoading(true);setRefresh(x=>x+1)}}>Refresh</button>
    {error&&<p role="alert">{error}</p>}
    <h3>Delegations ({items.length})</h3>
    <ul>{items.map((d,i)=><li key={d.id||i}><details><summary>{d.authority} · {d.department||'Global'} · {d.status} · {d.starts_at} — {d.ends_at}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(d,null,2)}</pre></details></li>)}</ul>
    <h3>Audit History ({audits.length})</h3>
    <ul>{audits.map((a,i)=><li key={a.id||i}><details><summary>{a.created_at} · {a.action}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(a,null,2)}</pre></details></li>)}</ul>
    <h3>Requester Handovers ({handovers.length})</h3>
    <ul>{handovers.map((h,i)=><li key={h.id||i}><details><summary>{h.created_at} · {h.status} · {h.original_requester} → {h.new_requester}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(h,null,2)}</pre></details></li>)}</ul>
  </section>
}
