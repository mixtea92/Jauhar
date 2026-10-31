// JIMS 57D4 — Cross-PV duplicate supplier invoice warning (Draft form only).
// Uses authorized Supabase read-only RPC. Final submit block is always server-side.
import {useEffect,useMemo,useState} from 'react'
import {supabase} from './lib/supabase'

const normalizeRef=s=>String(s||'').trim().replace(/\s+/g,'').toUpperCase()

export default function JIMS57D4DuplicateInvoiceWarning({
  payeeName='',supplierCode='',supplierTin='',lines=[],excludeVoucherId=null
}){
  const [state,setState]=useState({loading:false,matches:[],error:''})
  const refs=useMemo(()=>lines.map(x=>String(x?.invoice_reference||'').trim())
    .filter(Boolean),[lines])
  const identity=String(payeeName||'').trim()||String(supplierCode||'').trim()||
    String(supplierTin||'').trim()
  const signature=JSON.stringify([payeeName,supplierCode,supplierTin,refs,excludeVoucherId])
  const localRepeated=useMemo(()=>{
    const seen=new Set()
    const repeats=new Set()
    for(const ref of refs){
      const key=normalizeRef(ref)
      if(!key)continue
      if(seen.has(key))repeats.add(ref)
      seen.add(key)
    }
    return [...repeats]
  },[refs])

  useEffect(()=>{
    let active=true
    if(!identity||refs.length===0){
      return ()=>{active=false}
    }
    // Wait until user finishes typing. Avoid requests for each keystroke.
    const timeout=setTimeout(async()=>{
      if(!active)return
      setState({loading:true,matches:[],error:''})
      try{
        const {data,error}=await supabase.rpc('jims_57d4_check_draft_v1',{
          p_payee_name:payeeName||'',p_supplier_code:supplierCode||'',
          p_supplier_tin:supplierTin||'',
          p_invoice_references:refs,p_exclude_pv:excludeVoucherId||null
        })
        if(error)throw error
        if(active)setState({loading:false,matches:Array.isArray(data?.matches)?data.matches:[],error:''})
      }catch(error){
        if(active)setState({loading:false,matches:[],
          error:error?.message||'Unable to check invoices'})
      }
    },600)
    return ()=>{active=false;clearTimeout(timeout)}
    // signature intentionally captures all inputs; protects against outdated duplicate responses.
  },[signature])

  if(!identity||refs.length===0)return null
  const hasIssues=state.matches.length>0||localRepeated.length>0
  const panel={
    margin:'14px 0 8px',padding:'12px 14px',borderRadius:9,
    border:hasIssues?'1px solid #b77d3c':'1px solid #62502c',
    background:'var(--jims-card-bg,rgba(151,114,45,.08))',color:'inherit'
  }
  return <div style={panel} role={hasIssues?'alert':'status'} aria-live="polite">
    <strong>{hasIssues?'Duplicate invoice warning':'Invoice check'}</strong>
    {state.loading&&<span style={{marginLeft:9,opacity:.75}}>Checking...</span>}
    {!state.loading&&!state.error&&!hasIssues&&<span style={{marginLeft:9,opacity:.75}}>
      No matching invoice found in another active PV.
    </span>}
    {localRepeated.length>0&&<p style={{margin:'7px 0'}}>
      Repeated invoice reference within this draft: {localRepeated.join(', ')}.
    </p>}
    {state.matches.length>0&&<div style={{marginTop:7}}>
      <div>Same supplier and invoice already recorded in:</div>
      <ul style={{margin:'5px 0 0',paddingLeft:22}}>
        {state.matches.slice(0,8).map((m,i)=>
          <li key={String(m.existing_pv)+'-'+String(m.invoice_reference)+'-'+i}>
            <strong>{m.existing_pv||'Existing PV'}</strong>
            {' · Invoice '+(m.invoice_reference||'')}
            {' · '+String(m.existing_status||'').replaceAll('_',' ')}
            {m.existing_branch?' · '+m.existing_branch:''}
          </li>)}
      </ul>
      {state.matches.length>8&&<p>+ {state.matches.length-8} other matching PV(s)</p>}
      <p style={{margin:'7px 0 0',fontWeight:600}}>
        Draft can be saved, but submission will be blocked until the duplicate is resolved.
      </p>
    </div>}
    {state.error&&<p style={{margin:'6px 0 0',opacity:.8}}>
      Invoice check unavailable. Server will still validate at submission.
    </p>}
  </div>
}
