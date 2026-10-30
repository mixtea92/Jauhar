// JIMS Step 57D2B — read-only system-generated Official PV PDF.
// Data is provided only by authorized Supabase RPC; this component never edits financial records.
import {useState} from 'react'
import {supabase} from './lib/supabase'

const value=(x)=>x==null||String(x).trim()===''?'—':String(x)
const money=x=>'RM '+Number(x||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})
const ymd=x=>x?String(x).slice(0,10).split('-').reverse().join('/'):'—'
const stamp=x=>{
  if(!x)return '—'
  const d=new Date(x)
  if(Number.isNaN(d.valueOf()))return value(x)
  return new Intl.DateTimeFormat('en-MY',{timeZone:'Asia/Kuala_Lumpur',
    dateStyle:'medium',timeStyle:'short'}).format(d)
}
const titleCase=x=>value(x).replaceAll('_',' ').replace(/\b[a-z]/g,c=>c.toUpperCase())
const cell=(x,bold=false)=>({text:value(x),bold,fontSize:8,margin:[1,3,1,3]})
const pair=(label,text)=>[cell(label,true),cell(text)]
const section=text=>({text,style:'section',margin:[0,16,0,7]})
const filename=x=>value(x).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,110)
const grid=(body,widths=['29%','71%'])=>({
  table:{widths,body},layout:'lightHorizontalLines',margin:[0,2,0,6]
})

export function officialPVDocDefinition(report){
  if(report?.document_version!=='JIMS-57D2-V1'||report.voucher?.status!=='fully_approved')
    throw new Error('Not a valid fully approved official PV snapshot.')
  const v=report.voucher
  const sum=report.financial_summary||{}
  const lines=report.invoice_lines
  const approvals=report.approval_history
  const txns=report.payment_transactions
  if(!Array.isArray(lines)||!Array.isArray(approvals)||!Array.isArray(txns))
    throw new Error('Incomplete approval or payment ledger.')
  const approved=Number(sum.approved_amount),paid=Number(sum.settled_paid_amount),
    remaining=Number(sum.outstanding_amount)
  if(![approved,paid,remaining].every(Number.isFinite)||
    Math.abs(approved-paid-remaining)>0.011||Math.min(approved,paid,remaining)<0)
    throw new Error('Unreconciled PV totals. Official PDF blocked.')
  const due=report.supplier_obligation||{}
  const linesBody=[
    ['#','Invoice Reference','Description','GL','Amount (MYR)','File'].map(x=>cell(x,true)),
    ...lines.map(x=>[
      cell(x.line_no),cell(x.invoice_reference),cell(x.description),
      cell(x.gl_code),cell(money(x.amount)),
      cell(x.invoice_document_on_file?'On File':'Missing')
    ])
  ]
  const approvalsBody=[
    ['Round','Tier','Decision','Approved / Verified By','Timestamp','Remarks'].map(x=>cell(x,true)),
    ...approvals.map(x=>[
      cell(x.approval_round),cell(titleCase(x.tier)),cell(titleCase(x.action)),
      cell(x.actor),cell(stamp(x.occurred_at)),cell(x.remarks)
    ])
  ]
  const paymentsBody=[
    ['Tranche','Status','Requested','Paid','Date','Bank Reference'].map(x=>cell(x,true)),
    ...txns.map(t=>[
      cell(t.installment_no),cell(titleCase(t.status)),
      cell(money(t.requested_amount)),
      cell(t.status==='paid'?money(t.settled_amount):'—'),
      cell(ymd(t.payment_date)),cell(t.bank_reference)
    ])
  ]
  const noRecords=(table,cols,label)=>{
    if(table.length===1){
      const empty=Array.from({length:cols},()=>({}))
      empty[0]={text:label,colSpan:cols,fontSize:8,color:'#755f38'}
      table.push(empty)
    }
    return table
  }
  const paymentDetails=v.payment_mode==='partial'?[
    {text:'Only installments with status Paid reduce the outstanding balance.',
      style:'muted',margin:[0,0,0,6]},
    {table:{headerRows:1,widths:[43,62,69,69,64,'*'],
      body:noRecords(paymentsBody,6,'No payment installments recorded')},
      layout:'lightHorizontalLines'},
    ...txns.map(t=>({
      text:[
        {text:'Tranche '+value(t.installment_no)+': ',bold:true},
        titleCase(t.status)+' · Initiated '+stamp(t.initiated_at)+' by '+value(t.initiated_by)+
        ' · FM '+titleCase(t.review_decision)+' '+stamp(t.reviewed_at)+
        ' · Completed '+stamp(t.completed_at)+
        (t.final_receipt_on_file?' · Final receipt on file':'')
      ],fontSize:8,margin:[0,5,0,0]
    }))
  ]:[
    grid([
      pair('Initiated At',stamp(v.payment_initiation_date)),
      pair('FM Review',titleCase(v.fm_payment_review_decision)+' · '+stamp(v.fm_payment_review_date)),
      pair('FM Review Remarks',v.fm_payment_review_remarks),
      pair('Payment Date',ymd(v.payment_date)),
      pair('Paid Recorded At',stamp(v.payment_recorded_at)),
      pair('Bank / Cheque Reference',v.bank_reference),
      pair('Initiation Proof',v.initiation_proof_on_file?'On File':'Not Recorded'),
      pair('Final Receipt',v.receipt_on_file?'On File':'Not Recorded')
    ])
  ]
  return {
    pageSize:'A4',pageMargins:[34,43,34,46],
    info:{title:'JAUHAR Official PV '+value(v.pv_number),
      author:'JAUHAR Integrated Management System',
      subject:'Read-only Payment Voucher approval and settlement history'},
    defaultStyle:{font:'Roboto',fontSize:9,color:'#232323'},
    styles:{
      company:{fontSize:15,bold:true,color:'#aa843e'},
      document:{fontSize:11,bold:true},
      section:{fontSize:10,bold:true,color:'#9c763d'},
      muted:{fontSize:8,color:'#777'}
    },
    header:()=>({text:'JIMS   •   OFFICIAL PAYMENT VOUCHER',alignment:'right',
      margin:[34,18,34,0],fontSize:7,color:'#9c763d'}),
    footer:(page,total)=>({columns:[
      {text:'JAUHAR · System-generated read-only document',fontSize:7,color:'#888'},
      {text:'Page '+page+' / '+total,alignment:'right',fontSize:7,color:'#888'}
    ],margin:[34,0,34,16]}),
    content:[
      {text:'JAUHAR MEDICAL CLINIC',style:'company'},
      {text:'OFFICIAL PAYMENT VOUCHER',style:'document',margin:[0,4,0,12]},
      grid([
        pair('PV Number',v.pv_number),
        pair('Financial Tier',v.financial_tier),
        pair('Branch / Cost Center',value(v.branch)+' / '+value(v.cost_center)),
        pair('Origin Department',v.origin_department),
        pair('PV Created',stamp(v.created_at)),
        pair('Final Approval',stamp(v.final_approval_at)),
        pair('Approval Status',titleCase(v.status)),
        pair('Payment Status',titleCase(v.payment_status)),
        pair('Payment Mode',titleCase(v.payment_mode))
      ]),
      section('SUPPLIER & PAYMENT DETAILS'),
      grid([
        pair('Payee',v.payee_name),
        pair('Supplier Code',v.supplier_code),
        pair('Supplier TIN',v.supplier_tin),
        pair('Bank / Account',value(v.bank_name)+' / '+value(v.bank_account_no)),
        pair('Payment Method',v.payment_method),
        pair('Payment Type',v.payment_type),
        pair('Description',v.description)
      ]),
      section('INVOICE LINE ITEMS'),
      {table:{headerRows:1,widths:[21,96,'*',42,72,41],
        body:noRecords(linesBody,6,'No invoice lines recorded')},
        layout:{fillColor:i=>i===0?'#f2ebdf':null,
          hLineColor:'#d6cbb5',vLineColor:'#d6cbb5'}},
      section('FINANCIAL POSITION'),
      grid([
        pair('SST',money(v.sst_amount)),
        pair('Approved Amount',money(approved)),
        pair('Actual Paid (Recorded)',money(paid)),
        pair('Outstanding Balance',money(remaining))
      ]),
      section('SUPPLIER OBLIGATION / SCHEDULE'),
      grid([
        pair('Contractual Supplier Due Date',ymd(due.supplier_due_date)),
        pair('FM Approved Schedule',ymd(due.fm_schedule))
      ]),
      section('ACTUAL APPROVAL HISTORY — ALL ROUNDS'),
      {table:{headerRows:1,widths:[31,66,50,77,85,'*'],
        body:noRecords(approvalsBody,6,'No approval actions recorded')},
        layout:{fillColor:i=>i===0?'#f2ebdf':null,
          hLineColor:'#d6cbb5',vLineColor:'#d6cbb5'}},
      section('ACTUAL PAYMENT HISTORY'),
      ...paymentDetails,
      section('DOCUMENT INFORMATION'),
      {text:'Generated By '+value(report.generated_by)+'  |  '+stamp(report.generated_at),
        style:'muted'},
      {text:value(report.disclaimer),style:'muted',margin:[0,8,0,0]}
    ]
  }
}

export default function JIMS57D2OfficialPVDownload({voucher}){
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  if(!voucher||voucher.status!=='fully_approved')return null
  async function download(){
    if(busy)return
    setBusy(true);setError('')
    try{
      const {data,error:rpcError}=await supabase.rpc('jims_57d2_official_pv_snapshot_v1',
        {p_voucher_id:voucher.id})
      if(rpcError)throw rpcError
      if(data?.voucher?.id!==voucher.id)throw new Error('PV identity mismatch')
      const definition=officialPVDocDefinition(data)
      const [{default:pdfMake},fonts]=await Promise.all([
        import('pdfmake/build/pdfmake'),
        import('pdfmake/build/vfs_fonts')
      ])
      pdfMake.vfs=fonts.default?.pdfMake?.vfs||fonts.pdfMake?.vfs||fonts.default||fonts
      pdfMake.createPdf(definition).download(filename(voucher.pv_number)+'_Official_PV.pdf')
    }catch(e){
      setError(e?.message||'Unable to generate official PDF')
    }finally{setBusy(false)}
  }
  return <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',margin:'12px 0'}}>
    <button type="button" className="btn" onClick={download} disabled={busy}>
      {busy?'Generating Official PDF...':'Download Official PV PDF'}
    </button>
    {error&&<span style={{color:'#b42318',fontSize:12}} role="alert">{error}</span>}
  </div>
}
