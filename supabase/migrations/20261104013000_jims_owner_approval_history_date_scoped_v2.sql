-- JIMS staging UAT-14F2: Owner Approval History scoped by event date.
-- A max 366-day period and 10,000 combined approval events guard large exports.
-- Preserves legacy v1 and all existing approval privileges/workflows.
CREATE OR REPLACE FUNCTION public.jims_owner_approval_history_export_v2(p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pv jsonb;
  v_pc jsonb;
  v_delegate jsonb;
  v_limit bigint := 10000;
  v_start timestamptz;
  v_end timestamptz;
  v_rows bigint;
BEGIN
  IF NOT public.jims_is_system_owner_v1() THEN
     RAISE EXCEPTION 'Only the designated System Owner can export approval history'
       USING ERRCODE='42501';
  END IF;
  -- Inclusive Malaysia-local calendar days, bounded at database level.
  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RAISE EXCEPTION 'Select Date From and Date To for Approval History export'
      USING ERRCODE='22023';
  END IF;
  IF p_date_to < p_date_from OR p_date_to - p_date_from > 365 THEN
    RAISE EXCEPTION 'Approval History date range must be 1 to 366 days'
      USING ERRCODE='22023';
  END IF;
  v_start := p_date_from::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_end := (p_date_to + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur';
  SELECT
    (SELECT count(*) FROM public.pv_approval_actions
      WHERE created_at >= v_start AND created_at < v_end)
    + (SELECT count(*) FROM public.cash_voucher_approvals
      WHERE approved_at >= v_start AND approved_at < v_end)
    + (SELECT count(*) FROM public.pv_delegation_audit_events
      WHERE created_at >= v_start AND created_at < v_end)
  INTO v_rows;
  IF v_rows > v_limit THEN
    RAISE EXCEPTION 'Approval History has % events in this range (max %). Select a shorter date range',v_rows,v_limit
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
  LEFT JOIN public.user_profiles u ON u.id=a.actor_id
  WHERE a.created_at >= v_start AND a.created_at < v_end;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'cv_number',v.cv_number,'department',v.applicable_department,
      'amount',v.total_amount,'status',v.status,'authority',a.authority,
      'actor',COALESCE(NULLIF(a.approved_username,''),u.username,'Account unavailable'),
      'approval_time',a.approved_at
    ) ORDER BY a.approved_at,a.id),'[]'::jsonb)
  INTO v_pc FROM public.cash_voucher_approvals a
  JOIN public.cash_vouchers v ON v.id=a.voucher_id
  LEFT JOIN public.user_profiles u ON u.id=a.approved_by
  WHERE a.approved_at >= v_start AND a.approved_at < v_end;
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
  LEFT JOIN public.user_profiles de ON de.id=d.delegate_id
  WHERE a.created_at >= v_start AND a.created_at < v_end;

  RETURN jsonb_build_object(
    'export_type','System Owner — JIMS Approval History',
    'generated_at',clock_timestamp(),
    'date_from',p_date_from,'date_to',p_date_to,'event_count',v_rows,
    'pv_approval_history',v_pv,
    'petty_cash_approval_history',v_pc,
    'delegation_approval_history',v_delegate
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.jims_owner_approval_history_export_v2(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jims_owner_approval_history_export_v2(date,date) TO authenticated, service_role;
CREATE INDEX IF NOT EXISTS jims_owner_pv_approval_time_idx ON public.pv_approval_actions(created_at);
CREATE INDEX IF NOT EXISTS jims_owner_pc_approval_time_idx ON public.cash_voucher_approvals(approved_at);
CREATE INDEX IF NOT EXISTS jims_owner_delegation_event_time_idx ON public.pv_delegation_audit_events(created_at);
