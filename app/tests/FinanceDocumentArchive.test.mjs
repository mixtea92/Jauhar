import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/FinanceDocumentArchive.jsx', import.meta.url), 'utf8')
const installer = await readFile(new URL('../../tools/JIMS_57D7C5_Archive_Installer.py', import.meta.url), 'utf8')

test('archive role gate excludes non-Finance staff', () => {
  assert.match(source, /profile\.department === 'Finance'/)
  assert.match(source, /\['executive', 'manager'\]/)
  assert.match(source, /\['ceo', 'bod', 'system_admin'\]/)
})
test('all eight financial registries are covered', () => {
  for (const table of [
    'pv_invoice_documents', 'pv_justification_reports',
    'pv_payment_initiation_proofs', 'pv_payment_transactions',
    'jims_v2_payment_documents', 'cash_voucher_receipts',
    'payment_vouchers', 'cash_vouchers',
  ]) assert.ok(source.includes("'" + table + "'"), table)
})
test('no record or Storage writes', () => {
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.remove\(|\.upload\(/)
  assert.match(source, /\.download\(row\.path\)/)
  assert.match(source, /\.createSignedUrl\(row\.path, 60\)/)
})
test('six categories and no Excel import archive', () => {
  for (const category of ['invoice', 'jr', 'initiation', 'final', 'partial', 'petty']) {
    assert.ok(source.includes("['" + category + "'"), category)
  }
  assert.doesNotMatch(source, /Excel Import|Original Excel Template/)
})
test('selected and filtered ZIP, CSV index and safe splitting', () => {
  assert.match(source, /ZIP_PART_SIZE = 25/)
  assert.match(source, /Document_Index\.csv/)
  assert.match(source, /Download Selected ZIP/)
  assert.match(source, /Download All Filtered ZIP/)
  assert.match(source, /csvCell/)
  assert.match(source, /cleanName/)
})
test('installer checks anchors and backs up App', () => {
  assert.match(installer, /--dry-run/)
  assert.match(installer, /--apply/)
  assert.match(installer, /Petty Cash navigation anchor not found uniquely/)
  assert.match(installer, /CashVoucher page route not found uniquely/)
  assert.match(installer, /shutil\.copyfile\(APP, backup\)/)
})
