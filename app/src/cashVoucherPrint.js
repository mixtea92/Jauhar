// Signed Petty Cash export uses the existing lossless OOXML implementation.
// Preserve module evaluation and the public async wrapper used by callers.
import './cashVoucherExcel'
import { downloadSignedCVExcel as downloadSignedCVExcelOOXML } from './cashVoucherPrintOOXML'
// JSYNC_CV_LOSSLESS_OOXML_EXPORT_48M

export async function downloadSignedCVExcel(voucher,approvalRecords,capturedImages) {
  return downloadSignedCVExcelOOXML(voucher,approvalRecords,capturedImages)
}
