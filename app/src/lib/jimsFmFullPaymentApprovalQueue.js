// JIMS R09D — FM-only, read-only full-payment initiation review queue.
// This does not authorize payments: decisions remain in the secured
// PaymentTrackingPanel RPC after the user opens Payment Process.
import { supabase } from './supabase'

export async function loadPendingFmFullPaymentApprovals() {
  const { data, error } = await supabase
    .from('payment_vouchers')
    .select('id,pv_number,financial_tier,payee_name,amount,origin_department,branch_department,payment_initiated_at')
    .is('archived_at', null)
    .eq('status', 'fully_approved')
    .eq('payment_mode', 'full')
    .eq('payment_status', 'payment_initiated')
    .eq('payment_initiation_manager_decision', 'pending')
    .order('payment_initiated_at', { ascending: true })
    .limit(301)

  if (error) throw error
  if ((data || []).length > 300) {
    throw new Error('FM full payment review queue exceeds 300 records. Pagination is required.')
  }
  return data || []
}
