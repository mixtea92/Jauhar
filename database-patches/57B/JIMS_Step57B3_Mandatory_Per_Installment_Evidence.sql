-- JIMS STEP 57B3 — mandatory per-installment payment evidence & settlement.
-- Apply AFTER Step 57B1 and Step 57B2. User should run in Supabase SQL editor.
-- Full Payment V1 remains untouched. Existing 57B2 drafts are preserved.
BEGIN;
DO $pre$
BEGIN
 IF to_regclass('public.pv_payment_transactions') IS NULL
    OR to_regclass('public.pv_payment_balances_v2') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='payment_vouchers' AND column_name='payment_mode')
 THEN RAISE EXCEPTION 'Step 57B1 foundation required'; END IF;
 IF EXISTS (SELECT 1 FROM public.pv_payment_transactions
            WHERE status NOT IN ('draft','voided'))
 THEN RAISE EXCEPTION 'Review existing active V2 transactions before installing 57B3'; END IF;
END $pre$;

-- Immutable evidence registry; every new proof including a returned re-submission is preserved.
CREATE TABLE IF NOT EXISTS public.jims_v2_payment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.payment_vouchers(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL REFERENCES public.pv_payment_transactions(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('initiation','final_receipt')),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS jims_v2_docs_transaction_idx
  ON public.jims_v2_payment_documents(transaction_id, created_at DESC);
ALTER TABLE public.jims_v2_payment_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jims_v2_payment_documents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.jims_v2_payment_documents TO authenticated;
DROP POLICY IF EXISTS jims_v2_documents_view ON public.jims_v2_payment_documents;
CREATE POLICY jims_v2_documents_view
 ON public.jims_v2_payment_documents FOR SELECT TO authenticated USING (
   EXISTS (SELECT 1 FROM public.payment_vouchers v WHERE v.id=voucher_id
     AND v.status='fully_approved' AND v.archived_at IS NULL)
 );

-- Storage path: voucher_uuid / installment_uuid / random_uuid.ext.
-- Reuse private V1 buckets with V2-specific append-only upload policies.
DROP POLICY IF EXISTS jims_v2_initiation_insert ON storage.objects;
CREATE POLICY jims_v2_initiation_insert ON storage.objects
 FOR INSERT TO authenticated WITH CHECK (
   bucket_id='jauhar-pv-payment-initiation'
   AND split_part(name,'/',1) ~* '^[0-9a-f-]{36}$'
   AND split_part(name,'/',2) ~* '^[0-9a-f-]{36}$'
   AND split_part(name,'/',3) ~* '^[0-9a-f-]{36}\.(pdf|png|jpg|jpeg|webp)$'
   AND split_part(name,'/',4)=''
   AND EXISTS (
     SELECT 1 FROM public.pv_payment_transactions t
     JOIN public.payment_vouchers v ON v.id=t.voucher_id
     JOIN public.user_profiles p ON p.id=(SELECT auth.uid())
     WHERE t.id::text=split_part(storage.objects.name,'/',2)
       AND v.id::text=split_part(storage.objects.name,'/',1)
       AND t.status IN ('draft','returned')
       AND v.payment_mode='partial' AND v.status='fully_approved'
       AND v.archived_at IS NULL AND v.payment_status='pending_payment'
       AND p.role='executive' AND p.department='Finance' AND p.is_active
   )
 );
DROP POLICY IF EXISTS jims_v2_receipt_insert ON storage.objects;
CREATE POLICY jims_v2_receipt_insert ON storage.objects
 FOR INSERT TO authenticated WITH CHECK (
   bucket_id='jauhar-pv-receipts'
   AND split_part(name,'/',1) ~* '^[0-9a-f-]{36}$'
   AND split_part(name,'/',2) ~* '^[0-9a-f-]{36}$'
   AND split_part(name,'/',3) ~* '^[0-9a-f-]{36}\.pdf$'
   AND split_part(name,'/',4)=''
   AND EXISTS (
     SELECT 1 FROM public.pv_payment_transactions t
     JOIN public.payment_vouchers v ON v.id=t.voucher_id
     JOIN public.user_profiles p ON p.id=(SELECT auth.uid())
     WHERE t.id::text=split_part(storage.objects.name,'/',2)
       AND v.id::text=split_part(storage.objects.name,'/',1)
       AND t.status='approved' AND t.review_decision='approved'
       AND v.payment_mode='partial' AND v.status='fully_approved'
       AND v.archived_at IS NULL AND v.payment_status='pending_payment'
       AND p.role='executive' AND p.department='Finance' AND p.is_active
   )
 );
-- Registered V2 initiation proofs can be opened with short-lived signed URLs.
DROP POLICY IF EXISTS jims_v2_initiation_read ON storage.objects;
CREATE POLICY jims_v2_initiation_read ON storage.objects
 FOR SELECT TO authenticated USING (
   bucket_id='jauhar-pv-payment-initiation'
   AND EXISTS (
     SELECT 1 FROM public.jims_v2_payment_documents d
     WHERE d.storage_path=storage.objects.name AND d.kind='initiation'
       AND (public.jauhar_can_read_payment_proof_v1(d.voucher_id)
          OR public.jauhar_can_view_delegation_docs_v1(d.voucher_id))
   )
 );

-- Do not allow re-use of a proof across installments (registry storage_path UNIQUE).
CREATE OR REPLACE FUNCTION public.jims_v2_submit_installment_v1(
 p_transaction_id uuid,p_storage_path text,p_expected_updated_at timestamptz
) RETURNS public.pv_payment_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 u uuid:=auth.uid(); v public.payment_vouchers;
 t public.pv_payment_transactions; obj jsonb; mime text; bytes bigint;
 expect text; suffix text;
BEGIN
 IF u IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_profiles p
   WHERE p.id=u AND p.is_active AND p.role='executive' AND p.department='Finance')
 THEN RAISE EXCEPTION 'AP Finance Executive required'; END IF;
 SELECT voucher_id INTO t.voucher_id FROM public.pv_payment_transactions
   WHERE id=p_transaction_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Installment not found'; END IF;
 SELECT * INTO v FROM public.payment_vouchers WHERE id=t.voucher_id FOR UPDATE;
 SELECT * INTO t FROM public.pv_payment_transactions
   WHERE id=p_transaction_id FOR UPDATE;
 IF v.archived_at IS NOT NULL OR v.status<>'fully_approved' OR v.payment_mode<>'partial'
    OR v.payment_status<>'pending_payment' OR t.status NOT IN ('draft','returned')
 THEN RAISE EXCEPTION 'Installment is not eligible for submission'; END IF;
 IF p_expected_updated_at IS NULL OR v.updated_at IS DISTINCT FROM p_expected_updated_at
 THEN RAISE EXCEPTION 'Reload PV before submitting'; END IF;
 IF t.created_by<>u THEN RAISE EXCEPTION 'Only installment creator can submit'; END IF;
 IF t.status='returned' AND t.initiation_proof_path=p_storage_path
 THEN RAISE EXCEPTION 'Returned initiation requires a NEW proof file'; END IF;
 expect := '^'||v.id::text||'/'||t.id::text||
   '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg|webp)$';
 IF p_storage_path IS NULL OR p_storage_path !~* expect
 THEN RAISE EXCEPTION 'Each installment requires a unique PDF/image initiation proof'; END IF;
 SELECT metadata INTO obj FROM storage.objects WHERE
   bucket_id='jauhar-pv-payment-initiation' AND name=p_storage_path;
 IF NOT FOUND THEN RAISE EXCEPTION 'Upload mandatory proof before submit'; END IF;
 mime:=obj->>'mimetype';
 IF mime NOT IN ('application/pdf','image/png','image/jpeg','image/webp') OR
  NOT ( (p_storage_path ~* '\.pdf$' AND mime='application/pdf')
     OR (p_storage_path ~* '\.png$' AND mime='image/png')
     OR (p_storage_path ~* '\.(jpg|jpeg)$' AND mime='image/jpeg')
     OR (p_storage_path ~* '\.webp$' AND mime='image/webp') )
 THEN RAISE EXCEPTION 'Invalid initiation proof MIME type'; END IF;
 IF (obj->>'size') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Missing proof size'; END IF;
 bytes:=(obj->>'size')::bigint;
 IF bytes NOT BETWEEN 1 AND 5242880 THEN RAISE EXCEPTION 'Proof must be 1–5 MB'; END IF;
 IF EXISTS (SELECT 1 FROM public.jims_v2_payment_documents WHERE storage_path=p_storage_path)
 THEN RAISE EXCEPTION 'Evidence cannot be reused'; END IF;

 INSERT INTO public.jims_v2_payment_documents
  (voucher_id,transaction_id,kind,storage_path,mime_type,size_bytes,uploaded_by)
 VALUES(v.id,t.id,'initiation',p_storage_path,mime,bytes,u);
 UPDATE public.pv_payment_transactions
 SET status='initiated',initiation_proof_path=p_storage_path,
     initiated_by=u,initiated_at=clock_timestamp(),
     review_decision='pending',reviewed_by=NULL,reviewed_at=NULL,
     review_remarks=NULL,updated_at=clock_timestamp()
 WHERE id=t.id RETURNING * INTO t;
 UPDATE public.payment_vouchers SET updated_at=clock_timestamp() WHERE id=v.id;
 INSERT INTO public.pv_audit_events(voucher_id,actor_id,action,details)
 VALUES(v.id,u,'jims_v2_installment_initiated',
  jsonb_build_object('installment_id',t.id,'installment_no',t.installment_no,
  'amount',t.requested_amount,'proof_path',p_storage_path));
 RETURN t;
END $fn$;

CREATE OR REPLACE FUNCTION public.jims_v2_review_installment_v1(
 p_transaction_id uuid,p_decision text,p_remarks text,p_expected_updated_at timestamptz
) RETURNS public.pv_payment_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 u uuid:=auth.uid(); v public.payment_vouchers;
 t public.pv_payment_transactions;
 act text:=lower(btrim(coalesce(p_decision,'')));
 reason text:=nullif(btrim(coalesce(p_remarks,'')),'');
BEGIN
 IF act NOT IN ('approve','return') OR length(coalesce(reason,''))>2000
    OR (act='return' AND reason IS NULL)
 THEN RAISE EXCEPTION 'Approve or Return; return requires remarks (max 2000)'; END IF;
 SELECT voucher_id INTO t.voucher_id FROM public.pv_payment_transactions WHERE id=p_transaction_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Installment not found'; END IF;
 SELECT * INTO v FROM public.payment_vouchers WHERE id=t.voucher_id FOR UPDATE;
 SELECT * INTO t FROM public.pv_payment_transactions WHERE id=p_transaction_id FOR UPDATE;
 IF u IS NULL OR NOT public.jauhar_can_stage_act_v1(v.id,'finance_manager',act)
 THEN RAISE EXCEPTION 'Current Finance Manager / valid delegate authority required'; END IF;
 IF v.archived_at IS NOT NULL OR v.status<>'fully_approved' OR
    v.payment_mode<>'partial' OR v.payment_status<>'pending_payment' OR
    t.status<>'initiated' OR t.review_decision<>'pending' OR
    t.initiated_by=u OR t.initiation_proof_path IS NULL OR
    NOT EXISTS (SELECT 1 FROM public.jims_v2_payment_documents d
     WHERE d.transaction_id=t.id AND d.kind='initiation'
       AND d.storage_path=t.initiation_proof_path)
 THEN RAISE EXCEPTION 'Valid initiated installment with mandatory proof required'; END IF;
 IF p_expected_updated_at IS NULL OR v.updated_at IS DISTINCT FROM p_expected_updated_at
 THEN RAISE EXCEPTION 'Reload PV before Finance Manager review'; END IF;
 UPDATE public.pv_payment_transactions
 SET status=CASE WHEN act='approve' THEN 'approved' ELSE 'returned' END,
     review_decision=CASE WHEN act='approve' THEN 'approved' ELSE 'returned' END,
     reviewed_by=u,reviewed_at=clock_timestamp(),review_remarks=reason,
     updated_at=clock_timestamp()
 WHERE id=t.id RETURNING * INTO t;
 UPDATE public.payment_vouchers SET updated_at=clock_timestamp() WHERE id=v.id;
 INSERT INTO public.pv_audit_events(voucher_id,actor_id,action,details)
 VALUES(v.id,u,'jims_v2_installment_'||CASE WHEN act='approve' THEN 'approved' ELSE 'returned' END,
  jsonb_build_object('installment_id',t.id,'installment_no',t.installment_no,
  'amount',t.requested_amount,'remarks',reason,'proof_path',t.initiation_proof_path));
 RETURN t;
END $fn$;

-- A controlled gate for V2 final settlement only. No legacy V1 RPC sets this.
CREATE OR REPLACE FUNCTION public.jims_v2_guard_legacy_payment_updates_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF OLD.payment_mode='partial' AND
    current_setting('jims.v2_settlement',true) IS DISTINCT FROM 'yes'
 THEN RAISE EXCEPTION 'Partial Payment V2 selected. Legacy Full Payment cannot change this PV'; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.jims_v2_guard_legacy_payment_updates_v1()
 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.jims_v2_complete_installment_v1(
 p_transaction_id uuid,p_payment_date date,p_transaction_no text,
 p_receipt_path text,p_expected_updated_at timestamptz
) RETURNS public.pv_payment_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 u uuid:=auth.uid(); v public.payment_vouchers;
 t public.pv_payment_transactions;
 paid numeric(18,2); remaining numeric(18,2);
 memo text:=nullif(btrim(coalesce(p_transaction_no,'')),'');
 obj jsonb; bytes bigint; now_malaysia date:=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
BEGIN
 IF u IS NULL OR NOT EXISTS (SELECT 1 FROM public.user_profiles p
   WHERE p.id=u AND p.is_active AND p.role='executive' AND p.department='Finance')
 THEN RAISE EXCEPTION 'Active AP Finance Executive required'; END IF;
 SELECT voucher_id INTO t.voucher_id FROM public.pv_payment_transactions WHERE id=p_transaction_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Installment not found'; END IF;
 SELECT * INTO v FROM public.payment_vouchers WHERE id=t.voucher_id FOR UPDATE;
 SELECT * INTO t FROM public.pv_payment_transactions WHERE id=p_transaction_id FOR UPDATE;
 IF v.archived_at IS NOT NULL OR v.status<>'fully_approved' OR
    v.payment_mode<>'partial' OR v.payment_status<>'pending_payment' OR
    t.status<>'approved' OR t.review_decision<>'approved' OR
    t.reviewed_by IS NULL OR t.reviewed_at IS NULL OR
    t.initiated_by=t.reviewed_by OR t.initiation_proof_path IS NULL
 THEN RAISE EXCEPTION 'Finance Manager verification required before settlement'; END IF;
 IF p_expected_updated_at IS NULL OR v.updated_at IS DISTINCT FROM p_expected_updated_at
 THEN RAISE EXCEPTION 'Reload PV before completing payment'; END IF;
 IF p_payment_date IS NULL OR v.final_approval_date IS NULL OR
    p_payment_date<(v.final_approval_date AT TIME ZONE 'Asia/Kuala_Lumpur')::date
    OR p_payment_date>now_malaysia
 THEN RAISE EXCEPTION 'Payment date must be between final approval and today'; END IF;
 IF memo IS NULL OR length(memo)>200
 THEN RAISE EXCEPTION 'Actual bank transaction number required (max 200)'; END IF;
 IF p_receipt_path IS NULL OR p_receipt_path !~*
   ('^'||v.id::text||'/'||t.id::text||
   '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$')
 THEN RAISE EXCEPTION 'Final PDF receipt is mandatory for THIS installment'; END IF;
 SELECT metadata INTO obj FROM storage.objects
 WHERE bucket_id='jauhar-pv-receipts' AND name=p_receipt_path;
 IF NOT FOUND OR obj->>'mimetype'<>'application/pdf'
 THEN RAISE EXCEPTION 'Uploaded private PDF bank receipt not found'; END IF;
 IF (obj->>'size') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Invalid receipt size'; END IF;
 bytes:=(obj->>'size')::bigint;
 IF bytes NOT BETWEEN 1 AND 5242880 THEN RAISE EXCEPTION 'Receipt must be 1–5 MB'; END IF;
 IF EXISTS (SELECT 1 FROM public.jims_v2_payment_documents WHERE storage_path=p_receipt_path)
 THEN RAISE EXCEPTION 'Receipt already belongs to another payment'; END IF;
 SELECT COALESCE(sum(settled_amount),0)::numeric(18,2) INTO paid
 FROM public.pv_payment_transactions
 WHERE voucher_id=v.id AND status='paid';
 remaining:=round(v.amount-paid,2);
 IF remaining<=0 OR t.requested_amount>remaining
 THEN RAISE EXCEPTION 'Installment exceeds outstanding approved amount'; END IF;

 INSERT INTO public.jims_v2_payment_documents
  (voucher_id,transaction_id,kind,storage_path,mime_type,size_bytes,uploaded_by)
 VALUES(v.id,t.id,'final_receipt',p_receipt_path,'application/pdf',bytes,u);
 UPDATE public.pv_payment_transactions
 SET status='paid',settled_amount=requested_amount,
     payment_date=p_payment_date,bank_transaction_reference=memo,
     final_receipt_path=p_receipt_path,completed_by=u,completed_at=clock_timestamp(),
     updated_at=clock_timestamp()
 WHERE id=t.id RETURNING * INTO t;
 IF t.requested_amount=remaining THEN
   PERFORM set_config('jims.v2_settlement','yes',true);
   UPDATE public.payment_vouchers
    SET payment_status='paid',payment_date=p_payment_date,
        paid_recorded_by=u,paid_recorded_at=clock_timestamp(),
        updated_at=clock_timestamp()
    WHERE id=v.id;
   PERFORM set_config('jims.v2_settlement','',true);
 ELSE
   UPDATE public.payment_vouchers SET updated_at=clock_timestamp() WHERE id=v.id;
 END IF;
 INSERT INTO public.pv_audit_events(voucher_id,actor_id,action,details)
 VALUES(v.id,u,'jims_v2_installment_paid',
  jsonb_build_object('installment_id',t.id,'installment_no',t.installment_no,
   'amount',t.settled_amount,'payment_date',p_payment_date,'transaction_no',memo,
   'receipt_path',p_receipt_path,'outstanding_after',remaining-t.requested_amount));
 RETURN t;
END $fn$;

REVOKE ALL ON FUNCTION public.jims_v2_submit_installment_v1(uuid,text,timestamptz)
 FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_v2_review_installment_v1(uuid,text,text,timestamptz)
 FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_v2_complete_installment_v1(uuid,date,text,text,timestamptz)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_v2_submit_installment_v1(uuid,text,timestamptz)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_v2_review_installment_v1(uuid,text,text,timestamptz)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_v2_complete_installment_v1(uuid,date,text,text,timestamptz)
 TO authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.pv_payment_transactions
 FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE public.jims_v2_payment_documents IS
 'Private, append-only per-installment evidence and resubmission history for JIMS Payment V2.';
COMMIT;
