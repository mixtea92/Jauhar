// JIMS Step 57C8B — one Report Generation workspace for AP and Accounting.
// AP operational Excel and private supporting-file ZIP; owner-only Approval History.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

const AP_UNITS = ['Accounts Payable','Accounting']
const AP_REPORTS = [
  {id:'pv_history',label:'Payment Voucher Report',sheet:'Payment Vouchers'},
  {id:'payment_process_history',label:'Payment Process / Tranche Report',sheet:'Payment Process'},
  {id:'petty_cash_history',label:'Petty Cash Report',sheet:'Petty Cash'},
  {id:'pv_operational_events_history',label:'PV Operational Timeline',sheet:'PV Operations'},
  {id:'petty_cash_operational_events_history',label:'Petty Cash Operational Timeline',sheet:'PC Operations'}
]
const EVIDENCE = [
  {id:'invoice',label:'Invoice / Supplier Documents'},
  {id:'initiation_proof',label:'Payment Initiation Proof'},
  {id:'final_receipt',label:'Final Payment Receipt'},
  {id:'jr_pdf',label:'Justification Report (JR) PDFs'},
  {id:'jr_meeting',label:'Offline JR Meeting Records (Excel)'}
]
const COLUMNS = {
  pv_history:[['pv_number','PV Number'],['financial_tier','Tier'],['tier_version','Policy'],['department','Origin Department'],
    ['charge_department','Charge Department'],['charge_subdepartment','Charge Subdept'],
    ['branch','Branch'],['cost_center','Cost Center'],['budget_code','Budget Code'],['payee','Payee'],
    ['purpose','Purpose'],['amount','Amount (RM)'],['approval_status','PV Status'],['payment_status','Payment Status'],
    ['payment_mode','Payment Mode'],['created_at','Created'],['final_approval_date','Final Approval Date'],
    ['payment_date','Payment Date'],['archived','Archived']],
  payment_process_history:[['pv_number','PV Number'],['installment_no','Tranche'],['requested_amount','Requested (RM)'],
    ['settled_amount','Settled (RM)'],['status','Status'],['review_decision','Review Decision'],
    ['review_remarks','Review Remarks'],['bank_transaction_reference','Bank Reference'],
    ['payment_date','Payment Date'],['created_at','Created'],['initiated_at','Initiated'],
    ['reviewed_at','Reviewed'],['completed_at','Completed'],['voided_at','Voided'],['void_reason','Void Reason']],
  petty_cash_history:[['cv_number','Petty Cash No'],['department','Department'],['branch','Branch'],
    ['cost_center','Cost Center'],['charge_subdepartment','Charge Sub-Department'],['requester_department','Requester Department'],['requester_subdepartment','Requester Sub-Department'],['requester_cost_center','Requester Cost Center'],['claimant','Claimant'],['amount','Amount (RM)'],
    ['status','Status'],['receipt_count','Receipt Count'],['created_at','Created'],
    ['submitted_at','Submitted'],['closed_at','Closed']],
  pv_operational_events_history:[['pv_number','PV Number'],['action','Event'],['actor','Recorded By'],
    ['event_time','Date / Time'],['details','Operational Details']],
  petty_cash_operational_events_history:[['cv_number','Petty Cash No'],['action','Event'],['actor','Recorded By'],
    ['event_time','Date / Time'],['details','Operational Details']],
  pv_approval_history:[['pv_number','PV Number'],['financial_tier','Tier'],['tier_policy_version','Policy'],
    ['branch','Branch'],['department','Department'],['payee','Payee'],['amount','Amount'],
    ['round','Round'],['authority','Authority'],['action','Decision'],['actor','Actor'],
    ['remarks','Remarks'],['event_time','Date / Time']],
  petty_cash_approval_history:[['cv_number','PC Number'],['department','Department'],['amount','Amount'],
    ['status','Status'],['authority','Authority'],['actor','Actor'],['approval_time','Date / Time']],
  delegation_approval_history:[['action','Action'],['authority','Authority'],['department','Department'],
    ['delegation_status','Status'],['actor','Actor'],['principal','Principal'],
    ['delegate','Delegate'],['details','Details'],['event_time','Date / Time']],
  meeting_records:[['pv_number','PV Number'],['tier','Tier'],['branch','Branch'],
    ['approval_round','Approval Round'],['decision_tier','Meeting Decision Authority'],
    ['meeting_reference','Meeting Reference'],['meeting_date','Meeting Date'],
    ['jr_document_id','Linked JR Document ID'],['recorded_at','Recorded At']],
  evidence_register:[['pv_number','PV Number'],['tier','Tier'],['branch','Branch'],
    ['kind','File Category'],['filename','Original Filename'],['size_bytes','Size (Bytes)'],
    ['exists_in_storage','File Exists'],['archive_path','ZIP Path']]
}
const OWNER_REPORTS=[
  ['pv_approval_history','PV Approvals'],
  ['petty_cash_approval_history','Petty Cash Approvals'],
  ['delegation_approval_history','Delegation Approvals']
]
const toLocalDate = input=>{
  if(!input)return ''
  const d=new Date(input)
  return Number.isFinite(d.getTime())?
    new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):''
}
const valueText = v=>{
  if(v==null)return ''
  const txt=typeof v==='object'?JSON.stringify(v):String(v)
  return /^[\s]*[=+\-@\r\t]/.test(txt)?"'"+txt:txt
}
const safeFolder = value=>String(value||'Unknown').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,72)
const moneyCols=new Set(['amount','requested_amount','settled_amount'])
const numberCols=new Set(['installment_no','approval_round','round','receipt_count','size_bytes'])
const dateCols=new Set(['created_at','submitted_at','closed_at','event_time','recorded_at','approval_time',
  'initiated_at','reviewed_at','completed_at','voided_at','final_approval_date'])
function excelValue(key,v){
  if(v==null)return ''
  if(typeof v==='boolean')return v?'Yes':'No'
  if(moneyCols.has(key)||numberCols.has(key)){
    const num=Number(v)
    return Number.isFinite(num)?num:valueText(v)
  }
  if(dateCols.has(key)&&v){
    const d=new Date(v)
    if(Number.isFinite(d.getTime()))
      return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',
        year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
        second:'2-digit',hour12:false}).format(d)
  }
  return valueText(v)
}
async function makeExcel(groups){
  const ExcelJS=(await import('exceljs')).default
  const wb=new ExcelJS.Workbook()
  wb.creator='JIMS Report Generation'
  wb.created=new Date()
  for(const {key,sheet,rows} of groups){
    const columns=COLUMNS[key]
    if(!columns)throw new Error('Unknown report sheet: '+key)
    const ws=wb.addWorksheet(sheet,{views:[{state:'frozen',ySplit:1}]})
    ws.addRow(columns.map(([,title])=>title))
    const h=ws.getRow(1)
    h.font={bold:true,color:{argb:'FFF5D98E'}}
    h.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF232326'}}
    h.height=29
    for(const row of rows){
      const values=columns.map(([k])=>excelValue(k,row?.[k]))
      const r=ws.addRow(values)
      r.eachCell((cell,i)=>{
        if(moneyCols.has(columns[i-1][0])&&typeof cell.value==='number')cell.numFmt='#,##0.00'
      })
    }
    ws.columns=columns.map(([k,title])=>({
      key:k,width:Math.min(55,Math.max(title.length+3,k.includes('details')?48:21))
    }))
    ws.autoFilter={from:'A1',to:{row:1,column:columns.length}}
  }
  return new Blob([await wb.xlsx.writeBuffer()],{
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob)
  try{
    const a=document.createElement('a')
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove()
  }finally{window.setTimeout(()=>URL.revokeObjectURL(url),15000)}
}
function stamp(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',
  day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date())}
function isAP(p){return p?.is_active===true&&p.department==='Finance'&&
  ['executive','manager'].includes(p.role)&&AP_UNITS.includes(p.subdepartment)}
const toggle=(values,key)=>values.includes(key)?values.filter(v=>v!==key):[...values,key]
const canCompareDate=(date,from,to)=>{
  const day=toLocalDate(date)
  return (!from||day>=from)&&(!to||day<=to)
}
const maxFileCount=150
const maxZipBytes=100*1024*1024

export default function JIMSHistoryExports({profile}){
  const ap=isAP(profile)
  const [owner,setOwner]=useState(false)
  const [checking,setChecking]=useState(true)
  const [selectedReports,setSelectedReports]=useState(['pv_history','payment_process_history'])
  const [selectedDocs,setSelectedDocs]=useState([])
  const [pvSearch,setPvSearch]=useState('')
  const [dateFrom,setDateFrom]=useState('')
  const [dateTo,setDateTo]=useState('')
  const [branch,setBranch]=useState('')
  const [tier,setTier]=useState('')
  const [paymentStatus,setPaymentStatus]=useState('')
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [manifest,setManifest]=useState(null)
  const [manifestFilters,setManifestFilters]=useState('')

  useEffect(()=>{
    let mounted=true
    async function check(){
      if(profile?.role!=='system_admin'||profile?.is_active!==true){
        if(mounted){setOwner(false);setChecking(false)};return
      }
      setChecking(true)
      const {data,error:e}=await supabase.rpc('jims_is_system_owner_v1')
      if(mounted){setOwner(!e&&data===true);setChecking(false)}
    }
    void check()
    return ()=>{mounted=false}
  },[profile?.role,profile?.is_active])

  const queryFilters=useMemo(()=>JSON.stringify([pvSearch.trim(),dateFrom,dateTo,branch]),[pvSearch,dateFrom,dateTo,branch])
  const scopedFiles=useMemo(()=>((manifest?.files)||[]).filter(r=>
    (!tier||r.tier===tier)&&(!paymentStatus||r.payment_status===paymentStatus)),[manifest,tier,paymentStatus])
  const scopedMeetings=useMemo(()=>((manifest?.meeting_records)||[]).filter(r=>
    (!tier||r.tier===tier)&&(!paymentStatus||r.payment_status===paymentStatus)),[manifest,tier,paymentStatus])
  const selectedEvidence=useMemo(()=>
    scopedFiles.filter(r=>selectedDocs.includes(r.kind)),[scopedFiles,selectedDocs])

  const loadManifest=useCallback(async()=>{
    if(!ap)throw new Error('AP/Accounting authorization required')
    if(dateFrom&&dateTo&&dateFrom>dateTo)throw new Error('Date From must be before Date To.')
    const {data,error:e}=await supabase.rpc('jims_ap_report_document_manifest_v1',{
      p_pv_number:pvSearch.trim()||null,
      p_date_from:dateFrom||null,
      p_date_to:dateTo||null,
      p_branch:branch||null
    })
    if(e)throw e
    if(!Array.isArray(data?.files)||!Array.isArray(data?.meeting_records))
      throw new Error('Invalid evidence manifest response')
    setManifest(data);setManifestFilters(queryFilters)
    return data
  },[ap,pvSearch,dateFrom,dateTo,branch,queryFilters])

  function matchPV(r,pvIndex){
    const number=r.pv_number
    const pv=pvIndex.get(number)
    if(pvSearch.trim() && !String(number||'').toLowerCase().includes(pvSearch.trim().toLowerCase()))return false
    if(tier && (pv?.financial_tier||'')!==tier)return false
    if(branch && (pv?.branch||'')!==branch)return false
    if(paymentStatus && (pv?.payment_status||'')!==paymentStatus)return false
    if(dateFrom||dateTo){
      const creation=pv?.created_at||r.created_at||r.event_time
      if(!canCompareDate(creation,dateFrom,dateTo))return false
    }
    return true
  }
  function filterReports(data){
    if(!Array.isArray(data?.pv_history))throw new Error('PV index not returned')
    const index=new Map(data.pv_history.map(r=>[r.pv_number,r]))
    return selectedReports.map(key=>{
      const config=AP_REPORTS.find(r=>r.id===key)
      if(!config||!Array.isArray(data[key]))throw new Error('Unknown report dataset '+key)
      let rows=data[key]
      if(key==='petty_cash_history'){
        rows=rows.filter(r=>(!branch||r.branch===branch)&&canCompareDate(r.created_at,dateFrom,dateTo))
      }else if(key==='petty_cash_operational_events_history'){
        // Petty Cash event table does not have branch; match exported PC index.
        const pc=new Map((data.petty_cash_history||[]).map(r=>[r.cv_number,r]))
        rows=rows.filter(r=>{
          const voucher=pc.get(r.cv_number)
          return (!branch||voucher?.branch===branch)&&canCompareDate(voucher?.created_at||r.event_time,dateFrom,dateTo)
        })
      }else rows=rows.filter(r=>matchPV(r,index))
      return {key,sheet:config.sheet,rows}
    })
  }

  async function runReports(){
    if(!ap||busy||!selectedReports.length)return
    setBusy('excel');setError('');setNotice('')
    try{
      if(dateFrom&&dateTo&&dateFrom>dateTo)throw new Error('Invalid date range')
      const {data,error:e}=await supabase.rpc('jims_finance_ap_operational_history_export_v1')
      if(e)throw e
      const groups=filterReports(data)
      const total=groups.reduce((n,g)=>n+g.rows.length,0)
      downloadBlob(await makeExcel(groups),'JIMS_AP_Report_'+stamp()+'.xlsx')
      setNotice('Excel downloaded: '+total+' records across '+groups.length+' sheet(s).')
    }catch(e){setError(e.message||'Excel generation failed.')}finally{setBusy('')}
  }
  async function previewEvidence(){
    if(!ap||busy)return
    setBusy('preview');setError('');setNotice('')
    try{
      const result=await loadManifest()
      setNotice('Found '+result.files.length+' registered supporting files and '+
        result.meeting_records.length+' JR meeting records. Choose categories, then download ZIP.')
    }catch(e){setError(e.message||'Could not check document availability.')}finally{setBusy('')}
  }
  async function runEvidence(){
    if(!ap||busy||!selectedDocs.length)return
    setBusy('evidence');setError('');setNotice('')
    try{
      const current=manifestFilters===queryFilters&&manifest?manifest:await loadManifest()
      const files=current.files.filter(r=>selectedDocs.includes(r.kind)&&
        (!tier||r.tier===tier)&&(!paymentStatus||r.payment_status===paymentStatus))
      const meetings=selectedDocs.includes('jr_meeting')?
        current.meeting_records.filter(r=>(!tier||r.tier===tier)&&
          (!paymentStatus||r.payment_status===paymentStatus)):[]
      if(!files.length&&!meetings.length)throw new Error('No matching documents or meeting records.')
      const totalBytes=files.reduce((n,r)=>n+Number(r.size_bytes||0),0)
      if(files.length>maxFileCount || totalBytes>maxZipBytes)
        throw new Error('Too many files (max 150 / 100 MB). Apply tighter filters.')
      const missing=files.filter(r=>!r.exists_in_storage)
      if(missing.length)throw new Error(missing.length+
        ' registered file(s) are missing in private storage. Resolve missing uploads before exporting.')
      const JSZip=(await import('jszip')).default
      const zip=new JSZip()
      const list=[]
      let actualBytes=0
      for(let i=0;i<files.length;i++){
        const f=files[i]
        const folder=safeFolder(f.pv_number)+'/'+safeFolder(f.kind)+'/'
        const filename=safeFolder(f.filename||f.storage_path.split('/').pop()||'document')
        const target=folder+String(i+1).padStart(3,'0')+'_'+filename
        const {data:blob,error:e}=await supabase.storage.from(f.bucket).download(f.storage_path)
        if(e||!blob)throw new Error('Cannot access '+f.pv_number+' / '+f.kind+
          '. Authorization or storage failed: '+(e?.message||'Unknown error'))
        actualBytes+=blob.size
        if(actualBytes>maxZipBytes)throw new Error('Downloaded evidence exceeds 100 MB. Apply a tighter filter.')
        zip.file(target,blob)
        list.push({...f,archive_path:target})
      }
      const register=await makeExcel([
        {key:'evidence_register',sheet:'Evidence Register',rows:list},
        {key:'meeting_records',sheet:'JR Meeting Records',rows:meetings}
      ])
      zip.file('JIMS_Evidence_Register.xlsx',register)
      zip.file('ABOUT_JR_MEETING.txt',
        'JIMS offline JR meetings are stored as meeting reference/date/authority records.'+
        '\nNo meeting-minutes PDF is automatically uploaded by the present JR workflow.'+
        '\nSee JR Meeting Records in JIMS_Evidence_Register.xlsx.\n')
      const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',
        compressionOptions:{level:3}})
      downloadBlob(blob,'JIMS_AP_Supporting_Documents_'+stamp()+'.zip')
      setNotice('Evidence ZIP downloaded: '+files.length+' private documents and '+
        meetings.length+' meeting records.')
    }catch(e){setError(e.message||'Document ZIP failed; no partial download was created.')}
    finally{setBusy('')}
  }
  async function runOwner(){
    if(!owner||busy)return
    setBusy('owner');setError('');setNotice('')
    try{
      const {data,error:e}=await supabase.rpc('jims_owner_approval_history_export_v1')
      if(e)throw e
      const groups=OWNER_REPORTS.map(([key,sheet])=>{
        if(!Array.isArray(data?.[key]))throw new Error('Missing Owner dataset: '+key)
        return {key,sheet,rows:data[key]}
      })
      downloadBlob(await makeExcel(groups),'JIMS_OWNER_Approval_History_'+stamp()+'.xlsx')
      setNotice('System Owner Approval History downloaded: '+
        groups.reduce((s,g)=>s+g.rows.length,0)+' entries.')
    }catch(e){setError(e.message||'Owner approval export failed.')}finally{setBusy('')}
  }

  const checkStyle={display:'flex',gap:8,alignItems:'center',padding:'8px 0'}
  const inputStyle={padding:9,borderRadius:7,minWidth:150}
  if(!ap&&!owner)return <section className="panel">
    <h2>Report Generation</h2>
    <p className="muted">{checking?'Checking System Owner permission...':
      'Access restricted. AP/Accounting operational reports or designated System Owner approval exports only.'}</p>
  </section>

  return <section className="panel" aria-label="JIMS Report Generation">
    <div className="panel-head">
      <div><span className="muted">JIMS · FINANCE</span><h2>Report Generation</h2>
        <p className="muted">Select reports and supporting documents to download. Original files remain private.</p></div>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&<p className="pv-notice" role="status">{notice}</p>}
    {ap&&<div>
      <h3>1. Report Type (.xlsx)</h3>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:5,marginBottom:20}}>
        {AP_REPORTS.map(r=><label key={r.id} style={checkStyle}>
          <input type="checkbox" checked={selectedReports.includes(r.id)}
            disabled={!!busy} onChange={()=>setSelectedReports(x=>toggle(x,r.id))}/>
          {r.label}
        </label>)}
      </div>
      <h3>2. Supporting Documents (.zip)</h3>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:5,marginBottom:20}}>
        {EVIDENCE.map(r=><label key={r.id} style={checkStyle}>
          <input type="checkbox" checked={selectedDocs.includes(r.id)}
            disabled={!!busy} onChange={()=>setSelectedDocs(x=>toggle(x,r.id))}/>
          {r.label}
        </label>)}
      </div>
      <p className="muted">JR meeting evidence is exported as recorded meeting reference/date in Excel, not an invented minutes PDF.</p>
      <h3>3. Filters</h3>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'end',marginBottom:20}}>
        <label>PV Number / Search
          <input style={{...inputStyle,display:'block'}} value={pvSearch} maxLength={80}
            disabled={!!busy} onChange={e=>setPvSearch(e.target.value)}
            placeholder="e.g. PV-2026-000008" /></label>
        <label>Created From
          <input type="date" style={{...inputStyle,display:'block'}} value={dateFrom}
            disabled={!!busy} onChange={e=>setDateFrom(e.target.value)}/></label>
        <label>Created To
          <input type="date" style={{...inputStyle,display:'block'}} value={dateTo}
            disabled={!!busy} onChange={e=>setDateTo(e.target.value)}/></label>
        <label>Branch
          <select style={{...inputStyle,display:'block'}} value={branch} disabled={!!busy}
            onChange={e=>setBranch(e.target.value)}>
            <option value="">All Branches</option>
            {['GP','KM','PM','TD','Gelang Patah','Kota Masai','Pulai Mutiara','Taman Daya'].map(b=>
              <option value={b} key={b}>{b}</option>)}
          </select></label>
        <label>Tier
          <select style={{...inputStyle,display:'block'}} value={tier} disabled={!!busy}
            onChange={e=>setTier(e.target.value)}>
            <option value="">All Tiers</option>
            {Array.from({length:9},(_,i)=>'T'+String(i+1).padStart(2,'0')).map(t=>
              <option key={t} value={t}>{t}</option>)}
          </select></label>
        <label>Payment Status
          <select style={{...inputStyle,display:'block'}} value={paymentStatus}
            disabled={!!busy} onChange={e=>setPaymentStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="pending_payment">Pending Payment</option>
            <option value="payment_initiated">Payment Initiated</option>
            <option value="paid">Paid</option>
          </select></label>
      </div>
      <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:24}}>
        <button type="button" className="btn" disabled={!!busy||!selectedReports.length}
          onClick={runReports}>{busy==='excel'?'Preparing Excel...':'Download Selected Excel Reports'}</button>
        <button type="button" className="btn" style={{background:'#72603b'}} disabled={!!busy}
          onClick={previewEvidence}>{busy==='preview'?'Checking...':'Preview Available Documents'}</button>
        <button type="button" className="btn" style={{background:'#775522'}}
          disabled={!!busy||!selectedDocs.length} onClick={runEvidence}>
          {busy==='evidence'?'Preparing ZIP...':'Download Selected Documents ZIP'}</button>
      </div>
      {manifest&&manifestFilters===queryFilters&&<p className="muted">
        Current filter: {scopedFiles.length} documents registered, {scopedMeetings.length} JR meeting records.
        Selected files: {selectedEvidence.length}. Max 150 files / 100 MB per ZIP.
      </p>}
    </div>}
    {owner&&<div style={{borderTop:ap?'1px solid #777':'none',paddingTop:ap?20:0}}>
      <h3>System Owner — Approval History</h3>
      <p className="muted">This approval-history download is separate from AP reports and can only be generated by the designated System Owner.</p>
      <button type="button" className="btn" disabled={!!busy} onClick={runOwner}>
        {busy==='owner'?'Preparing Owner Excel...':'Download All Approval History (.xlsx)'}
      </button>
    </div>}
  </section>
}
