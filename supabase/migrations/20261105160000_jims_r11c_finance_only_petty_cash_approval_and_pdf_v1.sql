-- JIMS STAGING ONLY — R11C Finance-only Petty Cash initial rollout.
-- No change to PV, Payment Process, or the underlying receipt-per-line requirement.
-- Existing signed history and earlier audit events are retained.

-- New approvals are recorded as explicit authenticated decisions, not drawn images.
-- Leave old signature records unchanged; CHECK constraints already permit SQL NULL.
ALTER TABLE public.cash_voucher_approvals
  ALTER COLUMN signature_png DROP NOT NULL;
ALTER TABLE public.cash_voucher_approvals
  ADD COLUMN IF NOT EXISTS approved_designation text;

-- Do not require an active HOD from the claimant's department during this
-- Finance-only rollout; the claim's department stays in the voucher metadata.
DO $m$
DECLARE v_def text;
  v_old text := $old$
 IF NOT EXISTS (SELECT 1 FROM public.user_profiles p
  WHERE p.is_active AND p.role='manager' AND p.department=v.applicable_department) THEN
  RAISE EXCEPTION 'No active Applicable HOD for this department'; END IF;
$old$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jsync_cv_submit_v1';
  IF v_def IS NULL OR strpos(v_def,v_old)=0 THEN
    RAISE EXCEPTION 'R11C: unexpected Petty Cash submit RPC baseline';
  END IF;
  EXECUTE replace(v_def,v_old,E'\n -- R11C: Applicable HOD review deferred; Finance HOD still required.\n');
END;
$m$;

-- Disable the legacy two-HOD/signature RPC for ordinary authenticated users
-- so the UI restriction cannot be bypassed with a direct API call.
REVOKE EXECUTE ON FUNCTION public.jsync_cv_approve_many_v1(uuid[],text,text)
  FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.jims_r11c_pc_finance_approve_v1(p_voucher_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  a uuid := auth.uid();
  actor public.user_profiles;
  v public.cash_vouchers;
  vid uuid;
  approved_count integer := 0;
BEGIN
  SELECT * INTO actor FROM public.user_profiles
  WHERE id=a AND is_active IS TRUE AND role='manager' AND department='Finance';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only active Finance Manager may approve Petty Cash'
      USING ERRCODE='42501';
  END IF;
  IF p_voucher_ids IS NULL OR cardinality(p_voucher_ids) NOT BETWEEN 1 AND 50
     OR array_position(p_voucher_ids,NULL) IS NOT NULL
     OR cardinality(ARRAY(SELECT DISTINCT unnest(p_voucher_ids)))
        <> cardinality(p_voucher_ids)
  THEN
    RAISE EXCEPTION 'Select 1–50 distinct Petty Cash records';
  END IF;

  -- Sorted row locks; the entire batch rolls back if any record is ineligible.
  FOR vid IN SELECT unnest(p_voucher_ids) ORDER BY 1 LOOP
    SELECT * INTO v FROM public.cash_vouchers WHERE id=vid FOR UPDATE;
    IF NOT FOUND OR v.status<>'pending_approval' OR v.created_by=a THEN
      RAISE EXCEPTION 'Ineligible Petty Cash approval: %', vid
        USING ERRCODE='42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cash_voucher_approvals ap
               WHERE ap.voucher_id=vid AND ap.authority='finance_hod') THEN
      RAISE EXCEPTION 'Petty Cash already approved by Finance Manager';
    END IF;

    INSERT INTO public.cash_voucher_approvals
      (voucher_id,authority,approved_by,signature_png,approved_designation)
    VALUES (vid,'finance_hod',a,NULL,
      COALESCE(NULLIF(btrim(actor.staff_designation),''),
               'Finance Manager'));

    INSERT INTO public.cash_voucher_audit_events
      (voucher_id,actor_id,action,details)
    VALUES (vid,a,'finance_approved',jsonb_build_object(
      'authority','finance_hod',
      'decision','approve',
      'designation',COALESCE(NULLIF(btrim(actor.staff_designation),''),'Finance Manager'),
      'bulk_size',cardinality(p_voucher_ids),
      'rollout','r11c_finance_only'));

    UPDATE public.cash_vouchers
    SET status='closed',closed_at=now(),updated_at=now() WHERE id=vid;

    INSERT INTO public.cash_voucher_audit_events(voucher_id,actor_id,action,details)
    VALUES(vid,a,'closed_finance_approved',jsonb_build_object(
       'rollout','r11c_finance_only'));
    approved_count := approved_count + 1;
  END LOOP;
  RETURN approved_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.jims_r11c_pc_finance_approve_v1(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jims_r11c_pc_finance_approve_v1(uuid[]) TO authenticated;

-- The official PDF pulls only authenticated, authorized, database-backed data.
-- It deliberately excludes full approval history and receipt images.
CREATE OR REPLACE FUNCTION public.jims_r11c_pc_official_snapshot_v1(p_voucher_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  actor public.user_profiles;
  v public.cash_vouchers;
  created_account public.user_profiles;
  fm_approval public.cash_voucher_approvals;
  current_fm public.user_profiles;
BEGIN
  SELECT * INTO actor FROM public.user_profiles
  WHERE id=auth.uid() AND is_active IS TRUE;
  IF NOT FOUND OR NOT (
      actor.role IN ('ceo','bod','system_admin')
      OR (actor.department='Finance' AND actor.role='manager')
      OR public.jsync_cv_is_finance_ap_v1(actor.id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to download Petty Cash'
      USING ERRCODE='42501';
  END IF;
  SELECT * INTO v FROM public.cash_vouchers WHERE id=p_voucher_id;
  IF NOT FOUND OR v.status<>'closed' THEN
    RAISE EXCEPTION 'Only closed Petty Cash may be downloaded';
  END IF;
  SELECT * INTO fm_approval FROM public.cash_voucher_approvals
  WHERE voucher_id=v.id AND authority='finance_hod';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finance Manager approval is missing';
  END IF;
  SELECT * INTO created_account FROM public.user_profiles WHERE id=v.created_by;
  SELECT * INTO current_fm FROM public.user_profiles WHERE id=fm_approval.approved_by;
  RETURN jsonb_build_object(
    'document_version','JIMS-R11C-PC-V1',
    'voucher',jsonb_build_object(
       'id',v.id, 'cv_number',v.cv_number, 'status',v.status,
       'applicable_department',v.applicable_department,
       'total_amount',v.total_amount, 'form_data',v.form_data,
       'created_at',v.created_at,'submitted_at',v.submitted_at,'closed_at',v.closed_at),
    'created_by',jsonb_build_object(
       'account',COALESCE(created_account.username,'Unknown'),
       'designation',COALESCE(NULLIF(btrim(created_account.staff_designation),''),'AP Finance Executive'),
       'date',v.created_at),
    'approved_by',jsonb_build_object(
       'account',fm_approval.approved_username,
       'designation',COALESCE(
         NULLIF(btrim(fm_approval.approved_designation),''),
         NULLIF(btrim(current_fm.staff_designation),''),
         'Finance Manager'),
       'date',fm_approval.approved_at),
    'generated_at',now()
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.jims_r11c_pc_official_snapshot_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jims_r11c_pc_official_snapshot_v1(uuid) TO authenticated;
