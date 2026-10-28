
-- JSYNC Cash Voucher V1. Entirely new objects; DO NOT touch any PV/Delegation objects.
CREATE SEQUENCE IF NOT EXISTS public.cash_voucher_number_seq;
CREATE TABLE IF NOT EXISTS public.cash_vouchers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cv_number text NOT NULL UNIQUE DEFAULT ('CV-' || to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY') || '-' || lpad(nextval('public.cash_voucher_number_seq')::text,6,'0')),
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 applicable_department text,
 form_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(form_data)='object'),
 total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount>=0),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 submitted_at timestamptz,
 closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS cash_vouchers_created_idx ON public.cash_vouchers(created_by,created_at DESC);
CREATE INDEX IF NOT EXISTS cash_vouchers_status_idx ON public.cash_vouchers(status,applicable_department);
CREATE TABLE IF NOT EXISTS public.cash_voucher_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 voucher_id uuid NOT NULL REFERENCES public.cash_vouchers(id) ON DELETE RESTRICT,
 authority text NOT NULL CHECK (authority IN ('applicable_hod','finance_hod')),
 approved_by uuid NOT NULL REFERENCES public.user_profiles(id),
 approved_at timestamptz NOT NULL DEFAULT now(),
 signature_png text NOT NULL CHECK (length(signature_png) BETWEEN 120 AND 200000 AND signature_png LIKE 'data:image/png;base64,%'),
 UNIQUE(voucher_id,authority)
);
CREATE INDEX IF NOT EXISTS cash_voucher_approvals_voucher_idx ON public.cash_voucher_approvals(voucher_id);
CREATE TABLE IF NOT EXISTS public.cash_voucher_audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 voucher_id uuid NOT NULL REFERENCES public.cash_vouchers(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_voucher_audit_voucher_idx ON public.cash_voucher_audit_events(voucher_id,created_at);

ALTER TABLE public.cash_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_voucher_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_voucher_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_vouchers,public.cash_voucher_approvals,public.cash_voucher_audit_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cash_vouchers,public.cash_voucher_approvals,public.cash_voucher_audit_events TO authenticated;

CREATE POLICY "jsync_cv_read_v1" ON public.cash_vouchers FOR SELECT TO authenticated
USING (EXISTS (
 SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.is_active IS TRUE
 AND (p.role IN ('system_admin','ceo','bod')
 OR (p.department='Finance' AND p.role IN ('executive','manager'))
 OR (p.role='manager' AND p.department=cash_vouchers.applicable_department))
));
CREATE POLICY "jsync_cv_approvals_read_v1" ON public.cash_voucher_approvals FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.cash_vouchers v WHERE v.id=voucher_id));
CREATE POLICY "jsync_cv_audit_read_v1" ON public.cash_voucher_audit_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.cash_vouchers v WHERE v.id=voucher_id));

CREATE OR REPLACE FUNCTION public.jsync_cv_is_finance_ap_v1(a uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $fn$ SELECT EXISTS (
 SELECT 1 FROM public.user_profiles p WHERE p.id=a AND p.is_active IS TRUE
 AND p.role='executive' AND p.department='Finance'
); $fn$;

CREATE OR REPLACE FUNCTION public.jsync_cv_calculate_amount_v1(form jsonb, strict boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE a numeric:=0; line jsonb; n integer; value text; c integer:=0;
BEGIN
 IF form IS NULL OR jsonb_typeof(form)<>'object' THEN RAISE EXCEPTION 'Invalid CV form'; END IF;
 IF form ? 'lines' AND jsonb_typeof(form->'lines')<>'array' THEN RAISE EXCEPTION 'CV lines must be an array'; END IF;
 n:=coalesce(jsonb_array_length(coalesce(form->'lines','[]'::jsonb)),0);
 IF n>10 THEN RAISE EXCEPTION 'Original Excel template supports a maximum of 10 expense rows'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(coalesce(form->'lines','[]'::jsonb)) LOOP
  IF jsonb_typeof(line)<>'object' THEN RAISE EXCEPTION 'Invalid expense row'; END IF;
  value:=btrim(coalesce(line->>'amount',''));
  IF value<>'' THEN
   IF value !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' OR value::numeric<=0 THEN
    RAISE EXCEPTION 'CV amount must be positive with up to two decimal places';
   END IF;
   a:=a+value::numeric;
   c:=c+1;
  ELSIF strict THEN RAISE EXCEPTION 'Receipt amount required';
  END IF;
  IF strict THEN
   IF nullif(btrim(coalesce(line->>'description','')),'') IS NULL
    OR nullif(btrim(coalesce(line->>'receipt_date','')),'') IS NULL
    OR nullif(btrim(coalesce(line->>'receipt_no','')),'') IS NULL
    OR nullif(btrim(coalesce(line->>'expense_category','')),'') IS NULL
    OR coalesce(line->>'expenses_branch','') NOT IN ('JMC_GP','JMC_KM','JMC_PM','JMC_TD')
    OR coalesce(line->>'receipt_attached','') NOT IN ('Yes','No')
   THEN RAISE EXCEPTION 'Complete every required expense field and dropdown'; END IF;
  END IF;
 END LOOP;
 IF strict AND (c=0 OR n=0) THEN RAISE EXCEPTION 'At least one complete receipt line is required'; END IF;
 IF a>999999999999.99 THEN RAISE EXCEPTION 'CV amount exceeds allowed limit'; END IF;
 RETURN round(a,2);
END; $fn$;

CREATE OR REPLACE FUNCTION public.jsync_cv_save_draft_v1(p_voucher_id uuid,p_form jsonb)
RETURNS public.cash_vouchers LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE a uuid:=auth.uid(); v public.cash_vouchers; amount numeric;
BEGIN
 IF NOT public.jsync_cv_is_finance_ap_v1(a) THEN RAISE EXCEPTION 'Only active AP Finance Executive may record a Cash Voucher' USING ERRCODE='42501'; END IF;
 amount:=public.jsync_cv_calculate_amount_v1(p_form,false);
 IF p_voucher_id IS NULL THEN
  INSERT INTO public.cash_vouchers(created_by,form_data,total_amount,applicable_department)
  VALUES(a,p_form,amount,nullif(btrim(p_form->>'department'),''))
  RETURNING * INTO v;
  INSERT INTO public.cash_voucher_audit_events(voucher_id,actor_id,action)
  VALUES(v.id,a,'created_draft');
 ELSE
  SELECT * INTO v FROM public.cash_vouchers WHERE id=p_voucher_id FOR UPDATE;
  IF NOT FOUND OR v.created_by IS DISTINCT FROM a OR v.status<>'draft' THEN
   RAISE EXCEPTION 'Only the original AP Finance Executive may edit a Draft CV' USING ERRCODE='42501';
  END IF;
  UPDATE public.cash_vouchers
  SET form_data=p_form,total_amount=amount,applicable_department=nullif(btrim(p_form->>'department'),''),updated_at=now()
  WHERE id=v.id RETURNING * INTO v;
  INSERT INTO public.cash_voucher_audit_events(voucher_id,actor_id,action)
  VALUES(v.id,a,'updated_draft');
 END IF;
 RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION public.jsync_cv_submit_v1(p_voucher_id uuid)
RETURNS public.cash_vouchers LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE a uuid:=auth.uid();v public.cash_vouchers;f jsonb;
BEGIN
 IF NOT public.jsync_cv_is_finance_ap_v1(a) THEN RAISE EXCEPTION 'AP Finance Executive required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM public.cash_vouchers WHERE id=p_voucher_id FOR UPDATE;
 IF NOT FOUND OR v.created_by IS DISTINCT FROM a OR v.status<>'draft' THEN
  RAISE EXCEPTION 'Only your Draft CV may be submitted' USING ERRCODE='42501';
 END IF;
 f:=v.form_data;
 IF nullif(btrim(coalesce(f->>'claimant_name','')),'') IS NULL
  OR nullif(btrim(coalesce(f->>'staff_id','')),'') IS NULL
  OR nullif(btrim(coalesce(f->>'position','')),'') IS NULL
  OR coalesce(f->>'branch','') NOT IN ('JMC_GP','JMC_KM','JMC_PM','JMC_TD')
  OR btrim(coalesce(f->>'claim_category','')) NOT IN ('Cash Advance','Reimbursement Claim')
  OR coalesce(f->>'payment_method','') <> 'Cash (Petty Cash)'
  OR coalesce(f->>'date_of_request','') = ''
  OR coalesce(f->>'date_disbursed','') = ''
  OR v.applicable_department NOT IN ('Finance','Operation','Sales & Marketing','Medical','System, Project & Infrastructure')
 THEN RAISE EXCEPTION 'Complete claimant, claim category, dates and branch before submission'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.user_profiles p
  WHERE p.is_active AND p.role='manager' AND p.department=v.applicable_department) THEN
  RAISE EXCEPTION 'No active Applicable HOD for this department'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.user_profiles p
  WHERE p.is_active AND p.role='manager' AND p.department='Finance') THEN
  RAISE EXCEPTION 'No active HOD FM'; END IF;
 PERFORM public.jsync_cv_calculate_amount_v1(f,true);
 UPDATE public.cash_vouchers SET status='pending_approval',submitted_at=now(),updated_at=now()
 WHERE id=v.id RETURNING * INTO v;
 INSERT INTO public.cash_voucher_audit_events(voucher_id,actor_id,action)
 VALUES(v.id,a,'submitted');
 RETURN v;
END; $fn$;

CREATE OR REPLACE FUNCTION public.jsync_cv_approve_many_v1(p_voucher_ids uuid[],p_authority text,p_signature_png text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE a uuid:=auth.uid(); actor public.user_profiles; v public.cash_vouchers; vid uuid; n integer:=0;
BEGIN
 SELECT * INTO actor FROM public.user_profiles WHERE id=a AND is_active IS TRUE;
 IF NOT FOUND OR actor.role<>'manager' THEN
  RAISE EXCEPTION 'Only an active HOD may verify Cash Vouchers' USING ERRCODE='42501'; END IF;
 IF p_authority NOT IN ('applicable_hod','finance_hod') THEN RAISE EXCEPTION 'Invalid approval stage'; END IF;
 IF p_authority='finance_hod' AND actor.department<>'Finance' THEN RAISE EXCEPTION 'Only HOD FM can sign this stage' USING ERRCODE='42501'; END IF;
 IF p_signature_png IS NULL OR length(p_signature_png) NOT BETWEEN 120 AND 200000
  OR p_signature_png !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' THEN
  RAISE EXCEPTION 'A drawn PNG digital signature is required'; END IF;
 IF p_voucher_ids IS NULL OR cardinality(p_voucher_ids)<1 OR cardinality(p_voucher_ids)>50
  OR cardinality(ARRAY(SELECT DISTINCT unnest(p_voucher_ids)))<>cardinality(p_voucher_ids)
  OR array_position(p_voucher_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Select 1–50 distinct Cash Vouchers'; END IF;
 -- All-or-nothing bulk approval: any invalid CV rolls back all changes.
 FOR vid IN SELECT unnest(p_voucher_ids) ORDER BY 1 LOOP
  SELECT * INTO v FROM public.cash_vouchers WHERE id=vid FOR UPDATE;
  IF NOT FOUND OR v.status<>'pending_approval'
   OR (p_authority='applicable_hod' AND actor.department IS DISTINCT FROM v.applicable_department)
   OR v.created_by=a THEN
   RAISE EXCEPTION 'Unauthorized or ineligible Cash Voucher approval: %',vid USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_voucher_approvals ca
   WHERE ca.voucher_id=vid AND ca.authority=p_authority) THEN
   RAISE EXCEPTION 'This approval stage is already signed for %',vid; END IF;
  INSERT INTO public.cash_voucher_approvals(voucher_id,authority,approved_by,signature_png)
  VALUES(vid,p_authority,a,p_signature_png);
  INSERT INTO public.cash_voucher_audit_events(voucher_id,actor_id,action,details)
  VALUES(vid,a,'signed_approval',jsonb_build_object('authority',p_authority,'bulk_size',cardinality(p_voucher_ids)));
  IF (SELECT count(*) FROM public.cash_voucher_approvals ca WHERE ca.voucher_id=vid)=2 THEN
   UPDATE public.cash_vouchers SET status='closed',closed_at=now(),updated_at=now() WHERE id=vid;
   INSERT INTO public.cash_voucher_audit_events(voucher_id,actor_id,action)
   VALUES(vid,a,'closed_dual_signed');
  ELSE
   UPDATE public.cash_vouchers SET updated_at=now() WHERE id=vid;
  END IF;
  n:=n+1;
 END LOOP;
 RETURN n;
END; $fn$;

REVOKE ALL ON FUNCTION public.jsync_cv_is_finance_ap_v1(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jsync_cv_calculate_amount_v1(jsonb,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jsync_cv_save_draft_v1(uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jsync_cv_submit_v1(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jsync_cv_approve_many_v1(uuid[],text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jsync_cv_save_draft_v1(uuid,jsonb),
public.jsync_cv_submit_v1(uuid),
public.jsync_cv_approve_many_v1(uuid[],text,text) TO authenticated;
