// JIMS UAT-12: FM-only read-only pending partial-payment approval queue.
// Decisions still use the existing secured review RPC inside Open PV.
import { supabase } from './supabase'

export const isFinanceManagerActual = profile =>
  profile?.is_active === true &&
  profile?.role === 'manager' &&
  profile?.department === 'Finance'

export async function loadPendingFmPartialApprovals() {
  const { data: installments, error: installmentError } = await supabase
    .from('pv_payment_transactions')
    .select('id,voucher_id,installment_no,requested_amount,initiated_at')
    .eq('status', 'initiated')
    .eq('review_decision', 'pending')
    .order('initiated_at', { ascending: true })
    .limit(301)

  if (installmentError) throw installmentError
  if ((installments || []).length > 300) {
    throw new Error('FM partial approval queue exceeds 300 records. Pagination is required.')
  }
  if (!installments?.length) return []

  const voucherIds = [...new Set(installments.map(item => item.voucher_id))]
  const { data: vouchers, error: voucherError } = await supabase
    .from('payment_vouchers')
    .select('id,pv_number,financial_tier,payee_name,origin_department,branch_department,amount')
    .in('id', voucherIds)
    .eq('status', 'fully_approved')
    .eq('payment_mode', 'partial')
    .is('archived_at', null)

  if (voucherError) throw voucherError
  const byId = new Map((vouchers || []).map(voucher => [voucher.id, voucher]))

  return installments
    .filter(item => byId.has(item.voucher_id))
    .map(item => ({
      ...item,
      voucher: byId.get(item.voucher_id)
    }))
}
