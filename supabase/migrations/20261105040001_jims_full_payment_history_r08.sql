-- JIMS STAGING ONLY: R08-02. Extend the existing AP Operational History export.
-- Keep all pv_payment_transactions rows unchanged (partial/tranches).
-- Add full-payment PV rows only when NO transaction rows exist for that voucher.
-- The export's existing AP-only authorization, redaction, key names, and row limit remain intact.
DO $migration$
DECLARE
  v_function text;
  v_old text := E'INTO v_payments FROM public.pv_payment_transactions t\n  JOIN public.payment_vouchers v ON v.id=t.voucher_id;';
  v_new text := $replacement$
INTO v_payments FROM (
    SELECT t.id,t.voucher_id,t.installment_no,
      t.requested_amount,t.settled_amount,t.status,t.review_decision,
      t.review_remarks,t.payment_date,t.bank_transaction_reference,
      t.created_at,t.initiated_at,t.reviewed_at,t.completed_at,
      t.voided_at,t.void_reason
    FROM public.pv_payment_transactions t
    UNION ALL
    SELECT v.id AS id,v.id AS voucher_id,1 AS installment_no,
      COALESCE(v.payment_amount,v.amount) AS requested_amount,
      CASE WHEN v.payment_status='paid'
        THEN COALESCE(v.payment_amount,v.amount) ELSE NULL::numeric END AS settled_amount,
      v.payment_status AS status,
      v.payment_initiation_manager_decision AS review_decision,
      v.payment_initiation_manager_remarks AS review_remarks,
      v.payment_date,
      v.transaction_cheque_no AS bank_transaction_reference,
      COALESCE(v.payment_initiated_at,v.paid_recorded_at,v.created_at) AS created_at,
      v.payment_initiated_at AS initiated_at,
      v.payment_initiation_reviewed_at AS reviewed_at,
      v.paid_recorded_at AS completed_at,
      NULL::timestamptz AS voided_at,
      NULL::text AS void_reason
    FROM public.payment_vouchers v
    WHERE v.payment_mode='full'
      AND NOT EXISTS (
        SELECT 1 FROM public.pv_payment_transactions tx
        WHERE tx.voucher_id=v.id
      )
      AND (
        v.payment_initiated_at IS NOT NULL
        OR v.paid_recorded_at IS NOT NULL
        OR v.payment_status='paid'
      )
  ) t
  JOIN public.payment_vouchers v ON v.id=t.voucher_id;
$replacement$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_function
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jims_finance_ap_operational_history_export_v1'
    AND pg_get_function_identity_arguments(p.oid)='';
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Expected AP Operational History export function is missing; abort migration';
  END IF;
  IF strpos(v_function,v_old)=0 THEN
    RAISE EXCEPTION 'Expected export baseline does not match; abort migration without changes';
  END IF;
  EXECUTE replace(v_function,v_old,v_new);
END;
$migration$;