-- UAT-FIX-12G: Partial Payment final installment must satisfy pv_paid_requires_details.
-- Source: verified Supabase STAGING definition after targeted patch.
-- No check constraints relaxed; no payment history/approval changes.
-- When the final installment is paid, store its verified receipt in the
-- PV parent compatibility fields while preserving per-installment ledger.
-- Applied to staging project pjrvxkrodkscucxdidqv on 2026-11-04.
CREATE OR REPLACE FUNCTION public.jims_v2_complete_installment_v1(p_transaction_id uuid, p_payment_date date, p_transaction_no text, p_receipt_path text, p_expected_updated_at timestamp with time zone)
 RETURNS pv_payment_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        receipt_path=p_receipt_path,payment_amount=v.amount,
        transaction_cheque_no=memo,
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
END $function$

