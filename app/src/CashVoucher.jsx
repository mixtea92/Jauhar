import { JIMSPettyCashChargeFields, JIMSPettyCashRevisionPanel } from './JIMSPettyCash57D1E'
import { useEffect,useMemo,useState } from 'react'
import { supabase } from './lib/supabase'
import {
  CV_BRANCHES,CV_DEPARTMENTS,CV_SHEETS,CV_CLAIM_CATEGORIES,CV_EXTRA_C18,
  CV_EXPENSE_CATEGORIES_DIGITAL,CV_EXPENSE_CATEGORIES_MANUAL,
  blankCVForm,blankCVLine,hasCVLineData
} from './cashVoucherExcel'
import { downloadOfficialPettyCashPDF } from './JIMSR11COfficialPettyCashPDF'
import { CV_RECEIPT_BUCKET,CV_RECEIPT_ACCEPT,validateCVReceiptFile,openPrivateCVReceipt } from './cashVoucherReceipts'
// JSYNC_CV_RECEIPTS_48J
// JSYNC_CV_PRINTABLE_SIGNER_V1

// JSYNC CV V1 is an independent post-disbursement documentation module.
// NO payment initiation, payment execution, or PV workflow modification.

const money = value => 'RM '+Number(value||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})
const dateLabel = value => value?new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}):'—'
const inputStyle={padding:'9px 10px',borderRadius:7,border:'1px solid #a4a8b3',minWidth:0,width:'100%'}
const cellStyle={padding:8,borderBottom:'1px solid #7d849755',verticalAlign:'middle'}
const smallButton={padding:'7px 11px',border:'1px solid #8e742c',borderRadius:7,cursor:'pointer'}
const selectOptions = (values) => values.map(x=><option key={x} value={x}>{x}</option>)
const normalized = form => ({...form,lines:(form.lines||[]).filter(hasCVLineData).map(l=>({...blankCVLine(),...l}))})

export default function CashVoucher({profile}) {
  const isMobileUpload=typeof navigator!=='undefined' && (Boolean(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent||'') || (/Macintosh/i.test(navigator.userAgent||'') && navigator.maxTouchPoints>1))
  const isAdmin=profile?.is_active===true && profile?.role==='system_admin'
  const isAP=profile?.is_active===true && profile?.role==='executive' && profile?.department==='Finance'
  const isHOD=profile?.is_active===true && profile?.role==='manager' && profile?.department==='Finance'
  const [rows,setRows]=useState([])
  const [approvals,setApprovals]=useState([])
  const [receipts,setReceipts]=useState([])
  const [audit,setAudit]=useState([])
  const [mode,setMode]=useState('home')
  const [selected,setSelected]=useState(null)
  const [editingId,setEditingId]=useState(null)
  const [form,setForm]=useState(blankCVForm)
  const [checked,setChecked]=useState([])
  const approvalStage='finance_hod' // R11C: other-department HOD approvals deferred
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [refresh,setRefresh]=useState(0)
  const [filter,setFilter]=useState('active')

  useEffect(()=>{
    let live=true
    const get=async()=>{
      setLoading(true)
      const [vs,as,rs]=await Promise.all([
        supabase.from('cash_vouchers').select('*').order('created_at',{ascending:false}).limit(500),
        supabase.from('cash_voucher_approvals').select('id,voucher_id,authority,approved_by,approved_at,approved_username,approved_designation').limit(1000),
        supabase.from('cash_voucher_receipts').select('id,voucher_id,line_index,storage_path,original_file_name,uploaded_at').limit(5000)
      ])
      if(!live)return
      if(vs.error||as.error||rs.error)setError(vs.error?.message||as.error?.message||rs.error?.message)
      else {setRows(vs.data||[]);setApprovals(as.data||[]);setReceipts(rs.data||[])}
      setLoading(false)
    }
    get().catch(e=>{if(live){setError(e?.message||'Could not load CV records');setLoading(false)}})
    return ()=>{live=false}
  },[refresh])


  const byId=id=>approvals.filter(a=>a.voucher_id===id)
  const receiptFor=(voucherId,index)=>receipts.find(r=>r.voucher_id===voucherId&&r.line_index===index)
  const hasApproval=(id,authority)=>approvals.some(a=>a.voucher_id===id&&a.authority===authority)
  const canSign=(v,authority)=>{
    if(!isHOD||!v||v.status!=='pending_approval'||hasApproval(v.id,authority))return false
    return authority==='finance_hod' && profile.department==='Finance'
  }
  const stageRows=rows.filter(v=>canSign(v,approvalStage))
  const displayRows=rows.filter(v=>filter==='active'
    ? v.status==='draft'||v.status==='pending_approval' : v.status===filter)
  const historyRows=rows.filter(v=>v.status==='closed')
  const totals=useMemo(()=>{
    const out={draft:0,pending_approval:0,closed:0,total:0}
    rows.forEach(v=>{out[v.status]=(out[v.status]||0)+1;out.total+=Number(v.total_amount||0)})
    return out
  },[rows])
  const myAttention=rows.filter(v=>canSign(v,'finance_hod')).length

  async function reload(){setRefresh(x=>x+1)}
  async function action(label,call){
    if(busy)return
    setError('');setNotice('');setBusy(true)
    try{
      const result=await call()
      if(result?.error)throw result.error
      setNotice(label)
      await reload()
      return result?.data
    }catch(e){setError(e?.message||String(e))}
    finally{setBusy(false)}
  }
  function newForm(){
    if(!isAP)return
    setForm(blankCVForm())
    setEditingId(null);setMode('form');setError('');setNotice('')
  }
  function editForm(v){
    if(!isAP||v.status!=='draft')return
    setEditingId(v.id)
    setForm({...blankCVForm(),...(v.form_data||{}),lines:v.form_data?.lines||[]})
    setMode('form');setError('');setNotice('')
  }
  function setField(key,value){setForm(f=>({...f,[key]:value}))}
  function setLine(i,key,value){
    setForm(f=>{
      const lines=Array.from({length:10},(_,n)=>({...blankCVLine(),...(f.lines?.[n]||{})}))
      lines[i]={...lines[i],[key]:value}
      return {...f,lines}
    })
  }
  async function openReceipt(receipt) {
    setError('')
    try {await openPrivateCVReceipt(supabase,receipt)}
    catch(err){setError(err?.message||'Unable to open private receipt')}
  }
  async function uploadReceipt(i,event) {
    const input=event.currentTarget
    const file=input.files?.[0]
    if(!file)return
    if(!isAP||isMobileUpload){setError('Receipt uploads are allowed only for Finance AP using desktop browsers.');input.value='';return}
    if(busy){input.value='';return}
    const payload=normalized(form)
    const index=Array.from({length:i+1},(_,k)=>({...blankCVLine(),...(form.lines?.[k]||{})})).filter(hasCVLineData).length
    if(index<1||!hasCVLineData({...blankCVLine(),...(form.lines?.[i]||{})})){
      setError('Enter the expense details before uploading its receipt.');input.value='';return
    }
    setError('');setNotice('');setBusy(true)
    try{
      const ext=validateCVReceiptFile(file)
      if(typeof crypto==='undefined'||typeof crypto.randomUUID!=='function')throw Error('Secure browser context is required to upload receipts.')
      const saved=await supabase.rpc('jsync_cv_save_draft_v1',{p_voucher_id:editingId||null,p_form:payload})
      if(saved.error)throw saved.error
      const v=saved.data
      if(!v?.id)throw Error('Failed to save CV Draft for receipt attachment.')
      setEditingId(v.id)
      setForm({...blankCVForm(),...payload})
      const objectPath=v.id+'/'+index+'/'+crypto.randomUUID()+ext
      const stored=await supabase.storage.from(CV_RECEIPT_BUCKET).upload(objectPath,file,{upsert:false,contentType:file.type})
      if(stored.error)throw stored.error
      const attached=await supabase.rpc('jsync_cv_attach_receipt_v1',{
        p_voucher_id:v.id,p_line_index:index,p_storage_path:objectPath,p_original_name:file.name
      })
      if(attached.error)throw attached.error
      const rec=attached.data
      if(!rec?.id)throw Error('Receipt upload could not be linked to the CV row.')
      setReceipts(prev=>[...prev.filter(r=>!(r.voucher_id===v.id&&r.line_index===index)),rec])
      setForm({...blankCVForm(),...payload,lines:payload.lines.map((l,j)=>j===index-1?{...l,receipt_attached:'Yes'}:l)})
      setNotice('Receipt uploaded and attached to expense row '+index+': '+file.name+' (private).')
      setRefresh(n=>n+1)
    }catch(err){setError(err?.message||'Receipt upload failed. Draft may have been saved, but CV cannot Submit until a receipt is attached.')}
    finally{setBusy(false);input.value=''}
  }
  async function saveDraft(){
    if(!isAP)return
    const payload=normalized(form)
    const result=await action('CV Draft saved.',()=>supabase.rpc('jsync_cv_save_draft_v1',{
      p_voucher_id:editingId||null,p_form:payload
    }))
    if(result?.id){setEditingId(result.id);setForm({...blankCVForm(),...payload})}
  }
  async function submitCV(v){
    if(!isAP||v.status!=='draft')return
    if(!window.confirm('Submit '+v.cv_number+' for Finance HOD signed verification?'))return
    const result=await action('CV submitted for Finance HOD verification.',()=>supabase.rpc('jsync_cv_submit_v1',{p_voucher_id:v.id}))
    if(result)setMode('home')
  }
  async function approveSelected(){
    if(!isHOD||busy||!checked.length)return
    const eligible=checked.filter(id=>stageRows.some(v=>v.id===id))
    if(eligible.length!==checked.length){
      setError('One or more selected Petty Cash records are not eligible.');return
    }
    if(!window.confirm('Approve '+checked.length+' Petty Cash record(s) as Finance Manager? This will close the records and create an audit event.'))return
    const result=await action('Finance approval recorded for '+checked.length+' Petty Cash record(s).',
      ()=>supabase.rpc('jims_r11c_pc_finance_approve_v1',{p_voucher_ids:eligible}))
    if(result){setChecked([]);setMode('home')}
  }
  async function downloadOfficial(v){
    if(busy||!v||v.status!=='closed')return
    setError('');setNotice('');setBusy(true)
    try {
      const result=await downloadOfficialPettyCashPDF(v)
      setNotice(result.filename+' generated as an official A4 Petty Cash PDF.')
    } catch(err) {
      setError(err?.message||'Unable to download official Petty Cash PDF.')
    } finally {setBusy(false)}
  }

  async function inspect(v){
    setSelected(v)
    setMode('view')
    setAudit([])
    const res=await supabase.from('cash_voucher_audit_events').select('action,actor_id,created_at,details').eq('voucher_id',v.id).order('created_at',{ascending:true})
    if(!res.error)setAudit(res.data||[])
  }

  const field=(label,key,type='text',options=null)=>(
    <label key={key} style={{display:'flex',flexDirection:'column',gap:5,fontSize:13}}>
      <span>{label}</span>
      {options?<select style={inputStyle} value={form[key]||''} onChange={e=>setField(key,e.target.value)}>
        <option value="">— Select —</option>{selectOptions(options)}
      </select>:<input type={type} style={inputStyle} value={form[key]||''}
        onChange={e=>setField(key,e.target.value)}/>}
    </label>
  )
  const expenseCategories=form.source_sheet==='PC (Manual)'?CV_EXPENSE_CATEGORIES_MANUAL:CV_EXPENSE_CATEGORIES_DIGITAL
  const tenRows=Array.from({length:10},(_,i)=>({...blankCVLine(),...(form.lines?.[i]||{})}))
  const selectCell=(line,rowIndex,key,options)=>(
    <select aria-label={key+' row '+(rowIndex+1)} style={{...inputStyle,minWidth:116}}
      value={line[key]||''} onChange={e=>setLine(rowIndex,key,e.target.value)}>
      <option value="">— Select —</option>{selectOptions(options)}
    </select>
  )
  const textCell=(line,rowIndex,key,type='text')=>(
    <input aria-label={key+' row '+(rowIndex+1)} type={type} style={{...inputStyle,minWidth:key==='description'?190:115}}
      value={line[key]||''} onChange={e=>setLine(rowIndex,key,e.target.value)}/>
  )

  return <section className="panel" style={{maxWidth:'100%',overflow:'hidden'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'center'}}>
      <div><h2 style={{marginBottom:5}}>Petty Cash</h2>
        <p style={{marginTop:0}}>Finance HOD approval required for initial rollout. Other-department HOD approvals are deferred.</p>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {mode!=='home'&&<button type="button" className="btn" onClick={()=>{setMode('home');setError('')}}>Back to Petty Cash Dashboard</button>}
        {isAP&&<button type="button" className="btn" onClick={newForm}>+ New Petty Cash</button>}
      </div>
    </div>
    {isAdmin&&<p className="pv-notice" role="status">SYSTEM ADMIN — VIEW ALL / READ ONLY. No business actions permitted.</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&<p className="pv-success" role="status">{notice}</p>}
    {mode==='home'&&<>
      
      <JIMSPettyCashRevisionPanel profile={profile} /><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:10,margin:'18px 0'}}>
        {[['Draft',totals.draft],['Pending Finance Approval',totals.pending_approval],['Action Required',myAttention]].map(([k,n])=>
          <div key={k} style={{border:'1px solid #9a7b3c',borderRadius:10,padding:14}}>
            <div style={{fontSize:12,opacity:.9}}>{k}</div><strong style={{fontSize:26}}>{n}</strong>
          </div>)}
      </div>
      <section style={{border:'1px solid #81704c',borderRadius:9,padding:12,marginBottom:18}}>
        <h3>Official Petty Cash Excel Template</h3>
        
        {templateReady?<a className="btn" href={CV_TEMPLATE_URL} download="FIN_FM_PC_Petty Cash.xlsx">Download Original Excel Template</a>:
          <p className="pv-notice">Official template is not installed in public/templates yet. Upload the original unchanged XLSX file to enable download.</p>}
        {isAP&&<div style={{marginTop:12,display:'flex',gap:12,alignItems:'end',flexWrap:'wrap'}}>
          <label>Import worksheet
            <select style={{...inputStyle,marginTop:5}} value={sheetForImport} onChange={e=>setSheetForImport(e.target.value)}>
              {selectOptions(CV_SHEETS)}
            </select>
          </label>
          <label>Upload Completed Official CV Excel (.xlsx)
            <input style={{...inputStyle,marginTop:5}} type="file" accept=".xlsx" disabled={busy||isMobileUpload} onChange={uploadExcel}/>
          </label>
        </div>}
      </section>
      <h3>Petty Cash Records</h3>
      <div style={{display:'flex',gap:8,margin:'10px 0',flexWrap:'wrap'}}>
        {['active','draft','pending_approval'].map(s=>
          <button key={s} type="button" style={smallButton} aria-pressed={filter===s} onClick={()=>setFilter(s)}>
            {s==='active'?'ACTIVE':s.replaceAll('_',' ').toUpperCase()}
          </button>)}
        <button type="button" disabled={loading} style={smallButton} onClick={reload}>Refresh</button>
      </div>
      <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',minWidth:870}}>
        <thead><tr>{['CV Number','Claimant','Department','Amount','Status','Applicable HOD','HOD FM','Date','Action'].map(s=><th key={s} style={cellStyle}>{s}</th>)}</tr></thead>
        <tbody>
          {displayRows.map(v=><tr key={v.id}>
            <td style={cellStyle}>{v.cv_number}</td><td style={cellStyle}>{v.form_data?.claimant_name||'—'}</td>
            <td style={cellStyle}>{v.applicable_department||'—'}</td><td style={cellStyle}>{money(v.total_amount)}</td>
            <td style={cellStyle}>{v.status==='pending_approval'?'Pending Finance Approval':v.status.toUpperCase()}</td>
            <td style={cellStyle}>{hasApproval(v.id,'applicable_hod')?'Signed (legacy)':'Not required'}</td>
            <td style={cellStyle}>{hasApproval(v.id,'finance_hod')?'Signed':'Pending'}</td>
            <td style={cellStyle}>{dateLabel(v.created_at)}</td>
            <td style={cellStyle}>
              <button type="button" style={smallButton} onClick={()=>inspect(v)}>View</button>
              {isAP&&v.status==='draft'&&<button type="button" style={smallButton} onClick={()=>editForm(v)}>Edit</button>}
              {isAP&&v.status==='draft'&&<button type="button" style={smallButton} disabled={busy} onClick={()=>submitCV(v)}>Submit</button>}
            </td>
          </tr>)}
          {!displayRows.length&&<tr><td style={cellStyle} colSpan={9}>{loading?'Loading Petty Cash records...':'No matching Petty Cash records'}</td></tr>}
        </tbody>
      </table></div>
      {isHOD&&<>
        <h3 style={{marginTop:22}}>Finance HOD Verification / Bulk Approval</h3>
        
        <p>Finance HOD signs the Petty Cash verification. Applicable HOD approval is not required during the Finance-only rollout.</p>
        <div style={{margin:'12px 0',maxWidth:700}}>
          {stageRows.map(v=><label key={v.id} style={{display:'flex',alignItems:'center',gap:10,margin:'8px 0',padding:9,border:'1px solid #5b5b5b55',borderRadius:7}}>
            <input type="checkbox" checked={checked.includes(v.id)}
              onChange={e=>setChecked(prev=>e.target.checked?[...prev,v.id]:prev.filter(x=>x!==v.id))}/>
            <span>{v.cv_number} · {v.form_data?.claimant_name||'—'} · {money(v.total_amount)}</span>
            <button type="button" style={smallButton} onClick={()=>inspect(v)}>View</button>
          </label>)}
          {!stageRows.length&&<p>No Petty Cash records awaiting this HOD approval stage.</p>}
        </div>
        {checked.length>0&&<>
          <p><strong>{checked.length} selected</strong> · Confirm documents before signing.</p>
          <SignaturePad key={approvalStage} onSignatureChange={setSignature}/>
          <button type="button" className="btn" disabled={!signature||busy} onClick={signSelected}
            style={{marginTop:10}}>Digitally Sign & Approve {checked.length} CV(s)</button>
        </>}
      </>}
      <section className="jims-closed-history" aria-label="Petty Cash History">
        <h3>Petty Cash History</h3>
        <p>Closed records after Finance HOD signature. Historical Applicable HOD signatures, if any, remain visible; original Excel layout remains unchanged.</p>
        <details>
          <summary>View Closed Petty Cash ({historyRows.length} loaded records)</summary>
          <div className="jims-history-scroll">
            <table>
              <thead><tr><th>CV Number</th><th>Claimant</th><th>Amount</th>
                <th>Status</th><th>Date</th><th>Action</th></tr></thead>
              <tbody>
                {historyRows.map(v=><tr key={v.id}>
                  <td>{v.cv_number}</td>
                  <td>{v.form_data?.claimant_name||'—'}</td>
                  <td>{money(v.total_amount)}</td>
                  <td>Closed</td>
                  <td>{dateLabel(v.created_at)}</td>
                  <td><button type="button" style={smallButton}
                    onClick={()=>inspect(v)}>View</button></td>
                </tr>)}
                {!historyRows.length&&<tr><td colSpan={6}>No Closed Petty Cash yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <small>Showing records currently loaded, up to the latest 500. Original approval audit and signed Excel remain available.</small>
        </details>
      </section>
    </>}
    {mode==='form'&&isAP&&<>
      
      <JIMSPettyCashChargeFields form={form} setForm={setForm} /><h3>{editingId?'Edit Petty Cash Draft':'New Petty Cash'}</h3>
      
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(215px,1fr))',gap:12}}>
        {field('Date of Request (H10)','date_of_request','date')}
        {field('Actual Petty Cash Disbursement Date (system record)','date_disbursed','date')}
        {field('Claimant Name (D13)','claimant_name')}
        {field('Staff ID (D14)','staff_id')}
        {field('Position (D15)','position')}
        {field('Department (D16)','department','text',CV_DEPARTMENTS)}
        {field('Branch (D17)','branch','text',CV_BRANCHES)}
        {field('Claim Category (G13)','claim_category','text',CV_CLAIM_CATEGORIES)}
        {field('Sheet / Expense Category Dropdown Set','source_sheet','text',CV_SHEETS)}
        {field('Extra Category (C18, legacy dropdown)','legacy_category','text',CV_EXTRA_C18)}
      </div>
      <label style={{display:'block',marginTop:15}}>Remarks Claim (G14:I16)
        <textarea style={{...inputStyle,minHeight:65}} value={form.remarks||''} onChange={e=>setField('remarks',e.target.value)}/>
      </label>
      <p>Payment Method (G17:I17): <strong>Cash (Petty Cash)</strong></p>
      <h3>Expense Details — Maximum 10 Receipt Lines</h3>
      <p style={{fontSize:12}}>Receipt required per row (PDF/image, max 10 MB). Re-upload after editing a row. Desktop upload only.</p>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',minWidth:1220,width:'100%'}}>
          <thead><tr>{['No.','Receipt Date','Receipt No.','Supplier / Description / Purpose','Expense Category (Finance Use Only)','Expenses for Branch','Amount (RM)','Receipt Attached?','Upload Receipt *'].map(h=><th key={h} style={cellStyle}>{h}</th>)}</tr></thead>
          <tbody>{tenRows.map((line,i)=><tr key={i}>
            <td style={cellStyle}>{i+1}</td>
            <td style={cellStyle}>{textCell(line,i,'receipt_date','date')}</td>
            <td style={cellStyle}>{textCell(line,i,'receipt_no')}</td>
            <td style={cellStyle}>{textCell(line,i,'description')}</td>
            <td style={cellStyle}>{selectCell(line,i,'expense_category',expenseCategories)}</td>
            <td style={cellStyle}>{selectCell(line,i,'expenses_branch',CV_BRANCHES)}</td>
            <td style={cellStyle}>{textCell(line,i,'amount','number')}</td>
            <td style={cellStyle}>{selectCell(line,i,'receipt_attached',['Yes','No'])}</td>
            <td style={cellStyle}>
              <input type="file" aria-label={'Upload receipt for expense row '+(i+1)}
                accept={CV_RECEIPT_ACCEPT}
                disabled={busy||isMobileUpload||!hasCVLineData(line)}
                onChange={e=>uploadReceipt(i,e)}
                style={{maxWidth:220,fontSize:12}} />
              {editingId&&receiptFor(editingId,i+1)&&
                <div style={{marginTop:5,fontSize:12}}>
                  <span style={{color:'#56b78b'}}>Uploaded: </span>
                  <button type="button" style={smallButton} onClick={()=>openReceipt(receiptFor(editingId,i+1))}>
                    {receiptFor(editingId,i+1).original_file_name}
                  </button>
                </div>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      <p style={{marginTop:13}}><strong>TOTAL CLAIM (RM): {money(tenRows.reduce((acc,l)=>acc+(Number(l.amount)||0),0))}</strong></p>
      
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button type="button" className="btn" disabled={busy} onClick={saveDraft}>Save CV Draft</button>
        <button type="button" style={smallButton} onClick={()=>setMode('home')}>Back to Dashboard</button>
      </div>
    </>}
    {mode==='view'&&selected&&<>
      <h3>{selected.cv_number} — CV Record</h3>
      <p><strong>Status: {selected.status.toUpperCase()}</strong> · {money(selected.total_amount)}</p>
      <dl>
        {[['Claimant',selected.form_data?.claimant_name],['Staff ID',selected.form_data?.staff_id],
          ['Department',selected.applicable_department],['Branch',selected.form_data?.branch],
          ['Claim Category',selected.form_data?.claim_category],['Disbursement Date',selected.form_data?.date_disbursed],
          ['Remarks',selected.form_data?.remarks]].map(([label,value])=>
          <div key={label} style={{marginBottom:6}}><dt style={{display:'inline',fontWeight:600}}>{label}: </dt><dd style={{display:'inline',margin:0}}>{value||'—'}</dd></div>)}
      </dl>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',minWidth:700,borderCollapse:'collapse'}}>
        <thead><tr>{['Receipt Date','Receipt No.','Description','Expense Category','Branch','Amount','Attached?','Receipt File'].map(h=><th key={h} style={cellStyle}>{h}</th>)}</tr></thead>
        <tbody>{(selected.form_data?.lines||[]).map((l,i)=><tr key={i}>
          <td style={cellStyle}>{l.receipt_date}</td><td style={cellStyle}>{l.receipt_no}</td>
          <td style={cellStyle}>{l.description}</td><td style={cellStyle}>{l.expense_category}</td>
          <td style={cellStyle}>{l.expenses_branch}</td><td style={cellStyle}>{money(l.amount)}</td>
          <td style={cellStyle}>{l.receipt_attached}</td>
          <td style={cellStyle}>{receiptFor(selected.id,i+1)?<button type="button" style={smallButton} onClick={()=>openReceipt(receiptFor(selected.id,i+1))}>View Receipt</button>:'Missing receipt'}</td>
        </tr>)}</tbody></table></div>
      {selected.status!=='draft'&&<div style={{margin:'14px 0',display:'flex',flexDirection:'column',alignItems:'flex-start',gap:6}}>
        <button type="button" className="btn" disabled={busy||!templateReady} onClick={()=>downloadSigned(selected)}>
          Download Signed CV Excel (Print / PDF)
        </button>
        <small>PDF: Open signed Excel → Save as PDF.</small>
      </div>}
      <h3>Digital Signatures</h3>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        {['applicable_hod','finance_hod'].map(authority=>{
          const approval=byId(selected.id).find(x=>x.authority===authority)
          return <div key={authority} style={{border:'1px solid #a48a53',padding:10,borderRadius:8,minWidth:230}}>
            <strong>{authority==='applicable_hod'?'Applicable HOD (legacy)':'HOD FM'}</strong>
            <p>{approval?'Approved & Signed':authority==='applicable_hod'?'Not required during initial rollout':'Pending'}</p>
            {approval&&<div data-jsync-cv-signature-capture={authority} style={{display:'flex',flexDirection:'column',alignItems:'center',background:'transparent',width:'100%',gap:0}}><img alt={'Digital signature '+authority} src={approval.signature_png}
              style={{maxWidth:220,maxHeight:90,background:'transparent'}}/>
              <div style={{fontFamily:'"Monotype Corsiva","Apple Chancery","Brush Script MT",cursive',fontSize:26,fontStyle:'italic',color:'#c5a05b',lineHeight:1.1,maxWidth:230,overflowWrap:'anywhere'}}>
                {approval.approved_username||'Signer username not recorded'}
              </div>
              <p style={{fontSize:16,margin:'4px 0 0'}}>Date: {new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(approval.approved_at))}</p></div>}
          </div>
        })}
      </div>
      <h3>Audit Trail</h3>
      <ul>{audit.map((a,i)=><li key={i}>{dateLabel(a.created_at)} — {a.action}</li>)}</ul>
      {isAP&&selected.status==='draft'&&<button type="button" className="btn" onClick={()=>editForm(selected)}>Edit Draft</button>}
      {isAP&&selected.status==='draft'&&<button type="button" className="btn" disabled={busy} onClick={()=>submitCV(selected)}>Submit for Finance HOD Approval</button>}
      {isHOD&&(canSign(selected,'applicable_hod')||canSign(selected,'finance_hod'))&&
        <p>To approve, return to the dashboard, select this CV in the HOD verification section and draw your digital signature.</p>}
    </>}
  </section>
}
