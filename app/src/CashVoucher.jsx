import { useEffect,useMemo,useRef,useState } from 'react'
import { supabase } from './lib/supabase'
import {
  CV_TEMPLATE_URL,CV_BRANCHES,CV_DEPARTMENTS,CV_SHEETS,
  CV_CLAIM_CATEGORIES,CV_EXTRA_C18,
  CV_EXPENSE_CATEGORIES_DIGITAL,CV_EXPENSE_CATEGORIES_MANUAL,
  blankCVForm,blankCVLine,hasCVLineData,parseCVWorkbook
} from './cashVoucherExcel'

// JSYNC CV V1 is an independent post-disbursement documentation module.
// NO payment initiation, payment execution, or PV workflow modification.

const money = value => 'RM '+Number(value||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})
const dateLabel = value => value?new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}):'—'
const inputStyle={padding:'9px 10px',borderRadius:7,border:'1px solid #a4a8b3',minWidth:0,width:'100%'}
const cellStyle={padding:8,borderBottom:'1px solid #7d849755',verticalAlign:'middle'}
const smallButton={padding:'7px 11px',border:'1px solid #8e742c',borderRadius:7,cursor:'pointer'}
const selectOptions = (values) => values.map(x=><option key={x} value={x}>{x}</option>)
const normalized = form => ({...form,lines:(form.lines||[]).filter(hasCVLineData).map(l=>({...blankCVLine(),...l}))})

function SignaturePad({onSignatureChange}) {
  const ref=useRef(null)
  const drawing=useRef(false)
  const [signed,setSigned]=useState(false)
  function point(event){
    const c=ref.current,rect=c.getBoundingClientRect()
    return {x:(event.clientX-rect.left)*c.width/rect.width,y:(event.clientY-rect.top)*c.height/rect.height}
  }
  function start(event){
    const c=ref.current,ctx=c.getContext('2d'),p=point(event)
    c.setPointerCapture(event.pointerId)
    ctx.strokeStyle='#0c2341'
    ctx.lineWidth=2.8
    ctx.lineCap='round'
    ctx.lineJoin='round'
    ctx.beginPath()
    ctx.moveTo(p.x,p.y)
    ctx.lineTo(p.x+0.1,p.y+0.1)
    ctx.stroke()
    drawing.current=true
    setSigned(true)
  }
  function move(event){
    if(!drawing.current)return
    const c=ref.current,p=point(event),ctx=c.getContext('2d')
    ctx.lineTo(p.x,p.y);ctx.stroke()
  }
  function end(){
    if(!drawing.current)return
    drawing.current=false
    onSignatureChange(ref.current.toDataURL('image/png'))
  }
  function clear(){
    const c=ref.current
    c.getContext('2d').clearRect(0,0,c.width,c.height)
    setSigned(false)
    onSignatureChange('')
  }
  return <div style={{maxWidth:460}}>
    <p style={{marginBottom:6}}>Draw your digital signature below. This signature is attached to each selected CV approval.</p>
    <canvas ref={ref} width={460} height={145}
      style={{width:'100%',background:'#fff',border:'2px solid #ae9460',borderRadius:8,touchAction:'none',cursor:'crosshair'}}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    <button type="button" style={{...smallButton,marginTop:6}} onClick={clear}>Clear Signature</button>
    <span style={{marginLeft:12,fontSize:12}}>{signed?'Signature drawn':'Signature required'}</span>
  </div>
}

export default function CashVoucher({profile}) {
  const isAdmin=profile?.is_active===true && profile?.role==='system_admin'
  const isAP=profile?.is_active===true && profile?.role==='executive' && profile?.department==='Finance'
  const isHOD=profile?.is_active===true && profile?.role==='manager'
  const [rows,setRows]=useState([])
  const [approvals,setApprovals]=useState([])
  const [audit,setAudit]=useState([])
  const [mode,setMode]=useState('home')
  const [selected,setSelected]=useState(null)
  const [editingId,setEditingId]=useState(null)
  const [form,setForm]=useState(blankCVForm)
  const [sheetForImport,setSheetForImport]=useState('PC (Digital)')
  const [checked,setChecked]=useState([])
  const [approvalStage,setApprovalStage]=useState('applicable_hod')
  const [signature,setSignature]=useState('')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [templateReady,setTemplateReady]=useState(false)
  const [refresh,setRefresh]=useState(0)
  const [filter,setFilter]=useState('all')

  useEffect(()=>{
    let live=true
    const get=async()=>{
      setLoading(true)
      const [vs,as]=await Promise.all([
        supabase.from('cash_vouchers').select('*').order('created_at',{ascending:false}).limit(500),
        supabase.from('cash_voucher_approvals').select('id,voucher_id,authority,approved_by,approved_at,signature_png').limit(1000)
      ])
      if(!live)return
      if(vs.error||as.error)setError(vs.error?.message||as.error?.message)
      else {setRows(vs.data||[]);setApprovals(as.data||[])}
      setLoading(false)
    }
    get().catch(e=>{if(live){setError(e?.message||'Could not load CV records');setLoading(false)}})
    return ()=>{live=false}
  },[refresh])

  useEffect(()=>{
    let live=true
    // The master XLSX is an exact unchanged file placed in public/templates.
    fetch(CV_TEMPLATE_URL,{method:'GET'}).then(async r=>{
      if(!live)return
      const type=r.headers.get('content-type')||''
      setTemplateReady(r.ok && !type.includes('text/html') && (await r.arrayBuffer()).byteLength>10000)
    }).catch(()=>{if(live)setTemplateReady(false)})
    return ()=>{live=false}
  },[])

  const byId=id=>approvals.filter(a=>a.voucher_id===id)
  const hasApproval=(id,authority)=>approvals.some(a=>a.voucher_id===id&&a.authority===authority)
  const canSign=(v,authority)=>{
    if(!isHOD||!v||v.status!=='pending_approval'||hasApproval(v.id,authority))return false
    return authority==='finance_hod' ? profile.department==='Finance' : profile.department===v.applicable_department
  }
  const stageRows=rows.filter(v=>canSign(v,approvalStage))
  const displayRows=rows.filter(v=>filter==='all'||v.status===filter)
  const totals=useMemo(()=>{
    const out={draft:0,pending_approval:0,closed:0,total:0}
    rows.forEach(v=>{out[v.status]=(out[v.status]||0)+1;out.total+=Number(v.total_amount||0)})
    return out
  },[rows])
  const myAttention=rows.filter(v=>canSign(v,'applicable_hod')||canSign(v,'finance_hod')).length

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
  async function uploadExcel(e){
    if(!isAP)return
    const f=e.target.files?.[0]
    if(!f)return
    setError('');setNotice('');setBusy(true)
    try{
      const parsed=await parseCVWorkbook(f,sheetForImport)
      setForm(parsed);setEditingId(null);setMode('form')
      setNotice('Excel imported. Check all details, especially the actual disbursement date, before saving.')
    }catch(err){setError(err?.message||'Excel import failed')}
    finally{setBusy(false);e.target.value=''}
  }
  function setField(key,value){setForm(f=>({...f,[key]:value}))}
  function setLine(i,key,value){
    setForm(f=>{
      const lines=Array.from({length:10},(_,n)=>({...blankCVLine(),...(f.lines?.[n]||{})}))
      lines[i]={...lines[i],[key]:value}
      return {...f,lines}
    })
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
    if(!window.confirm('Submit '+v.cv_number+' for BOTH Applicable HOD and HOD FM signed verification?'))return
    const result=await action('CV submitted for dual HOD verification.',()=>supabase.rpc('jsync_cv_submit_v1',{p_voucher_id:v.id}))
    if(result)setMode('home')
  }
  async function signSelected(){
    if(!isHOD||busy||!signature||!checked.length)return
    const eligible=checked.filter(id=>stageRows.some(v=>v.id===id))
    if(eligible.length!==checked.length){setError('One or more selected CVs are not eligible for this approval stage.');return}
    if(!window.confirm('Digitally sign and approve '+checked.length+' Cash Voucher(s) as '+(approvalStage==='finance_hod'?'HOD FM':'Applicable HOD')+'? Each CV will receive its own approval and audit record.'))return
    const result=await action('Signed approvals recorded: '+checked.length+' CV(s).',()=>supabase.rpc('jsync_cv_approve_many_v1',{
      p_voucher_ids:eligible,p_authority:approvalStage,p_signature_png:signature
    }))
    if(result){setChecked([]);setSignature('');setMode('home')}
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
      <div><h2 style={{marginBottom:5}}>Cash Voucher (Petty Cash)</h2>
        <p style={{marginTop:0}}>Post-disbursement recording, dual HOD approval with digital signatures, then CLOSED.</p>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {mode!=='home'&&<button type="button" className="btn" onClick={()=>{setMode('home');setError('')}}>Back to CV Dashboard</button>}
        {isAP&&<button type="button" className="btn" onClick={newForm}>+ New Cash Voucher</button>}
      </div>
    </div>
    {isAdmin&&<p className="pv-notice" role="status">SYSTEM ADMIN — VIEW ALL / READ ONLY. No business actions permitted.</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&<p className="pv-success" role="status">{notice}</p>}
    {mode==='home'&&<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:10,margin:'18px 0'}}>
        {[['Draft',totals.draft],['Pending Dual HOD',totals.pending_approval],['Closed',totals.closed],['Action Required',myAttention]].map(([k,n])=>
          <div key={k} style={{border:'1px solid #9a7b3c',borderRadius:10,padding:14}}>
            <div style={{fontSize:12,opacity:.9}}>{k}</div><strong style={{fontSize:26}}>{n}</strong>
          </div>)}
      </div>
      <section style={{border:'1px solid #81704c',borderRadius:9,padding:12,marginBottom:18}}>
        <h3>Official Petty Cash Excel Template</h3>
        <p>Original workbook, unchanged: PC (Digital), PC (Manual), List Expenses Category; A4 portrait one-page print areas.</p>
        {templateReady?<a className="btn" href={CV_TEMPLATE_URL} download="FIN_FM_PC_Petty Cash.xlsx">Download Original Excel Template</a>:
          <p className="pv-notice">Official template is not installed in public/templates yet. Upload the original unchanged XLSX file to enable download.</p>}
        {isAP&&<div style={{marginTop:12,display:'flex',gap:12,alignItems:'end',flexWrap:'wrap'}}>
          <label>Import worksheet
            <select style={{...inputStyle,marginTop:5}} value={sheetForImport} onChange={e=>setSheetForImport(e.target.value)}>
              {selectOptions(CV_SHEETS)}
            </select>
          </label>
          <label>Upload Completed Official CV Excel (.xlsx)
            <input style={{...inputStyle,marginTop:5}} type="file" accept=".xlsx" disabled={busy} onChange={uploadExcel}/>
          </label>
        </div>}
      </section>
      <h3>Cash Voucher Records</h3>
      <div style={{display:'flex',gap:8,margin:'10px 0',flexWrap:'wrap'}}>
        {['all','draft','pending_approval','closed'].map(s=>
          <button key={s} type="button" style={smallButton} aria-pressed={filter===s} onClick={()=>setFilter(s)}>
            {s==='all'?'All':s.replaceAll('_',' ').toUpperCase()}
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
            <td style={cellStyle}>{v.status==='pending_approval'?'Pending Dual Approval':v.status.toUpperCase()}</td>
            <td style={cellStyle}>{hasApproval(v.id,'applicable_hod')?'Signed':'Pending'}</td>
            <td style={cellStyle}>{hasApproval(v.id,'finance_hod')?'Signed':'Pending'}</td>
            <td style={cellStyle}>{dateLabel(v.created_at)}</td>
            <td style={cellStyle}>
              <button type="button" style={smallButton} onClick={()=>inspect(v)}>View</button>
              {isAP&&v.status==='draft'&&<button type="button" style={smallButton} onClick={()=>editForm(v)}>Edit</button>}
              {isAP&&v.status==='draft'&&<button type="button" style={smallButton} disabled={busy} onClick={()=>submitCV(v)}>Submit</button>}
            </td>
          </tr>)}
          {!displayRows.length&&<tr><td style={cellStyle} colSpan={9}>{loading?'Loading Cash Vouchers...':'No matching Cash Voucher records'}</td></tr>}
        </tbody>
      </table></div>
      {isHOD&&<>
        <h3 style={{marginTop:22}}>HOD Verification / Bulk Approval</h3>
        <p>Each selected CV receives a separate approval record and digital signature. Both stages must be signed before CLOSED.</p>
        <label>Verification Stage
          <select style={{...inputStyle,maxWidth:300,marginTop:5}} value={approvalStage}
            onChange={e=>{setApprovalStage(e.target.value);setChecked([]);setSignature('')}}>
            <option value="applicable_hod">Applicable HOD</option>
            {profile.department==='Finance'&&<option value="finance_hod">HOD FM</option>}
          </select>
        </label>
        <div style={{margin:'12px 0',maxWidth:700}}>
          {stageRows.map(v=><label key={v.id} style={{display:'flex',alignItems:'center',gap:10,margin:'8px 0',padding:9,border:'1px solid #5b5b5b55',borderRadius:7}}>
            <input type="checkbox" checked={checked.includes(v.id)}
              onChange={e=>setChecked(prev=>e.target.checked?[...prev,v.id]:prev.filter(x=>x!==v.id))}/>
            <span>{v.cv_number} · {v.form_data?.claimant_name||'—'} · {money(v.total_amount)}</span>
            <button type="button" style={smallButton} onClick={()=>inspect(v)}>View</button>
          </label>)}
          {!stageRows.length&&<p>No Cash Vouchers awaiting this HOD approval stage.</p>}
        </div>
        {checked.length>0&&<>
          <p><strong>{checked.length} selected</strong> · Confirm documents before signing.</p>
          <SignaturePad key={approvalStage} onSignatureChange={setSignature}/>
          <button type="button" className="btn" disabled={!signature||busy} onClick={signSelected}
            style={{marginTop:10}}>Digitally Sign & Approve {checked.length} CV(s)</button>
        </>}
      </>}
    </>}
    {mode==='form'&&isAP&&<>
      <h3>{editingId?'Edit Cash Voucher Draft':'New Cash Voucher'}</h3>
      <p>Enter the same fields as the official XLSX. No new payment is made. Entries must fit the original 10-row printed form.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(215px,1fr))',gap:12}}>
        {field('Date of Request (H10)','date_of_request','date')}
        {field('Actual Petty Cash Disbursement Date (system record)','date_disbursed','date')}
        {field('Claimant Name (D13)','claimant_name')}
        {field('Staff ID (D14)','staff_id')}
        {field('Position (D15)','position')}
        {field('Department / Applicable HOD (D16)','department','text',CV_DEPARTMENTS)}
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
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',minWidth:1050,width:'100%'}}>
          <thead><tr>{['No.','Receipt Date','Receipt No.','Supplier / Description / Purpose','Expense Category (Finance Use Only)','Expenses for Branch','Amount (RM)','Receipt Attached?'].map(h=><th key={h} style={cellStyle}>{h}</th>)}</tr></thead>
          <tbody>{tenRows.map((line,i)=><tr key={i}>
            <td style={cellStyle}>{i+1}</td>
            <td style={cellStyle}>{textCell(line,i,'receipt_date','date')}</td>
            <td style={cellStyle}>{textCell(line,i,'receipt_no')}</td>
            <td style={cellStyle}>{textCell(line,i,'description')}</td>
            <td style={cellStyle}>{selectCell(line,i,'expense_category',expenseCategories)}</td>
            <td style={cellStyle}>{selectCell(line,i,'expenses_branch',CV_BRANCHES)}</td>
            <td style={cellStyle}>{textCell(line,i,'amount','number')}</td>
            <td style={cellStyle}>{selectCell(line,i,'receipt_attached',['Yes','No'])}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p style={{marginTop:13}}><strong>TOTAL CLAIM (RM): {money(tenRows.reduce((acc,l)=>acc+(Number(l.amount)||0),0))}</strong></p>
      <p style={{fontSize:12}}>The official claimant declaration, approval boxes, acknowledgment, logo and print layout stay in the original Excel. HOD signatures are captured digitally during approval.</p>
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
        <thead><tr>{['Receipt Date','Receipt No.','Description','Expense Category','Branch','Amount','Attached?'].map(h=><th key={h} style={cellStyle}>{h}</th>)}</tr></thead>
        <tbody>{(selected.form_data?.lines||[]).map((l,i)=><tr key={i}>
          <td style={cellStyle}>{l.receipt_date}</td><td style={cellStyle}>{l.receipt_no}</td>
          <td style={cellStyle}>{l.description}</td><td style={cellStyle}>{l.expense_category}</td>
          <td style={cellStyle}>{l.expenses_branch}</td><td style={cellStyle}>{money(l.amount)}</td>
          <td style={cellStyle}>{l.receipt_attached}</td>
        </tr>)}</tbody></table></div>
      <h3>Digital Signatures</h3>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        {['applicable_hod','finance_hod'].map(authority=>{
          const approval=byId(selected.id).find(x=>x.authority===authority)
          return <div key={authority} style={{border:'1px solid #a48a53',padding:10,borderRadius:8,minWidth:230}}>
            <strong>{authority==='applicable_hod'?'Applicable HOD':'HOD FM'}</strong>
            <p>{approval?'Approved & Signed':'Pending'}</p>
            {approval&&<><img alt={'Digital signature '+authority} src={approval.signature_png}
              style={{maxWidth:220,maxHeight:90,background:'#fff'}}/>
              <p style={{fontSize:12}}>{dateLabel(approval.approved_at)}</p></>}
          </div>
        })}
      </div>
      <h3>Audit Trail</h3>
      <ul>{audit.map((a,i)=><li key={i}>{dateLabel(a.created_at)} — {a.action}</li>)}</ul>
      {isAP&&selected.status==='draft'&&<button type="button" className="btn" onClick={()=>editForm(selected)}>Edit Draft</button>}
      {isAP&&selected.status==='draft'&&<button type="button" className="btn" disabled={busy} onClick={()=>submitCV(selected)}>Submit for Dual Approval</button>}
      {isHOD&&(canSign(selected,'applicable_hod')||canSign(selected,'finance_hod'))&&
        <p>To approve, return to the dashboard, select this CV in the HOD verification section and draw your digital signature.</p>}
    </>}
  </section>
}
