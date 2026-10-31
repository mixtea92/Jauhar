// JIMS Step 57D3.7 — printable, operational Payment Process Audit (Excel).
// Additive button within existing Report Generation. NO approval-history export here.
import {useState} from 'react'
import {supabase} from './lib/supabase'

const summaryCols=[
 ['pv_number','PV Number'],['supplier','Supplier'],['invoice_reference','Invoice Reference'],
 ['tier','Tier'],['branch','Branch'],['department','Department'],['cost_center','Cost Center'],
 ['payment_mode','Payment Mode'],['payment_status','Payment Status'],
 ['approved_amount','Approved (RM)'],['paid_amount','Paid (RM)'],
 ['outstanding_amount','Outstanding (RM)'],['due_status','Due Status'],
 ['last_actual_payment_date','Latest Actual Payment'],['final_approved_at','Final Approved At']
]
const planningCols=[
 ['pv_number','PV Number'],['supplier','Supplier'],['branch','Branch'],
 ['original_due_date','Original Due'],['current_due_date','Current Due'],
 ['due_verified','FM Due Verified'],['ap_proposed_date','AP Proposed'],
 ['first_scheduled_date','First Approved Schedule'],['current_scheduled_date','Current Schedule'],
 ['schedule_scope','Schedule Scope'],['payment_status','Payment Status'],
 ['last_actual_payment_date','Latest Actual Payment'],['full_payment_bank_reference','Full Bank Reference']
]
const trancheCols=[
 ['pv_number','PV Number'],['tranche_no','Tranche #'],['requested_amount','Requested (RM)'],
 ['settled_paid_amount','Settled (RM) — Detail'],['tranche_status','Tranche Status'],
 ['fm_review','FM Review'],['review_remarks','Review Remarks'],
 ['current_due_date','Supplier Due'],['first_scheduled_date','Original Schedule'],
 ['current_scheduled_date','Current Schedule'],['schedule_source','Schedule Source'],
 ['actual_payment_date','Actual Payment Date'],['bank_reference','Bank Reference'],
 ['initiated_at','Initiated At'],['completed_at','Completed At'],
 ['void_reason','Void Reason']
]
const eventCols=[
 ['pv_number','PV Number'],['tranche_no','Tranche #'],['event','Event'],
 ['previous_date','Previous Date'],['new_date','New Date'],
 ['reason','Reason'],['supplier_evidence_reference','Supplier Evidence Reference'],
 ['actor_username','Performed By'],['actor_role','Actor Role'],
 ['actor_department','Actor Department'],['actor_subdepartment','Actor Subdepartment'],
 ['actor_branch','Actor Branch'],['actor_cost_center','Actor Cost Center'],['event_time','Time (MYT)']
]
const moneyFields=new Set(['approved_amount','paid_amount','outstanding_amount',
  'requested_amount','settled_paid_amount'])
const dateFields=new Set(['original_due_date','current_due_date','ap_proposed_date',
  'first_scheduled_date','current_scheduled_date','last_actual_payment_date',
  'actual_payment_date','previous_date','new_date'])
const timestampFields=new Set(['final_approved_at','initiated_at','completed_at','event_time'])
const stamp=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const dateText=value=>{
  if(!value)return ''
  const parts=String(value).split('-')
  return parts.length===3?parts[2]+'/'+parts[1]+'/'+parts[0]:String(value)
}
const timeText=value=>{
  if(!value)return ''
  const d=new Date(value)
  return Number.isNaN(d.getTime())?String(value):new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Kuala_Lumpur',day:'2-digit',month:'2-digit',year:'numeric',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
  }).format(d)
}
const safeText=value=>{
  if(value===null||value===undefined)return ''
  const v=String(value)
  // Prevent formula injection in spreadsheet software, including leading whitespace.
  return /^[\s]*[=+\-@\t\r]/.test(v)?"'"+v:v
}
const valueCell=(field,value)=>{
  if(value===null||value===undefined)return ''
  if(typeof value==='boolean')return value?'Yes':'No'
  if(moneyFields.has(field)){
    const n=Number(value)
    return Number.isFinite(n)?n:safeText(value)
  }
  if(dateFields.has(field))return safeText(dateText(value))
  if(timestampFields.has(field))return safeText(timeText(value))
  return safeText(value)
}
const localDay=value=>{
  if(!value)return ''
  const d=new Date(value)
  return Number.isFinite(d.getTime())?'':new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(d)
}

function addSheet(book,title,columns,rows,generated){
  const ws=book.addWorksheet(title,{
    views:[{state:'frozen',ySplit:4}],
    pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,
      margins:{left:0.25,right:0.25,top:0.5,bottom:0.5,header:0.2,footer:0.2}}
  })
  ws.mergeCells(1,1,1,columns.length)
  ws.getCell('A1').value='JIMS | FINANCE — PAYMENT PROCESS AUDIT'
  ws.getCell('A1').font={size:15,bold:true,color:{argb:'FFB58B3A'}}
  ws.mergeCells(2,1,2,columns.length)
  ws.getCell('A2').value=title+' • Generated '+timeText(generated)+' MYT'
  ws.getCell('A2').font={size:10,italic:true}
  ws.mergeCells(3,1,3,columns.length)
  ws.getCell('A3').value='Approved PVs only • Financial totals are counted once per PV in PV Summary'
  ws.getCell('A3').font={size:9,italic:true}
  const header=ws.getRow(4)
  header.values=columns.map(([,label])=>label)
  header.font={bold:true,color:{argb:'FFF5D98E'},size:9}
  header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF252525'}}
  header.height=32
  header.alignment={vertical:'middle',wrapText:true}
  rows.forEach(item=>{
    const row=ws.addRow(columns.map(([key])=>valueCell(key,item[key])))
    row.font={size:9}
    row.eachCell((cell,i)=>{
      const col=columns[i-1]?.[0]
      if(moneyFields.has(col)&&typeof cell.value==='number')cell.numFmt='#,##0.00'
      cell.alignment={vertical:'top',wrapText:true}
    })
  })
  ws.columns=columns.map(([key,label])=>({
    width:Math.min(35,Math.max(15,label.length+3,
      ['supplier','reason','review_remarks','supplier_evidence_reference'].includes(key)?28:17))
  }))
  ws.autoFilter={from:{row:4,column:1},to:{row:Math.max(5,rows.length+4),column:columns.length}}
  ws.pageSetup.printTitlesRow='1:4'
  ws.headerFooter.oddFooter='JIMS — Internal Finance Audit | Page &P of &N'
  return ws
}
async function createWorkbook(result,summary,tranches,changes,filters){
  const ExcelJS=(await import('exceljs')).default
  const wb=new ExcelJS.Workbook()
  wb.creator='JIMS Finance'
  wb.created=new Date()
  const generated=result.generated_at||new Date().toISOString()
  addSheet(wb,'PV Summary',summaryCols,summary,generated)
  addSheet(wb,'Planning Dates',planningCols,summary,generated)
  addSheet(wb,'Payment Tranches',trancheCols,tranches,generated)
  addSheet(wb,'Planning Changes',eventCols,changes,generated)
  const notes=wb.addWorksheet('Audit Notes',{pageSetup:{paperSize:9,orientation:'portrait'}})
  notes.columns=[{width:32},{width:100}]
  notes.addRows([
    ['JIMS PAYMENT PROCESS AUDIT',''],
    ['Generated (Malaysia time)',timeText(generated)],
    ['Filter — PV',filters.pvSearch||'All'],
    ['Filter — Date From/To',(filters.dateFrom||'All')+' / '+(filters.dateTo||'All')],
    ['Filter — Branch',filters.branch||'All'],
    ['Filter — Tier',filters.tier||'All'],
    ['Filter — Payment Status',filters.paymentStatus||'All'],
    ['Approved PV records',summary.length],
    ['Financial total basis','PV Summary only. Every PV appears once. Do not add tranche amounts to PV totals.'],
    ['Partial paid amount','Only actual paid tranches (status=paid) contribute to a PV paid balance.'],
    ['Outstanding','PV approved amount minus recorded paid amount; never less than zero.'],
    ['Obligation due date','Original date stays preserved. FM amendments require documented evidence.'],
    ['Scheduled date','First FM approved date remains recorded; current date may be rescheduled.'],
    ['Overdue','Based on current supplier due date and unpaid balance, NOT FM schedule.'],
    ['Legacy missing dates','Blank means no 57D3 obligation/schedule data was captured. No dates are inferred.'],
    ['Payment cleared','Paid means recorded in JIMS. This report is not a bank reconciliation statement.'],
    ['Access','Authorized AP operational export. No PV/PC approval-decision history is included.'],
    ['Supporting evidence','References only. Private files, signatures and bank account numbers are not embedded.'],
  ])
  notes.getRow(1).font={bold:true,size:14,color:{argb:'FFB58B3A'}}
  notes.getColumn(1).font={bold:true}
  notes.getColumn(2).alignment={wrapText:true,vertical:'top'}
  notes.eachRow(row=>{row.height=27})
  return new Blob([await wb.xlsx.writeBuffer()],{
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
}
function download(blob,filename){
  const href=URL.createObjectURL(blob)
  try{
    const a=document.createElement('a')
    a.href=href;a.download=filename;document.body.appendChild(a);a.click();a.remove()
  }finally{window.setTimeout(()=>URL.revokeObjectURL(href),15000)}
}

export default function JIMS57D3PaymentProcessAuditExport({filters={},disabled=false}){
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  async function run(){
    if(disabled||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const {pvSearch='',dateFrom='',dateTo='',branch='',tier='',paymentStatus=''}=filters
      if(dateFrom&&dateTo&&dateFrom>dateTo)throw new Error('Created From must be before Created To.')
      const {data,error:e}=await supabase.rpc('jims_57d3_payment_process_audit_export_v1')
      if(e)throw e
      for(const key of ['payment_planning_summary','payment_planning_tranches','payment_planning_changes']){
        if(!Array.isArray(data?.[key]))throw new Error('Incomplete audit export dataset: '+key)
      }
      const summary=data.payment_planning_summary.filter(r=>
        (!pvSearch||String(r.pv_number||'').toLowerCase().includes(pvSearch.toLowerCase()))&&
        (!branch||r.branch===branch)&&(!tier||r.tier===tier)&&
        (!paymentStatus||r.payment_status===paymentStatus)&&
        (!dateFrom||localDay(r.pv_created_at)>=dateFrom)&&
        (!dateTo||localDay(r.pv_created_at)<=dateTo))
      if(!summary.length)throw new Error('No approved PV matches your selected filters.')
      const included=new Set(summary.map(r=>r.pv_number))
      const tranches=data.payment_planning_tranches.filter(r=>included.has(r.pv_number))
      const changes=data.payment_planning_changes.filter(r=>included.has(r.pv_number))
      // Amount reconciliation checks are per PV, not across repeated payment lines.
      for(const r of summary){
        if([r.approved_amount,r.paid_amount,r.outstanding_amount]
          .some(x=>!Number.isFinite(Number(x))||Number(x)<0))
          throw new Error('Invalid financial amount in PV '+r.pv_number)
        const difference=Math.abs(Number(r.approved_amount)-
          Number(r.paid_amount)-Number(r.outstanding_amount))
        if(difference>0.011)throw new Error('Financial balance mismatch in '+r.pv_number+
          '. Resolve before exporting audit report.')
      }
      const file=await createWorkbook(data,summary,tranches,changes,filters)
      download(file,'JIMS_Payment_Process_Audit_'+stamp()+'.xlsx')
      setNotice('Audit Excel ready: '+summary.length+' PV, '+tranches.length+
        ' tranche records, '+changes.length+' planning events.')
    }catch(e){setError(e?.message||'Payment Process Audit export failed')}
    finally{setBusy(false)}
  }
  return <div style={{borderTop:'1px solid #62502d',paddingTop:14,marginTop:8,marginBottom:20}}>
    <div style={{fontWeight:700,marginBottom:5}}>Payment Process Audit</div>
    <p className="muted" style={{margin:'0 0 10px'}}>
      Supplier due dates, FM schedules, actual payments and change history.
      Uses the filters above; Excel sheets are printable.
    </p>
    <button type="button" className="btn" disabled={disabled||busy} onClick={run}>
      {busy?'Preparing Audit...':'Download Payment Process Audit (.xlsx)'}
    </button>
    {notice&&<p role="status" className="pv-notice">{notice}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
  </div>
}
