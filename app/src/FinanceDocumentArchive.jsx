import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './FinanceDocumentArchive.css'

// JIMS 57D7C5 — Read-only archive. Never writes to PV, CV or Storage.
// Metadata is filtered by existing database RLS; each file download is
// independently checked by the existing private Storage bucket RLS.
const TYPES = [
  ['all', 'All Documents'],
  ['invoice', 'Invoice'],
  ['jr', 'Justification Report'],
  ['initiation', 'Payment Initiation Proof'],
  ['final', 'Final Bank Receipt'],
  ['partial', 'Partial Payment Proof'],
  ['petty', 'Petty Cash Receipt'],
  ['recurring_supporting','Recurring Payment Supporting Documents'],
]
const LABELS = Object.fromEntries(TYPES)
const BUCKETS = {
  invoice: 'jauhar-pv-invoices',
  jr: 'jauhar-pv-jr',
  initiation: 'jauhar-pv-payment-initiation',
  final: 'jauhar-pv-receipts',
  petty: 'jsync-cv-receipts',
  recurring_supporting: 'jauhar-recurring-supporting',
}
const PAGE_SIZE = 500
const MAX_PER_TABLE = 20000
const ZIP_PART_SIZE = 25

export function canAccessFinanceDocumentArchive(profile) {
  if (!profile || profile.is_active === false) return false
  if (['ceo', 'bod', 'system_admin'].includes(profile.role)) return true
  return ['executive', 'manager'].includes(profile.role) && profile.department === 'Finance'
}

function cleanName(value, fallback = 'document') {
  const text = String(value || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim()
  return text.slice(0, 130) || fallback
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = cleanName(name, 'JIMS_Document')
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

async function readAll(table, fields) {
  const rows = []
  for (let offset = 0; offset < MAX_PER_TABLE; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select(fields).range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(table + ': ' + error.message)
    const next = data || []
    rows.push(...next)
    if (next.length < PAGE_SIZE) return rows
  }
  // Never silently claim an incomplete, truncated archive is complete.
  throw new Error(table + ': archive exceeds the current safe retrieval limit. Narrowing the query server-side is required.')
}

function createArchiveRows(source) {
  const pvById = new Map(source.pvs.map(v => [v.id, v]))
  const cvById = new Map(source.cvs.map(v => [v.id, v]))
  const collected = new Map()

  function add(bucket, path, type, pv, cv, meta = {}) {
    if (!path || (!pv && !cv)) return
    const key = bucket + '::' + path
    const existing = collected.get(key)
    const selectedType = existing?.type === 'partial' ? 'partial' : type
    const reference = pv?.pv_number || cv?.cv_number || ''
    const fallbackName = cleanName(path.split('/').pop(), 'document')
    collected.set(key, {
      key, bucket, path, type: selectedType, reference,
      filename: meta.filename || existing?.filename || fallbackName,
      branch: pv?.branch_department || cv?.form_data?.branch || '',
      supplier: pv?.payee_name || '',
      createdAt: meta.createdAt || existing?.createdAt || '',
      voucherId: pv?.id || cv?.id || '',
      lineIndex: meta.lineIndex ?? existing?.lineIndex ?? null,
    })
  }

  source.invoices.forEach(d => add(BUCKETS.invoice, d.storage_path, 'invoice', pvById.get(d.voucher_id), null, { createdAt: d.created_at }))
  source.jrs.forEach(d => add(BUCKETS.jr, d.storage_path, 'jr', pvById.get(d.voucher_id), null, { filename: d.original_filename, createdAt: d.created_at }))
  source.proofs.forEach(d => {
    const pv = pvById.get(d.voucher_id)
    add(BUCKETS.initiation, d.storage_path, pv?.payment_mode === 'partial' ? 'partial' : 'initiation', pv, null, {
      filename: d.original_filename, createdAt: d.created_at,
    })
  })
  source.transactions.forEach(t => {
    const pv = pvById.get(t.voucher_id)
    if (!pv) return
    const isPartial = pv.payment_mode === 'partial'
    add(BUCKETS.initiation, t.initiation_proof_path, isPartial ? 'partial' : 'initiation', pv, null, { createdAt: t.initiated_at })
    add(BUCKETS.final, t.final_receipt_path, isPartial ? 'partial' : 'final', pv, null, { createdAt: t.completed_at })
  })
  source.v2docs.forEach(d => {
    const pv = pvById.get(d.voucher_id)
    if (!pv || !['initiation', 'final_receipt'].includes(d.kind)) return
    const bucket = d.kind === 'initiation' ? BUCKETS.initiation : BUCKETS.final
    const type = pv.payment_mode === 'partial' || d.transaction_id ? 'partial' : (d.kind === 'initiation' ? 'initiation' : 'final')
    add(bucket, d.storage_path, type, pv, null, { createdAt: d.created_at })
  })
  source.pvs.forEach(pv => {
    const isPartial = pv.payment_mode === 'partial'
    add(BUCKETS.initiation, pv.payment_initiation_proof_path, isPartial ? 'partial' : 'initiation', pv)
    add(BUCKETS.final, pv.receipt_path, isPartial ? 'partial' : 'final', pv)
  })
  source.cvReceipts.forEach(d => add(BUCKETS.petty, d.storage_path, 'petty', null, cvById.get(d.voucher_id), {
    filename: d.original_file_name, createdAt: d.uploaded_at, lineIndex: d.line_index,
  }))
  return [...collected.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || a.reference.localeCompare(b.reference))
}

async function getArchiveData(includeRecurring=false) {
  const [pvs, cvs] = await Promise.all([
    readAll('payment_vouchers', 'id,pv_number,branch_department,payee_name,payment_mode,payment_initiation_proof_path,receipt_path'),
    readAll('cash_vouchers', 'id,cv_number,form_data'),
  ])
  const [invoices, jrs, proofs, transactions, v2docs, cvReceipts] = await Promise.all([
    readAll('pv_invoice_documents', 'id,voucher_id,storage_path,created_at'),
    readAll('pv_justification_reports', 'id,voucher_id,storage_path,original_filename,created_at'),
    readAll('pv_payment_initiation_proofs', 'id,voucher_id,storage_path,original_filename,created_at'),
    readAll('pv_payment_transactions', 'id,voucher_id,initiation_proof_path,final_receipt_path,initiated_at,completed_at'),
    readAll('jims_v2_payment_documents', 'id,voucher_id,transaction_id,kind,storage_path,created_at'),
    readAll('cash_voucher_receipts', 'id,voucher_id,storage_path,original_file_name,uploaded_at,line_index'),
  ])
  const rows=createArchiveRows({ pvs, cvs, invoices, jrs, proofs, transactions, v2docs, cvReceipts })
  if(includeRecurring){
    const {data,error}=await supabase.rpc('jims_recurring_documents_list_v1')
    if(error)throw new Error('Recurring archive: '+error.message)
    if(!Array.isArray(data?.documents))throw new Error('Recurring archive data invalid')
    for(const d of data.documents){
      const suffix=(d.original_filename||'file.pdf').split('.').pop()?.toLowerCase()||'pdf'
      rows.push({
        key:BUCKETS.recurring_supporting+'::'+d.storage_path,
        bucket:BUCKETS.recurring_supporting,path:d.storage_path,
        type:'recurring_supporting',
        filename:cleanName(d.document_name,'Recurring Document')+'.'+suffix,
        originalFilename:d.original_filename,reference:d.document_name,
        branch:d.branch_code||'',supplier:d.supplier_name||'',
        createdAt:d.confirmed_at||'',voucherId:''
      })
    }
  }
  return rows.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))
}

async function authorizedDownload(row) {
  const { data, error } = await supabase.storage.from(row.bucket).download(row.path)
  if (error || !data) throw new Error('Cannot download ' + row.reference + ': access denied or file unavailable.')
  return data
}

function indexCsv(rows) {
  const head = ['Reference', 'Document Type', 'Filename', 'Branch', 'Supplier', 'Uploaded At', 'ZIP Path']
  const body = rows.map(({ row, name }) => [
    row.reference, LABELS[row.type] || row.type, row.filename, row.branch,
    row.supplier, row.createdAt, name,
  ])
  return '\uFEFF' + [head, ...body].map(line => line.map(csvCell).join(',')).join('\r\n')
}

export default function FinanceDocumentArchive({ profile }) {
  const allowed = canAccessFinanceDocumentArchive(profile)
  const fmOnly=profile?.is_active===true&&profile?.role==='manager'&&profile?.department==='Finance'
  const recurringDocView=fmOnly||['ceo','bod','system_admin'].includes(profile?.role)||
    (profile?.role==='executive'&&profile?.department==='Finance'&&profile?.subdepartment==='Accounts Payable')
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [branch, setBranch] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(0)

  const refresh = useCallback(async () => {
    if (!allowed) return
    setLoading(true)
    setRecords([])
    setSelected([])
    setPage(0)
    setError('')
    setNotice('')
    try {
      const result = await getArchiveData(recurringDocView)
      setRecords(result)
      setSelected([])
      setPage(0)
    } catch (err) {
      setError(err.message || 'Unable to load Finance Document Archive.')
    } finally {
      setLoading(false)
    }
  }, [allowed, profile?.id, recurringDocView])

  useEffect(() => { void refresh() }, [refresh])

  const branches = useMemo(() => [...new Set(records.map(r => r.branch).filter(Boolean))].sort(), [records])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return records.filter(r => {
      if (type !== 'all' && r.type !== type) return false
      if (branch !== 'all' && r.branch !== branch) return false
      if (fromDate && (!r.createdAt || r.createdAt.slice(0, 10) < fromDate)) return false
      if (toDate && (!r.createdAt || r.createdAt.slice(0, 10) > toDate)) return false
      return !term || [r.reference, r.filename, r.supplier, r.branch, LABELS[r.type]]
        .some(x => String(x || '').toLowerCase().includes(term))
    })
  }, [records, type, branch, fromDate, toDate, search])

  const visible = filtered.slice(page * 30, page * 30 + 30)
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const selectedRows = useMemo(() => records.filter(r => selectedSet.has(r.key)), [records, selectedSet])

  function toggle(id) {
    setSelected(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id])
  }

  async function oneDownload(row, preview = false) {
    if (working) return
    setWorking(true)
    setError('')
    try {
      if (preview) {
        // The signed URL is short-lived and issued only if Storage RLS permits.
        const { data, error: signedError } = await supabase.storage.from(row.bucket).createSignedUrl(row.path, 60)
        if (signedError || !data?.signedUrl) throw new Error('Document preview is not permitted or the file is unavailable.')
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
      } else {
        saveBlob(await authorizedDownload(row), row.filename)
        setNotice('Document downloaded.')
      }
    } catch (err) {
      setError(err.message || 'Download failed.')
    } finally {
      setWorking(false)
    }
  }

  async function zipDownload(rows) {
    if (working || !rows.length) return
    setWorking(true)
    setNotice('')
    setError('')
    try {
      const { default: JSZip } = await import('jszip')
      const parts = Math.ceil(rows.length / ZIP_PART_SIZE)
      for (let index = 0; index < parts; index++) {
        const zip = new JSZip()
        const manifest = []
        const batch = rows.slice(index * ZIP_PART_SIZE, (index + 1) * ZIP_PART_SIZE)
        for (let n = 0; n < batch.length; n++) {
          const row = batch[n]
          setNotice('Preparing ZIP part ' + (index + 1) + '/' + parts + ' — file ' + (n + 1) + '/' + batch.length)
          const categoryFolder = cleanName(LABELS[row.type] || 'Documents')
          const folder = cleanName(row.reference, 'Unreferenced') + '/' + categoryFolder
          const fileName = String(n + 1).padStart(3, '0') + '_' + cleanName(row.filename)
          const zipPath = folder + '/' + fileName
          zip.file(zipPath, await authorizedDownload(row))
          manifest.push({ row, name: zipPath })
        }
        zip.file('Document_Index.csv', indexCsv(manifest))
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } })
        const suffix = parts > 1 ? '_Part_' + String(index + 1).padStart(3, '0') : ''
        saveBlob(blob, 'JIMS_Finance_Documents' + suffix + '.zip')
      }
      setNotice('Export finished: ' + rows.length + ' documents in ' + parts + ' ZIP file(s). For larger exports, allow multiple downloads in your browser.')
    } catch (err) {
      setError(err.message || 'ZIP export failed. No original documents were changed.')
    } finally {
      setWorking(false)
    }
  }

  if (!allowed) return <section className="jims-fa"><p role="alert">Finance Document Archive is restricted to authorized Finance, CEO, BOD and System Admin users.</p></section>

  return (
    <section className="jims-fa">
      <header className="jims-fa-header">
        <div><h2>Finance Document Archive</h2><p>Uploaded financial supporting documents</p></div>
        <button className="btn" type="button" disabled={loading || working} onClick={refresh}>{loading ? 'Loading...' : 'Refresh'}</button>
      </header>
      <p className="muted">Recurring Payment Supporting Documents are registered from the assigned AP's
        Edit Recurring Details form. This archive remains the central view and download location.</p>
      <div className="jims-fa-stats">
        <div><span>Total Documents</span><strong>{records.length}</strong></div>
        <div><span>Selected Documents</span><strong>{selected.length}</strong></div>
      </div>
      <div className="jims-fa-filters">
        <label className="jims-fa-search">Search
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} placeholder="PV / CV number, filename, supplier" />
        </label>
        <label>Document Type<select value={type} onChange={e => { setType(e.target.value); setPage(0) }}>
          {TYPES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label>Branch<select value={branch} onChange={e => { setBranch(e.target.value); setPage(0) }}>
          <option value="all">All Branches</option>
          {branches.map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <label>Date From<input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0) }} /></label>
        <label>Date To<input type="date" min={fromDate || undefined} value={toDate} onChange={e => { setToDate(e.target.value); setPage(0) }} /></label>
      </div>
      <div className="jims-fa-toolbar">
        <span>{filtered.length} matching document(s)</span>
        <div>
          <button type="button" className="btn" disabled={!filtered.length || working} onClick={() => setSelected(old => [...new Set([...old, ...filtered.map(r => r.key)])])}>Select All Filtered</button>
          <button type="button" className="btn" disabled={!selected.length || working} onClick={() => setSelected([])}>Clear Selection</button>
          <button type="button" className="btn" disabled={!selectedRows.length || working} onClick={() => zipDownload(selectedRows)}>Download Selected ZIP</button>
          <button type="button" className="btn" disabled={!filtered.length || working} onClick={() => zipDownload(filtered)}>Download All Filtered ZIP</button>
        </div>
      </div>
      {error && <p role="alert" className="jims-fa-error">{error}</p>}
      {notice && <p role="status" className="jims-fa-notice">{notice}</p>}
      <div className="jims-fa-table-wrap"><table className="jims-fa-table">
        <thead><tr><th>Choose</th><th>Document</th><th>Category</th><th>Reference</th><th>Branch</th><th>Uploaded</th><th>Action</th></tr></thead>
        <tbody>
          {visible.map(row => <tr key={row.key}>
            <td><input aria-label={'Select ' + row.filename} type="checkbox" checked={selectedSet.has(row.key)} onChange={() => toggle(row.key)} /></td>
            <td title={row.filename}>{row.filename}<small>{row.supplier}</small></td>
            <td>{LABELS[row.type]}</td><td>{row.reference}</td><td>{row.branch || '—'}</td>
            <td>{row.createdAt ? row.createdAt.slice(0, 10) : '—'}</td>
            <td className="jims-fa-actions">
              <button className="btn" type="button" disabled={working} onClick={() => oneDownload(row, true)}>View</button>
              <button className="btn" type="button" disabled={working} onClick={() => oneDownload(row, false)}>Download</button>
            </td>
          </tr>)}
          {!loading && !visible.length && <tr><td colSpan={7}>No documents match these filters.</td></tr>}
        </tbody>
      </table></div>
      <div className="jims-fa-pages">
        <span>Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 30))}</span>
        <div><button className="btn" type="button" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button>
        <button className="btn" type="button" disabled={(page + 1) * 30 >= filtered.length || loading} onClick={() => setPage(p => p + 1)}>Next</button></div>
      </div>
    </section>
  )
}
