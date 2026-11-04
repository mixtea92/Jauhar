// Additive PV evidence viewer. The document remains in Finance Document Archive.
import {useEffect,useState} from 'react'
import {supabase} from './lib/supabase'
export default function JIMSRecurringPVSupport({voucherId}){
  const [doc,setDoc]=useState(null)
  const [error,setError]=useState('')
  const [opening,setOpening]=useState(false)
  useEffect(()=>{
    let active=true
    setDoc(null);setError('')
    if(!voucherId)return
    supabase.rpc('jims_recurring_pv_support_v1',{p_voucher_id:voucherId})
      .then(({data,error:e})=>{
        if(!active)return
        if(e)throw e
        setDoc(data||null)
      }).catch(e=>{if(active)setError(e?.message||'Unable to load recurring evidence')})
    return()=>{active=false}
  },[voucherId])
  async function open(){
    if(!doc||opening)return
    setOpening(true);setError('')
    try{
      const {data,error:e}=await supabase.storage.from('jauhar-recurring-supporting')
        .createSignedUrl(doc.storage_path,60)
      if(e||!data?.signedUrl)throw e||new Error('Signed link unavailable')
      window.open(data.signedUrl,'_blank','noopener,noreferrer')
    }catch(e){setError(e?.message||'Cannot open recurring document')}
    finally{setOpening(false)}
  }
  if(!doc&&!error)return null
  return <section className="pv-notice" aria-label="Recurring supporting document in Finance Archive">
    {doc&&<>
      <strong>Recurring Payment Supporting Document (Finance Document Archive)</strong>
      <p>Document Name: <b>{doc.document_name}</b> · Original File: {doc.original_filename}</p>
      <p>Recurring Cycle: {String(doc.period_month).slice(0,7)}
        {' · '}Evidence {doc.document_valid?'Valid':'Needs FM review'}</p>
      <button className="btn" type="button" onClick={open} disabled={opening}>
        {opening?'Opening...':'View Named Supporting Document'}
      </button>
      <p className="muted">Archive document is linked, not relabelled as a supplier invoice.
        Payment initiation and final receipt proofs remain in their original PV sections.</p>
    </>}
    {error&&<p role="alert" className="error">{error}</p>}
  </section>
}
