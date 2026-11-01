// JIMS 57D7C7 / F5A — Source-level regression gate (offline).
// Run in feature worktree from /app:
// node --test tests/invoiceDetailsRegressionF5.test.mjs
//
// Exact code compared with pinned Integration baseline. No Supabase/cloud/Docker.
// This gate is NOT full approval / payment functional UAT.
import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const BASE='9e55decf1ddf2280b932888b23276e20a0429b1e'
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'})
const baseline=path=>git('show',BASE+':'+path)
const current=path=>readFile(resolve(root,path),'utf8')

function functionSource(source,name){
 const matcher=new RegExp('^([ \\t]*)(?:async\\s+)?function\\s+'+name+'\\s*\\(','m')
 const m=matcher.exec(source)
 assert.ok(m,'Missing function '+name)
 const indent=m[1]
 const end=source.indexOf('\n'+indent+'}\n',m.index)
 assert.ok(end>=0,'Unclosed function '+name)
 return source.slice(m.index,end+2+indent.length)
}

test('Pinned Integration baseline available locally in Git',()=>{
 assert.equal(git('cat-file','-t',BASE).trim(),'commit')
 assert.equal(git('branch','--show-current').trim(),'jims-feature-invoice-details-57d7c7',
   'Run ONLY in the separate JIMS-INVOICE-DETAILS feature worktree')
})

const untouchedModules=[
 'app/src/payment/PaymentTrackingPanel.jsx',
 'app/src/JIMSPaymentProcessBoard.jsx',
 'app/src/JIMSPaymentCompletionQueue.jsx',
 'app/src/JIMSV2FinanceManagerQueue.jsx',
 'app/src/CashVoucher.jsx',
 'app/src/JIMS57D2OfficialPVDownload.jsx',
 'app/src/JIMS57D4DuplicateInvoiceWarning.jsx',
 'app/src/PVDelegationHistory.jsx'
]
for(const path of untouchedModules){
 test('Source unchanged vs Integration: '+path,async()=>{
  assert.equal(await current(path),baseline(path))
 })
}
const criticalPVFunctions=[
 'decideAsDelegate','archiveDraft','saveExecutivePaymentRemarks','getReceiptLink',
 'uploadInvoice','uploadJR','openJR','recordJRMeeting','viewInvoice',
 'correctPaymentDate','departmentHODDecide','verifyDepartmentAPFinance',
 'managerDecide','decideCrossDepartment','financeManagerDecide',
 'ceoDecideT04','ceoDecideT08','ceoDecide','bodDecide','bodDecideT08',
 'ceoDecideJR','bodDecideJR','startEditDraft','handleSave'
]
test('24 protected PV approval, upload and editing functions unchanged',async()=>{
 const before=baseline('app/src/PaymentVoucher.jsx')
 const after=await current('app/src/PaymentVoucher.jsx')
 for(const name of criticalPVFunctions)
  assert.equal(functionSource(after,name),functionSource(before,name),
    'Changed protected existing PV function: '+name)
})
const protectedReportFunctions=[
 'makeExcel','downloadBlob','previewEvidence','runEvidence','runOwner'
]
test('Existing Excel, evidence ZIP and Owner approval exports unchanged',async()=>{
 const before=baseline('app/src/JIMSHistoryExports.jsx')
 const after=await current('app/src/JIMSHistoryExports.jsx')
 for(const name of protectedReportFunctions)
  assert.equal(functionSource(after,name),functionSource(before,name),
   'Changed protected existing report export: '+name)
})
test('Invoice Details export is additive and calls Finance RPC',async()=>{
 const src=await current('app/src/JIMSHistoryExports.jsx')
 assert.match(src,/jims_invoice_details_report_v1/)
 assert.match(src,/Invoice Summary/)
 assert.match(src,/Invoice Item Details/)
 assert.match(src,/Invoice Proof Register/)
})
test('New SQL guard applies only on draft or returned submission',async()=>{
 const src=await current('supabase/migrations/20261102100000_jims_invoice_required_breakdown_submit_guard_v1.sql')
 assert.match(src,/OLD\.status IN \('draft','returned'\)/)
 assert.match(src,/NEW\.status IN \(/)
 assert.match(src,/public\.pv_invoice_item_details/)
 assert.doesNotMatch(src,/UPDATE public\.payment_vouchers/)
 assert.doesNotMatch(src,/ALTER TABLE public\.payment_vouchers/)
})
test('Committed changes stay strictly scoped to Invoice Details feature',()=>{
 const allowed=[
  /^app\/invoice-preview\.html$/,
  /^app\/src\/PaymentVoucher\.jsx$/,
  /^app\/src\/JIMSHistoryExports\.jsx$/,
  /^app\/src\/JIMSInvoiceDetailsPanel\.jsx$/,
  /^app\/tests\/invoiceDetails[A-Za-z0-9_.-]+\.mjs$/,
  /^supabase\/migrations\/\d+_jims_invoice_(details|required)[A-Za-z0-9_]*\.sql$/
 ]
 const changed=git('diff','--name-only',BASE+'..HEAD').trim().split('\n').filter(Boolean)
 assert.ok(changed.length>=4,'Expected invoice feature files missing')
 const unexpected=changed.filter(path=>!allowed.some(re=>re.test(path)))
 assert.deepEqual(unexpected,[],'Non-feature files changed')
})
test('Existing payment and approval UAT remains a separate requirement',()=>{
 assert.equal(typeof baseline,'function')
})
