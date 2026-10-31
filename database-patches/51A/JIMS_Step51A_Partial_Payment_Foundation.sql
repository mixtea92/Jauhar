-- JIMS STEP 51A — Partial Payment V2 Foundation (additive-only).
-- Date: 2026-10-29. Preserves fully tested Full Payment V1.
-- This migration creates an EMPTY ledger and a read-only balance view.
-- IMPORTANT: No INSERT/UPDATE/DELETE grants or write policies. Step 51B will
-- introduce secured, row-locking RPCs and V1/V2 mutual-exclusion gates.
-- No existing PV/CV/Delegation tables, triggers, functions, RLS, or data altered.

CREATE TABLE public.pv_payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.payment_vouchers(id) ON DELETE RESTRICT,
  installment_no integer NOT NULL CHECK (installment_no > 0),
  request_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  requested_amount numeric(18,2) NOT NULL CHECK (requested_amount > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft','initiated','returned','approved','paid','voided')
  ),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  initiation_proof_path text,
  initiated_by uuid REFERENCES auth.users(id),
  initiated_at timestamptz,
  review_decision text CHECK (review_decision IS NULL OR review_decision IN ('pending','approved','returned')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_remarks text,
  settled_amount numeric(18,2) CHECK (settled_amount IS NULL OR settled_amount > 0),
  payment_date date,
  bank_transaction_reference text,
  final_receipt_path text,
  completed_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  voided_at timestamptz,
  void_reason text,
  CONSTRAINT pv_payment_transactions_installment_unique UNIQUE (voucher_id,installment_no),
  CONSTRAINT pv_payment_transactions_paid_evidence CHECK (
    status <> 'paid'
    OR (
      settled_amount = requested_amount
      AND review_decision = 'approved'
      AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND initiated_by IS NOT NULL AND initiated_at IS NOT NULL
      AND initiation_proof_path IS NOT NULL
      AND payment_date IS NOT NULL
      AND nullif(btrim(bank_transaction_reference),'') IS NOT NULL
      AND final_receipt_path IS NOT NULL
      AND completed_by IS NOT NULL AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT pv_payment_transactions_approved_evidence CHECK (
    status NOT IN ('approved','paid')
    OR (
      review_decision = 'approved'
      AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND initiated_by IS NOT NULL AND initiated_at IS NOT NULL
      AND initiation_proof_path IS NOT NULL
    )
  ),
  CONSTRAINT pv_payment_transactions_initiated_evidence CHECK (
    status <> 'initiated'
    OR (
      initiated_by IS NOT NULL AND initiated_at IS NOT NULL
      AND initiation_proof_path IS NOT NULL
      AND review_decision = 'pending'
    )
  ),
  CONSTRAINT pv_payment_transactions_returned_evidence CHECK (
    status <> 'returned'
    OR (
      review_decision = 'returned'
      AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND nullif(btrim(review_remarks),'') IS NOT NULL
    )
  )
);

CREATE INDEX pv_payment_transactions_voucher_status_idx
  ON public.pv_payment_transactions (voucher_id,status);
CREATE INDEX pv_payment_transactions_created_at_idx
  ON public.pv_payment_transactions (created_at DESC);

ALTER TABLE public.pv_payment_transactions ENABLE ROW LEVEL SECURITY;

-- A ledger row is visible only if the requesting user can see the original
-- voucher through EXISTING payment_vouchers RLS; archived PVs are excluded.
CREATE POLICY "JIMS 51A: read ledger for visible approved PV"
  ON public.pv_payment_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.payment_vouchers pv
      WHERE pv.id = voucher_id
        AND pv.status = 'fully_approved'
        AND pv.archived_at IS NULL
    )
  );

REVOKE ALL ON TABLE public.pv_payment_transactions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pv_payment_transactions TO authenticated;

-- Read-only balance report. SECURITY INVOKER is essential: BOTH underlying
-- tables are read using the current user's permissions and existing PV RLS.
CREATE VIEW public.pv_payment_balances_v2
  WITH (security_invoker = true)
AS
WITH ledger AS (
  SELECT
    voucher_id,
    COALESCE(SUM(settled_amount) FILTER (WHERE status = 'paid'),0::numeric) AS v2_paid,
    COALESCE(SUM(requested_amount) FILTER (WHERE status IN ('initiated','approved')),0::numeric) AS reserved,
    COUNT(*) FILTER (WHERE status = 'paid') AS v2_paid_installments,
    COUNT(*) FILTER (WHERE status IN ('initiated','approved')) AS active_installments
  FROM public.pv_payment_transactions
  GROUP BY voucher_id
),
rollup AS (
  SELECT
    pv.id AS voucher_id,
    pv.pv_number,
    pv.amount AS approved_amount,
    pv.payment_status AS legacy_payment_status,
    CASE WHEN pv.payment_status = 'paid' THEN pv.amount
      ELSE COALESCE(ledger.v2_paid,0::numeric) END AS total_paid,
    COALESCE(ledger.reserved,0::numeric) AS reserved_amount,
    COALESCE(ledger.v2_paid_installments,0::bigint) AS paid_installments,
    COALESCE(ledger.active_installments,0::bigint) AS active_installments
  FROM public.payment_vouchers pv
  LEFT JOIN ledger ON ledger.voucher_id = pv.id
  WHERE pv.status = 'fully_approved'
    AND pv.archived_at IS NULL
)
SELECT
  voucher_id, pv_number, approved_amount, total_paid, reserved_amount,
  (approved_amount - total_paid) AS outstanding_amount,
  CASE
    WHEN legacy_payment_status <> 'pending_payment' THEN 0::numeric
    ELSE GREATEST(approved_amount - total_paid - reserved_amount,0::numeric)
  END AS available_for_next_initiation,
  CASE
    WHEN legacy_payment_status = 'paid' THEN 'paid'
    WHEN total_paid > 0 AND total_paid < approved_amount THEN 'partially_paid'
    WHEN total_paid >= approved_amount THEN 'paid'
    WHEN legacy_payment_status = 'payment_initiated' OR reserved_amount > 0 THEN 'payment_initiated'
    ELSE 'pending_payment'
  END AS derived_payment_status,
  legacy_payment_status,
  paid_installments, active_installments
FROM rollup;

REVOKE ALL ON TABLE public.pv_payment_balances_v2
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pv_payment_balances_v2 TO authenticated;

COMMENT ON TABLE public.pv_payment_transactions IS
'JIMS Partial Payment V2 EMPTY ledger. Step 51A foundation, no client writes. Existing Full Payment V1 is unaffected.';
COMMENT ON VIEW public.pv_payment_balances_v2 IS
'JIMS 51A read-only balances. Legacy full paid amounts recognized; legacy initiated PVs locked against V2 initiation. No write RPC installed yet.';
