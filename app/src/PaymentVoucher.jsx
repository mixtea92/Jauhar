// JAUHAR_STEP_40_T08_OPTION_B_BOD_FINAL
// JAUHAR_STEP_39C_LIST_AND_MODAL_UX
// JAUHAR_STEP_39B_FINANCE_T04_NO_JR
// JAUHAR_STEP_39A_PAYROLL_DRAFT_ONLY
// JAUHAR_STEP_38_5W_RETURN_AMENDMENT
// JAUHAR_STEP_38_5P_PRESERVE_INVOICE_IDS
import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

// Step 38.3: official Excel is imported from 'Blank Form' before any NEW PV.
// It is read in the browser; no Excel bytes are uploaded/stored in Supabase yet.
// Financial Tier is saved through the versioned v3 draft RPCs.
// Tier-based submission is disabled until the routing backend is implemented.
const OFFICIAL_TEMPLATE_URL = '/templates/JAUHAR_PV_Official_Template.xlsx'
const REQUIRED_TEMPLATE_REVISION = '0000'
const TIER_PERSISTENCE_BACKEND_READY = true
const FINANCIAL_TIERS = {
  T01: { label: 'Fixed / recurring (budgeted)', approver: 'Finance Manager', jr: false },
  T02: { label: 'Variable within budget < RM10,000', approver: 'Finance Manager', jr: false },
  T03: { label: 'Variable exceeds budget <= RM10,000', approver: 'CEO', jr: true },
  T04: { label: 'Variable within budget > RM10,000', approver: 'CEO', jr: false },
  T05: { label: 'Variable exceeds budget > RM10,000', approver: 'BOD', jr: true },
  T06: { label: 'Unbudgeted > RM1,000', approver: 'BOD', jr: true },
  T07: { label: 'Unbudgeted <= RM1,000', approver: 'CEO', jr: true },
  T08: { label: 'Payroll within budget (pilot; amount limit pending Finance)', approver: 'BOD', jr: false },
  T09: { label: 'Payroll exceeds budget < RM200,000 (provisional)', approver: 'BOD', jr: true }
}
// T08: Finance pilot routes FM -> CEO -> BOD; T09 stays Draft-only.
// Payroll limits/payment controls are still pending Finance confirmation.
const DEFAULT_INVOICE_LINES = 5
// Step 38.1: enable expanded invoice lists ONLY AFTER the companion
// Supabase migration has been run successfully on this project's database.
const EXTENDED_INVOICE_BACKEND_READY = true
const PV_LIST_PAGE_SIZE = 15
// JAUHAR_STEP_38_5M_FINANCE_PILOT
const SUBMITTED_STAGES = ['pending_manager', 'pending_finance_manager', 'pending_ceo', 'pending_bod']
const choices = {
  branch: ['', 'GP', 'KM', 'PM', 'TD'],
  method: ['', 'Online Transfer', 'Cash', 'Cheque'],
  type: ['', 'Supplier', 'Staff Reimbursement', 'Staff Advance', 'Other'],
  nature: ['', 'Recurring', 'Ad Hoc'],
  budget: ['', 'Budgeted', 'Unbudgeted']
}
const documentTypes = [
  { value: 'Invoice', label: 'Invoice' },
  { value: 'Quotation', label: 'Quotation' },
  { value: 'Payment Request Form', label: 'Payment Request Form' },
  { value: 'Other', label: 'Other' }
]

function blankInvoiceLine() {
  return { invoice_reference: '', description: '', gl_code: '', amount: '' }
}

function blankLines() {
  return Array.from({ length: DEFAULT_INVOICE_LINES }, blankInvoiceLine)
}

function blankForm() {
  return {
    payee_name: '', supplier_code: '', supplier_tin: '',
    bank_name: '', bank_account_no: '', branch_department: '',
    payment_method: '', payment_type: '', expense_nature: '',
    budget_classification: '', financial_tier: '', template_version: '',
    lines: blankLines(), sst_amount: '0',
    supporting_types: [], supporting_other_text: '', remarks: '',
    source_voucher_no: '', source_pv_date: '',
    imported_transaction_no: '', imported_payment_date: ''
  }
}

const pvCss = `
  .pv-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:14px 18px; }
  .pv-field { display:flex; flex-direction:column; gap:6px; min-width:0; }
  .pv-field label { font-size:13px; font-weight:700; color:#263750; }
  .pv-field input, .pv-field select, .pv-field textarea {
    width:100%; font:inherit; color:#17253d; background:white;
    border:1px solid #cdd8e6; border-radius:8px; padding:10px 12px;
  }
  .pv-field input:disabled { color:#56657a; background:#f5f7fb; }
  .pv-section { background:#fff2b3; border-left:4px solid #e6b600;
    padding:10px 14px; margin:26px 0 14px; font-size:15px; font-weight:800; }
  .pv-lines { overflow-x:auto; }
  .pv-lines table { min-width:760px; }
  .pv-lines input { width:100%; min-width:0; padding:9px; border:1px solid #d4dce8;
    border-radius:6px; font:inherit; }
  .pv-lines th { background:#fff2b3; color:#213047; }
  .pv-lines td { padding:7px; }
  .pv-totals { max-width:430px; margin:18px 0 16px auto; }
  .pv-total-row { display:flex; justify-content:space-between; gap:10px;
    padding:10px; border-bottom:1px solid #e5eaf1; }
  .pv-total-row strong { font-variant-numeric:tabular-nums; }
  .pv-total-final { background:#fff2b3; font-weight:800; font-size:17px; }
  .pv-docs { display:flex; flex-wrap:wrap; gap:12px 24px; padding:8px 0; }
  .pv-docs label { display:flex; gap:8px; align-items:center; font-size:14px; }
  .pv-notice { background:#edf3fa; border:1px solid #d5e2f0; border-radius:8px;
    padding:12px 14px; color:#334960; font-size:13px; margin:12px 0; }
  .pv-success { color:#167347; margin:14px 0; font-weight:700; }
  .pv-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:24px; }
  .pv-mode-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:16px; margin-top:18px; }
  .pv-mode-card { display:flex; flex-direction:column; align-items:flex-start; gap:12px;
    width:100%; min-height:165px; padding:22px; border:2px solid #d4dfed;
    border-radius:12px; background:#fff; color:#17253d; text-align:left;
    cursor:pointer; transition:border-color .15s, background .15s; }
  .pv-mode-card:hover, .pv-mode-card:focus-visible { border-color:#173d70; background:#f1f6fc; }
  .pv-mode-card:disabled { opacity:.6; cursor:not-allowed; }
  .pv-mode-card strong { font-size:20px; }
  .pv-mode-card span { font-size:13px; line-height:1.5; color:#5c6f86; }
  .pv-mode-label { display:inline-block; font-size:12px; font-weight:800;
    letter-spacing:.04em; color:#173d70; background:#eaf1fa; border-radius:6px; padding:6px 9px; }
  .pv-tracking-table { min-width:1880px; }
  .pv-tracking-table th { white-space:nowrap; }
  .pv-tracking-table td { vertical-align:top; }
  .pv-inline-remark { display:flex; flex-direction:column; gap:6px; min-width:180px; }
  .pv-inline-remark textarea { font:inherit; font-size:13px; padding:7px; min-height:56px;
    border:1px solid #cdd8e6; border-radius:6px; resize:vertical; }
  .pv-payment-label { display:inline-block; white-space:nowrap; padding:5px 9px;
    border-radius:12px; background:#f3f5f8; color:#5a6473; font-size:12px; font-weight:700; }
  .pv-payment-label.paid { color:#167347; background:#e7f7ee; }
  .pv-payment-label.unpaid { color:#805b00; background:#fff2ca; }
  .pv-workflow-title { font-size:16px; font-weight:800; color:#233852; margin:12px 0; }
  .pv-home-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-bottom:24px; }
  .pv-home-grid.payment { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .pv-home-card { background:#fff; border:1px solid #d4dfed; border-radius:12px;
    text-align:left; padding:20px; min-height:145px; display:flex; flex-direction:column;
    gap:7px; color:#17253d; cursor:pointer; width:100%; }
  .pv-home-card:hover, .pv-home-card:focus-visible { border-color:#173d70; background:#f3f7fd; }
  .pv-home-card strong { font-size:34px; font-weight:800; font-variant-numeric:tabular-nums; }
  .pv-home-card span { font-size:14px; font-weight:800; }
  .pv-home-card small { color:#64748b; line-height:1.4; }
  .pv-action-panel { border:1px solid #eadfb7; background:#fffdf5;
    border-radius:12px; padding:18px; margin-bottom:24px; }
  .pv-action-title { display:flex; align-items:center; justify-content:space-between;
    font-weight:800; font-size:17px; margin-bottom:12px; }
  .pv-action-link { display:flex; justify-content:space-between; gap:12px;
    align-items:center; width:100%; border:0; border-top:1px solid #f0e7ce;
    background:transparent; color:#17253d; text-align:left; padding:11px 0; font:inherit; cursor:pointer; }
  .pv-action-link:hover { color:#173d70; text-decoration:underline; }
  .pv-list-filters { display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr;
    gap:10px; align-items:end; margin:18px 0; }
  .pv-list-filters label { display:block; font-size:12px; font-weight:700; margin-bottom:5px; }
  .pv-list-filters input,.pv-list-filters select { width:100%; padding:9px;
    border:1px solid #cdd8e6; border-radius:8px; font:inherit; background:white; }
  .pv-list-pagination { display:flex; align-items:center; flex-wrap:wrap;
    gap:12px; justify-content:space-between; padding-top:18px; }
  @media(max-width:880px) { .pv-home-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .pv-list-filters { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media(max-width:520px) { .pv-home-grid,.pv-home-grid.payment { grid-template-columns:1fr; }
    .pv-list-filters { grid-template-columns:1fr; } }
  @media(max-width:700px) { .pv-grid, .pv-mode-grid { grid-template-columns:1fr; } }
`

// Malaysia display dates use DD/MM/YYYY; database DATE inputs stay YYYY-MM-DD.
const RECEIPT_BUCKET = 'jauhar-pv-receipts'
const INVOICE_BUCKET = 'jauhar-pv-invoices'
const RECEIPT_MAX_SIZE = 5 * 1024 * 1024
const RECEIPT_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

function myDate(value) {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-')
    return `${day}/${month}/${year}`
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(date)
}

function myISODate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric'
  }).formatToParts(value)
  const read = (part) => parts.find(x => x.type === part)?.value
  return `${read('year')}-${read('month')}-${read('day')}`
}

function fileExtension(file) {
  const extension = file?.name?.split('.').pop()?.toLowerCase()
  if (!extension || !RECEIPT_MIME[extension]) return null
  if (file.type && file.type !== RECEIPT_MIME[extension]) return null
  return extension
}

function money(value) {
  return 'RM ' + (Number(value) || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })
}

function parseAmount(value) {
  const clean = String(value ?? '').trim().replace(/RM\s*/gi, '').replace(/,/g, '')
  return clean || '0'
}

function strictMoney(value, allowZero = false) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) return false
  const n = Number(value)
  return Number.isFinite(n) && n <= 999999999999.99 &&
    (allowZero ? n >= 0 : n > 0)
}

function cellText(sheet, address) {
  const cell = sheet.getCell(address)
  const value = cell.value
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(x => x.text).join('')
    if (value.result != null) return String(value.result)
    if (value.text != null) return String(value.text)
    return ''
  }
  return String(value).trim()
}

function dateToIso(value) {
  if (!value || /[xX]{2}/.test(value)) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const m = String(value).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (!m) return ''
  const date = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])))
  const result = date.toISOString().slice(0, 10)
  return result === `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    ? result : ''
}

function chooseValue(value, allowed) {
  return allowed.find(x => x.toLowerCase() === String(value).trim().toLowerCase()) || ''
}

function readFinancialTier(raw) {
  const value = String(raw ?? '').trim().toUpperCase()
  const match = value.match(/^(?:PV)?(T0[1-9])(?:\b|\s*-)/)
  return match ? match[1] : ''
}

function parseWorkbook(sheet) {
  // Cells below are from the 21 Oct 2026 JMC_FIN_PV FORM(1).xlsx Blank Form.
  // Sample PV and PV Approval Matrix are reference worksheets, NEVER imported.
  const lines = Array.from({ length: 10 }, (_, index) => {
    const row = 28 + index
    return {
      invoice_reference: cellText(sheet, `B${row}`),
      description: cellText(sheet, `E${row}`),
      gl_code: cellText(sheet, `I${row}`),
      amount: cellText(sheet, `K${row}`) ? parseAmount(cellText(sheet, `K${row}`)) : ''
    }
  })

  const documentRow = cellText(sheet, 'A42')
  const checkMarked = (label) =>
    new RegExp(`\\[\\s*[xX✓✔]\\s*\\]\\s*${label}`, 'i').test(documentRow)
  const supporting_types = [
    checkMarked('Invoice') && 'Invoice',
    checkMarked('Qu[ao]tation') && 'Quotation',
    checkMarked('Payment Request Form') && 'Payment Request Form',
    checkMarked('Other') && 'Other'
  ].filter(Boolean)
  const remarksCell = cellText(sheet, 'A44')
  const remarks = /^comments?\s*\/\s*justification/i.test(remarksCell)
    ? '' : remarksCell
  return {
    ...blankForm(),
    payee_name: cellText(sheet, 'D15'),
    supplier_code: cellText(sheet, 'D16'),
    supplier_tin: '', // New workbook has no TIN input; D19 is Branch, NOT TIN.
    bank_name: cellText(sheet, 'D17'),
    bank_account_no: cellText(sheet, 'D18'),
    branch_department: chooseValue(cellText(sheet, 'D19'), choices.branch),
    payment_method: chooseValue(cellText(sheet, 'D21'), choices.method),
    payment_type: chooseValue(cellText(sheet, 'D23'), choices.type),
    expense_nature: chooseValue(cellText(sheet, 'D24'), choices.nature),
    budget_classification: chooseValue(cellText(sheet, 'D25'), choices.budget),
    financial_tier: readFinancialTier(cellText(sheet, 'K12')),
    template_version: cellText(sheet, 'I2'),
    lines,
    sst_amount: parseAmount(cellText(sheet, 'K39')),
    supporting_types,
    supporting_other_text: '',
    remarks,
    // These fields are source-document references, NOT official PV details.
    source_voucher_no: cellText(sheet, 'K10'),
    source_pv_date: dateToIso(cellText(sheet, 'K11')),
    imported_transaction_no: cellText(sheet, 'D22'),
    imported_payment_date: dateToIso(cellText(sheet, 'K22'))
  }
}

function validateImportedPV(form) {
  if (!form.payee_name.trim()) return 'Payee Name is required in Blank Form (D15).'
  if (!form.financial_tier) {
    return 'Select a valid PV Tier in Blank Form K12 (PVT01 to PVT07).'
  }
  const lines = form.lines.filter(item =>
    Object.values(item).some(value => String(value).trim() !== '')
  )
  if (!lines.length) return 'Enter at least one invoice in Blank Form rows 28–37.'
  for (const line of lines) {
    if (!line.invoice_reference.trim() || !line.description.trim() ||
        !strictMoney(line.amount)) {
      return 'Each completed invoice needs Invoice / Reference No., Description and positive Amount (max 2 decimals).'
    }
  }
  if (!strictMoney(form.sst_amount || '0', true)) {
    return 'Invalid SST amount in Blank Form K39.'
  }
  return ''
}

function InputField({ label, name, value, onChange, placeholder = '', required = false,
  disabled = false, type = 'text' }) {
  return (
    <div className="pv-field">
      <label htmlFor={`pv-${name}`}>{label}{required ? ' *' : ''}</label>
      <input id={`pv-${name}`} name={name} value={value} onChange={onChange}
        placeholder={placeholder} required={required} disabled={disabled} type={type} />
    </div>
  )
}

function ChoiceField({ label, name, value, onChange, options }) {
  return (
    <div className="pv-field">
      <label htmlFor={`pv-${name}`}>{label}</label>
      <select id={`pv-${name}`} name={name} value={value} onChange={onChange}>
        {options.map(option => (
          <option value={option} key={option}>{option || 'Select...'}</option>
        ))}
      </select>
    </div>
  )
}

export default function PaymentVoucher({ profile }) {
  const canCreate = profile?.role === 'executive'
  const canManage = profile?.role === 'manager'
  const canApproveCEO = profile?.role === 'ceo'
  const canApproveBOD = profile?.role === 'bod'
  // Payment Voucher always opens its OWN dashboard under Finance Approval.
  const [workspaceMode, setWorkspaceMode] = useState('home')
  const [listCategory, setListCategory] = useState('draft')
  const [listStage, setListStage] = useState('all')
  const [listDraftStatus, setListDraftStatus] = useState('all')
  const [listPage, setListPage] = useState(0)
  const [listTotal, setListTotal] = useState(0)
  const [listSearch, setListSearch] = useState('')
  const [listBranch, setListBranch] = useState('')
  const [listTier, setListTier] = useState('')
  const [listDateFrom, setListDateFrom] = useState('')
  const [listDateTo, setListDateTo] = useState('')
  const latestListRequest = useRef(0)
  const [dashboardCounts, setDashboardCounts] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [form, setForm] = useState(blankForm)
  const [vouchers, setVouchers] = useState([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [archivingVoucherId, setArchivingVoucherId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [importNote, setImportNote] = useState('')
  const [newPvValidated, setNewPvValidated] = useState(false)
  const [uploadedTemplateName, setUploadedTemplateName] = useState('')
  // Open saved PV, and edit an existing draft without creating a new PV number.
  const [viewingVoucher, setViewingVoucher] = useState(null)
  const [viewLines, setViewLines] = useState([])
  const [invoiceDocuments, setInvoiceDocuments] = useState([])
  const [invoiceUploadingId, setInvoiceUploadingId] = useState(null)
  const [invoiceOpeningId, setInvoiceOpeningId] = useState(null)
  const [invoiceLinks, setInvoiceLinks] = useState({})
  const [invoiceMessage, setInvoiceMessage] = useState('')
  const [viewLoading, setViewLoading] = useState(false)
  const [viewError, setViewError] = useState('')
  const [editingVoucher, setEditingVoucher] = useState(null)
  const [submittingVoucher, setSubmittingVoucher] = useState(false)
  const [submitMessage, setSubmitMessage] = useState('')
  // Tier 2 Manager workflow. Backend checks role, active status, stage, and version.
  const [managerRemarks, setManagerRemarks] = useState('')
  const [managerSaving, setManagerSaving] = useState(false)
  const [managerMessage, setManagerMessage] = useState('')
  // Tier 3 CEO approval. Only the CEO RPC is allowed to change this status.
  const [ceoRemarks, setCeoRemarks] = useState('')
  const [ceoSaving, setCeoSaving] = useState(false)
  const [ceoMessage, setCeoMessage] = useState('')
  // Tier 4 BOD final approval. The RPC enforces permissions.
  const [bodRemarks, setBodRemarks] = useState('')
  const [bodSaving, setBodSaving] = useState(false)
  const [bodMessage, setBodMessage] = useState('')
  const [approvalHistory, setApprovalHistory] = useState([])
  const [historyError, setHistoryError] = useState('')
  // Step 31: separate finance/payment tracking from the approval process.
  const [currentUserId, setCurrentUserId] = useState(null)
  const [remarkDrafts, setRemarkDrafts] = useState({})
  const [remarksSavingId, setRemarksSavingId] = useState(null)
  const [paymentDate, setPaymentDate] = useState('')
  const [selectedReceipt, setSelectedReceipt] = useState(null)
  const [uploadedReceiptPath, setUploadedReceiptPath] = useState('')
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState('')
  const [correctionDate, setCorrectionDate] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionSaving, setCorrectionSaving] = useState(false)
  const [correctionMessage, setCorrectionMessage] = useState('')
  const [receiptLinks, setReceiptLinks] = useState({})
  const [receiptLoadingId, setReceiptLoadingId] = useState(null)

  useEffect(() => {
    let alive = true
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setCurrentUserId(data?.user?.id || null)
    }).catch(() => { if (alive) setCurrentUserId(null) })
    return () => { alive = false }
  }, [])

  const ownsVoucher = (voucher) => Boolean(
    canCreate && currentUserId && voucher?.created_by === currentUserId
  )

  // Step 39C: only the creator may archive a never-submitted Draft.
  // Backend is authoritative; this is merely the user interface.
  async function archiveDraft(voucher) {
    if (!ownsVoucher(voucher) || voucher.status !== 'draft' ||
        voucher.archived_at || archivingVoucherId !== null) return

    if (!window.confirm(
      `Delete Draft ${voucher.pv_number} from the active list?\n\n` +
      'This is a soft delete for audit. The PV number will NOT be reused.\n' +
      'Invoice attachments and the audit record will be retained.\n\n' +
      'Only an unsubmitted Draft owned by you can be archived.'
    )) return

    setArchivingVoucherId(voucher.id)
    setError('')
    setSuccess('')
    try {
      const { data, error: archiveError } = await supabase.rpc('archive_pv_draft_v1', {
        p_voucher_id: voucher.id,
        p_expected_updated_at: voucher.updated_at
      })
      if (archiveError) throw archiveError
      if (data?.id !== voucher.id || !data.archived_at) {
        throw new Error('Archive not confirmed. Refresh and inspect the Draft list.')
      }
      setSuccess(`${voucher.pv_number} removed from the active Draft list (audit copy retained).`)
      await refreshPVData()
    } catch (err) {
      setError(`Unable to delete Draft: ${err.message || 'Unknown error'}`)
    } finally {
      setArchivingVoucherId(null)
    }
  }

  // Overview is read-only, but remarks entered for an approval can be unsaved.
  const overviewBusy = submittingVoucher || managerSaving || ceoSaving ||
    bodSaving || paymentSaving || correctionSaving ||
    invoiceUploadingId !== null || invoiceOpeningId !== null

  function closeVoucherOverview() {
    if (overviewBusy) return
    if ((managerRemarks.trim() || ceoRemarks.trim() || bodRemarks.trim() ||
         correctionReason.trim() || selectedReceipt) &&
        !window.confirm('There are unsaved details in this overview. Close anyway?')) return
    setViewingVoucher(null)
    setViewLines([])
    setInvoiceDocuments([])
    setInvoiceLinks({})
    setInvoiceMessage('')
    setSubmitMessage('')
    setManagerMessage('')
    setManagerRemarks('')
    setCeoMessage('')
    setCeoRemarks('')
    setBodMessage('')
    setBodRemarks('')
    setPaymentMessage('')
    setCorrectionMessage('')
    setCorrectionReason('')
    setUploadedReceiptPath('')
    setSelectedReceipt(null)
  }

  useEffect(() => {
    if (!viewingVoucher) return
    const onKeyDown = event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (overviewBusy) return
        event.preventDefault()
        closeVoucherOverview()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewingVoucher, overviewBusy, managerRemarks, ceoRemarks, bodRemarks,
      correctionReason, selectedReceipt])


  // Counts come from the SERVER (exact count), not the first 50 loaded rows.
  // Supabase RLS means each user only counts vouchers they are permitted to see.
  async function loadDashboardCounts() {
    setDashboardLoading(true)
    setDashboardError('')
    try {
      const count = async (build) => {
        const { count: value, error: queryError } = await build(
          supabase.from('payment_vouchers')
            .select('id', { count: 'exact', head: true })
            .is('archived_at', null)
        )
        if (queryError) throw queryError
        return value ?? 0
      }
      const [draft, submitted, approved, pending_payment, paid,
        returned, pending_manager, pending_finance_manager, pending_ceo, pending_bod] = await Promise.all([
        count(q => q.in('status', ['draft', 'returned'])),
        count(q => q.in('status', SUBMITTED_STAGES)),
        count(q => q.eq('status', 'fully_approved')),
        count(q => q.eq('status', 'fully_approved').eq('payment_status', 'pending_payment')),
        count(q => q.eq('status', 'fully_approved').eq('payment_status', 'paid')),
        count(q => q.eq('status', 'returned')),
        count(q => q.eq('status', 'pending_manager')),
        count(q => q.eq('status', 'pending_finance_manager')),
        count(q => q.eq('status', 'pending_ceo')),
        count(q => q.eq('status', 'pending_bod'))
      ])
      setDashboardCounts({ draft, submitted, approved, pending_payment, paid,
        returned, pending_manager, pending_finance_manager, pending_ceo, pending_bod })
    } catch (err) {
      setDashboardCounts(null)
      setDashboardError(err.message || 'Unable to load PV counters.')
    } finally {
      setDashboardLoading(false)
    }
  }

  function withCategory(query) {
    if (listCategory === 'draft') return listDraftStatus === 'all'
      ? query.in('status', ['draft', 'returned'])
      : query.eq('status', listDraftStatus)
    if (listCategory === 'submitted') {
      return listStage === 'all'
        ? query.in('status', SUBMITTED_STAGES)
        : query.eq('status', listStage)
    }
    if (listCategory === 'approved') return query.eq('status', 'fully_approved')
    if (listCategory === 'pending_payment') {
      return query.eq('status', 'fully_approved').eq('payment_status', 'pending_payment')
    }
    if (listCategory === 'paid') {
      return query.eq('status', 'fully_approved').eq('payment_status', 'paid')
    }
    return query.eq('status', 'rejected') // Archive is accessible separately.
  }

  // Paginated queries avoid loading every Paid PV into the browser.
  async function loadVouchers() {
    const requestId = ++latestListRequest.current
    setListLoading(true)
    setError('')
    try {
      let query = supabase.from('payment_vouchers')
        .select('id, pv_number, financial_tier, archived_at, payee_name, amount, sst_amount, status, created_at, updated_at, created_by, payment_status, executive_payment_remarks, final_approval_date, payment_date, receipt_path',
          { count: 'exact' })
      query = withCategory(query).is('archived_at', null)
      if (listTier === 'legacy') query = query.is('financial_tier', null)
      else if (listTier) query = query.eq('financial_tier', listTier)
      const safeSearch = listSearch.trim().slice(0, 60)
        .replace(/[^a-zA-Z0-9 _-]/g, '')
      if (safeSearch) {
        query = query.or(`pv_number.ilike.%${safeSearch}%,payee_name.ilike.%${safeSearch}%`)
      }
      if (listBranch) query = query.eq('branch_department', listBranch)
      if (listDateFrom) query = query.gte('created_at', `${listDateFrom}T00:00:00+08:00`)
      if (listDateTo) query = query.lte('created_at', `${listDateTo}T23:59:59+08:00`)
      const { data, count, error: listError } = await query
        .order('created_at', { ascending: false })
        .range(listPage * PV_LIST_PAGE_SIZE,
          (listPage + 1) * PV_LIST_PAGE_SIZE - 1)
      if (listError) throw listError
      if (requestId === latestListRequest.current) {
        setVouchers(data || [])
        setListTotal(count ?? 0)
      }
    } catch (err) {
      if (requestId === latestListRequest.current) {
        setVouchers([])
        setListTotal(0)
        setError(err.message || 'Unable to load Payment Vouchers.')
      }
    } finally {
      if (requestId === latestListRequest.current) setListLoading(false)
    }
  }

  function openCategory(category, stage = 'all') {
    if (!changeMode('existing')) return
    setListCategory(category)
    setListStage(category === 'submitted' ? stage : 'all')
    setListDraftStatus(category === 'draft' && stage === 'returned' ? 'returned' : 'all')
    setListPage(0)
    setListSearch('')
    setListBranch('')
    setListTier('')
    setListDateFrom('')
    setListDateTo('')
  }

  async function refreshPVData() {
    await Promise.all([loadDashboardCounts(), loadVouchers()])
  }

  // Approval History is read-only. RLS restricts access to visible vouchers.
  async function refreshApprovalHistory(voucherId) {
    setHistoryError('')
    const { data, error: historyQueryError } = await supabase
      .from('pv_approval_actions')
      .select('id, approval_round, tier, action, remarks, created_at')
      .eq('voucher_id', voucherId)
      .order('created_at', { ascending: true })

    if (historyQueryError) {
      setHistoryError(historyQueryError.message)
      setApprovalHistory([])
    } else {
      setApprovalHistory(data || [])
    }
  }

  // Retrieve a saved voucher and its invoice lines in read-only mode.
  // RLS on the database determines which vouchers the logged-in user can read.
  async function openVoucher(voucherId) {
    setPaymentMessage('')
    setPaymentDate('')
    setSelectedReceipt(null)
    setUploadedReceiptPath('')
    setCorrectionDate('')
    setCorrectionReason('')
    setCorrectionMessage('')
    setSubmitMessage('')
    setManagerMessage('')
    setManagerRemarks('')
    setCeoMessage('')
    setCeoRemarks('')
    setBodMessage('')
    setBodRemarks('')
    setApprovalHistory([])
    setHistoryError('')
    setViewLoading(true)
    setViewError('')
    setViewingVoucher(null)
    setViewLines([])
    setInvoiceDocuments([])
    setInvoiceLinks({})
    setInvoiceMessage('')


    try {
      const { data: voucher, error: voucherError } = await supabase
        .from('payment_vouchers')
        .select('*')
        .eq('id', voucherId)
        .is('archived_at', null)
        .single()

      if (voucherError) throw voucherError

      const { data: lines, error: linesError } = await supabase
        .from('pv_line_items') 
        .select('id, line_no, invoice_reference, description, gl_code, amount')
        .eq('voucher_id', voucherId)
        .order('line_no', { ascending: true })

      if (linesError) throw linesError
        const { data: documents, error: documentsError } =
          await supabase
            .from('pv_invoice_documents')
            .select('id, line_item_id, storage_path, created_at')
            .eq('voucher_id', voucherId)
        if (documentsError) throw documentsError

        setInvoiceDocuments(documents || [])

      setViewingVoucher(voucher)
      setViewLines(lines || [])
      setPaymentDate(myISODate())
      setCorrectionDate(voucher.payment_date || '')
      setRemarkDrafts(current => ({
        ...current, [voucher.id]: voucher.executive_payment_remarks || ''
      }))
      // History errors do not block reading voucher details.
      await refreshApprovalHistory(voucherId)
    } catch (err) {
      setViewError(err.message || 'Unable to open Payment Voucher.')
    } finally {
      setViewLoading(false)
    }
  }

  // Executive payment remarks are separate from the initial PV remarks.
  async function saveExecutivePaymentRemarks(voucher) {
    if (!ownsVoucher(voucher) || remarksSavingId) return
    const remarks = String(remarkDrafts[voucher.id] ?? voucher.executive_payment_remarks ?? '').trim()
    if (remarks.length > 2000) {
      setError('Executive Remarks may not exceed 2000 characters.')
      return
    }
    if (remarks === (voucher.executive_payment_remarks || '')) return
    setRemarksSavingId(voucher.id)
    setError('')
    setSuccess('')
    try {
      const { data, error: saveError } = await supabase.rpc(
        'update_pv_payment_remarks', {
          p_voucher_id: voucher.id, p_remarks: remarks || null
        }
      )
      if (saveError) throw saveError
      if (data?.id !== voucher.id) throw new Error('Remarks update not confirmed.')
      setVouchers(items => items.map(item => item.id === voucher.id ? {
        ...item, executive_payment_remarks: data.executive_payment_remarks
      } : item))
      setViewingVoucher(current => current?.id === voucher.id ? data : current)
      setRemarkDrafts(current => ({ ...current, [voucher.id]: data.executive_payment_remarks || '' }))
      setSuccess(`${voucher.pv_number}: Executive Remarks saved.`)
    } catch (err) {
      setError(`Unable to save remarks: ${err.message || 'Unknown error'}`)
    } finally {
      setRemarksSavingId(null)
    }
  }

  // Generate short-lived signed links; the receipt bucket is never public.
  async function getReceiptLink(voucher) {
    if (!voucher?.receipt_path || receiptLoadingId) return
    setReceiptLoadingId(voucher.id)
    setError('')
    setPaymentMessage('')
    try {
      const { data, error: linkError } = await supabase.storage
        .from(RECEIPT_BUCKET)
        .createSignedUrl(voucher.receipt_path, 90)
      if (linkError) throw linkError
      if (!data?.signedUrl) throw new Error('Receipt link not available.')
      setReceiptLinks(current => ({ ...current, [voucher.id]: data.signedUrl }))
    } catch (err) {
      setError(`Unable to open receipt: ${err.message || 'Unknown error'}`)
    } finally {
      setReceiptLoadingId(null)
    }
  }


async function uploadInvoice(line, file) {
  const voucher = viewingVoucher

  if (!file || !voucher || !line?.id) return

  if (!ownsVoucher(voucher) ||
      !(voucher.status === 'draft' || (voucher.status === 'returned' &&
        profile?.department === 'Finance' && ['T01','T02','T04','T08'].includes(voucher.financial_tier))) ||
      invoiceUploadingId) {
    setInvoiceMessage('Only the Draft owner can upload invoices.')
    return
  }

  if (!currentUserId) {
    setInvoiceMessage('User session is not ready. Try again.')
    return
  }

  if (invoiceDocuments.some(d => d.line_item_id === line.id)) {
    setInvoiceMessage('This invoice already has an attachment.')
    return
  }

  const extension = fileExtension(file)

  if (!extension || file.size === 0 ||
      file.size > RECEIPT_MAX_SIZE) {
    setInvoiceMessage(
      'Choose a PDF/JPG/PNG/WEBP file, maximum 5 MB.'
    )
    return
  }

  setInvoiceUploadingId(line.id)
  setInvoiceMessage('Uploading invoice...')

  const storagePath =
    `${voucher.id}/${line.id}/${crypto.randomUUID()}.${extension}`

  let fileUploaded = false

  try {
    const { error: uploadError } = await supabase.storage
      .from(INVOICE_BUCKET)
      .upload(storagePath, file, {
        upsert: false,
        contentType: RECEIPT_MIME[extension]
      })

    if (uploadError) throw uploadError
    fileUploaded = true

    const { data: document, error: documentError } =
      await supabase
        .from('pv_invoice_documents')
        .insert({
          voucher_id: voucher.id,
          line_item_id: line.id,
          storage_path: storagePath,
          uploaded_by: currentUserId
        })
        .select('id, line_item_id, storage_path, created_at')
        .single()

    if (documentError) throw documentError

    setInvoiceDocuments(current => [...current, document])
    setInvoiceMessage(
      `Invoice ${line.invoice_reference} uploaded successfully.`
    )
  } catch (err) {
    setInvoiceMessage(
      `Invoice upload failed: ${err.message || 'Unknown error'}.` +
      (fileUploaded
        ? ' The file reached Storage but registration failed. ' +
          'Contact System Admin to check for an orphan file before retrying.'
        : '')
    )
  } finally {
    setInvoiceUploadingId(null)
  }
}
    async function viewInvoice(document) {
      if (!document || invoiceOpeningId) return

      setInvoiceOpeningId(document.line_item_id)
      setInvoiceMessage('')

      try {
        const { data, error: linkError } = await supabase.storage
          .from(INVOICE_BUCKET)
          .createSignedUrl(document.storage_path, 60)

        if (linkError) throw linkError
        if (!data?.signedUrl) {
          throw new Error('Unable to generate a secure invoice link.')
        }

        setInvoiceLinks(current => ({
          ...current,
          [document.line_item_id]: data.signedUrl
        }))
      } catch (err) {
        setInvoiceMessage(
          `Unable to view invoice: ${err.message || 'Unknown error'}`
        )
      } finally {
        setInvoiceOpeningId(null)
      }
    }

  // Executive records an actual bank payment only after BOD final approval.
  async function recordPayment() {
    const voucher = viewingVoucher
    if (!ownsVoucher(voucher) || voucher.status !== 'fully_approved' ||
        voucher.payment_status === 'paid' || paymentSaving) return

    const earliest = voucher.final_approval_date
      ? myISODate(new Date(voucher.final_approval_date)) : ''
    const today = myISODate()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
        paymentDate < earliest || paymentDate > today) {
      setPaymentMessage(`Invalid payment date. Use a date from ${myDate(voucher.final_approval_date)} to ${myDate(today)}.`)
      return
    }
    if (!selectedReceipt && !uploadedReceiptPath) {
      setPaymentMessage('A receipt (PDF or image) is required before Paid can be recorded.')
      return
    }
    const extension = selectedReceipt ? fileExtension(selectedReceipt) : null
    if (selectedReceipt && (!extension || selectedReceipt.size === 0 ||
        selectedReceipt.size > RECEIPT_MAX_SIZE)) {
      setPaymentMessage('Receipt must be PDF/JPG/PNG/WEBP, nonempty and maximum 5 MB.')
      return
    }
    if (!window.confirm(
      `Mark ${voucher.pv_number} as PAID?\n\n` +
      `Amount: ${money(voucher.amount)}\nPayment Date: ${myDate(paymentDate)}\n` +
      'Confirm only if the payment actually happened and the receipt is genuine.'
    )) return

    setPaymentSaving(true)
    setPaymentMessage('')
    let path = uploadedReceiptPath
    try {
      if (!path) {
        if (!selectedReceipt) throw new Error('Select a payment receipt first.')
        path = `${voucher.id}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase.storage
          .from(RECEIPT_BUCKET)
          .upload(path, selectedReceipt, {
            upsert: false,
            contentType: RECEIPT_MIME[extension],
            cacheControl: '60'
          })
        if (uploadError) throw uploadError
        setUploadedReceiptPath(path)
      }
      const { data, error: recordError } = await supabase.rpc(
        'record_pv_payment', {
          p_voucher_id: voucher.id,
          p_payment_date: paymentDate,
          p_receipt_path: path,
          p_expected_updated_at: voucher.updated_at
        }
      )
      if (recordError) throw recordError
      if (data?.id !== voucher.id || data?.payment_status !== 'paid') {
        throw new Error('Payment status could not be confirmed. Reopen the voucher.')
      }
      setViewingVoucher(data)
      setPaymentDate(data.payment_date || '')
      setSelectedReceipt(null)
      setUploadedReceiptPath('')
      setPaymentMessage(`${data.pv_number} recorded as Paid. Receipt saved privately.`)
      await refreshPVData()
    } catch (err) {
      setPaymentMessage(
        `Payment was NOT confirmed: ${err.message || 'Unknown error'}. ` +
        (path ? 'Receipt may already be uploaded; leave this window open and retry after checking the voucher.' : '')
      )
    } finally {
      setPaymentSaving(false)
    }
  }

  // Manager may correct Payment Date for already-paid PVs, with compulsory justification.
  async function correctPaymentDate() {
    const voucher = viewingVoucher
    if (!canManage || !voucher || voucher.payment_status !== 'paid' ||
        voucher.status !== 'fully_approved' || correctionSaving) return
    const reason = correctionReason.trim()
    const earliest = voucher.final_approval_date
      ? myISODate(new Date(voucher.final_approval_date)) : ''
    if (!reason || reason.length > 1000) {
      setCorrectionMessage('Correction reason is mandatory (maximum 1000 characters).')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(correctionDate) ||
        correctionDate < earliest || correctionDate > myISODate() ||
        correctionDate === voucher.payment_date) {
      setCorrectionMessage('Select a different, valid Payment Date after final approval.')
      return
    }
    if (!window.confirm(
      `Correct Payment Date for ${voucher.pv_number}?\n\n` +
      `${myDate(voucher.payment_date)} → ${myDate(correctionDate)}\n\n` +
      `Reason: ${reason}`
    )) return
    setCorrectionSaving(true)
    setCorrectionMessage('')
    try {
      const { data, error: correctionError } = await supabase.rpc(
        'manager_correct_pv_payment_date', {
          p_voucher_id: voucher.id,
          p_payment_date: correctionDate,
          p_reason: reason
        }
      )
      if (correctionError) throw correctionError
      if (data?.id !== voucher.id || data?.payment_date !== correctionDate) {
        throw new Error('Correction was not confirmed.')
      }
      setViewingVoucher(data)
      setCorrectionReason('')
      setCorrectionMessage('Payment Date corrected. Audit entry saved.')
      await refreshPVData()
    } catch (err) {
      setCorrectionMessage(`Correction failed: ${err.message || 'Unknown error'}`)
    } finally {
      setCorrectionSaving(false)
    }
  }

  // Tier 1: the Executive who created the Draft submits it for Manager review.
  // The Supabase RPC enforces role, ownership, Draft status and stale-version checks.
  // Pilot: Finance-only T01/T02; other Financial Tiers remain blocked.
  // Server RPC (not React) enforces ownership, documents, amount, role and approval stage.
  async function submitAndVerify() {
    const voucher = viewingVoucher
    if (!canCreate || !voucher || !['draft', 'returned'].includes(voucher.status) || submittingVoucher) return

    const financePilot = ['T01', 'T02', 'T04', 'T08'].includes(voucher.financial_tier)
    const t04Pilot = voucher.financial_tier === 'T04'
    const t08Pilot = voucher.financial_tier === 'T08'
    if (voucher.status === 'returned' && !financePilot) {
      setSubmitMessage('Only Finance T01/T02/T04/T08 Returned PVs can resubmit in this pilot.')
      return
    }
    if (voucher.financial_tier && !financePilot) {
      setSubmitMessage('Only Finance T01/T02/T04/T08 submission is enabled. Other tiers remain locked.')
      return
    }
    if (financePilot && profile?.department !== 'Finance') {
      setSubmitMessage('Finance pilot T01/T02/T04/T08 is available to Finance Executives only.')
      return
    }
    if (financePilot && (!viewLines.length || !viewLines.every(line =>
      invoiceDocuments.some(doc => doc.line_item_id === line.id)))) {
      setSubmitMessage('Upload one registered invoice PDF/image for every invoice line before submitting.')
      return
    }

    const confirmed = window.confirm(
      `Submit & Verify ${voucher.pv_number}?\n\n` +
      `Financial Tier: ${voucher.financial_tier || 'Legacy'}\n` +
      `Amount: ${money(voucher.amount)}\n\n` +
      (financePilot
        ? (t08Pilot
            ? 'Your submission sends this PV to Finance Manager, CEO, then BOD FINAL approval.\n'
            : t04Pilot
            ? 'Your submission sends this PV to the Finance Manager, then CEO for final approval.\n'
            : 'Your submission sends this PV to the Finance Manager for final decision.\n')
        : 'Your submission sends the Legacy PV to Manager review.\n') +
      'The PV will be locked for normal edits until returned for amendment.'
    )
    if (!confirmed) return

    setSubmittingVoucher(true)
    setSubmitMessage('')
    try {
      const rpcName = t08Pilot ? 'submit_finance_t08_v1'
        : t04Pilot ? 'submit_finance_t04_v1'
        : financePilot ? 'submit_finance_t01_t02_v2'
        : 'submit_pv_for_approval'
      const { data, error: submitError } = await supabase.rpc(rpcName, {
        p_voucher_id: voucher.id,
        p_expected_updated_at: voucher.updated_at
      })
      if (submitError) throw submitError
      const expectedStatus = financePilot ? 'pending_finance_manager' : 'pending_manager'
      if (!data || data.id !== voucher.id || data.status !== expectedStatus) {
        throw new Error('Submission status could not be confirmed. Reopen the PV to check.')
      }
      setViewingVoucher(data)
      setSubmitMessage(`${data.pv_number} submitted. Status: ${expectedStatus.replaceAll('_',' ')}.`)
      await refreshPVData()
      await refreshApprovalHistory(voucher.id)
    } catch (err) {
      setSubmitMessage(`Submission failed: ${err.message || 'Unknown error'}`)
    } finally {
      setSubmittingVoucher(false)
    }
  }

  // Tier 2: Manager approves, returns for amendment, or permanently rejects.
  // The RPC is authoritative; UI role checks are only a convenience.
  async function managerDecide(decision) {
    const voucher = viewingVoucher
    if (!canManage || !voucher || voucher.status !== 'pending_manager' || managerSaving) return

    const remarks = managerRemarks.trim()
    if (['return', 'reject'].includes(decision) && !remarks) {
      setManagerMessage('Decision failed: Remarks are required for Return or Reject.')
      return
    }
    if (remarks.length > 2000) {
      setManagerMessage('Decision failed: Remarks cannot exceed 2000 characters.')
      return
    }

    const newStatus = {
      approve: 'Pending CEO',
      return: 'Returned for Amendment',
      reject: 'Rejected Permanently'
    }[decision]
    if (!newStatus) return

    const confirmed = window.confirm(
      `${decision.toUpperCase()} ${voucher.pv_number}?\n\n` +
      `Amount: ${money(voucher.amount)}\n` +
      `New status: ${newStatus}\n\n` +
      (remarks ? `Remarks: ${remarks}\n\n` : '') +
      'This decision will be saved in the PV approval history.'
    )
    if (!confirmed) return

    setManagerSaving(true)
    setManagerMessage('')

    try {
      const { data, error: decisionError } = await supabase.rpc(
        'manager_decide_pv', {
          p_voucher_id: voucher.id,
          p_decision: decision,
          p_expected_updated_at: voucher.updated_at,
          p_remarks: remarks || null
        }
      )
      if (decisionError) throw decisionError

      const expectedStatus = {
        approve: 'pending_ceo', return: 'returned', reject: 'rejected'
      }[decision]
      if (!data || data.id !== voucher.id || data.status !== expectedStatus) {
        throw new Error('Decision result could not be confirmed. Refresh and reopen the voucher.')
      }

      setViewingVoucher(data)
      setManagerRemarks('')
      setManagerMessage(`${data.pv_number}: ${newStatus}. Manager decision recorded.`)
      await refreshPVData()
      await refreshApprovalHistory(voucher.id)
    } catch (err) {
      setManagerMessage(`Decision failed: ${err.message || 'Unknown error'}`)
    } finally {
      setManagerSaving(false)
    }
  }

  // Finance T01/T02 pilot is DISTINCT from the original Legacy Manager decision.
  // Do not change manager_decide_pv, ceo_decide_pv or bod_decide_pv.
  async function financeManagerDecide(decision) {
    const voucher = viewingVoucher
    if (!canManage || profile?.department !== 'Finance' || !voucher ||
        voucher.status !== 'pending_finance_manager' ||
        !['T01', 'T02', 'T04', 'T08'].includes(voucher.financial_tier) || managerSaving) return

    const remarks = managerRemarks.trim()
    if (!['approve', 'return', 'reject'].includes(decision)) return
    if (['return','reject'].includes(decision) && !remarks) {
      setManagerMessage('Decision failed: Remarks required for Return or Reject.')
      return
    }
    if (remarks.length > 2000) {
      setManagerMessage('Decision failed: Remarks exceed 2000 characters.')
      return
    }
    if (!window.confirm(
      `${decision.toUpperCase()} ${voucher.pv_number}?\n` +
      `Tier: ${voucher.financial_tier}\n` +
      `Amount: ${money(voucher.amount)}\n` +
      `Result: ${decision === 'approve' ? (['T04','T08'].includes(voucher.financial_tier)
        ? (voucher.financial_tier === 'T08' ? 'Pending CEO, then BOD final' : 'Pending CEO for final decision')
        : 'Fully Approved (Finance Manager final)') :
        decision === 'return' ? 'Returned for Amendment' : 'Rejected Permanently'}\n` +
      (remarks ? `Remarks: ${remarks}\n` : '')
    )) return

    setManagerSaving(true)
    setManagerMessage('')
    try {
      const { data, error: decisionError } = await supabase.rpc(
        voucher.financial_tier === 'T08' ? 'finance_manager_decide_t08_v1'
          : voucher.financial_tier === 'T04'
          ? 'finance_manager_decide_t04_v1' : 'finance_manager_decide_t01_t02_v1', {
          p_voucher_id: voucher.id,
          p_decision: decision,
          p_expected_updated_at: voucher.updated_at,
          p_remarks: remarks || null
        }
      )
      if (decisionError) throw decisionError
      const expected = decision === 'approve'
        ? (['T04','T08'].includes(voucher.financial_tier) ? 'pending_ceo' : 'fully_approved') :
        decision === 'return' ? 'returned' : 'rejected'
      if (!data || data.id !== voucher.id || data.status !== expected) {
        throw new Error('Decision not confirmed; reopen PV before retrying.')
      }
      setViewingVoucher(data)
      setManagerRemarks('')
      setManagerMessage(`${data.pv_number}: ${expected.replaceAll('_',' ')} (Finance Manager).`)
      await refreshPVData()
      await refreshApprovalHistory(voucher.id)
    } catch (err) {
      setManagerMessage(`Decision failed: ${err.message || 'Unknown error'}`)
    } finally {
      setManagerSaving(false)
    }
  }


  // Step 39B: T04 CEO is the FINAL approver (unlike Legacy CEO -> BOD).
  // The server independently verifies current-round Finance Manager approval.
  async function ceoDecideT04(decision) {
    const voucher = viewingVoucher
    if (!canApproveCEO || !voucher || voucher.financial_tier !== 'T04' ||
        voucher.status !== 'pending_ceo' || ceoSaving) return
    const remarks = ceoRemarks.trim()
    if (!['approve', 'return', 'reject'].includes(decision)) return
    if (['return', 'reject'].includes(decision) && !remarks) {
      setCeoMessage('Decision failed: Reason is mandatory for Return or Reject.')
      return
    }
    if (remarks.length > 2000) {
      setCeoMessage('Decision failed: Remarks exceed 2000 characters.')
      return
    }
    const outcome = decision === 'approve' ? 'Fully Approved (CEO final)' :
      decision === 'return' ? 'Returned for Amendment' : 'Rejected Permanently'
    if (!window.confirm(
      `${decision.toUpperCase()} ${voucher.pv_number}?\n\n` +
      `Tier: T04\nAmount: ${money(voucher.amount)}\n` +
      `Result: ${outcome}\n` +
      (remarks ? `Remarks: ${remarks}\n` : '')
    )) return
    setCeoSaving(true)
    setCeoMessage('')
    try {
      const { data, error: decisionError } = await supabase.rpc('ceo_decide_t04_v1', {
        p_voucher_id: voucher.id,
        p_decision: decision,
        p_expected_updated_at: voucher.updated_at,
        p_remarks: remarks || null
      })
      if (decisionError) throw decisionError
      const expected = decision === 'approve' ? 'fully_approved' :
        decision === 'return' ? 'returned' : 'rejected'
      if (!data || data.id !== voucher.id || data.status !== expected) {
        throw new Error('CEO decision not confirmed; close and reopen PV before retrying.')
      }
      setViewingVoucher(data)
      setCeoRemarks('')
      setCeoMessage(`${data.pv_number}: ${outcome}.`)
      await refreshPVData()
      await refreshApprovalHistory(voucher.id)
    } catch (err) {
      setCeoMessage(`Decision failed: ${err.message || 'Unknown error'}`)
    } finally {
      setCeoSaving(false)
    }
  }


  // Step 40: T08 CEO approval goes to BOD, never directly to Fully Approved.
  async function ceoDecideT08(decision) {
    const voucher = viewingVoucher
    if (!canApproveCEO || !voucher || voucher.financial_tier !== 'T08' ||
        voucher.status !== 'pending_ceo' || ceoSaving) return
    const remarks = ceoRemarks.trim()
    if (!['approve','return','reject'].includes(decision)) return
    if (['return','reject'].includes(decision) && !remarks) {
      setCeoMessage('Decision failed: Remarks required for Return or Reject.'); return
    }
    if (remarks.length > 2000) {
      setCeoMessage('Decision failed: Remarks exceed 2000 characters.'); return
    }
    const outcome = decision === 'approve' ? 'Pending BOD for FINAL approval' :
      decision === 'return' ? 'Returned for Amendment' : 'Rejected Permanently'
    if (!window.confirm(
      `${decision.toUpperCase()} ${voucher.pv_number}?\n\nTier: T08\n` +
      `Amount: ${money(voucher.amount)}\nResult: ${outcome}\n` +
      (remarks ? `Remarks: ${remarks}\n` : '')
    )) return
    setCeoSaving(true)
    setCeoMessage('')
    try {
      const {data,error:rpcError} = await supabase.rpc('ceo_decide_t08_v1', {
        p_voucher_id: voucher.id, p_decision: decision,
        p_expected_updated_at: voucher.updated_at, p_remarks: remarks || null
      })
      if (rpcError) throw rpcError
      const expected = decision === 'approve' ? 'pending_bod' :
        decision === 'return' ? 'returned' : 'rejected'
      if (!data || data.id !== voucher.id || data.status !== expected) {
        throw new Error('T08 CEO decision not confirmed; reopen this PV.')
      }
      setViewingVoucher(data)
      setCeoRemarks('')
      setCeoMessage(`${data.pv_number}: ${outcome}.`)
      await refreshPVData()
      await refreshApprovalHistory(voucher.id)
    } catch (err) {
      setCeoMessage(`Decision failed: ${err.message || 'Unknown error'}`)
    } finally { setCeoSaving(false) }
  }

  // Tier 3: CEO approves, returns for amendment, or permanently rejects.
  // Supabase RPC enforces active CEO role, Pending CEO status, and earlier approvals.
  async function ceoDecide(decision) {
    const voucher = viewingVoucher
    if (!canApproveCEO || !voucher || voucher.status !== 'pending_ceo' ||
        ['T04','T08'].includes(voucher.financial_tier) || ceoSaving) return

    const remarks = ceoRemarks.trim()
    if (['return', 'reject'].includes(decision) && !remarks) {
      setCeoMessage('Decision failed: Remarks are required for Return or Reject.')
      return
    }
    if (remarks.length > 2000) {
      setCeoMessage('Decision failed: Remarks cannot exceed 2000 characters.')
      return
    }

    const newStatus = {
      approve: 'Pending BOD',
      return: 'Returned for Amendment',
      reject: 'Rejected Permanently'
    }[decision]
    if (!newStatus) return

    const confirmed = window.confirm(
      `${decision.toUpperCase()} ${voucher.pv_number}?\n\n` +
      `Amount: ${money(voucher.amount)}\n` +
      `New status: ${newStatus}\n\n` +
      (remarks ? `Remarks: ${remarks}\n\n` : '') +
      'This decision will be recorded in the PV approval history.'
    )
    if (!confirmed) return

    setCeoSaving(true)
    setCeoMessage('')

    try {
      const { data, error: decisionError } = await supabase.rpc(
        'ceo_decide_pv', {
          p_voucher_id: voucher.id,
          p_decision: decision,
          p_expected_updated_at: voucher.updated_at,
          p_remarks: remarks || null
        }
      )
      if (decisionError) throw decisionError

      const expectedStatus = {
        approve: 'pending_bod', return: 'returned', reject: 'rejected'
      }[decision]
      if (!data || data.id !== voucher.id || data.status !== expectedStatus) {
        throw new Error('Decision result could not be confirmed. Refresh and reopen the voucher.')
      }

      setViewingVoucher(data)
      setCeoRemarks('')
      setCeoMessage(`${data.pv_number}: ${newStatus}. CEO decision recorded.`)
      await refreshPVData()
      await refreshApprovalHistory(voucher.id)
    } catch (err) {
      setCeoMessage(`Decision failed: ${err.message || 'Unknown error'}`)
    } finally {
      setCeoSaving(false)
    }
  }

  // Tier 4: BOD gives the FINAL approval, returns for amendment, or rejects.
  // Fully Approved is NOT the same as Paid. Payment execution is a separate process.
  async function bodDecide(decision) {
    const voucher = viewingVoucher
    if (!canApproveBOD || !voucher || voucher.status !== 'pending_bod' ||
        voucher.financial_tier === 'T08' || bodSaving) return

    const remarks = bodRemarks.trim()
    if (['return', 'reject'].includes(decision) && !remarks) {
      setBodMessage('Decision failed: Remarks are required for Return or Reject.')
      return
    }
    if (remarks.length > 2000) {
      setBodMessage('Decision failed: Remarks cannot exceed 2000 characters.')
      return
    }

    const newStatus = {
      approve: 'Fully Approved',
      return: 'Returned for Amendment',
      reject: 'Rejected Permanently'
    }[decision]
    if (!newStatus) return

    const confirmed = window.confirm(
      `${decision.toUpperCase()} ${voucher.pv_number}?\n\n` +
      `Amount: ${money(voucher.amount)}\n` +
      `New status: ${newStatus}\n\n` +
      (remarks ? `Remarks: ${remarks}\n\n` : '') +
      'This is a FINAL BOD decision. Approval does not mean payment has been executed.'
    )
    if (!confirmed) return

    setBodSaving(true)
    setBodMessage('')

    try {
      const { data, error: decisionError } = await supabase.rpc(
        'bod_decide_pv', {
          p_voucher_id: voucher.id,
          p_decision: decision,
          p_expected_updated_at: voucher.updated_at,
          p_remarks: remarks || null
        }
      )
      if (decisionError) throw decisionError

      const expectedStatus = {
        approve: 'fully_approved', return: 'returned', reject: 'rejected'
      }[decision]
      if (!data || data.id !== voucher.id || data.status !== expectedStatus) {
        throw new Error('Decision result could not be confirmed. Refresh and reopen the voucher.')
      }

      setViewingVoucher(data)
      setBodRemarks('')
      setBodMessage(`${data.pv_number}: ${newStatus}. BOD final decision recorded.`)
      await refreshPVData()
      await refreshApprovalHistory(voucher.id)
    } catch (err) {
      setBodMessage(`Decision failed: ${err.message || 'Unknown error'}`)
    } finally {
      setBodSaving(false)
    }
  }


  // Step 40: Only BOD can FINAL approve T08 after same-round FM and CEO approvals.
  async function bodDecideT08(decision) {
    const voucher = viewingVoucher
    if (!canApproveBOD || !voucher || voucher.financial_tier !== 'T08' ||
        voucher.status !== 'pending_bod' || bodSaving) return
    const remarks = bodRemarks.trim()
    if (!['approve','return','reject'].includes(decision)) return
    if (['return','reject'].includes(decision) && !remarks) {
      setBodMessage('Decision failed: Remarks required for Return or Reject.'); return
    }
    if (remarks.length > 2000) {
      setBodMessage('Decision failed: Remarks exceed 2000 characters.'); return
    }
    const outcome = decision === 'approve' ? 'Fully Approved (BOD final)' :
      decision === 'return' ? 'Returned for Amendment' : 'Rejected Permanently'
    if (!window.confirm(
      `${decision.toUpperCase()} ${voucher.pv_number}?\n\nTier: T08\n` +
      `Amount: ${money(voucher.amount)}\nResult: ${outcome}\n` +
      (remarks ? `Remarks: ${remarks}\n` : '') +
      'This action does NOT record an actual bank payment.'
    )) return
    setBodSaving(true)
    setBodMessage('')
    try {
      const {data,error:rpcError} = await supabase.rpc('bod_decide_t08_v1', {
        p_voucher_id: voucher.id, p_decision: decision,
        p_expected_updated_at: voucher.updated_at, p_remarks: remarks || null
      })
      if (rpcError) throw rpcError
      const expected = decision === 'approve' ? 'fully_approved' :
        decision === 'return' ? 'returned' : 'rejected'
      if (!data || data.id !== voucher.id || data.status !== expected) {
        throw new Error('T08 BOD decision not confirmed; reopen this PV.')
      }
      setViewingVoucher(data)
      setBodRemarks('')
      setBodMessage(`${data.pv_number}: ${outcome}.`)
      await refreshPVData()
      await refreshApprovalHistory(voucher.id)
    } catch (err) {
      setBodMessage(`Decision failed: ${err.message || 'Unknown error'}`)
    } finally { setBodSaving(false) }
  }

  // Refill the same form using an existing Draft. Save Changes calls
  // update_pv_draft_v3; the server checks ownership and status again.
  function startEditDraft() {
    const voucher = viewingVoucher
    if (!ownsVoucher(voucher) || !['draft','returned'].includes(voucher.status)) return
    if (voucher.status === 'returned' &&
        !(profile?.department === 'Finance' && ['T01','T02','T04','T08'].includes(voucher.financial_tier))) return

    // IMPORTANT: Rehydrate every stored line; never silently truncate after line five.
    const restoredLines = [...viewLines]
      .sort((a, b) => Number(a.line_no) - Number(b.line_no))
      .map(saved => ({
        id: saved.id,
        invoice_reference: saved.invoice_reference || '',
        description: saved.description || '',
        gl_code: saved.gl_code || '',
        amount: String(saved.amount ?? '')
      }))
    while (restoredLines.length < DEFAULT_INVOICE_LINES) {
      restoredLines.push(blankInvoiceLine())
    }

    setForm({
      ...blankForm(),
      payee_name: voucher.payee_name || '',
      supplier_code: voucher.supplier_code || '',
      supplier_tin: voucher.supplier_tin || '',
      bank_name: voucher.bank_name || '',
      bank_account_no: voucher.bank_account_no || '',
      branch_department: voucher.branch_department || '',
      payment_method: voucher.payment_method || '',
      payment_type: voucher.payment_type || '',
      expense_nature: voucher.expense_nature || '',
      budget_classification: voucher.budget_classification || '',
      lines: restoredLines,
      financial_tier: voucher.financial_tier || '',
      template_version: voucher.source_template_version || '',
      sst_amount: String(voucher.sst_amount ?? '0'),
      supporting_types: Array.isArray(voucher.supporting_document_types)
        ? voucher.supporting_document_types : [],
      supporting_other_text: voucher.supporting_other_text || '',
      remarks: voucher.remarks || '',
      source_voucher_no: voucher.source_voucher_no || '',
      source_pv_date: voucher.source_pv_date || ''
    })

    setEditingVoucher({
      id: voucher.id,
      pv_number: voucher.pv_number,
      updated_at: voucher.updated_at
    })
    setWorkspaceMode('edit')
    setViewingVoucher(null)
    setViewLines([])
    setError('')
    setSuccess('')
    setImportNote(`Editing ${voucher.pv_number}. Review the fields, then Save Changes.`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function clearForm() {
    setForm(blankForm())
    setEditingVoucher(null)
    setError('')
    setSuccess('')
    setImportNote('')
    setNewPvValidated(false)
    setUploadedTemplateName('')
  }

  // Switching modes discards unsaved form data ONLY after explicit confirmation.
  function changeMode(nextMode) {
    if (loading || importing) return false

    const hasUnsavedInputs =
      JSON.stringify(form) !== JSON.stringify(blankForm())
    if ((workspaceMode === 'new' || workspaceMode === 'edit') &&
        (hasUnsavedInputs || editingVoucher)) {
      const confirmed = window.confirm(
        'You have unsaved Payment Voucher information. Discard it and switch?'
      )
      if (!confirmed) return false
    }

    clearForm()
    setViewingVoucher(null)
    setViewLines([])
    setViewError('')
    setSubmitMessage('')
    setWorkspaceMode(nextMode)
    return true
  }

  useEffect(() => { loadDashboardCounts() }, [])
  useEffect(() => {
    if (workspaceMode === 'existing') loadVouchers()
  }, [workspaceMode, listCategory, listStage, listPage, listSearch,
    listBranch, listTier, listDateFrom, listDateTo, listDraftStatus])

  // Stay reasonably fresh when staff return to the tab; manual Refresh remains available.
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') {
        loadDashboardCounts()
        if (workspaceMode === 'existing') loadVouchers()
      }
    }
    const interval = window.setInterval(refreshVisible, 120000)
    window.addEventListener('focus', refreshVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshVisible)
    }
  }, [workspaceMode, listCategory, listStage, listDraftStatus, listPage,
    listSearch, listBranch, listTier, listDateFrom, listDateTo])

  const update = (event) => {
    const { name, value } = event.target
    setForm(current => ({ ...current, [name]: value }))
  }

  const updateLine = (index, key, value) => {
    setForm(current => ({
      ...current,
      lines: current.lines.map((row, i) => i === index ? { ...row, [key]: value } : row)
    }))
  }

  const addInvoiceLine = () => {
    setForm(current => ({ ...current, lines: [...current.lines, blankInvoiceLine()] }))
  }

  const removeInvoiceLine = (index) => {
    setForm(current => current.lines.length <= DEFAULT_INVOICE_LINES ? current : ({
      ...current,
      lines: current.lines.filter((_, i) => i !== index)
    }))
  }

  const toggleDocument = (type, checked) => {
    setForm(current => ({
      ...current,
      supporting_types: checked
        ? [...current.supporting_types.filter(x => x !== type), type]
        : current.supporting_types.filter(x => x !== type)
    }))
  }

  async function handleExcelImport(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (workspaceMode !== 'new' || editingVoucher) {
      setError('Excel upload is only allowed for a NEW Payment Voucher.')
      return
    }
    setError('')
    setSuccess('')
    if (!/\.xlsx$/i.test(file.name)) {
      setError('Upload the official .xlsx template, not PDF/CSV/other Excel formats.')
      return
    }
    if (file.size === 0 || file.size > 3 * 1024 * 1024) {
      setError('Excel file must be nonempty and under 3 MB.')
      return
    }

    if (newPvValidated && !window.confirm(
      'Replace the previously imported form and all your unsaved edits with this new Excel?'
    )) return

    setImporting(true)
    try {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const sheet = workbook.getWorksheet('Blank Form')
      if (!sheet || !workbook.getWorksheet('Sample PV') ||
          !workbook.getWorksheet('PV Approval Matrix') ||
          !cellText(sheet, 'A5').toUpperCase().includes('PAYMENT VOUCHER') ||
          !cellText(sheet, 'A26').toUpperCase().includes('PV APPROVAL TIER') ||
          !cellText(sheet, 'I12').toUpperCase().includes('PV TIER') ||
          !cellText(sheet, 'A27').toUpperCase().includes('NO.') ||
          !cellText(sheet, 'K27').toUpperCase().includes('AMOUNT')) {
        throw new Error('Wrong Excel layout. Use the current official JAUHAR workbook with Blank Form, Sample PV and PV Approval Matrix.')
      }
      const revision = cellText(sheet, 'I2')
      if (revision !== REQUIRED_TEMPLATE_REVISION) {
        throw new Error(`Outdated or unsupported template revision (${revision || 'blank'}). Download the latest template (rev ${REQUIRED_TEMPLATE_REVISION}).`)
      }
      const parsed = parseWorkbook(sheet)
      // T08/T09 may now import for Draft only; Submit is independently blocked.
      const validationError = validateImportedPV(parsed)
      if (validationError) throw new Error(validationError)
      setForm(parsed)
      setUploadedTemplateName(file.name)
      setNewPvValidated(true)
      setImportNote(
        `Template validated: ${file.name} · revision ${revision} · ${parsed.financial_tier} · ` +
        `${parsed.lines.filter(line => Object.values(line).some(v => String(v).trim())).length} invoice(s). ` +
        'You may now review and edit. The actual Excel file is NOT stored in Supabase.'
      )
    } catch (err) {
      // If an attempted replacement fails, retain the last successful import.
      setError(err.message || 'Unable to read or validate official Excel template.')
    } finally {
      setImporting(false)
    }
  }

  const populatedLines = form.lines.filter(item =>
    Object.values(item).some(value => String(value).trim() !== '')
  )
  const subtotal = populatedLines.reduce((sum, line) => sum +
    (Number(parseAmount(line.amount)) || 0), 0)
  const sst = Number(parseAmount(form.sst_amount)) || 0
  const total = subtotal + sst

  async function handleSave(event) {
    event.preventDefault()
    if (!canCreate || loading || importing) return
    if (workspaceMode !== 'new' && workspaceMode !== 'edit') {
      setError('Choose New Payment Voucher or open an existing Draft before saving.')
      return
    }
    if (workspaceMode === 'edit' && !editingVoucher) {
      setError('No existing Draft selected. Open a Draft again.')
      return
    }
    if (workspaceMode === 'new' && editingVoucher) {
      setError('Cannot create a new PV while an existing voucher is selected.')
      return
    }
    if (workspaceMode === 'new' && !newPvValidated) {
      setError('Upload and validate the official JAUHAR Excel template before creating a PV.')
      return
    }
    if (workspaceMode === 'new' && !TIER_PERSISTENCE_BACKEND_READY) {
      setError('New PV saving is paused until the financial tier database migration is installed. No data has been saved.')
      return
    }
    if (!FINANCIAL_TIERS[form.financial_tier]) {
      setError('Choose a valid Financial Tier (T01–T09) before saving a Draft.')
      return
    }
    if (workspaceMode === 'new' && form.template_version !== REQUIRED_TEMPLATE_REVISION) {
      setError('The official Excel template revision must match the current release.')
      return
    }
    setError('')
    setSuccess('')

    if (!form.payee_name.trim()) {
      setError('Payee name is required.')
      return
    }
    if (populatedLines.length < 1) {
      setError('Enter at least one invoice line.')
      return
    }
    // Prevent old Supabase RPCs from rejecting or silently truncating expanded items.
    // Remove this gate only AFTER create, update and submit RPCs AND the database
    // line_no constraint have all been migrated and tested.
    if (!EXTENDED_INVOICE_BACKEND_READY && populatedLines.length > DEFAULT_INVOICE_LINES) {
      setError('More than 5 invoice lines are entered. Add/remove is ready, but the ' +
        'Supabase migration is required before saving more than 5. Do not delete your ' +
        'extra lines; ask for the Step 38.1 backend upgrade first.')
      return
    }
    if (populatedLines.some(item => !item.invoice_reference.trim() || !item.description.trim() || !strictMoney(item.amount))) {
      setError('Each invoice needs a reference number, description and a positive amount (max 2 decimals).')
      return
    }
    if (!strictMoney(form.sst_amount || '0', true) || total > 999999999999.99) {
      setError('Invalid SST amount or total payment.')
      return
    }

    setLoading(true)
    try {
      // Editing must UPDATE the original voucher, NEVER create a new one.
      if (editingVoucher) {
        const { data: updated, error: updateError } = await supabase.rpc(
          'update_pv_draft_v8', {
            p_voucher_id: editingVoucher.id,
            p_expected_updated_at: editingVoucher.updated_at,
            p_form: {
              payee_name: form.payee_name.trim(),
              supplier_code: form.supplier_code.trim(),
              supplier_tin: form.supplier_tin.trim(),
              bank_name: form.bank_name.trim(),
              bank_account_no: form.bank_account_no.trim(),
              branch_department: form.branch_department,
              payment_method: form.payment_method,
              payment_type: form.payment_type,
              expense_nature: form.expense_nature,
              budget_classification: form.budget_classification,
              financial_tier: form.financial_tier,
              sst_amount: form.sst_amount || '0',
              supporting_types: form.supporting_types,
              supporting_other_text: form.supporting_other_text.trim(),
              remarks: form.remarks.trim(),
              source_voucher_no: form.source_voucher_no.trim(),
              source_pv_date: form.source_pv_date || null
            },
            p_items: populatedLines.map(item => ({
              id: item.id || null,
              invoice_reference: item.invoice_reference.trim(),
              description: item.description.trim(),
              gl_code: item.gl_code.trim(),
              amount: String(item.amount).trim()
            }))
          }
        )

        if (updateError) throw updateError
        if (!updated?.pv_number || updated.financial_tier !== form.financial_tier) {
          throw new Error('PV update and financial tier storage could not be confirmed. Reopen and check the Draft.')
        }

        setSuccess(`${updated.pv_number} updated successfully (${money(updated.amount)}).`)
        setEditingVoucher(null)
        setForm(blankForm())
        setImportNote('')
        setListCategory('draft')
        setListStage('all')
        setListPage(0)
        setWorkspaceMode('existing')
        await refreshPVData()
        return // Prevent the create_v2 call below from generating a duplicate.
      }

      const { data, error: saveError } = await supabase.rpc('create_pv_draft_v4', {
        p_financial_tier: form.financial_tier,
        p_template_version: form.template_version,
        p_payee_name: form.payee_name.trim(),
        p_items: populatedLines.map(item => ({
          invoice_reference: item.invoice_reference.trim(),
          description: item.description.trim(),
          gl_code: item.gl_code.trim(),
          amount: String(item.amount).trim()
        })),
        p_supplier_tin: form.supplier_tin.trim() || null,
        p_supplier_code: form.supplier_code.trim() || null,
        p_bank_name: form.bank_name.trim() || null,
        p_bank_account_no: form.bank_account_no.trim() || null,
        p_branch_department: form.branch_department || null,
        p_payment_method: form.payment_method || null,
        p_payment_type: form.payment_type || null,
        p_expense_nature: form.expense_nature || null,
        p_budget_classification: form.budget_classification || null,
        p_sst_amount: Number(form.sst_amount || 0),
        p_remarks: form.remarks.trim() || null,
        p_supporting_types: form.supporting_types,
        p_supporting_other_text: form.supporting_other_text.trim() || null,
        p_source_voucher_no: form.source_voucher_no.trim() || null,
        p_source_pv_date: form.source_pv_date || null
      })
      if (saveError) throw saveError
      if (!data?.pv_number || data.financial_tier !== form.financial_tier ||
          data.source_template_version !== REQUIRED_TEMPLATE_REVISION) {
        throw new Error('PV save and financial tier/template metadata could not be confirmed. Check Existing Drafts before retrying to avoid duplicates.')
      }
      setSuccess(`${data.pv_number} saved successfully as Draft (${money(data.amount)}).`)
      setForm(blankForm())
      setImportNote('')
      setListCategory('draft')
      setListStage('all')
      setListPage(0)
      setWorkspaceMode('existing')
      await refreshPVData()
    } catch (err) {
      setError(err.message || 'Unable to save Payment Voucher.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <style>{pvCss}</style>
      <section className="panel">
        <h2>JAUHAR — Payment Voucher</h2>
        <p className="muted">
          Finance Department | Document No. FM-FIN-PV_AP-0000 | Revision 0000
        </p>
        <p className="muted">Effective Date (template): 01-Nov-2026 · PV numbers are assigned by JAUHAR upon saving.</p>
      </section>

      {error && <p className="error" role="alert">{error}</p>}
      {success && <p className="pv-success" role="status">{success}</p>}

      {workspaceMode === 'home' && (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Payment Voucher Dashboard</h2>
                <p className="muted">Counters reflect vouchers visible to your login. Select a card to open its filtered list.</p>
              </div>
              <button type="button" className="btn" disabled={dashboardLoading}
                onClick={loadDashboardCounts}>
                {dashboardLoading ? 'Refreshing...' : 'Refresh Counters'}
              </button>
            </div>
            {dashboardError && <p role="alert" className="error">{dashboardError}</p>}
            <div className="pv-action-panel">
              <div className="pv-action-title">
                <span>⚠ Action Required</span>
                <strong>{dashboardCounts ? (
                  canCreate ? dashboardCounts.returned + dashboardCounts.pending_payment
                  : canManage ? dashboardCounts.pending_manager +
                    (profile?.department === 'Finance' ? dashboardCounts.pending_finance_manager : 0)
                  : canApproveCEO ? dashboardCounts.pending_ceo
                  : canApproveBOD ? dashboardCounts.pending_bod
                  : 0
                ) : '—'}</strong>
              </div>
              {canCreate ? (
                <>
                  <button className="pv-action-link" type="button"
                    onClick={() => openCategory('draft','returned')}>
                    <span>Returned for Amendment <small>(resubmission workflow coming next)</small></span>
                    <strong>{dashboardCounts?.returned ?? '—'} →</strong>
                  </button>
                  <button className="pv-action-link" type="button"
                    onClick={() => openCategory('pending_payment')}>
                    <span>Pending Payment — Record Payment</span>
                    <strong>{dashboardCounts?.pending_payment ?? '—'} →</strong>
                  </button>
                </>
              ) : canManage || canApproveCEO || canApproveBOD ? (
                <button className="pv-action-link" type="button"
                  onClick={() => openCategory('submitted',
                    canManage ? 'all' : canApproveCEO ? 'pending_ceo' : 'pending_bod')}>
                  <span>{canManage ? 'Pending Manager / Finance Manager Approval'
                    : canApproveCEO ? 'Pending CEO Approval' : 'Pending BOD Final Approval'}</span>
                  <strong>{canManage
                    ? (dashboardCounts?.pending_manager ?? 0) +
                      (profile?.department === 'Finance' ? (dashboardCounts?.pending_finance_manager ?? 0) : 0)
                    : (dashboardCounts?.[canApproveCEO ? 'pending_ceo' : 'pending_bod'] ?? '—')} →</strong>
                </button>
              ) : (
                <p className="muted">View-only access. No approval or payment action is assigned.</p>
              )}
            </div>

            <div className="pv-workflow-title">Approval Process</div>
            <div className="pv-home-grid">
              {[
                { id:'draft', label:'Draft', hint:'Draft + Returned' },
                { id:'submitted', label:'Submitted', hint:'Pending Manager / Finance Manager / CEO / BOD' },
                { id:'approved', label:'Approved', hint:'Final approval by designated authority' }
              ].map(card => (
                <button type="button" key={card.id} className="pv-home-card"
                  onClick={() => openCategory(card.id)}>
                  <strong>{dashboardCounts?.[card.id] ?? '—'}</strong>
                  <span>{card.label} ↗</span>
                  <small>{card.hint}</small>
                </button>
              ))}
            </div>
            <div className="pv-workflow-title">Payment Process</div>
            <div className="pv-home-grid payment">
              {[
                { id:'pending_payment', label:'Pending Payment', hint:'Approved, waiting for payment' },
                { id:'paid', label:'Paid', hint:'Payment date and receipt history' }
              ].map(card => (
                <button type="button" key={card.id} className="pv-home-card"
                  onClick={() => openCategory(card.id)}>
                  <strong>{dashboardCounts?.[card.id] ?? '—'}</strong>
                  <span>{card.label} ↗</span>
                  <small>{card.hint}</small>
                </button>
              ))}
            </div>
            <p className="muted">Approved includes both Pending Payment and Paid. Counts are not additive across processes.</p>
            <div className="pv-actions">
              {canCreate && (
                <button type="button" className="btn" onClick={() => changeMode('new')}>
                  + New Payment Voucher
                </button>
              )}
              <button type="button" className="btn" style={{background:'#68788d'}}
                onClick={() => openCategory('rejected')}>
                Rejected Archive
              </button>
            </div>
          </section>
        </>
      )}

      {canCreate && (workspaceMode === 'new' || workspaceMode === 'edit') && (
        <section className="panel">
          <div className="pv-actions" style={{ marginTop: 0, marginBottom: 16 }}>
            <span className="pv-mode-label">
              {workspaceMode === 'edit' ? 'EDIT EXISTING DRAFT' : 'NEW PAYMENT VOUCHER'}
            </span>
            <button type="button" className="btn" style={{ background: '#68788d' }}
              disabled={loading || importing} onClick={() => changeMode('home')}>
              Back to Payment Voucher Dashboard
            </button>
          </div>
          <h2>{editingVoucher
            ? `Edit Payment Voucher — ${editingVoucher.pv_number}`
            : 'New Payment Voucher'}</h2>
          <p className="muted">New PV requires a valid official Excel upload. Existing Draft edits do not require another upload.</p>
          {workspaceMode === 'new' ? (
            <>
              <div className="pv-section">OFFICIAL JAUHAR EXCEL TEMPLATE</div>
              <div className="pv-notice">
                <strong>Download is optional. Upload is compulsory.</strong>
                {' '}If you already have the current Excel template, use it directly.
                <div className="pv-actions" style={{marginTop:10}}>
                  <a className="btn" href={OFFICIAL_TEMPLATE_URL} download="JAUHAR_PV_Official_Template.xlsx">
                    Download Official Template (Optional)
                  </a>
                </div>
              </div>
              <div className="pv-field">
                <label htmlFor="pv-import">Upload Completed Official PV Excel (.xlsx) *</label>
                <input id="pv-import" type="file" accept=".xlsx"
                  disabled={importing || loading} onChange={handleExcelImport} />
              </div>
              <p className="muted">
                Complete the <strong>Blank Form</strong> tab and choose PV Tier in cell K12.
                {' '}Sample PV and PV Approval Matrix are reference tabs, not data to import.
              </p>
              {newPvValidated && (
                <p className="pv-success" role="status">
                  Excel validated: {uploadedTemplateName}. Form unlocked.
                </p>
              )}
              {!TIER_PERSISTENCE_BACKEND_READY && newPvValidated && (
                <div className="pv-notice" role="status">
                  <strong>Import preview only:</strong> Saving a new PV is temporarily disabled
                  until Tier Level can be stored safely in Supabase. Existing Draft editing is unchanged.
                </div>
              )}
            </>
          ) : (
            <div className="pv-notice">
              Editing <strong>{editingVoucher?.pv_number}</strong>.
              Excel upload is disabled in Edit mode to prevent accidental replacement.
              You can update the fields below and press <strong>Save Changes</strong>.
              For a separate new Excel upload, click Back to Payment Voucher Dashboard and select New Payment Voucher.
            </div>
          )}
          {importing && <p className="muted">Reading Excel and filling the form...</p>}
          {importNote && <div className="pv-notice" role="status">{importNote}</div>}

          {(workspaceMode === 'edit' || newPvValidated) ? (
          <form onSubmit={handleSave}>
            <div className="pv-section">PAYMENT VOUCHER</div>
            <div className="pv-grid">
              <InputField label="Official Voucher No." name="generatedNo" value={editingVoucher?.pv_number || 'Auto-generated on Save Draft'} disabled />
              <InputField label="Official PV Date" name="generatedDate" value="Set by system on Save Draft" disabled />
              <InputField label="Original Excel Voucher No. (Reference)" name="source_voucher_no"
                value={form.source_voucher_no} onChange={update} placeholder="Optional reference from Excel" />
              <InputField label="Original Excel PV Date (Reference)" name="source_pv_date"
                value={form.source_pv_date} onChange={update} type="date" />
            </div>

            <div className="pv-section">PAYEE DETAILS</div>
            <div className="pv-grid">
              <InputField label="Payee Name" name="payee_name" required value={form.payee_name}
                onChange={update} />
              <InputField label="Supplier Code / Staff ID (if applicable)" name="supplier_code"
                value={form.supplier_code} onChange={update} />
              <InputField label="Supplier TIN (Optional)" name="supplier_tin"
                value={form.supplier_tin} onChange={update} placeholder="Tax Identification Number" />
              <InputField label="Bank Name" name="bank_name" value={form.bank_name} onChange={update} />
              <InputField label="Bank Account No." name="bank_account_no"
                value={form.bank_account_no} onChange={update} />
              <ChoiceField label="JMC Branch / Cost Centre" name="branch_department"
                value={form.branch_department} onChange={update} options={choices.branch} />
            </div>

            <div className="pv-section">FINANCIAL APPROVAL TIER</div>
            <div className="pv-field">
              <label htmlFor="pv-financial-tier">Financial Tier (required) *</label>
              <select id="pv-financial-tier" value={form.financial_tier}
                onChange={e => setForm(current => ({ ...current, financial_tier: e.target.value }))}>
                <option value="">Select tier...</option>
                {Object.entries(FINANCIAL_TIERS).map(([code, tier]) => (
                  <option key={code} value={code}>{code} — {tier.label}</option>
                ))}
              </select>
            </div>
            {FINANCIAL_TIERS[form.financial_tier] && (
              <div className="pv-notice">
                <strong>{form.financial_tier}</strong> · Final Approver: {' '}
                {FINANCIAL_TIERS[form.financial_tier].approver} ·
                JR Required: {FINANCIAL_TIERS[form.financial_tier].jr ? 'Yes' : 'No'}
                <p className="muted">Finance T01/T02/T04/T08 submission is enabled for testing. T03/T05/T06/T07/T09 remain Draft-only.</p>
              </div>
            )}
            <div className="pv-section">PAYMENT DETAILS</div>
            <div className="pv-grid">
              <ChoiceField label="Payment Method" name="payment_method"
                value={form.payment_method} onChange={update} options={choices.method} />
              <ChoiceField label="Payment Type" name="payment_type"
                value={form.payment_type} onChange={update} options={choices.type} />
              <ChoiceField label="Expense Nature" name="expense_nature"
                value={form.expense_nature} onChange={update} options={choices.nature} />
              <ChoiceField label="Budget Classification" name="budget_classification"
                value={form.budget_classification} onChange={update} options={choices.budget} />
            </div>
            {(form.imported_transaction_no || form.imported_payment_date) && (
              <div className="pv-notice">
                <strong>Post-payment fields found in Excel (reference only):</strong>
                <div className="pv-grid" style={{ marginTop: 10 }}>
                  <InputField label="Transaction / Cheque No. (After Payment)" name="imported_transaction_no"
                    value={form.imported_transaction_no} disabled />
                  <InputField label="Payment Date (After Payment)" name="imported_payment_date"
                    value={form.imported_payment_date} disabled />
                </div>
                These details are <strong>not saved as a payment record</strong> when creating a Draft.
                Payment must be verified in JAUHAR later.
              </div>
            )}

            <div className="pv-section">INVOICE / PAYMENT LINES ({form.lines.length} ROWS)</div>
            <div className="pv-lines">
              <table>
                <thead><tr>
                  <th style={{ width: 42 }}>No.</th>
                  <th>Invoice / Reference No.</th>
                  <th>Description *</th>
                  <th>GL Code</th>
                  <th style={{ width: 145 }}>Amount (RM) *</th>
                  <th style={{ width: 90 }}>Action</th>
                </tr></thead>
                <tbody>
                  {form.lines.map((line, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td><input aria-label={`Line ${i + 1} invoice reference`}
                        value={line.invoice_reference}
                        onChange={e => updateLine(i, 'invoice_reference', e.target.value)} /></td>
                      <td><input aria-label={`Line ${i + 1} description`}
                        value={line.description}
                        onChange={e => updateLine(i, 'description', e.target.value)} /></td>
                      <td><input aria-label={`Line ${i + 1} GL code`}
                        value={line.gl_code}
                        onChange={e => updateLine(i, 'gl_code', e.target.value)} /></td>
                      <td><input type="number" step="0.01" min="0.01"
                        aria-label={`Line ${i + 1} amount`}
                        value={line.amount}
                        onChange={e => updateLine(i, 'amount', e.target.value)} /></td>
                      <td>
                        <button type="button" aria-label={`Remove invoice line ${i + 1}`}
                          disabled={form.lines.length <= DEFAULT_INVOICE_LINES || loading || importing ||
                             (workspaceMode === 'edit' && Boolean(line.id) &&
                               invoiceDocuments.some(doc => doc.line_item_id === line.id))}
                          onClick={() => removeInvoiceLine(i)}
                          style={{ border:'1px solid #d4dce8', borderRadius:6,
                            padding:'8px 10px', background:'white', cursor:'pointer' }}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pv-actions" style={{ marginTop: 12, marginBottom: 4 }}>
              <button type="button" className="btn" disabled={loading || importing}
                onClick={addInvoiceLine}>+ Add Invoice Line</button>
              <span className="muted">Ten rows come from the official Excel; extra rows are allowed.</span>
            </div>
            <p className="muted">
              Each completed invoice will require its reference number and supporting PDF/image
              before submission in the upcoming document-upload step.
              {!EXTENDED_INVOICE_BACKEND_READY &&
                ' Saving more than five populated lines is temporarily blocked until the Supabase upgrade.'}
            </p>
            <div className="pv-totals">
              <div className="pv-total-row"><span>Subtotal (RM)</span><strong>{money(subtotal)}</strong></div>
              <div className="pv-total-row">
                <label htmlFor="pv-sst_amount">SST Amount (RM)</label>
                <input id="pv-sst_amount" name="sst_amount" type="number" min="0" step="0.01"
                  style={{ width: 140, padding: 8, border: '1px solid #cdd8e6', borderRadius: 6 }}
                  value={form.sst_amount} onChange={update} />
              </div>
              <div className="pv-total-row pv-total-final"><span>Total Payment</span><strong>{money(total)}</strong></div>
            </div>

            <div className="pv-section">SUPPORTING DOCUMENTS (CHECKLIST)</div>
            <div className="pv-docs">
              {documentTypes.map(doc => (
                <label key={doc.value}>
                  <input type="checkbox" checked={form.supporting_types.includes(doc.value)}
                    onChange={e => toggleDocument(doc.value, e.target.checked)} />
                  {doc.label}
                </label>
              ))}
            </div>
            {form.supporting_types.includes('Other') && (
              <div className="pv-field">
                <label htmlFor="pv-supporting_other_text">Other Supporting Document</label>
                <input id="pv-supporting_other_text" name="supporting_other_text"
                  value={form.supporting_other_text} onChange={update}
                  placeholder="Specify supporting document" />
              </div>
            )}
            <p className="muted">Checklist only. Actual PDF/image supporting-document upload to private storage will follow in a separate step.</p>

            <div className="pv-section">REMARKS</div>
            <div className="pv-field">
              <label htmlFor="pv-remarks">Remarks</label>
              <textarea id="pv-remarks" name="remarks" rows={3}
                value={form.remarks} onChange={update} />
            </div>

            <div className="pv-section">APPROVAL SIGN-OFF</div>
            <div className="pv-grid">
              <InputField label="Prepared By — Executive" name="prepared_by"
                value={profile?.username || ''} disabled />
              <InputField label="Verified By — Manager" name="verified_by"
                value="Pending approval workflow" disabled />
              <InputField label="Approved By — CEO / Director" name="approved_by"
                value="Pending approval workflow" disabled />
              <InputField label="Final Approval — BOD" name="bod_approval"
                value="Pending approval workflow" disabled />
            </div>
            <p className="muted">Excel signatures/names do not confer approval. Approval must occur in JAUHAR, in sequence.</p>

            <div className="pv-actions">
              <button type="submit" className="btn"
                disabled={loading || importing || (workspaceMode === 'new' && !TIER_PERSISTENCE_BACKEND_READY)}>
                {loading ? 'Saving...' : editingVoucher ? 'Save Changes' : 'Save Draft'}
              </button>
              <button type="button" className="btn" style={{ background: '#68788d' }}
                disabled={loading || importing}
                onClick={() => {
                  if (workspaceMode === 'edit') changeMode('existing')
                  else clearForm()
                }}>
                {editingVoucher ? 'Cancel Edit' : 'Clear Form'}
              </button>
            </div>
          </form>
          ) : (
            <div className="pv-notice" role="status">
              <strong><span aria-hidden="true">🔒</span> New PV form locked.</strong>
              {' '}Upload a valid, completed Blank Form Excel template above to unlock editing.
            </div>
          )}
        </section>
      )}

      {workspaceMode === 'existing' && (
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{({
              draft:'Draft & Returned',
              submitted:'Submitted — Pending Approval',
              approved:'Approved — Final Approval',
              pending_payment:'Pending Payment',
              paid:'Paid Payment Vouchers',
              rejected:'Rejected Archive'
            })[listCategory]}</h2>
            <p className="muted">{listTotal} matching voucher(s) · Page {listPage + 1}.
              Click a PV Number to open details and permitted actions.</p>
          </div>
          <button type="button" className="btn" disabled={listLoading || dashboardLoading}
            onClick={refreshPVData}>{listLoading ? 'Loading...' : 'Refresh'}</button>
        </div>
        <div className="pv-actions" style={{marginTop:0}}>
          <button type="button" className="btn" style={{background:'#68788d'}}
            onClick={() => changeMode('home')}>← Payment Voucher Dashboard</button>
          {canCreate && <button type="button" className="btn"
            onClick={() => changeMode('new')}>+ New Payment Voucher</button>}
        </div>
        {listCategory === 'draft' && (
          <p className="pv-notice">Returned vouchers appear here for visibility.
            Finance T01/T02/T04/T08 Returned PVs can be edited and resubmitted by the original requester. Other tiers remain disabled.</p>
        )}
        <div className="pv-list-filters">
          <div>
            <label htmlFor="pv-list-search">Search PV Number / Payee</label>
            <input id="pv-list-search" value={listSearch}
              onChange={e => {setListSearch(e.target.value);setListPage(0)}}
              placeholder="Enter PV Number or payee" />
          </div>
          <div>
            <label htmlFor="pv-list-branch">Branch</label>
            <select id="pv-list-branch" value={listBranch}
              onChange={e=>{setListBranch(e.target.value);setListPage(0)}}>
              <option value="">All branches</option>
              {choices.branch.filter(Boolean).map(branch =>
                <option key={branch} value={branch}>{branch}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pv-list-tier">Financial Tier</label>
            <select id="pv-list-tier" value={listTier}
              onChange={e => {setListTier(e.target.value);setListPage(0)}}>
              <option value="">All Tiers</option>
              {Object.keys(FINANCIAL_TIERS).map(tier =>
                <option key={tier} value={tier}>{tier}</option>)}
              <option value="legacy">Legacy (No Tier)</option>
            </select>
          </div>
          <div>
            <label htmlFor="pv-date-from">Created From</label>
            <input id="pv-date-from" type="date" value={listDateFrom}
              onChange={e=>{setListDateFrom(e.target.value);setListPage(0)}} />
          </div>
          <div>
            <label htmlFor="pv-date-to">Created To</label>
            <input id="pv-date-to" type="date" value={listDateTo}
              onChange={e=>{setListDateTo(e.target.value);setListPage(0)}} />
          </div>
        </div>
        {listCategory === 'draft' && (
          <div className="pv-actions" style={{marginTop:0,marginBottom:15}}>
            <label htmlFor="pv-draft-filter">Draft Status</label>
            <select id="pv-draft-filter" value={listDraftStatus}
              style={{padding:9,borderRadius:8}}
              onChange={e=>{setListDraftStatus(e.target.value);setListPage(0)}}>
              <option value="all">Draft + Returned</option>
              <option value="draft">Draft only</option>
              <option value="returned">Returned for Amendment</option>
            </select>
          </div>
        )}
        {listCategory === 'submitted' && (
          <div className="pv-actions" style={{marginTop:0,marginBottom:15}}>
            <label htmlFor="pv-list-stage">Approval Stage</label>
            <select id="pv-list-stage" value={listStage} style={{padding:9,borderRadius:8}}
              onChange={e=>{setListStage(e.target.value);setListPage(0)}}>
              <option value="all">All Pending Approvals</option>
              <option value="pending_manager">Pending Manager (Legacy)</option>
              <option value="pending_finance_manager">Pending Finance Manager</option>
              <option value="pending_ceo">Pending CEO</option>
              <option value="pending_bod">Pending BOD</option>
            </select>
          </div>
        )}
        <div className="table-wrap" aria-label="Payment Voucher tracking table">
          <table className="pv-tracking-table">
            <thead><tr>
              <th>PV Number</th>
              <th>Financial Tier</th>
              <th>Action</th>
              <th>Payee</th>
              <th>Total (RM)</th>
              <th>Approval Status</th>
              <th>Executive Remarks</th>
              <th>Payment Status</th>
              <th>Created Date</th>
              <th>Final Approval Date</th>
              <th>Payment Date</th>
              <th>Receipt Attachment</th>
            </tr></thead>
            <tbody>
              {vouchers.map(v => (
                <tr key={v.id}>
                  <td>
                    <button type="button" disabled={viewLoading}
                      onClick={() => openVoucher(v.id)}
                      style={{ border:'none', background:'transparent', padding:0,
                        color:'#173d70', textDecoration:'underline', fontWeight:700,
                        cursor:'pointer', whiteSpace:'nowrap' }}>
                      {v.pv_number}
                    </button>
                  </td>
                  <td><strong>{v.financial_tier || 'Legacy'}</strong></td>
                  <td>
                    {ownsVoucher(v) && v.status === 'draft' && !v.archived_at ? (
                      <button type="button" className="btn"
                        style={{background:'#b42318',fontSize:12,padding:'6px 10px'}}
                        disabled={archivingVoucherId !== null}
                        title="Remove Draft from active list (retain audit record)"
                        onClick={() => archiveDraft(v)}>
                        {archivingVoucherId === v.id ? 'Deleting...' : 'Delete Draft'}
                      </button>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>{v.payee_name}</td>
                  <td style={{ whiteSpace:'nowrap' }}>{money(v.amount)}</td>
                  <td>{(v.status || '').replaceAll('_', ' ')}</td>
                  <td>
                    {ownsVoucher(v) ? (
                      <div className="pv-inline-remark">
                        <textarea aria-label={`Executive Remarks for ${v.pv_number}`}
                          maxLength={2000} disabled={remarksSavingId === v.id}
                          value={remarkDrafts[v.id] ?? v.executive_payment_remarks ?? ''}
                          onChange={e => setRemarkDrafts(prev => ({
                            ...prev, [v.id]: e.target.value
                          }))}
                          placeholder="Executive payment remark" />
                        <button type="button" className="btn"
                          style={{ padding:'6px 10px', fontSize:12, alignSelf:'flex-start' }}
                          disabled={remarksSavingId !== null ||
                            (remarkDrafts[v.id] ?? v.executive_payment_remarks ?? '').trim() ===
                            (v.executive_payment_remarks || '')}
                          onClick={() => saveExecutivePaymentRemarks(v)}>
                          {remarksSavingId === v.id ? 'Saving...' : 'Save Remark'}
                        </button>
                      </div>
                    ) : (v.executive_payment_remarks || '—')}
                  </td>
                  <td>
                    {v.status !== 'fully_approved'
                      ? <span className="pv-payment-label">Not eligible</span>
                      : v.payment_status === 'paid'
                        ? <span className="pv-payment-label paid">Paid</span>
                        : <span className="pv-payment-label unpaid">Pending Payment</span>}
                  </td>
                  <td style={{whiteSpace:'nowrap'}}>{myDate(v.created_at)}</td>
                  <td style={{whiteSpace:'nowrap'}}>{myDate(v.final_approval_date)}</td>
                  <td style={{whiteSpace:'nowrap'}}>{myDate(v.payment_date)}</td>
                  <td>
                    {v.receipt_path ? (
                      <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-start'}}>
                        <button type="button" className="btn"
                          style={{fontSize:12,padding:'6px 10px'}}
                          disabled={receiptLoadingId !== null}
                          onClick={() => getReceiptLink(v)}>
                          {receiptLoadingId === v.id ? 'Generating...' : 'View Receipt'}
                        </button>
                        {receiptLinks[v.id] && (
                          <a href={receiptLinks[v.id]} target="_blank" rel="noopener noreferrer">
                            Open receipt (90s)
                          </a>
                        )}
                      </div>
                    ) : v.status === 'fully_approved' && v.payment_status !== 'paid'
                      ? <span className="muted">Required for Paid</span>
                      : '—'}
                  </td>
                </tr>
              ))}
              {!listLoading && vouchers.length === 0 && (
                <tr><td colSpan="11">No Payment Vouchers found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pv-list-pagination">
          <span className="muted">
            {listTotal === 0 ? 'No vouchers match this category/filter.'
              : `Showing ${listPage * PV_LIST_PAGE_SIZE + 1}–${Math.min((listPage + 1) * PV_LIST_PAGE_SIZE, listTotal)} of ${listTotal}`}
          </span>
          <div className="pv-actions" style={{marginTop:0}}>
            <button type="button" className="btn" style={{background:'#68788d'}}
              disabled={listLoading || listPage === 0}
              onClick={() => setListPage(p => Math.max(0,p - 1))}>Previous</button>
            <span>Page {listPage + 1} of {Math.max(1, Math.ceil(listTotal / PV_LIST_PAGE_SIZE))}</span>
            <button type="button" className="btn"
              disabled={listLoading || (listPage + 1) * PV_LIST_PAGE_SIZE >= listTotal}
              onClick={() => setListPage(p => p + 1)}>Next</button>
          </div>
        </div>
      </section>
      )}

      {/* Saved voucher detail modal; reading does not modify the database. */}
      {viewLoading && <p className="muted">Opening Payment Voucher...</p>}
      {viewError && <p className="error" role="alert">{viewError}</p>}
      {viewingVoucher && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pv-view-title"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeVoucherOverview()
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.55)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 20
          }}
        >
          <div style={{
            background: 'white', width: '100%', maxWidth: 950,
            maxHeight: '90vh', overflowY: 'auto', padding: 25, borderRadius: 12
          }}>
            <div className="panel-head">
              <div>
                <h2 id="pv-view-title">{viewingVoucher.pv_number}</h2>
                <p className="muted">Existing Payment Voucher — Read Only</p>
              </div>
              <button type="button" className="btn"
                aria-label="Close voucher overview" title="Close (Esc)"
                disabled={overviewBusy} onClick={closeVoucherOverview}>✕</button>
            </div>

            <div className="pv-section">PAYMENT VOUCHER DETAILS</div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {[
                    ['Status', viewingVoucher.status?.replaceAll('_', ' ')],
                    ['Created At', new Date(viewingVoucher.created_at).toLocaleString('en-MY', {
                      timeZone: 'Asia/Kuala_Lumpur'
                    })],
                    ['Payee Name', viewingVoucher.payee_name],
                    ['Supplier Code', viewingVoucher.supplier_code],
                    ['Supplier TIN', viewingVoucher.supplier_tin],
                    ['Bank Name', viewingVoucher.bank_name],
                    ['Bank Account No.', viewingVoucher.bank_account_no],
                    ['Branch', viewingVoucher.branch_department],
                    ['Payment Method', viewingVoucher.payment_method],
                    ['Payment Type', viewingVoucher.payment_type],
                    ['Expense Nature', viewingVoucher.expense_nature],
                    ['Budget Classification', viewingVoucher.budget_classification],
                    ['Original Voucher No.', viewingVoucher.source_voucher_no],
                    ['Original PV Date', viewingVoucher.source_pv_date],
                    ['SST', money(viewingVoucher.sst_amount)],
                    ['Total Payment', money(viewingVoucher.amount)],
                    ['Payment Status', viewingVoucher.status !== 'fully_approved'
                      ? 'Not eligible' : viewingVoucher.payment_status === 'paid'
                        ? 'Paid' : 'Pending Payment'],
                    ['Executive Payment Remarks', viewingVoucher.executive_payment_remarks],
                    ['Final Approval Date', myDate(viewingVoucher.final_approval_date)],
                    ['Payment Date', myDate(viewingVoucher.payment_date)],
                    ['Receipt', viewingVoucher.receipt_path ? 'Uploaded (private)' : '—'],
                    ['Supporting Documents', Array.isArray(viewingVoucher.supporting_document_types)
                      ? viewingVoucher.supporting_document_types.join(', ') : '—'],
                    ['Other Supporting Document', viewingVoucher.supporting_other_text],
                    ['Remarks', viewingVoucher.remarks]
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <th style={{ width: '38%' }}>{label}</th>
                      <td>{value == null || value === '' ? '—' : value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pv-section">INVOICE / PAYMENT LINES</div>
            <div className="pv-lines">
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Invoice No.</th>
                    <th>Description</th>
                    <th>GL Code</th>
                    <th>Amount (RM)</th>   
                    <th>Invoice Attachment</th>
                  </tr>
                </thead>
                <tbody>
                  {viewLines.map(line => (
                    <tr key={line.line_no}>
                      <td>{line.line_no}</td>
                      <td>{line.invoice_reference || '—'}</td>
                      <td>{line.description}</td>
                      <td>{line.gl_code || '—'}</td>
                      <td>{money(line.amount)}</td>
                      
                    <td>
                      {invoiceDocuments.some(
                        doc => doc.line_item_id === line.id
                      ) ? (
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6
                        }}>
                          <strong style={{ color: '#167347' }}>Uploaded</strong>

                          <button
                            type="button"
                            className="btn"
                            disabled={invoiceOpeningId !== null}
                            onClick={() => viewInvoice(
                              invoiceDocuments.find(
                                doc => doc.line_item_id === line.id
                              )
                            )}
                          >
                            View Invoice
                          </button>

                          {invoiceLinks[line.id] && (
                            <a
                              href={invoiceLinks[line.id]}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open Invoice (60s)
                            </a>
                          )}
                        </div>
                      ) : ownsVoucher(viewingVoucher) &&
                          (viewingVoucher.status === 'draft' || (viewingVoucher.status === 'returned' &&
        profile?.department === 'Finance' && ['T01','T02','T04','T08'].includes(viewingVoucher.financial_tier))) ? (
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp"
                          aria-label={`Upload invoice ${line.invoice_reference}`}
                          disabled={invoiceUploadingId !== null}
                          onChange={event => {
                            const file = event.target.files?.[0]
                            event.target.value = ''
                            if (file) uploadInvoice(line, file)
                          }}
                        />
                      ) : (
                        <span className="muted">Missing</span>
                      )}
                    </td>
                    </tr>
                  ))}
                  {viewLines.length === 0 && (
                    <tr><td colSpan="5">No invoice lines found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* INVOICE UPLOAD MESSAGE */}
            {invoiceMessage && (
              <p className="pv-notice" role="status">
                {invoiceMessage}
              </p>
            )}

              <div className="pv-section">APPROVAL HISTORY</div>
              {historyError && <p className="error">Unable to load history: {historyError}</p>}
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>Round</th><th>Tier</th><th>Action</th><th>Remarks</th><th>Date / Time (MY)</th>
                  </tr></thead>
                  <tbody>
                    {approvalHistory.map(row => (
                      <tr key={row.id}>
                        <td>{row.approval_round}</td>
                        <td>{row.tier}</td>
                        <td>{row.action}</td>
                        <td>{row.remarks || '—'}</td>
                        <td>{new Date(row.created_at).toLocaleString('en-MY', {
                          timeZone: 'Asia/Kuala_Lumpur'
                        })}</td>
                      </tr>
                    ))}
                    {approvalHistory.length === 0 && !historyError && (
                      <tr><td colSpan="5">No approval actions recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {canManage && profile?.department === 'Finance' &&
                viewingVoucher.status === 'pending_finance_manager' &&
                ['T01', 'T02', 'T04', 'T08'].includes(viewingVoucher.financial_tier) && (
                <div>
                  <div className="pv-section">FINANCE MANAGER — {viewingVoucher.financial_tier} DECISION</div>
                  <p className="muted">
                    Finance pilot only. Verify invoice attachments and account details.
                    {viewingVoucher.financial_tier === 'T08'
                      ? 'For T08, Finance Manager approval sends the PV to CEO, then BOD final.'
                      : viewingVoucher.financial_tier === 'T04'
                      ? 'For T04, Finance Manager approval sends the PV to CEO for final decision.'
                      : 'For T01/T02, Finance Manager approval completes the PV; no CEO/BOD sign-off.'}
                  </p>
                  <div className="pv-field">
                    <label htmlFor="pv-finance-manager-remarks">Finance Manager Remarks</label>
                    <textarea id="pv-finance-manager-remarks" rows={3} maxLength={2000}
                      value={managerRemarks} disabled={managerSaving}
                      onChange={e => setManagerRemarks(e.target.value)}
                      placeholder="Optional for Approve; mandatory for Return or Reject" />
                  </div>
                  <div className="pv-actions">
                    <button type="button" className="btn" style={{background:'#167347'}}
                      disabled={managerSaving}
                      onClick={() => financeManagerDecide('approve')}>
                      {managerSaving ? 'Processing...' : ['T04','T08'].includes(viewingVoucher.financial_tier)
                        ? `Approve → CEO (${viewingVoucher.financial_tier})` : 'Final Approve — T01/T02'}
                    </button>
                    <button type="button" className="btn" style={{background:'#9a6700'}}
                      disabled={managerSaving}
                      onClick={() => financeManagerDecide('return')}>
                      Return for Amendment
                    </button>
                    <button type="button" className="btn" style={{background:'#b42318'}}
                      disabled={managerSaving}
                      onClick={() => financeManagerDecide('reject')}>
                      Reject Permanently
                    </button>
                  </div>
                  <p className="muted">
                    Return requires remarks. Requester can amend the Returned PV and resubmit;
                    earlier approval rounds remain visible in the audit history.
                  </p>
                </div>
              )}

              {canManage && viewingVoucher.status === 'pending_manager' && (
                <div>
                  <div className="pv-section">MANAGER DECISION — TIER 2</div>
                  <p className="muted">
                    Review the PV before deciding. Remarks are compulsory for Return or Reject.
                    This PV has not yet been paid; approval is not payment confirmation.
                  </p>
                  <div className="pv-field">
                    <label htmlFor="pv-manager-remarks">Manager Remarks</label>
                    <textarea
                      id="pv-manager-remarks"
                      rows={3}
                      maxLength={2000}
                      value={managerRemarks}
                      disabled={managerSaving}
                      onChange={e => setManagerRemarks(e.target.value)}
                      placeholder="Optional for Approve; required for Return or Reject"
                    />
                  </div>
                  <div className="pv-actions">
                    <button type="button" className="btn"
                      style={{ background: '#167347' }}
                      disabled={managerSaving}
                      onClick={() => managerDecide('approve')}>
                      {managerSaving ? 'Processing...' : 'Approve → CEO'}
                    </button>
                    <button type="button" className="btn"
                      style={{ background: '#9a6700' }}
                      disabled={managerSaving}
                      onClick={() => managerDecide('return')}>
                      Return for Amendment
                    </button>
                    <button type="button" className="btn"
                      style={{ background: '#b42318' }}
                      disabled={managerSaving}
                      onClick={() => managerDecide('reject')}>
                      Reject Permanently
                    </button>
                  </div>
                </div>
              )}


              {/* Step 39B: T04 CEO final decision, NEVER the Legacy CEO -> BOD panel. */}
              {canApproveCEO && viewingVoucher.status === 'pending_ceo' &&
                viewingVoucher.financial_tier === 'T04' && (
                <div>
                  <div className="pv-section">CEO — T04 FINAL DECISION (NO JR)</div>
                  <p className="muted">
                    Review Finance Manager approval, invoice attachments and bank details.
                    CEO approval finishes T04; no BOD approval is required.
                  </p>
                  <div className="pv-field">
                    <label htmlFor="pv-ceo-t04-remarks">CEO Remarks</label>
                    <textarea id="pv-ceo-t04-remarks" rows={3} maxLength={2000}
                      value={ceoRemarks} disabled={ceoSaving}
                      onChange={e => setCeoRemarks(e.target.value)}
                      placeholder="Optional for Approve; required for Return or Reject" />
                  </div>
                  <div className="pv-actions">
                    <button type="button" className="btn" style={{background:'#167347'}}
                      disabled={ceoSaving} onClick={() => ceoDecideT04('approve')}>
                      {ceoSaving ? 'Processing...' : 'Final Approve — T04'}
                    </button>
                    <button type="button" className="btn" style={{background:'#9a6700'}}
                      disabled={ceoSaving} onClick={() => ceoDecideT04('return')}>
                      Return for Amendment
                    </button>
                    <button type="button" className="btn" style={{background:'#b42318'}}
                      disabled={ceoSaving} onClick={() => ceoDecideT04('reject')}>
                      Reject Permanently
                    </button>
                  </div>
                </div>
              )}


              {/* Step 40: separate T08 CEO -> BOD path (not T04 final, not Legacy). */}
              {canApproveCEO && viewingVoucher.status === 'pending_ceo' &&
                viewingVoucher.financial_tier === 'T08' && (
                <div>
                  <div className="pv-section">CEO — T08 PAYROLL APPROVAL (NO JR)</div>
                  <p className="muted">CEO Approve sends T08 to BOD for FINAL approval;
                    CEO is not the final approver. Development pilot only.</p>
                  <div className="pv-field">
                    <label htmlFor="pv-ceo-t08-remarks">CEO Remarks</label>
                    <textarea id="pv-ceo-t08-remarks" rows={3} maxLength={2000}
                      value={ceoRemarks} disabled={ceoSaving}
                      onChange={e => setCeoRemarks(e.target.value)}
                      placeholder="Optional for Approve; required for Return or Reject" />
                  </div>
                  <div className="pv-actions">
                    <button type="button" className="btn" style={{background:'#167347'}}
                      disabled={ceoSaving} onClick={() => ceoDecideT08('approve')}>
                      {ceoSaving ? 'Processing...' : 'Approve → BOD (T08)'}
                    </button>
                    <button type="button" className="btn" style={{background:'#9a6700'}}
                      disabled={ceoSaving} onClick={() => ceoDecideT08('return')}>
                      Return for Amendment
                    </button>
                    <button type="button" className="btn" style={{background:'#b42318'}}
                      disabled={ceoSaving} onClick={() => ceoDecideT08('reject')}>
                      Reject Permanently
                    </button>
                  </div>
                </div>
              )}

              {canApproveCEO && viewingVoucher.status === 'pending_ceo' &&
                !['T04','T08'].includes(viewingVoucher.financial_tier) && (
                <div>
                  <div className="pv-section">CEO DECISION — TIER 3</div>
                  <p className="muted">
                    Review the voucher and earlier approvals before deciding.
                    Remarks are compulsory for Return or Reject.
                    An approval is not confirmation that payment has been made.
                  </p>
                  <div className="pv-field">
                    <label htmlFor="pv-ceo-remarks">CEO Remarks</label>
                    <textarea
                      id="pv-ceo-remarks"
                      rows={3}
                      maxLength={2000}
                      value={ceoRemarks}
                      disabled={ceoSaving}
                      onChange={e => setCeoRemarks(e.target.value)}
                      placeholder="Optional for Approve; required for Return or Reject"
                    />
                  </div>
                  <div className="pv-actions">
                    <button type="button" className="btn"
                      style={{ background: '#167347' }}
                      disabled={ceoSaving}
                      onClick={() => ceoDecide('approve')}>
                      {ceoSaving ? 'Processing...' : 'Approve → BOD'}
                    </button>
                    <button type="button" className="btn"
                      style={{ background: '#9a6700' }}
                      disabled={ceoSaving}
                      onClick={() => ceoDecide('return')}>
                      Return for Amendment
                    </button>
                    <button type="button" className="btn"
                      style={{ background: '#b42318' }}
                      disabled={ceoSaving}
                      onClick={() => ceoDecide('reject')}>
                      Reject Permanently
                    </button>
                  </div>
                </div>
              )}


              {/* Step 40: separate T08 BOD final path (not Legacy). */}
              {canApproveBOD && viewingVoucher.status === 'pending_bod' &&
                viewingVoucher.financial_tier === 'T08' && (
                <div>
                  <div className="pv-section">BOD — T08 FINAL APPROVAL (NO JR)</div>
                  <p className="muted">Check current-round Finance Manager and CEO approvals.
                    Final approval is not proof of payment. Development pilot only.</p>
                  <div className="pv-field">
                    <label htmlFor="pv-bod-t08-remarks">BOD Remarks</label>
                    <textarea id="pv-bod-t08-remarks" rows={3} maxLength={2000}
                      value={bodRemarks} disabled={bodSaving}
                      onChange={e => setBodRemarks(e.target.value)}
                      placeholder="Optional for Approve; required for Return or Reject" />
                  </div>
                  <div className="pv-actions">
                    <button type="button" className="btn" style={{background:'#167347'}}
                      disabled={bodSaving} onClick={() => bodDecideT08('approve')}>
                      {bodSaving ? 'Processing...' : 'Final Approve — T08'}
                    </button>
                    <button type="button" className="btn" style={{background:'#9a6700'}}
                      disabled={bodSaving} onClick={() => bodDecideT08('return')}>
                      Return for Amendment
                    </button>
                    <button type="button" className="btn" style={{background:'#b42318'}}
                      disabled={bodSaving} onClick={() => bodDecideT08('reject')}>
                      Reject Permanently
                    </button>
                  </div>
                </div>
              )}

              {canApproveBOD && viewingVoucher.status === 'pending_bod' &&
                viewingVoucher.financial_tier !== 'T08' && (
                <div>
                  <div className="pv-section">BOD FINAL DECISION — TIER 4</div>
                  <p className="muted">
                    Check the voucher and Executive, Manager, and CEO approval history.
                    Remarks are compulsory for Return or Reject.
                    Final approval does not confirm that a bank payment has been made.
                  </p>
                  <div className="pv-field">
                    <label htmlFor="pv-bod-remarks">BOD Remarks</label>
                    <textarea
                      id="pv-bod-remarks"
                      rows={3}
                      maxLength={2000}
                      value={bodRemarks}
                      disabled={bodSaving}
                      onChange={e => setBodRemarks(e.target.value)}
                      placeholder="Optional for Approve; required for Return or Reject"
                    />
                  </div>
                  <div className="pv-actions">
                    <button type="button" className="btn"
                      style={{ background: '#167347' }}
                      disabled={bodSaving}
                      onClick={() => bodDecide('approve')}>
                      {bodSaving ? 'Processing...' : 'Final Approve → Fully Approved'}
                    </button>
                    <button type="button" className="btn"
                      style={{ background: '#9a6700' }}
                      disabled={bodSaving}
                      onClick={() => bodDecide('return')}>
                      Return for Amendment
                    </button>
                    <button type="button" className="btn"
                      style={{ background: '#b42318' }}
                      disabled={bodSaving}
                      onClick={() => bodDecide('reject')}>
                      Reject Permanently
                    </button>
                  </div>
                </div>
              )}

              {/* Payment is separate from the 4-tier approval workflow. */}
              <div className="pv-section">PAYMENT TRACKING</div>
              <p className="muted">
                Only an approved voucher can be recorded as Paid. The actual payment must
                already have been made. Receipt upload is required for Paid status.
              </p>
              {viewingVoucher.status === 'fully_approved' && (
                <div className="pv-notice">
                  <strong>Payment Status: </strong>
                  {viewingVoucher.payment_status === 'paid' ? 'Paid' : 'Pending Payment'}
                  {' · '}Final Approval: {myDate(viewingVoucher.final_approval_date)}
                  {viewingVoucher.payment_date
                    ? ` · Payment Date: ${myDate(viewingVoucher.payment_date)}` : ''}
                </div>
              )}
              {viewingVoucher.receipt_path && (
                <div className="pv-actions">
                  <button type="button" className="btn"
                    disabled={receiptLoadingId !== null}
                    onClick={() => getReceiptLink(viewingVoucher)}>
                    {receiptLoadingId === viewingVoucher.id ? 'Generating...' : 'View Payment Receipt'}
                  </button>
                  {receiptLinks[viewingVoucher.id] && (
                    <a href={receiptLinks[viewingVoucher.id]}
                      target="_blank" rel="noopener noreferrer">
                      Open receipt (link valid 90 seconds)
                    </a>
                  )}
                </div>
              )}
              {ownsVoucher(viewingVoucher) && viewingVoucher.status === 'fully_approved' &&
                viewingVoucher.payment_status !== 'paid' && (
                <div style={{border:'1px solid #d5e2f0',borderRadius:10,padding:16}}>
                  <h3>Record Payment — Executive</h3>
                  <div className="pv-grid">
                    <div className="pv-field">
                      <label htmlFor="pv-payment-date">Actual Payment Date *</label>
                      <input id="pv-payment-date" type="date"
                        min={viewingVoucher.final_approval_date
                          ? myISODate(new Date(viewingVoucher.final_approval_date)) : undefined}
                        max={myISODate()} value={paymentDate}
                        disabled={paymentSaving}
                        onChange={e => setPaymentDate(e.target.value)} />
                    </div>
                    <div className="pv-field">
                      <label htmlFor="pv-payment-receipt">Payment Receipt *</label>
                      <input id="pv-payment-receipt" type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        disabled={paymentSaving || Boolean(uploadedReceiptPath)}
                        onChange={e => {
                          setSelectedReceipt(e.target.files?.[0] || null)
                          setUploadedReceiptPath('')
                          setPaymentMessage('')
                        }} />
                    </div>
                  </div>
                  {uploadedReceiptPath && (
                    <p className="muted">Receipt uploaded; waiting for payment confirmation.
                      You may retry the payment record without uploading again.</p>
                  )}
                  <p className="muted">PDF, JPG, PNG or WEBP · Maximum 5 MB.
                    Payment Date cannot be earlier than the final approval date.</p>
                  <button type="button" className="btn" style={{background:'#167347'}}
                    disabled={paymentSaving || (!selectedReceipt && !uploadedReceiptPath)}
                    onClick={recordPayment}>
                    {paymentSaving ? 'Recording...' : 'Upload Receipt & Mark as Paid'}
                  </button>
                </div>
              )}
              {canManage && viewingVoucher.status === 'fully_approved' &&
                viewingVoucher.payment_status === 'paid' && (
                <div style={{border:'1px solid #d5e2f0',borderRadius:10,padding:16,marginTop:16}}>
                  <h3>Correct Payment Date — Manager</h3>
                  <p className="muted">A correction reason is compulsory and recorded in PV audit.</p>
                  <div className="pv-grid">
                    <div className="pv-field">
                      <label htmlFor="pv-correct-payment-date">Corrected Payment Date *</label>
                      <input id="pv-correct-payment-date" type="date"
                        min={viewingVoucher.final_approval_date
                          ? myISODate(new Date(viewingVoucher.final_approval_date)) : undefined}
                        max={myISODate()} value={correctionDate}
                        disabled={correctionSaving}
                        onChange={e => setCorrectionDate(e.target.value)} />
                    </div>
                    <div className="pv-field">
                      <label htmlFor="pv-correction-reason">Reason for Correction *</label>
                      <textarea id="pv-correction-reason" rows={2} maxLength={1000}
                        value={correctionReason} disabled={correctionSaving}
                        onChange={e => setCorrectionReason(e.target.value)}
                        placeholder="Explain why the original date was incorrect" />
                    </div>
                  </div>
                  <button type="button" className="btn" disabled={correctionSaving}
                    onClick={correctPaymentDate}>
                    {correctionSaving ? 'Updating...' : 'Save Date Correction'}
                  </button>
                </div>
              )}
              {paymentMessage && (
                <p role="status" style={{fontWeight:600,color:
                  paymentMessage.startsWith('Payment was NOT') ||
                  paymentMessage.startsWith('Invalid') ||
                  paymentMessage.startsWith('A receipt') ||
                  paymentMessage.startsWith('Receipt must') ? '#b42318' : '#167347'}}>
                  {paymentMessage}
                </p>
              )}
              {correctionMessage && (
                <p role="status" style={{fontWeight:600,
                  color:correctionMessage.startsWith('Payment Date corrected') ? '#167347' : '#b42318'}}>
                  {correctionMessage}
                </p>
              )}

              <div className="pv-actions">
                {ownsVoucher(viewingVoucher) && (viewingVoucher.status === 'draft' ||
                  (viewingVoucher.status === 'returned' && profile?.department === 'Finance' &&
                    ['T01','T02','T04','T08'].includes(viewingVoucher.financial_tier))) && (
                  <>
                    <button
                      type="button"
                      className="btn"    
                      disabled={submittingVoucher}
                      onClick={startEditDraft}
                    >
                      Edit Draft
                    </button>
                    {['T01','T02','T04','T08'].includes(viewingVoucher.financial_tier) ? (
                      profile?.department === 'Finance' ? (
                        <div>
                          <button type="button" className="btn"
                            style={{background:'#167347'}}
                            disabled={submittingVoucher || !viewLines.length ||
                              !viewLines.every(line => invoiceDocuments.some(
                                doc => doc.line_item_id === line.id))}
                            onClick={submitAndVerify}>
                            {submittingVoucher ? 'Submitting...' : viewingVoucher.status === 'returned'
                              ? 'Resubmit → Finance Manager' : 'Submit & Verify → Finance Manager'}
                          </button>
                          {!viewLines.length || !viewLines.every(line =>
                            invoiceDocuments.some(doc => doc.line_item_id === line.id)) ? (
                            <p className="muted">Upload each invoice attachment before Submit.</p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="pv-notice">T01/T02/T04/T08 pilot is for Finance Executives only.</div>
                      )
                    ) : viewingVoucher.financial_tier ? (
                      <div className="pv-notice" role="status">
                        Financial Tier {viewingVoucher.financial_tier} saved. Submission remains disabled
                        until the relevant department routing and JR rules are implemented.
                      </div>
                    ) : (
                      <button type="button" className="btn"
                        style={{background:'#167347'}}
                        disabled={submittingVoucher}
                        onClick={submitAndVerify}>
                        {submittingVoucher ? 'Submitting...' : 'Submit & Verify (Legacy PV)'}
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="btn"
                  style={{ background: '#68788d' }}
                  disabled={overviewBusy}
                  onClick={closeVoucherOverview}
                >
                  Close Voucher
                </button>
              </div>
              {managerMessage && (
                <p role="status" aria-live="polite" style={{
                  marginTop: 15,
                  fontWeight: 600,
                  color: managerMessage.startsWith('Decision failed') ? '#b42318' : '#167347'
                }}>
                  {managerMessage}
                </p>
              )}
              {ceoMessage && (
                <p role="status" aria-live="polite" style={{
                  marginTop: 15,
                  fontWeight: 600,
                  color: ceoMessage.startsWith('Decision failed') ? '#b42318' : '#167347'
                }}>
                  {ceoMessage}
                </p>
              )}
              {bodMessage && (
                <p role="status" aria-live="polite" style={{
                  marginTop: 15,
                  fontWeight: 600,
                  color: bodMessage.startsWith('Decision failed') ? '#b42318' : '#167347'
                }}>
                  {bodMessage}
                </p>
              )}
              {submitMessage && (
                <p
                  role="status"
                  aria-live="polite"
                  style={{
                    marginTop: 15,
                    fontWeight: 600,
                    color: submitMessage.startsWith('Submission failed')
                      ? '#b42318'
                      : '#167347'
                  }}
                >
                  {submitMessage}
                </p>
              )}
          </div>
        </div>
      )}
    </div>
  )
}

