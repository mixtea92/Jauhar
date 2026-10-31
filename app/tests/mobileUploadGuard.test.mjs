// 57D7C0 — Dependency-free mobile file-upload guard regression.
// Run from repo root: node --test app/tests/mobileUploadGuard.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isMobileUploadBlocked, MOBILE_UPLOAD_NOTICE } from '../src/lib/mobileUploadGuard.js'

const devices = [
  ['iPhone Safari', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }, true],
  ['iPad Safari', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' }, true],
  ['iPad desktop-mode Safari', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5 }, true],
  ['Android phone', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel) Mobile', maxTouchPoints: 5 }, true],
  ['Android tablet', { userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-T870)', maxTouchPoints: 5 }, true],
  ['Android WebView', { userAgent: 'Mozilla/5.0 (Linux; Android 12; wv)' }, true],
  ['Client Hints mobile', { userAgent: 'Unknown', userAgentData: { mobile: true } }, true],
  ['Windows desktop', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, false],
  ['Mac desktop', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 0 }, false],
  ['Mac with one touch point', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 1 }, false],
  ['Linux desktop', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, false],
  ['No navigator (SSR)', null, false],
]

for (const [name, navigatorLike, expected] of devices) {
  test(`mobile-device predicate: ${name}`, () => {
    assert.equal(isMobileUploadBlocked(navigatorLike), expected)
  })
}

test('a consistent user-facing message is available', () => {
  assert.match(MOBILE_UPLOAD_NOTICE, /disabled on mobile/i)
  assert.match(MOBILE_UPLOAD_NOTICE, /desktop browser/i)
})

const source = async (relative) => readFile(new URL(relative, import.meta.url), 'utf8')

test('Payment Voucher Excel, invoice, and JR handlers reject mobile', async () => {
  const s = await source('../src/PaymentVoucher.jsx')
  assert.match(s, /async function uploadInvoice\(line, file\)\s*\{\s*if \(isMobileUploadBlocked\(\)\)/)
  assert.match(s, /async function uploadJR\(file\)\s*\{\s*if \(isMobileUploadBlocked\(\)\)/)
  assert.match(s, /async function handleExcelImport\(event\)[\s\S]*?if \(isMobileUploadBlocked\(\)\)/)
  assert.match(s, /disabled=\{mobileUploadsBlocked \|\| importing \|\| loading\}/)
  assert.match(s, /disabled=\{mobileUploadsBlocked \|\| invoiceUploadingId !== null\}/)
  assert.equal((s.match(/type="file"/g) || []).length, 2)
})

test('JR PDF input disabled on mobile while viewing and meeting workflows remain', async () => {
  const s = await source('../src/jr/JRPanel.jsx')
  assert.match(s, /disabled=\{mobileUploadsBlocked \|\| uploading\}/)
  assert.match(s, /if\(f && !isMobileUploadBlocked\(\)\)onUpload\(f\)/)
  assert.match(s, /Record Offline Approval Evidence/)
})

test('Payment Tracking proof upload and receipt upload have mobile guards', async () => {
  const s = await source('../src/payment/PaymentTrackingPanel.jsx')
  assert.match(s, /async function uploadProof\(\)\s*\{\s*if \(isMobileUploadBlocked\(\)\)/)
  assert.match(s, /if \(isMobileUploadBlocked\(\) && !receiptPath\)/)
  assert.match(s, /disabled=\{busy \|\| mobileUploadsBlocked\}/)
  assert.match(s, /disabled=\{busy \|\| mobileUploadsBlocked \|\| Boolean\(receiptPath\)\}/)
  assert.match(s, /mobileUploadsBlocked && !receiptPath/)
  assert.match(s, /onClick=\{\(\)=>review\('approve'\)\}/)
  assert.equal((s.match(/type="file"/g) || []).length, 2)
})

test('Petty Cash existing mobile guards remain in place', async () => {
  const s = await source('../src/CashVoucher.jsx')
  assert.match(s, /isMobileUpload/)
  assert.match(s, /if\(isMobileUpload\)/)
  assert.match(s, /if\(!isAP\|\|isMobileUpload\)/)
  assert.match(s, /disabled=\{busy\|\|isMobileUpload\|\|!hasCVLineData\(line\)\}/)
})
