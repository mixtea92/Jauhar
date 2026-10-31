-- JIMS Step 57B1 — secure partial-payment selection + draft reservation.
-- Additive migration. No real payment can be initiated or marked Paid by V2.
-- Apply only after reviewing the existing Supabase project and 57A UI.
-- Step 57B2 will add initiation / FM review / receipt settlement RPCs.
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.pv_payment_transactions') IS NULL
     OR to_regclass('public.payment_vouchers') IS NULL
     OR to_regclass('public.pv_audit_events') IS NULL
     OR to_regclass('public.pv_payment_balances_v2') IS NULL
  THEN
    RAISE EXCEPTION 'Step 51A payment ledger and balance view required before 57B1';
  END IF;
END
$guard$;

ALTER TABLE public.payment_vouchers
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'full';

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_vouchers'::regclass
      AND conname = 'jims_payment_mode_value_v1'
  ) THEN
    ALTER TABLE public.payment_vouchers
      ADD CONSTRAINT jims_payment_mode_value_v1
      CHECK (payment_mode IN ('full','partial'));
  END IF;
END
$guard$;

-- Exactly one unsettled V2 installment at a time, per voucher.
-- This serializes the business workflow as well as the row lock.
CREATE UNIQUE INDEX IF NOT EXISTS jims_v2_single_open_installment_v1
  ON public.pv_payment_transactions (voucher_id)
  WHERE status IN ('draft','initiated','returned','approved');

-- Hard stop against legacy Full Payment writes once V2 is selected.
-- Includes legacy record_pv_payment, complete_pv_payment_v1 and FM review.
CREATE OR REPLACE FUNCTION public.jims_v2_guard_legacy_payment_updates_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.payment_mode = 'partial' THEN
    RAISE EXCEPTION 'Partial Payment V2 selected. Legacy Full Payment cannot change this PV.';
  END IF;
  RETURN NEW;
END
$fn$;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.payment_vouchers'::regclass
      AND tgname = 'jims_v2_guard_legacy_payment_updates_trg'
  ) THEN
    CREATE TRIGGER jims_v2_guard_legacy_payment_updates_trg
      BEFORE UPDATE OF
        payment_status, payment_initiated_at, payment_initiated_by,
        payment_initiation_proof_id, payment_initiation_proof_path,
        payment_initiation_manager_decision, payment_initiation_reviewed_at,
        payment_initiation_reviewed_by, payment_initiation_manager_remarks,
        payment_date, receipt_path, payment_amount, transaction_cheque_no,
        paid_recorded_at, paid_recorded_by
      ON public.payment_vouchers FOR EACH ROW
      EXECUTE FUNCTION public.jims_v2_guard_legacy_payment_updates_v1();
  END IF;
END
$guard$;

-- Legacy proof-registration RPC inserts a proof then updates only updated_at;
-- therefore also block the child insert, rather than relying on the PV gate.
CREATE OR REPLACE FUNCTION public.jims_v2_guard_legacy_proof_registration_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payment_vouchers v
    WHERE v.id = NEW.voucher_id AND v.payment_mode = 'partial'
  ) THEN
    RAISE EXCEPTION 'Partial Payment V2 selected. Use installment evidence flow.';
  END IF;
  RETURN NEW;
END
$fn$;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.pv_payment_initiation_proofs'::regclass
      AND tgname = 'jims_v2_guard_legacy_proof_registration_trg'
  ) THEN
    CREATE TRIGGER jims_v2_guard_legacy_proof_registration_trg
      BEFORE INSERT ON public.pv_payment_initiation_proofs
      FOR EACH ROW
      EXECUTE FUNCTION public.jims_v2_guard_legacy_proof_registration_v1();
  END IF;
END
$guard$;

-- Creates the first or next installment DRAFT. No bank initiation.
-- Auth, row locks, status, cents precision and approved balance enforced server-side.
-- p_request_key enables safe retries without duplicate ledger rows.
CREATE OR REPLACE FUNCTION public.jims_v2_create_payment_draft_v1(
  p_voucher_id uuid,
  p_requested_amount numeric,
  p_request_key uuid,
  p_expected_updated_at timestamptz
)
RETURNS public.pv_payment_transactions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_pv public.payment_vouchers;
  v_existing public.pv_payment_transactions;
  v_row public.pv_payment_transactions;
  v_paid numeric(18,2);
  v_outstanding numeric(18,2);
  v_next integer;
  v_amount numeric(18,2);
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = v_actor AND p.is_active
      AND p.role = 'executive' AND p.department = 'Finance'
  ) THEN
    RAISE EXCEPTION 'Active Finance AP Executive required';
  END IF;
  IF p_voucher_id IS NULL OR p_request_key IS NULL
     OR p_requested_amount IS NULL OR p_requested_amount <= 0
     OR p_requested_amount <> round(p_requested_amount,2)
     OR p_requested_amount > 9999999999999999.99
  THEN
    RAISE EXCEPTION 'Valid 2-decimal installment amount and request key required';
  END IF;
  v_amount := p_requested_amount;

  SELECT * INTO v_pv
  FROM public.payment_vouchers WHERE id=p_voucher_id FOR UPDATE;
  IF NOT FOUND OR v_pv.archived_at IS NOT NULL
     OR v_pv.status <> 'fully_approved'
     OR v_pv.payment_status <> 'pending_payment'
     OR v_pv.payment_mode NOT IN ('full','partial')
     OR v_pv.final_approval_date IS NULL
  THEN
    RAISE EXCEPTION 'Only final-approved, unpaid and active PVs can create V2 draft';
  END IF;

  -- Important for retry after timeout: return same row, not another installment.
  SELECT * INTO v_existing FROM public.pv_payment_transactions
  WHERE request_key=p_request_key;
  IF FOUND THEN
    IF v_existing.voucher_id <> p_voucher_id OR
       v_existing.requested_amount <> v_amount OR
       v_existing.created_by <> v_actor
    THEN RAISE EXCEPTION 'Request key is already used by a different payment';
    END IF;
    RETURN v_existing;
  END IF;

  IF p_expected_updated_at IS NULL OR
     v_pv.updated_at IS DISTINCT FROM p_expected_updated_at
  THEN
    RAISE EXCEPTION 'PV was updated; reload before selecting partial payment';
  END IF;

  -- Cannot mix old V1 proof, initiation or settlement with the V2 ledger.
  IF v_pv.payment_initiation_proof_id IS NOT NULL OR
     v_pv.payment_initiated_at IS NOT NULL OR
     v_pv.receipt_path IS NOT NULL OR
     v_pv.paid_recorded_at IS NOT NULL OR
     EXISTS (
       SELECT 1 FROM public.pv_payment_initiation_proofs p
       WHERE p.voucher_id=p_voucher_id
     )
  THEN
    RAISE EXCEPTION 'Legacy payment evidence exists; V2 cannot begin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_payment_transactions t
    WHERE t.voucher_id=p_voucher_id
      AND t.status IN ('draft','initiated','returned','approved')
  ) THEN
    RAISE EXCEPTION 'Another partial installment is not yet closed';
  END IF;

  SELECT COALESCE(sum(t.settled_amount),0)::numeric(18,2)
    INTO v_paid
  FROM public.pv_payment_transactions t
  WHERE t.voucher_id=p_voucher_id AND t.status='paid';

  v_outstanding := round(v_pv.amount - v_paid, 2);
  IF v_outstanding <= 0 OR v_amount > v_outstanding
     OR (v_pv.payment_mode = 'full' AND v_amount >= v_outstanding)
  THEN
    RAISE EXCEPTION 'Requested amount invalid or exceeds outstanding balance';
  END IF;
  -- Once Partial mode is underway, final installment may equal outstanding.
  SELECT coalesce(max(t.installment_no),0)+1 INTO v_next
  FROM public.pv_payment_transactions t
  WHERE t.voucher_id=p_voucher_id;

  -- Never change an existing PV's approved amount, tier or approval record.
  IF v_pv.payment_mode = 'full' THEN
    UPDATE public.payment_vouchers
      SET payment_mode='partial', updated_at=clock_timestamp()
      WHERE id=p_voucher_id;
  END IF;

  INSERT INTO public.pv_payment_transactions
    (voucher_id, installment_no, request_key, requested_amount,
     status, created_by)
  VALUES (p_voucher_id, v_next, p_request_key, v_amount,
          'draft', v_actor)
  RETURNING * INTO v_row;

  INSERT INTO public.pv_audit_events(voucher_id,actor_id,action,details)
  VALUES (p_voucher_id,v_actor,'jims_v2_installment_draft_created',
    jsonb_build_object('installment_id',v_row.id,
      'installment_no',v_next,'amount',v_amount,
      'outstanding_before',v_outstanding,
      'payment_mode','partial'));

  RETURN v_row;
END
$fn$;

-- Undo an unsubmitted draft. No silent deletion: preserve voided audit trail.
-- Revert to Full only when NO settled installment exists.
CREATE OR REPLACE FUNCTION public.jims_v2_cancel_payment_draft_v1(
  p_transaction_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
)
RETURNS public.pv_payment_transactions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.pv_payment_transactions;
  v_pv public.payment_vouchers;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id=v_actor AND p.is_active
      AND p.role='executive' AND p.department='Finance'
  ) THEN RAISE EXCEPTION 'Active Finance AP Executive required'; END IF;
  IF v_reason IS NULL OR length(v_reason)>1000
  THEN RAISE EXCEPTION 'Cancellation reason required (max 1000 characters)'; END IF;

  -- Fetch ID only first; lock parent PV before locking child to
  -- preserve the same lock order as create/initiate/settle operations.
  SELECT * INTO v_row FROM public.pv_payment_transactions
  WHERE id=p_transaction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Installment not found'; END IF;

  SELECT * INTO v_pv FROM public.payment_vouchers
  WHERE id=v_row.voucher_id FOR UPDATE;
  IF NOT FOUND OR v_pv.archived_at IS NOT NULL
     OR v_pv.status <> 'fully_approved'
     OR v_pv.payment_mode <> 'partial'
  THEN RAISE EXCEPTION 'Only active partial-payment PV drafts can be cancelled'; END IF;
  IF p_expected_updated_at IS NULL OR
     v_pv.updated_at IS DISTINCT FROM p_expected_updated_at
  THEN RAISE EXCEPTION 'PV was updated; reload before cancelling draft'; END IF;

  SELECT * INTO v_row FROM public.pv_payment_transactions
  WHERE id=p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'draft' OR v_row.created_by<>v_actor
  THEN RAISE EXCEPTION 'Only your open, unsubmitted draft may be cancelled'; END IF;

  UPDATE public.pv_payment_transactions
  SET status='voided', voided_by=v_actor, voided_at=clock_timestamp(),
      void_reason=v_reason, updated_at=clock_timestamp()
  WHERE id=v_row.id RETURNING * INTO v_row;

  IF NOT EXISTS (
    SELECT 1 FROM public.pv_payment_transactions t
    WHERE t.voucher_id=v_pv.id AND t.status <> 'voided'
  ) THEN
    UPDATE public.payment_vouchers
      SET payment_mode='full', updated_at=clock_timestamp()
      WHERE id=v_pv.id;
  END IF;

  INSERT INTO public.pv_audit_events(voucher_id,actor_id,action,details)
  VALUES (v_pv.id,v_actor,'jims_v2_installment_draft_cancelled',
    jsonb_build_object('installment_id',v_row.id,
      'installment_no',v_row.installment_no,'reason',v_reason));

  RETURN v_row;
END
$fn$;

-- Public schema RPCs must not be executable by anonymous clients.
REVOKE ALL ON FUNCTION public.jims_v2_create_payment_draft_v1(uuid,numeric,uuid,timestamptz)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.jims_v2_cancel_payment_draft_v1(uuid,text,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jims_v2_create_payment_draft_v1(uuid,numeric,uuid,timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_v2_cancel_payment_draft_v1(uuid,text,timestamptz)
  TO authenticated;
REVOKE ALL ON FUNCTION public.jims_v2_guard_legacy_payment_updates_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jims_v2_guard_legacy_proof_registration_v1() FROM PUBLIC, anon, authenticated;

-- Existing ledger stays SELECT-only for authenticated; all writes via RPC.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pv_payment_transactions
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.payment_vouchers.payment_mode IS
  'JIMS 57B: full V1 or partial V2. Partial never routes through the legacy V1 paid RPC.';
COMMENT ON FUNCTION public.jims_v2_create_payment_draft_v1(uuid,numeric,uuid,timestamptz) IS
  '57B1 draft-only; does not transfer or mark funds paid; requires Step 57B2 for evidence and settlement.';
COMMIT;
