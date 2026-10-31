import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { JSYNC_SUBDEPARTMENTS } from './UserOrganizationAssignment'

// JIMS_STEP57D1E_EXTERNAL_PETTY_CASH_FIELDS
// These are additive widgets: no existing receipt, approval or audit functions changed.
const input={padding:'9px 10px',borderRadius:7,border:'1px solid #a4a8b3',minWidth:0,width:'100%'}
const subdepartments = department => {
  const key = department === 'Sales & Marketing' ? 'Sales and Marketing'
    : ['System, Project & Infrastructure Department','System, Project & Infra'].includes(department)
      ? 'System, Project & Infrastructure' : department
  return JSYNC_SUBDEPARTMENTS[key] || []
}

export function JIMSPettyCashChargeFields({ form, setForm }) {
  const department=form?.department||''
  const units=useMemo(()=>subdepartments(department),[department])
  const existing=form?.charge_subdepartment||''
  useEffect(()=>{
    if(existing && !units.includes(existing)){
      setForm(f=>({...f,charge_subdepartment:''}))
    }
  },[existing,units,setForm])
  return <section style={{border:'1px solid #a58b53',borderRadius:9,padding:13,margin:'12px 0'}}>
    <h4 style={{margin:'0 0 7px'}}>JIMS Financial Allocation Metadata</h4>
    <p style={{fontSize:12,margin:'0 0 12px'}}>Department is taken from the existing Petty Cash form. Select its Sub-Department and Cost Center before submitting. These fields are stored in JIMS metadata and do not modify the official one-page Excel.</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
      <label style={{fontSize:13}}>
        <span style={{display:'block',marginBottom:5}}>Charge Department (from existing form)</span>
        <input style={input} readOnly value={department||'Select Department below first'} />
      </label>
      <label style={{fontSize:13}}>
        <span style={{display:'block',marginBottom:5}}>Charge Sub-Department *</span>
        <select style={input} value={existing} disabled={!department||!units.length}
          onChange={e=>setForm(f=>({...f,charge_subdepartment:e.target.value}))}>
          <option value="">— Select Sub-Department —</option>
          {units.map(x=><option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label style={{fontSize:13}}>
        <span style={{display:'block',marginBottom:5}}>Charge Cost Center *</span>
        <select style={input} value={form?.charge_cost_center||''}
          onChange={e=>setForm(f=>({...f,charge_cost_center:e.target.value}))}>
          <option value="">— Select Cost Center —</option>
          <option value="Management">Management</option>
          <option value="Operation">Operation</option>
        </select>
      </label>
    </div>
    <p style={{fontSize:12,margin:'10px 0 0'}}>Petty Cash number is issued automatically upon the first Save Draft, and is read-only. Historical CV numbers remain unchanged.</p>
  </section>
}

export function JIMSPettyCashRevisionPanel({profile}) {
  const admin=profile?.is_active===true&&profile?.role==='system_admin'
  const finance=profile?.is_active===true&&profile?.department==='Finance'&&
    ['executive','manager'].includes(profile.role)&&
    (!profile.subdepartment||['Accounts Payable','Accounting'].includes(profile.subdepartment))
  const canSee=admin||finance
  const [current,setCurrent]=useState(null)
  const [reason,setReason]=useState('')
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [version,setVersion]=useState(0)

  useEffect(()=>{
    if(!canSee)return
    let active=true
    supabase.rpc('jims_pc_number_status_v1').then(({data,error:e})=>{
      if(!active)return
      if(e)setError(e.message||'Unable to load PC numbering settings')
      else {setCurrent(data);setError('')}
    }).catch(e=>{if(active)setError(e.message||String(e))})
    return ()=>{active=false}
  },[canSee,version])

  if(!canSee)return null
  const currentRev=Number((current?.revision||'RV01').replace('RV',''))
  const next=currentRev+1
  async function advance(){
    if(!admin||saving||!current||!Number.isInteger(next)||next>99)return
    if(reason.trim().length<8){setError('Please enter a revision reason of at least 8 characters.');return}
    if(!window.confirm('Advance Petty Cash numbering to RV'+String(next).padStart(2,'0')+
      '? Existing PC and CV numbers are unchanged.'))return
    setSaving(true);setNotice('');setError('')
    try{
      const {error:e}=await supabase.rpc('jims_pc_set_next_revision_v1',{
        p_next_revision:next,p_reason:reason.trim()
      })
      if(e)throw e
      setReason('')
      setNotice('New Petty Cash revision activated for future records; audit saved.')
      setVersion(v=>v+1)
    }catch(e){setError(e.message||String(e))}
    finally{setSaving(false)}
  }
  return <section style={{border:'1px solid #a58b53',borderRadius:9,padding:12,margin:'12px 0'}}>
    <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',alignItems:'center',gap:8}}>
      <div>
        <strong>Petty Cash Running Number</strong>
        <div style={{fontSize:13,marginTop:6}}>{current
          ? 'PC/'+current.revision+'/'+current.period_mmyy+'/NNNN'
          : 'Loading PC numbering configuration...'}</div>
        <small>Auto-generated · Monthly reset · Not editable</small>
      </div>
      {admin&&current&&<small>Revision settings: System Admin only</small>}
    </div>
    {error&&<p role="alert" style={{color:'#d68470'}}>{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    {admin&&current&&<>
      <label style={{display:'block',marginTop:12,fontSize:13}}>Reason for next revision
        <input style={{...input,marginTop:5,maxWidth:530,display:'block'}}
          type="text" maxLength={500} value={reason} disabled={saving}
          placeholder="Required audit reason (at least 8 characters)"
          onChange={e=>setReason(e.target.value)} />
      </label>
      <button type="button" className="btn" style={{marginTop:9}}
        disabled={saving||reason.trim().length<8||next>99}
        onClick={advance}>
        {saving?'Saving...':'Advance to RV'+String(next).padStart(2,'0')}
      </button>
      <small style={{display:'block',marginTop:7}}>Changing revision affects only newly issued Petty Cash numbers; no approval permissions change.</small>
    </>}
  </section>
}
