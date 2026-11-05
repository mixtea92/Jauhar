-- STAGING R11A-01: evidence controls follow the already-moved R10
-- Payment Process review stage, including scoped FM 'approve' delegates.
-- No relaxation of file path format, owner path, or evidence verification.

ALTER POLICY jims_due_evidence_fm_insert ON storage.objects
WITH CHECK (
  bucket_id='jauhar-pv-due-evidence'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg|webp)$'
  AND split_part(name,'/',2)=auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.payment_vouchers v
    WHERE v.id::text=split_part(objects.name,'/',1)
      AND v.status='fully_approved'
      AND v.archived_at IS NULL
      AND v.payment_status IN ('pending_payment','payment_initiated')
      AND public.jauhar_can_stage_act_v1(v.id,'finance_manager','approve')
      AND (
        EXISTS (
          SELECT 1 FROM public.user_profiles p
          WHERE p.id=auth.uid() AND p.is_active
            AND p.role='manager' AND p.department='Finance'
        )
        OR public.jims_r11a_can_delegated_fm_plan_v1(v.id)
      )
  )
);

-- Evidence files remain read-only to the former FM, delegated approver,
-- CEO/BOD, System Admin and allowed AP creator. The delegated exception
-- does not work outside approved, currently actionable FM review.
DO $migration$
DECLARE
  v_def text;
  v_old text:=$old$
   AND ((usr.role='manager' AND usr.department='Finance')
   OR usr.role IN ('ceo','bod','system_admin')
$old$;
  v_new text:=$new$
   AND ((usr.role='manager' AND usr.department='Finance')
   OR public.jims_r11a_can_delegated_fm_plan_v1(v.id)
   OR usr.role IN ('ceo','bod','system_admin')
$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND p.proname='jims_57d8_can_read_due_file_v1';
  IF v_def IS NULL OR strpos(v_def,v_old)=0
     THEN RAISE EXCEPTION 'R11A-01: unexpected due evidence read baseline'; END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$migration$;
