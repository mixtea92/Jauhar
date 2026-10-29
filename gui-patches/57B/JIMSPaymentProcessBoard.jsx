import {useCallback,useEffect,useMemo,useState} from 'react'
import {supabase} from './lib/supabase'
import './JIMSPaymentProcessBoard.css'

// JIMS Step 57B9 — ONE payment process dashboard.
// Business data is read only; opening PV uses existing secured detail/approval UI.
// Full and partial paid history share exactly ONE bottom section.
const MAX=1000
const cents=value=>Math.round(Number(value||0)*100)
const money=value=>'RM '+Number(value||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})
const categories=[
  {id:'full_initiated',title:'Payment Initiated',hint:'Finance Manager verification'},
  {id:'full_completion',title:'Payment Completion',hint:'Upload final bank receipt PDF'},
  {id:'partial_initiated',title:'Partial Payment Initiated',hint:'Finance Manager verification per installment'},
  {id:'partial_completion',title:'Partial Payment Completion',hint:'Final receipt PDF required per installment'},
  {id:'partial_outstanding',title:'Partially Paid — Outstanding Balance',hint:'Some installments paid; balance remains'},
]
const sortByPV=(a,b)=>(a.pv_number||'').localeCompare(b.pv_number||'')||
  Number(a.installment_no||0)-Number(b.installment_no||0)

export default function JIMSPaymentProcessBoard({profile,onOpenVoucher}){
  const [vouchers,setVouchers]=useState([])
  const [ledger,setLedger]=useState([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [updated,setUpdated]=useState(null)
  const [selected,setSelected]=useState('')
  const [keyword,setKeyword]=useState('')

  const load=useCallback(async()=>{
    setLoading(true);setError('')
    try{
      const [v,t]=await Promise.all([
        supabase.from('payment_vouchers')
          .select('id,pv_number,payee_name,amount,status,payment_status,payment_mode,payment_initiation_manager_decision,payment_date')
          .is('archived_at',null).eq('status','fully_approved')
          .order('pv_number',{ascending:false}).limit(MAX+1),
        supabase.from('pv_payment_transactions')
          .select('id,voucher_id,installment_no,requested_amount,settled_amount,status,review_decision,payment_date,created_at')
          .order('created_at',{ascending:false}).limit(MAX+1)
      ])
      if(v.error||t.error)throw v.error||t.error
      if((v.data||[]).length>MAX||(t.data||[]).length>MAX)
        throw new Error('Payment records exceed 1,000. Safe pagination is required before displaying complete counts.')
      setVouchers(v.data||[])
      setLedger(t.data||[])
      setUpdated(new Date())
    }catch(e){
      setError(e?.message||'Payment information unavailable')
      setVouchers([]);setLedger([])
    }finally{setLoading(false)}
  },[])

  useEffect(()=>{
    load()
    const focus=()=>load()
    const visibility=()=>{if(document.visibilityState==='visible')load()}
    window.addEventListener('focus',focus)
    document.addEventListener('visibilitychange',visibility)
    const interval=window.setInterval(load,120000)
    return ()=>{
      window.removeEventListener('focus',focus)
      document.removeEventListener('visibilitychange',visibility)
      window.clearInterval(interval)
    }
  },[load])

  const groups=useMemo(()=>{
    const out={
      pending:[],full_initiated:[],full_completion:[],
      partial_initiated:[],partial_completion:[],partial_outstanding:[],history:[]
    }
    const voucherById=new Map(vouchers.map(v=>[v.id,v]))
    const installments=new Map()
    ledger.forEach(t=>{
      if(!voucherById.has(t.voucher_id))return
      if(!installments.has(t.voucher_id))installments.set(t.voucher_id,[])
      installments.get(t.voucher_id).push(t)
    })

    vouchers.forEach(v=>{
      const items=installments.get(v.id)||[]
      const paid=items.filter(t=>t.status==='paid')
      const paidCents=paid.reduce((total,t)=>total+cents(t.settled_amount),0)
      const remaining=Math.max(0,cents(v.amount)-paidCents)/100
      const base={...v,remaining,paid:paidCents/100}
      if(v.payment_mode==='full'){
        if(v.payment_status==='paid'){
          out.history.push({...base,kind:'Full Payment',paidAmount:Number(v.amount),payment_date:v.payment_date})
        }else if(v.payment_status==='payment_initiated'){
          if(v.payment_initiation_manager_decision==='approved')out.full_completion.push(base)
          else if(v.payment_initiation_manager_decision==='pending')out.full_initiated.push(base)
          else out.pending.push(base) // Returned: AP Finance must resubmit proof
        }else if(v.payment_status==='pending_payment'){
          out.pending.push(base)
        }
      }else if(v.payment_mode==='partial'){
        paid.forEach(t=>out.history.push({
          ...base,kind:'Partial Payment',payment_date:t.payment_date,
          installment_no:t.installment_no,paidAmount:Number(t.settled_amount||0),
          transactionId:t.id
        }))
        if(v.payment_status==='paid')return
        // Financial balance state is visible even while the NEXT installment
        // is initiated or in completion; these are different dimensions.
        if(paidCents>0&&remaining>0)out.partial_outstanding.push(base)
        const approval=items.find(t=>t.status==='approved'&&t.review_decision==='approved')
        const initiated=items.find(t=>t.status==='initiated'&&t.review_decision==='pending')
        if(approval){
          out.partial_completion.push({...base,installment_no:approval.installment_no,installmentAmount:approval.requested_amount})
        }else if(initiated){
          out.partial_initiated.push({...base,installment_no:initiated.installment_no,installmentAmount:initiated.requested_amount})
        }else if(paidCents===0){
          // A draft / returned proof remains at the common Pending Payment stage.
          out.pending.push(base)
        }
      }
    })
    Object.values(out).forEach(rows=>rows.sort(sortByPV))
    out.history.sort((a,b)=>String(b.payment_date||'').localeCompare(String(a.payment_date||''))||sortByPV(a,b))
    return out
  },[vouchers,ledger])

  const allGroups=useMemo(()=>[{
    id:'pending',title:'Pending Payment',hint:'Fully Approved PVs awaiting initial payment or resubmission'
  },...categories],[])
  const active=allGroups.find(g=>g.id===selected)||({id:'history',title:'Payment History'})
  const results=(groups[selected]||[]).filter(row=>
    (row.pv_number+' '+(row.payee_name||'')).toLowerCase().includes(keyword.toLowerCase()))
  const viewCard=(id)=>{setSelected(old=>old===id?'':id);setKeyword('')}
  const isAP=profile?.role==='executive'&&profile?.department==='Finance'
  const isFM=profile?.role==='manager'&&profile?.department==='Finance'

  function card(item){
    const count=groups[item.id]?.length||0
    return <button type="button" key={item.id}
      className={'jims-pb-card'+(selected===item.id?' jims-pb-selected':'')}
      aria-expanded={selected===item.id}
      onClick={()=>viewCard(item.id)} disabled={loading||Boolean(error)}>
      <span className="jims-pb-card-top">
        <strong>{loading?'—':error?'—':count}</strong><span aria-hidden="true">↗</span>
      </span>
      <span className="jims-pb-card-name">{item.title}</span>
      <small>{item.hint}</small>
    </button>
  }

  return <section className="panel jims-payment-board" aria-label="Payment Process">
    <div className="panel-head">
      <div><h2>Payment Process Dashboard</h2>
        <p className="muted">Pending Payment → Full / Partial workflows → One Payment History</p>
      </div>
      <button type="button" className="btn" disabled={loading}
        onClick={load}>{loading?'Refreshing…':'Refresh Counters'}</button>
    </div>
    {error&&<p role="alert" className="error">Payment Process unavailable: {error}</p>}
    {!error&&updated&&<p className="muted jims-pb-updated">
      Last refreshed: {updated.toLocaleTimeString('en-MY')} ·
      Viewing PVs permitted to your account
    </p>}

    <div className="jims-pb-pending">
      {card({id:'pending',title:'Pending Payment',
        hint:'Select Full / Partial Payment or upload initiation proof'})}
    </div>

    <div className="jims-pb-groups">
      <div className="jims-pb-group">
        <h3>Full Payment Status</h3>
        <div className="jims-pb-stack">
          {categories.slice(0,2).map(card)}
        </div>
      </div>
      <div className="jims-pb-group">
        <h3>Partial Payment Status</h3>
        <div className="jims-pb-stack">
          {categories.slice(2).map(card)}
        </div>
      </div>
    </div>

    {selected&&selected!=='history'&&
      <section className="jims-pb-details" aria-label={active.title+' records'}>
        <div className="jims-pb-detail-header">
          <div><h3>{active.title}</h3><p>{results.length} record(s)</p></div>
          <button type="button" className="btn" onClick={()=>setSelected('')}>Close List</button>
        </div>
        <label className="jims-pb-search">Search PV Number / Payee
          <input value={keyword} onChange={e=>setKeyword(e.target.value)}
            placeholder="Search visible records"/>
        </label>
        {!results.length&&!loading&&<p className="muted">No matching payment records.</p>}
        {results.map((v,i)=><div key={v.id+'-'+(v.installment_no||i)} className="jims-pb-record">
          <div>
            <strong>{v.pv_number}</strong>
            <span>{v.payee_name||'—'}</span>
            {v.installment_no&&<small>Installment #{v.installment_no}</small>}
            {(selected.startsWith('partial'))&&<small>Outstanding {money(v.remaining)}</small>}
          </div>
          <div className="jims-pb-record-actions">
            <strong>{money(v.installmentAmount ?? v.amount)}</strong>
            <button type="button" className="btn" onClick={()=>onOpenVoucher(v.id)}>
              {selected==='partial_completion'||selected==='full_completion'
                ? 'Open — Upload Final PDF'
                : selected==='partial_initiated'||selected==='full_initiated'
                  ? (isFM?'Open — FM Review':'Open PV')
                  : 'Open PV'}
            </button>
          </div>
        </div>)}
      </section>}

    {/* One and ONLY one history component; includes Full Paid PV and Paid Partial installments. */}
    <section className="jims-pb-history" id="jims-payment-history">
      <div className="jims-pb-detail-header">
        <div>
          <h3>Payment History</h3>
          <p>Full Payment and Partial Payment receipts in one history</p>
        </div>
        <span className="jims-pb-history-total">{loading?'—':groups.history.length} paid record(s)</span>
      </div>
      <button type="button" className="jims-pb-history-toggle"
        disabled={loading||Boolean(error)}
        aria-expanded={selected==='history'} onClick={()=>viewCard('history')}>
        {selected==='history'?'Hide Payment History':'View Payment History'} ↗
      </button>
      {selected==='history'&&<>
        <label className="jims-pb-search">Search PV Number / Payee
          <input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="Search paid records"/>
        </label>
        {!results.length&&<p className="muted">No paid records found.</p>}
        {results.map((r,i)=><div className="jims-pb-record"
          key={(r.transactionId||r.id)+'-'+i}>
          <div>
            <strong>{r.pv_number}</strong>
            <span>{r.kind}{r.installment_no?' · Installment #'+r.installment_no:''}</span>
            <small>{r.payment_date||'Date unavailable'} · {r.payee_name||'—'}</small>
            {r.kind==='Partial Payment'&&
              <small>{r.remaining>0?'Partially Paid':'Fully Paid'} · Balance {money(r.remaining)}</small>}
          </div>
          <div className="jims-pb-record-actions">
            <strong>{money(r.paidAmount)}</strong>
            <button type="button" className="btn" onClick={()=>onOpenVoucher(r.id)}>
              Open Receipt & History
            </button>
          </div>
        </div>)}
      </>}
    </section>
  </section>
}
