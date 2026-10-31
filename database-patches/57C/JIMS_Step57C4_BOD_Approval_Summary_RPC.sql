-- JIMS Step 57C4 — BOD-only approval summary, zero changes to approval/payment flow.
-- Read-only SECURITY DEFINER RPC restricted to active actual BOD. Shows private
-- organizational metadata by joining privately on the server, NOT exposing
-- the Step57C3 private table to browser. No new access for other roles.
CREATE OR REPLACE FUNCTION public.jims_bod_approval_summary_v1()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $jims57c4$
DECLARE v_actor uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.user_profiles p
    WHERE p.id=v_actor AND p.role='bod' AND p.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Active BOD access required for BOD Approval Summary'
      USING ERRCODE='42501';
  END IF;

  WITH eligible AS (
    SELECT v.id,v.pv_number,v.financial_tier,v.jims_tier_policy_version,
      v.origin_department,v.branch_department,v.payee_name,
      v.payment_type,v.description,v.amount,v.sst_amount,v.status,
      v.created_at,v.updated_at,v.approval_round,
      public.jauhar_can_stage_act_v1(v.id,'bod','approve') AS can_approve,
      public.jauhar_can_stage_act_v1(v.id,'bod','return') AS can_return,
      public.jauhar_can_stage_act_v1(v.id,'bod','reject') AS can_reject
    FROM public.payment_vouchers v
    WHERE v.archived_at IS NULL AND v.status='pending_bod'
  ), active AS (
    SELECT * FROM eligible
    WHERE can_approve OR can_return OR can_reject
    ORDER BY created_at ASC LIMIT 300
  ), detail AS (
    SELECT e.*,m.requester_subdepartment,m.requester_branch,
      m.charge_department,m.charge_subdepartment,m.branch_code,
      m.cost_center,m.budget_code,
      li.purpose,coalesce(li.line_count,0) AS invoice_count,
      (e.financial_tier IN ('T03','T05','T06','T07','T09')) AS jr_required,
      CASE WHEN e.origin_department IS NOT NULL AND e.origin_department <> 'Finance'
        THEN 'bod_decide_department_pv_v2'
      WHEN e.financial_tier IN ('T03','T05','T06','T07','T09')
        THEN 'bod_decide_jr_v1'
      WHEN e.financial_tier='T08'
        THEN 'bod_decide_t08_v1'
      ELSE 'bod_decide_pv' END AS decision_rpc,
      CASE WHEN e.financial_tier NOT IN ('T03','T05','T06','T07','T09')
           OR e.financial_tier IS NULL THEN true
        ELSE EXISTS (
          SELECT 1
          FROM public.pv_jr_meeting_records r
          WHERE r.voucher_id=e.id
            AND r.approval_round=e.approval_round
            AND r.decision_tier='bod'
            AND r.jr_document_id=(
              SELECT j.id FROM public.pv_justification_reports j
              JOIN storage.objects o
                ON o.bucket_id='jauhar-pv-jr' AND o.name=j.storage_path
              WHERE j.voucher_id=e.id
              ORDER BY j.version_num DESC LIMIT 1
            )
        ) END AS jr_meeting_ready
    FROM active e
    LEFT JOIN private.jims_financial_metadata_v1 m
       ON m.source_type='payment_voucher' AND m.source_id=e.id
    LEFT JOIN LATERAL (
      SELECT (array_agg(nullif(btrim(l.description),'') ORDER BY l.line_no))[1] AS purpose,
             count(*) AS line_count
      FROM public.pv_line_items l WHERE l.voucher_id=e.id
    ) li ON true
  )
  SELECT jsonb_build_object(
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'id',d.id,'pv_number',d.pv_number,'financial_tier',d.financial_tier,
      'tier_policy_version',d.jims_tier_policy_version,
      'payee_name',d.payee_name,
      'purpose',coalesce(nullif(d.purpose,''),nullif(d.description,''),nullif(d.payment_type,''),'Not specified'),
      'invoice_count',d.invoice_count,'amount',d.amount,
      'origin_department',d.origin_department,
      'requester_subdepartment',d.requester_subdepartment,
      'requester_branch',d.requester_branch,
      'charge_department',d.charge_department,
      'charge_subdepartment',d.charge_subdepartment,
      'branch',coalesce(d.branch_code,d.branch_department),
      'cost_center',d.cost_center,'budget_code',d.budget_code,
      'created_at',d.created_at,'updated_at',d.updated_at,
      'approval_round',d.approval_round,
      'jr_required',d.jr_required,'jr_meeting_ready',d.jr_meeting_ready,
      'can_approve',d.can_approve,'can_return',d.can_return,'can_reject',d.can_reject,
      'decision_rpc',d.decision_rpc
    ) ORDER BY d.created_at ASC),'[]'::jsonb),
    'limit',300
  ) INTO v_result
  FROM detail d;

  RETURN v_result;
END;
$jims57c4$;

REVOKE ALL ON FUNCTION public.jims_bod_approval_summary_v1()
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_bod_approval_summary_v1()
TO authenticated;
COMMENT ON FUNCTION public.jims_bod_approval_summary_v1() IS
'JIMS 57C4 BOD-only current actionable PV summary. Private cost metadata projected only to active BOD, no direct private schema grants. Decisions still use existing secure RPCs and JR meeting checks.';
