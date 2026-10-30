-- JIMS 57C6 — SYSTEM OWNER ONLY: export approval history (XLSX via frontend).
-- This migration does not alter existing PV / PC approval, payments or RLS.
-- Explicit OWNER ACCOUNT allowlist, not role-only export gate.
CREATE TABLE IF NOT EXISTS private.jims_system_owner_export_acl_v1(
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  designation text NOT NULL DEFAULT 'system_owner_export'
);
REVOKE ALL ON TABLE private.jims_system_owner_export_acl_v1 FROM PUBLIC, anon,authenticated;

-- One-time initialization only when there is exactly one ACTIVE System Admin.
-- No other admin automatically inherits this owner-only permission.
INSERT INTO private.jims_system_owner_export_acl_v1(user_id)
SELECT p.id FROM public.user_profiles p
WHERE p.role='system_admin' AND p.is_active IS TRUE
  AND (SELECT count(*) FROM public.user_profiles
      WHERE role='system_admin' AND is_active IS TRUE)=1
ON CONFLICT(user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.jims_is_system_owner_v1()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path TO ''
AS $owner$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
   SELECT 1 FROM private.jims_system_owner_export_acl_v1 owner_access
   JOIN public.user_profiles p ON p.id=owner_access.user_id
   WHERE owner_access.user_id=auth.uid()
     AND p.role='system_admin' AND p.is_active IS TRUE
 );
$owner$;
REVOKE ALL ON FUNCTION public.jims_is_system_owner_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_is_system_owner_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.jims_owner_approval_history_export_v1()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $approval$
DECLARE
  v_pv jsonb;
  v_pc jsonb;
  v_delegate jsonb;
  v_limit bigint := 20000;
BEGIN
  IF NOT public.jims_is_system_owner_v1() THEN
     RAISE EXCEPTION 'Only the designated System Owner can export approval history'
       USING ERRCODE='42501';
  END IF;
  -- Fail closed if history exceeds a workbook limit; never silently truncate.
  IF (SELECT count(*) FROM public.pv_approval_actions) > v_limit
     OR (SELECT count(*) FROM public.cash_voucher_approvals) > v_limit
     OR (SELECT count(*) FROM public.pv_delegation_audit_events) > v_limit THEN
    RAISE EXCEPTION 'Approval History export exceeds limit; use a date-scoped report'
      USING ERRCODE='54000';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'pv_number',v.pv_number,'financial_tier',v.financial_tier,
      'tier_policy_version',v.jims_tier_policy_version,
      'branch',v.branch_department,'department',v.origin_department,
      'payee',v.payee_name,'amount',v.amount,
      'round',a.approval_round,'authority',a.tier,'action',a.action,
      'actor',COALESCE(u.username,'Account unavailable'),
      'remarks',a.remarks,'event_time',a.created_at
    ) ORDER BY a.created_at,a.id),'[]'::jsonb)
  INTO v_pv FROM public.pv_approval_actions a
  JOIN public.payment_vouchers v ON v.id=a.voucher_id
  LEFT JOIN public.user_profiles u ON u.id=a.actor_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'cv_number',v.cv_number,'department',v.applicable_department,
      'amount',v.total_amount,'status',v.status,'authority',a.authority,
      'actor',COALESCE(NULLIF(a.approved_username,''),u.username,'Account unavailable'),
      'approval_time',a.approved_at
    ) ORDER BY a.approved_at,a.id),'[]'::jsonb)
  INTO v_pc FROM public.cash_voucher_approvals a
  JOIN public.cash_vouchers v ON v.id=a.voucher_id
  LEFT JOIN public.user_profiles u ON u.id=a.approved_by;
  -- Never return signature_png or private storage paths.

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'action',a.action,'authority',d.authority,'department',d.department,
      'delegation_status',d.status,
      'actor',COALESCE(u.username,'Account unavailable'),
      'principal',COALESCE(pr.username,'Account unavailable'),
      'delegate',COALESCE(de.username,'Account unavailable'),
      'details',a.details,'event_time',a.created_at
    ) ORDER BY a.created_at,a.id),'[]'::jsonb)
  INTO v_delegate FROM public.pv_delegation_audit_events a
  LEFT JOIN public.pv_authority_delegations d ON d.id=a.delegation_id
  LEFT JOIN public.user_profiles u ON u.id=a.actor_id
  LEFT JOIN public.user_profiles pr ON pr.id=d.principal_id
  LEFT JOIN public.user_profiles de ON de.id=d.delegate_id;

  RETURN jsonb_build_object(
    'export_type','System Owner — JIMS Approval History',
    'generated_at',clock_timestamp(),
    'pv_approval_history',v_pv,
    'petty_cash_approval_history',v_pc,
    'delegation_approval_history',v_delegate
  );
END;
$approval$;
REVOKE ALL ON FUNCTION public.jims_owner_approval_history_export_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_owner_approval_history_export_v1() TO authenticated;
COMMENT ON FUNCTION public.jims_owner_approval_history_export_v1()
 IS 'Owner-only full approval audit export, including PV, Petty Cash, Delegation. Does not include signed image bytes. All nonowners denied even if they know endpoint.';
