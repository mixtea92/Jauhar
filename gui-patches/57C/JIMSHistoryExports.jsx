// JIMS Step57C7B — Export Finance operational histories and Owner-only Approval History.
// Every download obtains fresh authorized data from Supabase; no browser-side RLS bypass.
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const AP_UNITS = new Set(['Accounts Payable', 'Accounting'])
const isAP = p => p?.is_active === true &&
  p.department === 'Finance' &&
  ['executive', 'manager'].includes(p.role) &&
  AP_UNITS.has(p.subdepartment)

const SPECS = {
  pv_history: [
    ['pv_number','PV Number'],['financial_tier','Tier'],['tier_version','Tier Policy'],
    ['department','Origin Department'],['charge_department','Charge Department'],
    ['charge_subdepartment','Charge Subdepartment'],['branch','Branch'],
    ['cost_center','Cost Center'],['budget_code','Budget Code'],
    ['payee','Payee'],['purpose','Purpose'],['amount','Amount (RM)'],
    ['approval_status','Approval Status'],['payment_status','Payment Status'],
    ['payment_mode','Payment Mode'],['created_at','Created (MYT)'],
    ['final_approval_date','Final Approved (MYT)'],['payment_date','Payment Date'],
    ['archived','Archived']
  ],
  payment_process_history: [
    ['pv_number','PV Number'],['installment_no','Tranche No.'],
    ['requested_amount','Requested (RM)'],['settled_amount','Settled (RM)'],
    ['status','Payment Status'],['review_decision','FM Review Decision'],
    ['review_remarks','Review Remarks'],['bank_transaction_reference','Bank Reference'],
    ['payment_date','Payment Date'],['created_at','Created (MYT)'],
    ['initiated_at','Initiated (MYT)'],['reviewed_at','Reviewed (MYT)'],
    ['completed_at','Completed (MYT)'],['voided_at','Voided (MYT)'],
    ['void_reason','Void Reason']
  ],
  petty_cash_history: [
    ['cv_number','Petty Cash No.'],['department','Department'],['branch','Branch'],
    ['cost_center','Cost Center'],['claimant','Claimant'],
    ['amount','Amount (RM)'],['status','Status'],['receipt_count','Receipts'],
    ['created_at','Created (MYT)'],['submitted_at','Submitted (MYT)'],
    ['closed_at','Closed (MYT)']
  ],
  pv_operational_events_history: [
    ['pv_number','PV Number'],['action','Operational Event'],['actor','Performed By'],
    ['event_time','Timestamp (MYT)'],['details','Details (JSON)']
  ],
  petty_cash_operational_events_history: [
    ['cv_number','Petty Cash Number'],['action','Operational Event'],
    ['actor','Performed By'],['event_time','Timestamp (MYT)'],['details','Details (JSON)']
  ],
  pv_approval_history: [
    ['pv_number','PV Number'],['financial_tier','Tier'],
    ['tier_policy_version','Tier Version'],['branch','Branch'],
    ['department','Department'],['payee','Payee'],['amount','Amount (RM)'],
    ['round','Approval Round'],['authority','Authority'],['action','Decision'],
    ['actor','Decision By'],['remarks','Remarks'],['event_time','Timestamp (MYT)']
  ],
  petty_cash_approval_history: [
    ['cv_number','PC Number'],['department','Department'],['amount','Amount (RM)'],
    ['status','Status'],['authority','Authority'],['actor','Signed By'],
    ['approval_time','Approved At (MYT)']
  ],
  delegation_approval_history: [
    ['action','Action'],['authority','Authority'],['department','Department'],
    ['delegation_status','Delegation Status'],['actor','Action By'],
    ['principal','Principal'],['delegate','Delegate'],['details','Details'],
    ['event_time','Timestamp (MYT)']
  ]
}
const DATE_KEYS = new Set([
  'created_at','submitted_at','closed_at','created_at','final_approval_date','payment_date',
  'initiated_at','reviewed_at','completed_at','voided_at','event_time','approval_time'
])
const pureDateKeys = new Set(['payment_date'])
const MONEY_KEYS = new Set(['amount','requested_amount','settled_amount'])
const numberKeys = new Set(['installment_no','round','receipt_count'])

function safeText(v){
  if(v==null)return ''
  if(typeof v==='object')v=JSON.stringify(v)
  const value=String(v)
  // Avoid Excel formula injection: CSV-style formula characters still need protection in XLSX.
  return /^[\s]*[=+\-@\t\r]/.test(value) ? "'"+value : value
}
function cellValue(key,value){
  if(value==null)return ''
  if(typeof value==='boolean')return value?'Yes':'No'
  if(MONEY_KEYS.has(key)||numberKeys.has(key)){
    const n=Number(value);return Number.isFinite(n)?n:safeText(value)
  }
  if(DATE_KEYS.has(key)&&value){
    if(pureDateKeys.has(key))return safeText(value)
    const d=new Date(value)
    if(Number.isFinite(d.getTime())){
      return new Intl.DateTimeFormat('en-GB',{
        timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
      }).format(d)
    }
  }
  return safeText(value)
}
async function writeExcel(data,sections,kind){
  const ExcelJS=(await import('exceljs')).default
  const wb=new ExcelJS.Workbook()
  wb.creator='JIMS — JAUHAR Integrated Management System'
  wb.created=new Date()
  for(const [key,sheetTitle] of sections){
    const cols=SPECS[key]
    const ws=wb.addWorksheet(sheetTitle,{views:[{state:'frozen',ySplit:1}]})
    ws.addRow(cols.map(([,title])=>title))
    const head=ws.getRow(1)
    head.font={bold:true,color:{argb:'FFFFD887'}}
    head.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF202023'}}
    head.alignment={vertical:'middle',wrapText:true}
    head.height=30
    const rows=Array.isArray(data?.[key])?data[key]:[]
    for(const row of rows){
      const added=ws.addRow(cols.map(([field])=>cellValue(field,row?.[field])))
      added.eachCell((cell,i)=>{
        const keyName=cols[i-1][0]
        if(MONEY_KEYS.has(keyName)&&typeof cell.value==='number')cell.numFmt='#,##0.00'
        cell.alignment={vertical:'top',wrapText:false}
      })
    }
    ws.columns=cols.map(([key,title])=>({
      key,width:Math.min(52,Math.max(15,title.length+3,key.includes('remarks')?28:20))
    }))
    ws.autoFilter={from:'A1',to:{row:1,column:cols.length}}
  }
  const stamp=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date()).replaceAll('/','-')
  const buffer=await wb.xlsx.writeBuffer()
  const blob=new Blob([buffer],{
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  const href=URL.createObjectURL(blob)
  try{
    const a=document.createElement('a')
    a.href=href
    a.download='JIMS_'+kind+'_'+stamp+'.xlsx'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }finally{
    window.setTimeout(()=>URL.revokeObjectURL(href),12000)
  }
}

export default function JIMSHistoryExports({profile}){
  const [owner,setOwner]=useState(false)
  const [checking,setChecking]=useState(true)
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const apEligible=isAP(profile)

  useEffect(()=>{
    let alive=true
    async function check(){
      if(profile?.role!=='system_admin'||!profile?.is_active){
        if(alive){setOwner(false);setChecking(false)};return
      }
      setChecking(true)
      const {data,error:e}=await supabase.rpc('jims_is_system_owner_v1')
      if(alive){setOwner(!e&&data===true);setChecking(false)}
    }
    void check()
    return ()=>{alive=false}
  },[profile?.role,profile?.is_active])

  async function download(type,sections,kind){
    if(busy || !((type==='ap'&&apEligible)||(type==='owner'&&owner)))return
    setBusy(kind);setError('');setNotice('')
    try{
      const rpc=type==='owner'
        ?'jims_owner_approval_history_export_v1'
        :'jims_finance_ap_operational_history_export_v1'
      const {data,error:e}=await supabase.rpc(rpc)
      if(e)throw e
      if(!data||typeof data!=='object')throw new Error('No export result')
      for(const [key] of sections){
        if(!Array.isArray(data[key]))throw new Error('Invalid history dataset '+key)
      }
      await writeExcel(data,sections,kind)
      const count=sections.reduce((n,[key])=>n+data[key].length,0)
      setNotice('Excel prepared: '+count+' rows across '+sections.length+' sheet(s).')
    }catch(e){setError(e.message||'Excel export failed.')}finally{setBusy('')}
  }

  if(!apEligible&&!owner){
    return <section className="panel">
      <h2>History Exports</h2>
      <p className="muted">{checking?'Checking System Owner authorization...':
        'Access restricted. AP operational exports require Accounts Payable / Accounting; approval history exports require the designated System Owner.'}</p>
    </section>
  }

  const allAP=[['pv_history','Payment Vouchers'],['payment_process_history','Payment Process'],['petty_cash_history','Petty Cash'],['pv_operational_events_history','PV Events'],['petty_cash_operational_events_history','Petty Cash Events']]
  const ownerSheets=[['pv_approval_history','PV Approvals'],['petty_cash_approval_history','PC Approvals'],['delegation_approval_history','Delegation Approvals']]
  const buttonStyle={padding:'10px 14px',fontWeight:700,marginRight:10,marginBottom:10}
  return <section className="panel" aria-label="JIMS Excel history exports">
    <h2>JIMS History Exports</h2>
    <p className="muted">Exports are .xlsx, all authorized records (not just the visible page). Private receipt files and bank account numbers are not embedded.</p>
    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&<p className="pv-success" role="status">{notice}</p>}
    {apEligible&&<div style={{marginBottom:23}}>
      <h3>AP Operational History</h3>
      <p className="muted">Accounts Payable and Accounting only. Contains no approval decision history.</p>
      <button className="btn" type="button" disabled={!!busy} style={buttonStyle}
        onClick={()=>download('ap',allAP,'AP_All_Operational_History')}>
        {busy==='AP_All_Operational_History'?'Exporting...':'Export All AP History (.xlsx)'}
      </button>
      {allAP.map(([key,title])=><button className="btn" type="button"
        key={key} disabled={!!busy} style={{...buttonStyle,background:'#6d5731'}}
        onClick={()=>download('ap',[[key,title]],title.replaceAll(' ','_')+'_History')}>
        Export {title}
      </button>)}
    </div>}
    {owner&&<div>
      <h3>System Owner — Approval History</h3>
      <p className="muted">Designated System Owner only. Read-only; no approval or financial posting privileges.</p>
      <button className="btn" type="button" disabled={!!busy} style={buttonStyle}
        onClick={()=>download('owner',ownerSheets,'OWNER_Approval_History')}>
        {busy==='OWNER_Approval_History'?'Exporting...':'Export All Approval History (.xlsx)'}
      </button>
    </div>}
  </section>
}
