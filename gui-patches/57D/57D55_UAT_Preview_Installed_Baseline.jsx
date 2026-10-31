// JIMS Step 57D5 — standalone Payment Calendar (no Payment Process modification).
// Supplier due date determines calendar/overdue. FM schedule is shown only in details.
// All accounting/role permissions are enforced by 57D5/57D3 Supabase RPCs.
import {useCallback,useEffect,useMemo,useState} from 'react'
import {supabase} from './lib/supabase'
import JIMSPaymentPlanning57D3 from './JIMSPaymentPlanning57D3'
import './JIMSPaymentCalendar57D5.css'

const amount=n=>'RM '+Number(n||0).toLocaleString('en-MY',{
  minimumFractionDigits:2,maximumFractionDigits:2})
const pad=n=>String(n).padStart(2,'0')
const iso=(y,m,d)=>y+'-'+pad(m+1)+'-'+pad(d)
const fmt=date=>date?String(date).slice(0,10).split('-').reverse().join('/'):'Not set'
// JIMS_STEP57D5B_DATE_RANGE: current KL day -> month end; overdue is never range-limited.
const monthEnd=date=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return ''
  const y=Number(date.slice(0,4)),m=Number(date.slice(5,7))
  return iso(y,m-1,new Date(Date.UTC(y,m,0)).getUTCDate())
}
const dueInRange=(date,start,end)=>Boolean(
  date&&start&&end&&start<=end&&date>=start&&date<=end
)
const week=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const monthName=(year,month)=>new Intl.DateTimeFormat('en-MY',{month:'long',year:'numeric',
  timeZone:'UTC'}).format(new Date(Date.UTC(year,month,1)))
function monthGrid(year,month){
  const start=(new Date(Date.UTC(year,month,1)).getUTCDay()+6)%7
  const days=new Date(Date.UTC(year,month+1,0)).getUTCDate()
  return Array.from({length:Math.ceil((start+days)/7)*7},(_,i)=>{
    const day=i-start+1
    return day>0&&day<=days?{day,key:iso(year,month,day)}:null
  })
}
const statusText={upcoming:'Upcoming',due_today:'Due Today',overdue:'Overdue',
  paid:'Paid',missing_due:'Due Date Not Set'}

// JIMS_STEP57D55_UAT_PREVIEW — local/dev-only, synthetic rows NEVER stored in Supabase.
// Due dates use an earlier Malaysia calendar day, not FM scheduled date.
const DEV_UAT=import.meta.env.DEV
function buildOverdueUatRows(today){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today||''))return []
  const earlier=days=>{
    const [y,m,d]=today.split('-').map(Number)
    const date=new Date(Date.UTC(y,m-1,d-days))
    return iso(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())
  }
  return [
    {
      id:'uat-preview-full',pv_number:'UAT-DEMO-FULL',payee_name:'DEMO ONLY · Full Payment',
      branch:'UAT',payment_mode:'full',payment_status:'pending_payment',
      amount:250,paid_amount:0,outstanding_amount:250,
      current_due_date:earlier(20),fm_scheduled_date:earlier(-5),
      calendar_status:'overdue',isUatPreview:true,transactions:[]
    },
    {
      id:'uat-preview-partial',pv_number:'UAT-DEMO-PARTIAL',
      payee_name:'DEMO ONLY · Partial Payment',branch:'UAT',
      payment_mode:'partial',payment_status:'pending_payment',
      amount:500,paid_amount:200,outstanding_amount:300,
      current_due_date:earlier(10),fm_scheduled_date:earlier(-10),
      calendar_status:'overdue',isUatPreview:true,transactions:[]
    }
  ]
}
function sumCents(rows){return rows.reduce((n,r)=>n+Math.round(Number(r.outstanding_amount||0)*100),0)/100}

export default function JIMSPaymentCalendar57D5({profile}){
  const [feed,setFeed]=useState(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [refreshToken,setRefreshToken]=useState(0)
  const [month,setMonth]=useState(null)
  const [selectedDay,setSelectedDay]=useState(null)
  const [branch,setBranch]=useState('')
  const [dueRange,setDueRange]=useState({from:'',to:'',custom:false})
  const [showOverdue,setShowOverdue]=useState(false)
  const [showUnplanned,setShowUnplanned]=useState(false)
  const [uatPreview,setUatPreview]=useState(false)
  const [selectedPV,setSelectedPV]=useState(null)
  const reload=useCallback(()=>setRefreshToken(n=>n+1),[])
  useEffect(()=>{
    let active=true
    setLoading(true)
    setError('')
    supabase.rpc('jims_57d5_payment_calendar_v1')
      .then(({data,error:e})=>{
        if(!active)return
        if(e)throw e
        if(!Array.isArray(data?.records)||!data?.today)
          throw new Error('Calendar data incomplete')
        const today=String(data.today).slice(0,10)
        if(!/^\d{4}-\d{2}-\d{2}$/.test(today))
          throw new Error('Calendar current date invalid')
        setFeed(data)
        setDueRange(r=>r.custom?r:{from:today,to:monthEnd(today),custom:false})
        setMonth(m=>m??today.slice(0,7))
        setSelectedDay(d=>d??today)
        setLoading(false)
      })
      .catch(e=>{if(active){setError(e?.message||'Calendar unavailable');setLoading(false)}})
    return()=>{active=false}
  },[refreshToken])
  useEffect(()=>{
    const focus=()=>reload()
    window.addEventListener('focus',focus)
    return()=>window.removeEventListener('focus',focus)
  },[reload])
  const today=feed?.today||''
  const year=Number((month||today||'2026-01').slice(0,4))
  const mIndex=Number((month||today||'2026-01').slice(5,7))-1
  const calDays=useMemo(()=>monthGrid(year,mIndex),[year,mIndex])
  const records=useMemo(()=>{
    const original=feed?.records||[]
    if(!DEV_UAT||!uatPreview||!feed?.today)return original
    return [...original,...buildOverdueUatRows(feed.today)]
  },[feed,uatPreview])
  const branches=useMemo(()=>[...new Set(records.map(r=>r.branch).filter(Boolean))].sort(),[records])
  const visible=useMemo(()=>records.filter(r=>!branch||r.branch===branch),[records,branch])
  const overdue=useMemo(()=>visible.filter(r=>r.calendar_status==='overdue')
    .sort((a,b)=>String(a.current_due_date).localeCompare(String(b.current_due_date))||
      String(a.pv_number).localeCompare(String(b.pv_number))),[visible])
  const missing=useMemo(()=>visible.filter(r=>r.calendar_status==='missing_due'),[visible])
  const rangeValid=Boolean(dueRange.from&&dueRange.to&&dueRange.from<=dueRange.to)
  const inSelectedRange=date=>rangeValid&&dueInRange(date,dueRange.from,dueRange.to)
  // Calendar/summaries use the selected period; overdue remains ALL historical
  // unpaid obligation dates, regardless of date filter, month or FM schedule.
  const upcoming=visible.filter(r=>r.calendar_status==='upcoming'&&
    inSelectedRange(r.current_due_date))
  const dueToday=visible.filter(r=>r.calendar_status==='due_today'&&
    inSelectedRange(r.current_due_date))
  const withinMonth=visible.filter(r=>r.current_due_date?.startsWith(month||'')&&
    inSelectedRange(r.current_due_date)&&
    ['upcoming','due_today','paid'].includes(r.calendar_status))
  const byDay=useMemo(()=>{
    const map=new Map()
    for(const r of withinMonth){
      const key=r.current_due_date
      if(!map.has(key))map.set(key,[])
      map.get(key).push(r)
    }
    return map
  },[withinMonth])
  const selectedRows=(byDay.get(selectedDay)||[]).sort((a,b)=>
    String(a.pv_number).localeCompare(String(b.pv_number)))
  // Month arrows are explicit month filters: full target month, except
  // Current Month resets to KL today -> end of month.
  const changeMonth=offset=>{
    const d=new Date(Date.UTC(year,mIndex+offset,1))
    const first=iso(d.getUTCFullYear(),d.getUTCMonth(),1)
    setDueRange({from:first,to:monthEnd(first),custom:true})
    setMonth(first.slice(0,7))
    setSelectedDay(first)
  }
  const resetToday=()=>{
    if(!today)return
    setDueRange({from:today,to:monthEnd(today),custom:false})
    setMonth(today.slice(0,7))
    setSelectedDay(today)
  }
  const updateStart=value=>{
    setDueRange(r=>({...r,from:value,custom:true}))
    if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
      setMonth(value.slice(0,7))
      setSelectedDay(value)
    }
  }
  const updateEnd=value=>{
    setDueRange(r=>({...r,to:value,custom:true}))
  }
  const openPlanning=record=>setSelectedPV(record)
  const closePlanning=()=>{setSelectedPV(null);reload()}
  const countStatus=(rows)=>rows.length+' PV'
  const chipStatus=code=><span className={'jims-cal-chip jims-cal-'+code}>
    {statusText[code]||code}</span>
  const recordCard=(r)=><div className="jims-cal-record" key={r.id}>
    <div className="jims-cal-record-main">
      <div className="jims-cal-record-heading">
        <strong>{r.pv_number}</strong>
        {r.isUatPreview&&<span className="jims-cal-demo-tag">DEMO ONLY</span>}
        {chipStatus(r.calendar_status)}
      </div>
      <span className="jims-cal-supplier">{r.payee_name||'Supplier not set'}{r.branch?' · '+r.branch:''}</span>
      <div className="jims-cal-record-metrics">
        <span>Due <b>{fmt(r.current_due_date)}</b></span>
        <span>FM Schedule <b>{fmt(r.fm_scheduled_date)}</b></span>
        <span>Outstanding <b>{amount(r.outstanding_amount)}</b></span>
        {r.payment_mode==='partial'&&<span>Paid <b>{amount(r.paid_amount)}</b></span>}
      </div>
    </div>
    {r.isUatPreview?
      <span className="jims-cal-demo-label">Preview only · no real PV</span>:
      <button type="button" className="btn jims-cal-plan-btn" onClick={()=>openPlanning(r)}>
        {['ceo','bod','system_admin'].includes(feed?.role)?'View Planning':'Payment Planning'}
      </button>}
  </div>
  return <section className="panel jims-cal-page" aria-label="Payment Calendar">
    <header className="jims-cal-header">
      <div><h2>Payment Calendar</h2>
        <p>Supplier due dates · All branches</p>
      </div>
      <div className="jims-cal-header-actions">
        <label htmlFor="jims-calendar-branch" className="jims-cal-visually-muted">Branch</label>
        <select id="jims-calendar-branch" value={branch} onChange={e=>setBranch(e.target.value)}>
          <option value="">All Branches</option>
          {branches.map(b=><option value={b} key={b}>{b}</option>)}
        </select>
        <button className="btn" type="button" onClick={reload} disabled={loading}>
          {loading?'Loading...':'Refresh'}</button>
      </div>
    </header>
    {error&&<p className="error" role="alert">{error}</p>}
    {loading&&!feed&&<p className="muted">Loading calendar...</p>}
    {feed&&<>
      <section className="jims-cal-range" aria-label="Supplier Due Date Range Filter">
        <div className="jims-cal-range-title">
          <strong>Due Date Range</strong>
          <small>Default: today to month end</small>
        </div>
        <div className="jims-cal-range-inputs">
          <label htmlFor="jims-cal-range-from">From
            <input id="jims-cal-range-from" type="date" value={dueRange.from}
              onChange={e=>updateStart(e.target.value)}/>
          </label>
          <label htmlFor="jims-cal-range-to">To
            <input id="jims-cal-range-to" type="date" value={dueRange.to}
              onChange={e=>updateEnd(e.target.value)}/>
          </label>
          <button type="button" className="jims-cal-reset btn" onClick={resetToday}>
            Current Month
          </button>
        </div>
        {rangeValid?
          <p className="jims-cal-range-note">
            Showing due dates {fmt(dueRange.from)} – {fmt(dueRange.to)}.
            <strong> Overdue is always included, even outside this date range.</strong>
          </p>:
          <p className="jims-cal-range-error" role="alert">
            Select a valid range: From must be on or before To. Overdue remains visible.
          </p>}
      </section>
      {DEV_UAT&&<section className="jims-cal-uat-preview" aria-label="Local development UAT preview">
        <div className="jims-cal-uat-top">
          <button type="button" className="btn"
            aria-pressed={uatPreview}
            onClick={()=>{
              setUatPreview(v=>!v)
              setShowOverdue(true)
            }}>
            {uatPreview?'Disable Overdue UAT Preview':'Enable Overdue UAT Preview'}
          </button>
          <small>Development only · simulated full + partial overdue PVs · no database writes</small>
        </div>
        {uatPreview&&<p role="status">
          TEST DATA VISIBLE — Two DEMO records added to the overdue panel.
          These are not Payment Vouchers and cannot be submitted or edited.
        </p>}
      </section>}
      <div className="jims-cal-stats">
        <div className="jims-cal-stat"><span>Upcoming</span><b>{countStatus(upcoming)}</b>
          <small>{amount(sumCents(upcoming))}</small></div>
        <div className="jims-cal-stat"><span>Due Today</span><b>{countStatus(dueToday)}</b>
          <small>{amount(sumCents(dueToday))}</small></div>
        <div className="jims-cal-stat"><span>Overdue</span><b>{countStatus(overdue)}</b>
          <small>{amount(sumCents(overdue))}</small></div>
        <div className="jims-cal-stat"><span>Due Date Missing</span><b>{countStatus(missing)}</b>
          <small>Needs payment planning</small></div>
      </div>
      <div className="jims-cal-toolbar">
        <div className="jims-cal-month-nav">
          <button type="button" aria-label="Previous month" onClick={()=>changeMonth(-1)}>‹</button>
          <h3>{monthName(year,mIndex)}</h3>
          <button type="button" aria-label="Next month" onClick={()=>changeMonth(1)}>›</button>
        </div>
        <span className="jims-cal-toolbar-note">Month arrows switch the due-date range</span>
      </div>
      <div className="jims-cal-scroll">
        <div className="jims-cal-grid" role="grid" aria-label={monthName(year,mIndex)}>
          {week.map((w,i)=><div className="jims-cal-dayname" key={i} role="columnheader">{w}</div>)}
          {calDays.map((day,index)=>{
            if(!day)return <div className="jims-cal-empty" key={'empty'+index}/>;
            const entries=byDay.get(day.key)||[]
            const outside=!inSelectedRange(day.key)
            const upcomingN=entries.filter(r=>r.calendar_status==='upcoming').length
            const todayN=entries.filter(r=>r.calendar_status==='due_today').length
            const paidN=entries.filter(r=>r.calendar_status==='paid').length
            return <button key={day.key} role="gridcell" type="button"
              aria-label={day.key+(outside?' outside date range': ' '+entries.length+' voucher(s)')}
              aria-selected={selectedDay===day.key}
              disabled={outside}
              className={'jims-cal-day'+(selectedDay===day.key?' jims-cal-selected':'')+
                (day.key===today?' jims-cal-current':'')+
                (outside?' jims-cal-outside':'')}
              onClick={()=>setSelectedDay(day.key)}>
              <span className="jims-cal-day-number">{day.day}</span>
              <span className="jims-cal-indicators">
                {upcomingN>0&&<i className="jims-cal-dot green" title={upcomingN+' upcoming'}/>}
                {todayN>0&&<i className="jims-cal-dot yellow" title={todayN+' due today'}/>}
                {paidN>0&&<i className="jims-cal-dot subdued" title={paidN+' paid'}/>}
              </span>
              {entries.length>0&&<small>{entries.length} PV</small>}
            </button>
          })}
        </div>
      </div>
      <div className="jims-cal-legend">
        <span><i className="jims-cal-dot green"/>Upcoming</span>
        <span><i className="jims-cal-dot yellow"/>Due Today</span>
        <span><i className="jims-cal-dot subdued"/>Paid</span>
        <span className="jims-cal-legend-note">Overdue payments always shown below, regardless of date filter</span>
      </div>
      <section className="jims-cal-details">
        <h3>{selectedDay?'Due on '+fmt(selectedDay):'Select a date'}</h3>
        {selectedDay&&selectedRows.length===0&&<p className="muted">No scheduled supplier obligations for this day.</p>}
        {selectedRows.map(recordCard)}
      </section>
      <details className="jims-cal-expand" open={showOverdue}
        onToggle={e=>setShowOverdue(e.currentTarget.open)}>
        <summary><span>Overdue Payments · All Dates</span><strong>{countStatus(overdue)} · {amount(sumCents(overdue))}</strong></summary>
        <div className="jims-cal-expand-content">
          {overdue.length===0?<p className="muted">No overdue payments.</p>:overdue.map(recordCard)}
        </div>
      </details>
      <details className="jims-cal-expand" open={showUnplanned}
        onToggle={e=>setShowUnplanned(e.currentTarget.open)}>
        <summary><span>Due Date Not Set</span><strong>{countStatus(missing)}</strong></summary>
        <div className="jims-cal-expand-content">
          {missing.length===0?<p className="muted">All unpaid PVs have a due date.</p>:missing.map(recordCard)}
        </div>
      </details>
      <p className="jims-cal-footnote">Calendar uses Supplier Due Date. Changing the FM payment schedule does not move the obligation date.</p>
    </>}
    {selectedPV&&<JIMSPaymentPlanning57D3
      voucher={selectedPV} profile={profile}
      transactions={selectedPV.transactions||[]}
      onClose={closePlanning}/>}
  </section>
}
