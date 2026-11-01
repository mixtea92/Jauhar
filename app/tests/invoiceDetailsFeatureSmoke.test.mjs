// JIMS 57D7C7 — Offline feature smoke tests. Run in /app via:
// node --test tests/invoiceDetailsFeatureSmoke.test.mjs
// This script DOES NOT connect to Supabase or modify any PV data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const base=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const file=async path=>readFile(resolve(base,path),'utf8')
const reportSrc=await file('src/JIMSHistoryExports.jsx')
const previewSrc=await file('invoice-preview.html')
const pvSrc=await file('src/PaymentVoucher.jsx')
const migration=await file('../supabase/migrations/20261102100000_jims_invoice_required_breakdown_submit_guard_v1.sql')

function section(source,begin,end){
 const a=source.indexOf(begin),b=source.indexOf(end,a+begin.length)
 assert.ok(a>=0&&b>a,'Expected code section: '+begin)
 return source.slice(a,b)
}
// Smoke-test the EXACT existing makeExcel() implementation and column mappings
// from JIMSHistoryExports.jsx, without importing React or Supabase.
function exportImplementation(){
 const definitions=section(reportSrc,'const COLUMNS = {','const OWNER_REPORTS=')
 const protect=section(reportSrc,'const valueText =','const safeFolder =')
 const excel=section(reportSrc,'const moneyCols=','function downloadBlob(')
 return new Function(definitions+'\n'+protect+'\n'+excel+'\n return makeExcel;')()
}
const makeExcel=exportImplementation()
function renderMoney(value){
 return 'RM '+Number(value||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})
}
function previewValidator(){
 const fn=section(previewSrc,'function validate(v){','function renderMain(){')
 return new Function('fmt',fn+'\n return validate;')(renderMoney)
}
const validate=previewValidator()
const item=(name,qty,price)=>({name,cat:'Medical Supplies',qty:String(qty),price:String(price),gl:'5001'})
const invoice=(items,saved=true)=>({number:'INV-01',amount:1500,items,saved,proof:'example.pdf'})

test('UI preview rejects missing, partial and unsaved invoice details',()=>{
 assert.match(validate(invoice([])).reason,/missing/i)
 assert.match(validate(invoice([item('',1,1500)])).reason,/incomplete/i)
 assert.match(validate(invoice([item('Syringe',1,1400)])).reason,/Mismatch/i)
 assert.match(validate(invoice([item('Syringe',1,1500)],false)).reason,/not saved/i)
 assert.equal(validate(invoice([item('Syringe',1,1500)])).valid,true)
})

test('UI preview keeps proof mandatory before Submit PV',()=>{
 assert.match(previewSrc,/\$('submitpv'\)\.disabled=failures\.length>0/)
 assert.match(previewSrc,/if\(!v\.proof\)problems\.push/)
 assert.match(previewSrc,/if\(invoices\.some\(v=>!validate\(v\)\.valid\|\|!v\.proof\)\)return/)
})

test('Actual ExcelJS writer creates the three correct invoice worksheets',async()=>{
 const rows=[
  {key:'invoice_summary',sheet:'Invoice Summary',rows:[{
   pv_number:'PV-2026-0001',invoice_no:'INV-001',supplier:'ABC Medical Supplies',
   invoice_description:'Medical Supplies',invoice_amount:1500,
   item_count:4,breakdown_total:1500,proof_exists:true,pv_status:'draft'
  }]},
  {key:'invoice_item_details',sheet:'Invoice Item Details',rows:[{
   pv_number:'PV-2026-0001',invoice_no:'INV-001',supplier:'ABC Medical Supplies',
   item_no:1,item_description:'Syringe 5ml',category:'Consumables',
   quantity:100,unit_price:1,total_amount:100,gl_code:'5001'
  }]},
  {key:'invoice_proof_register',sheet:'Invoice Proof Register',rows:[{
   pv_number:'PV-2026-0001',invoice_no:'INV-001',supplier:'ABC Medical Supplies',
   invoice_amount:1500,proof_status:'Uploaded',proof_storage_path:'private/invoice-001.pdf'
  }]}
 ]
 const blob=await makeExcel(rows)
 assert.ok(blob.size>3000,'XLSX should not be empty')
 const {default:ExcelJS}=await import('exceljs')
 const workbook=new ExcelJS.Workbook()
 await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()))
 assert.deepEqual(workbook.worksheets.map(ws=>ws.name),[
  'Invoice Summary','Invoice Item Details','Invoice Proof Register'
 ])
 const summary=workbook.getWorksheet('Invoice Summary')
 const items=workbook.getWorksheet('Invoice Item Details')
 const proofs=workbook.getWorksheet('Invoice Proof Register')
 assert.equal(summary.getRow(1).getCell(1).value,'PV Number')
 assert.equal(summary.getRow(2).getCell(1).value,'PV-2026-0001')
 assert.equal(summary.getRow(2).getCell(6).value,1500)
 assert.equal(summary.getRow(2).getCell(7).value,4)
 assert.equal(items.getRow(2).getCell(7).value,'Syringe 5ml')
 assert.equal(items.getRow(2).getCell(9).value,100)
 assert.equal(items.getRow(2).getCell(10).value,1)
 assert.equal(items.getRow(2).getCell(11).value,100)
 assert.equal(proofs.getRow(2).getCell(6).value,'Uploaded')
 assert.equal(proofs.getRow(2).getCell(7).value,'private/invoice-001.pdf')
})
test('Excel workbook treats user-supplied formula-looking values as text',async()=>{
 const blob=await makeExcel([{key:'invoice_summary',sheet:'Invoice Summary',rows:[{
  invoice_no:'=HYPERLINK("https://example.invalid")',supplier:'+COMMAND',
  invoice_amount:12,proof_exists:false
 }]}])
 const {default:ExcelJS}=await import('exceljs')
 const workbook=new ExcelJS.Workbook()
 await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()))
 const sheet=workbook.getWorksheet('Invoice Summary')
 assert.equal(typeof sheet.getRow(2).getCell(2).value,'string')
 assert.equal(sheet.getRow(2).getCell(2).value,"'=HYPERLINK(\"https://example.invalid\")")
 assert.equal(sheet.getRow(2).getCell(3).value,"'+COMMAND")
})

test('Backend guard SQL contains mandatory item, totals, and Storage checks',()=>{
 assert.match(migration,/OLD\.status IN \('draft','returned'\)/)
 assert.match(migration,/NOT EXISTS \(\s*SELECT 1 FROM public\.pv_invoice_item_details i/)
 assert.match(migration,/HAVING round\(sum\(i\.total_amount\),2\) <> round\(l\.amount,2\)/)
 assert.match(migration,/JOIN storage\.objects o/)
 assert.match(migration,/round\(v_line_total \+ NEW\.sst_amount, 2\) <> round\(NEW\.amount, 2\)/)
 // SQL contract checks do NOT replace executing the trigger inside a database.
})

test('Existing PV approval, payment and partial-payment component paths remain present',()=>{
 assert.match(pvSrc,/async function submitAndVerify\(/)
 assert.match(pvSrc,/JIMSV2FinanceManagerQueue/)
 assert.match(pvSrc,/JIMSPaymentCompletionQueue/)
 assert.match(pvSrc,/PaymentTrackingPanel/)
 assert.match(pvSrc,/jims_57d4_preflight_submit_v1/)
 // Presence checks only. Full approval/payment regression still requires UAT.
})
