// 57D7C7-T2-D — One invoice, one detail panel. Separate from PV approval/payment flow.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import JIMSPVPlanningSummary from './JIMSPVPlanningSummary'

const emptyItem = () => ({
  item_description: '', category: '', quantity: '1', unit_price: '0', gl_code: ''
})
const currency = amount => 'RM '+Number(amount||0).toLocaleString('en-MY',{
  minimumFractionDigits:2,maximumFractionDigits:2
})
const moneyCents = value => Math.round((Number(value)||0)*100)
const fieldStyle = {
  background:'var(--panel-bg, #fff)', color:'inherit',
  border:'1px solid #8a8a8a66',borderRadius:6,padding:'9px 10px',width:'100%'
}
const labelStyle = {fontSize:12,fontWeight:600,display:'block',marginBottom:4}

export default function JIMSInvoiceDetailsPanel({
  line, doc, canEdit, busy, mobileBlocked, signedUrl, invoiceMessage,
  showPlanning=false,planningDates=null,planningLoading=false,planningError='',
  awaitingFinalApproval=false,onManagePlanning=null,pendingFMReview=false,
  planningVoucherId=null,onPlanningSaved=null,
  planningInvoiceDocuments=[],planningInvoiceLines=[],
  onClose, onUpload, onView, onSaved, onDirtyChange
}){
  const [items,setItems]=useState([])
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [loaded,setLoaded]=useState(false)

  const load=useCallback(async()=>{
    if(!line?.id)return
    setLoading(true)
    setLoaded(false)
    setError('')
    try{
      const {data,error:e}=await supabase.from('pv_invoice_item_details')
        .select('id,item_no,item_description,category,quantity,unit_price,total_amount,gl_code')
        .eq('line_item_id',line.id).order('item_no',{ascending:true})
      if(e)throw e
      setItems((data||[]).map(item=>({
        item_description:item.item_description,
        category:item.category,
        quantity:String(item.quantity),
        unit_price:String(item.unit_price),
        gl_code:item.gl_code||''
      })))
      setLoaded(true)
      onDirtyChange?.(false)
    }catch(e){
      setError('Unable to load invoice item details: '+(e.message||'Unknown error'))
    }finally{setLoading(false)}
  },[line?.id,onDirtyChange])

  useEffect(()=>{void load()},[load])

  const calculatedCents=useMemo(()=>
    items.reduce((sum,item)=>sum+moneyCents(Number(item.quantity)*Number(item.unit_price)),0)
  ,[items])
  const targetCents=moneyCents(line?.amount)
  const matches=items.length>0&&calculatedCents===targetCents
  const fieldsValid=items.length>0&&items.every(item=>{
    const qty=String(item.quantity).trim()
    const price=String(item.unit_price).trim()
    return item.item_description.trim()&&item.category.trim()&&
      /^[0-9]{1,10}([.][0-9]{1,3})?$/.test(qty)&&Number(qty)>0&&
      /^[0-9]{1,10}([.][0-9]{1,4})?$/.test(price)
  })
  const readyToSave=fieldsValid&&matches
  const editItem=(index,key,value)=>{
    onDirtyChange?.(true)
    setNotice('')
    setItems(old=>old.map((row,i)=>i===index?{...row,[key]:value}:row))
  }

  async function save(){
    if(!canEdit||saving||!loaded)return
    setError('');setNotice('')
    try{
      if(!items.length)throw new Error('Add at least one invoice item before saving.')
      if(items.length>300)throw new Error('Maximum 300 items per invoice.')
      for(const [index,item] of items.entries()){
        const qty=String(item.quantity).trim()
        const price=String(item.unit_price).trim()
        if(!item.item_description.trim()||!item.category.trim()||
           !/^[0-9]{1,10}([.][0-9]{1,3})?$/.test(qty)||
           !/^[0-9]{1,10}([.][0-9]{1,4})?$/.test(price)||
           Number(qty)<=0)
          throw new Error('Complete item '+(index+1)+': description, category, positive quantity and valid unit price.')
      }
      if(!matches)throw new Error('Item breakdown must equal '+currency(line.amount)+' before saving.')
      setSaving(true)
      const {data,error:e}=await supabase.rpc('jims_save_invoice_item_details_v1',{
        p_line_item_id:line.id,
        p_items:items.map(item=>({
          item_description:item.item_description.trim(),
          category:item.category.trim(),
          quantity:String(item.quantity).trim(),
          unit_price:String(item.unit_price).trim(),
          gl_code:item.gl_code.trim()||null
        }))
      })
      if(e)throw e
      if(data?.success!==true)throw new Error('Invoice item save could not be confirmed.')
      await load()
      await onSaved?.()
      setNotice('Invoice item breakdown saved with audit trail.')
    }catch(e){setError(e.message||'Could not save invoice details.')}
    finally{setSaving(false)}
  }

  if(!line)return null
  return (
    <section className="pv-action-panel" style={{
      margin:'16px 0',padding:18,border:'1px solid #b0b0b044',borderRadius:12
    }} aria-label={'Invoice Details '+(line.invoice_reference||'')}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <div>
          <h3 style={{margin:'0 0 4px'}}>Invoice Details</h3>
          <strong>{line.invoice_reference||'Invoice'}</strong>
          <div className="muted" style={{fontSize:13}}>Invoice amount: {currency(line.amount)}</div>
        </div>
        <button type="button" className="btn" disabled={saving||busy}
          onClick={onClose}>Close</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,margin:'14px 0'}}>
        <div><span className="muted">Description</span><div>{line.description}</div></div>
        <div><span className="muted">GL Code</span><div>{line.gl_code||'—'}</div></div>
        <div><span className="muted">Invoice Total</span><div><strong>{currency(line.amount)}</strong></div></div>
      </div>
      {showPlanning && <JIMSPVPlanningSummary data={planningDates}
        loading={planningLoading} error={planningError}
        awaitingFinalApproval={awaitingFinalApproval} onManagePlanning={onManagePlanning}
        pendingFMReview={pendingFMReview} voucherId={planningVoucherId}
        invoiceDocuments={planningInvoiceDocuments} invoiceLines={planningInvoiceLines}
        onDatesSaved={onPlanningSaved}/>}
      <hr style={{border:'none',borderTop:'1px solid #88888844'}}/>
      <div style={{display:'flex',gap:10,justifyContent:'space-between',alignItems:'center'}}>
        <h4 style={{margin:'14px 0'}}>Item Breakdown <small style={{color:'#d9534f'}}>(Required)</small></h4>
        {canEdit&&<button type="button" className="btn" disabled={saving||loading||!loaded}
          onClick={()=>{onDirtyChange?.(true);setItems(a=>[...a,emptyItem()]);setNotice('')}}>+ Add Item</button>}
      </div>
      {loading&&<p className="muted">Loading invoice breakdown...</p>}
      {loaded&&!items.length&&<p className="muted">No item breakdown entered. Add at least one item; PV submission will remain blocked.</p>}
      {loaded&&items.map((item,index)=>(
        <div key={index} style={{border:'1px solid #99999944',borderRadius:8,padding:12,marginBottom:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <strong>Item {index+1}</strong>
            {canEdit&&<button className="btn" type="button" disabled={saving}
              onClick={()=>{onDirtyChange?.(true);setItems(a=>a.filter((_,i)=>i!==index));setNotice('')}}>Remove</button>}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
            <label><span style={labelStyle}>Product / Service</span>
              <input style={fieldStyle} value={item.item_description} maxLength={500}
                disabled={!canEdit||saving} onChange={e=>editItem(index,'item_description',e.target.value)}/></label>
            <label><span style={labelStyle}>Category</span>
              <input style={fieldStyle} value={item.category} maxLength={120}
                disabled={!canEdit||saving} onChange={e=>editItem(index,'category',e.target.value)}/></label>
            <label><span style={labelStyle}>Quantity</span>
              <input style={fieldStyle} type="number" min="0.001" step="0.001"
                value={item.quantity} disabled={!canEdit||saving}
                onChange={e=>editItem(index,'quantity',e.target.value)}/></label>
            <label><span style={labelStyle}>Unit Price (RM)</span>
              <input style={fieldStyle} type="number" min="0" step="0.0001"
                value={item.unit_price} disabled={!canEdit||saving}
                onChange={e=>editItem(index,'unit_price',e.target.value)}/></label>
            <label><span style={labelStyle}>GL Code (Optional)</span>
              <input style={fieldStyle} value={item.gl_code} maxLength={64}
                disabled={!canEdit||saving} onChange={e=>editItem(index,'gl_code',e.target.value)}/></label>
          </div>
          <div style={{textAlign:'right',marginTop:9}}>
            <strong>Item Total: {currency(Number(item.quantity)*Number(item.unit_price))}</strong>
          </div>
        </div>
      ))}
      {loaded&&<div style={{textAlign:'right',margin:'14px 0'}}>
        <strong>Breakdown Total: {currency(calculatedCents/100)}</strong>
        <p style={{margin:'4px 0',color:readyToSave?'#198754':'#d9534f'}}>
          {!items.length
            ? 'Enter invoice item details before submitting.'
            : !fieldsValid
            ? 'Complete every item: description, category, quantity and unit price.'
            : matches
            ? 'Matches invoice amount.'
            : 'Mismatch — expected '+currency(line.amount)+', entered '+currency(calculatedCents/100)+
              ' (difference '+currency(Math.abs(targetCents-calculatedCents)/100)+').'}
        </p>
      </div>}
      {canEdit&&loaded&&<button type="button" className="btn"
        disabled={saving||loading||!readyToSave} onClick={save}>
        {saving?'Saving...':'Save Item Breakdown'}
      </button>}
      {notice&&<p role="status" style={{color:'#198754'}}>{notice}</p>}
      {error&&<p role="alert" className="error">{error}</p>}
      <hr style={{border:'none',borderTop:'1px solid #88888844',marginTop:24}}/>
      <h4 style={{margin:'14px 0 6px'}}>Invoice Proof <span style={{color:'#d9534f'}}>(Required to Submit)</span></h4>
      {doc?(
        <div>
          <strong style={{color:'#198754'}}>Invoice proof attached</strong>
          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginTop:8}}>
            <button type="button" className="btn" disabled={!!busy} onClick={()=>onView(doc)}>View Invoice</button>
            {signedUrl&&<a href={signedUrl} target="_blank" rel="noopener noreferrer">
              Open Invoice (60s)</a>}
          </div>
        </div>
      ):canEdit?(
        <label style={{display:'block',maxWidth:440}}>
          <span style={labelStyle}>Upload actual invoice document (PDF / JPG / PNG / WEBP, max 5 MB)</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
            disabled={!!busy||!!mobileBlocked}
            onChange={event=>{
              const file=event.target.files?.[0]
              event.target.value=''
              if(file)onUpload(file)
            }}/>
          {mobileBlocked&&<div className="muted">Desktop browser required for file uploads.</div>}
        </label>
      ):<p style={{color:'#d9534f'}}>Invoice proof missing. Submission is blocked.</p>}
      {invoiceMessage&&<p className="pv-notice" role="status">{invoiceMessage}</p>}
      <p className="muted" style={{fontSize:12,marginTop:12}}>
        Save PV Draft first. Every invoice needs completed, matching item details and mandatory invoice proof before submission.
      </p>
    </section>
  )
}
