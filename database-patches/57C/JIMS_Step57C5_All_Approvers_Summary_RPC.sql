-- JIMS STEP57C5 — Actual Approver Summary: HOD, Finance Manager, CEO, BOD.
-- Pure read-only RPC. No role changes, approval shortcut privileges, invoice edits,
-- PV numbering changes, payment changes, or private metadata grants.
-- Only active approvers, current status and current ACTUAL authority.
CREATE FUNCTION public.jims_actual_approver_summary_v1()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $jims57c5$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_department text;
  v_result jsonb;
BEGIN
  SELECT role,department INTO v_role,v_department
  FROM public.user_profiles
  WHERE id=v_actor AND is_active IS TRUE;
  IF NOT FOUND OR NOT (
    v_role IN ('ceo','bod')
    OR (v_role='manager' AND v_department IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Active HOD, Finance Manager, CEO or BOD access required'
      USING ERRCODE='42501';
  END IF;

  WITH candidates AS (
    SELECT v.id,v.pv_number,v.financial_tier,v.jims_tier_policy_version,
           v.origin_department,v.branch_department,v.payee_name,
           v.description,v.payment_type,v.amount,v.status,v.created_at,
           v.updated_at,v.approval_round,
           CASE v.status
             WHEN 'pending_hod' THEN 'hod'
             WHEN 'pending_finance_manager' THEN 'finance_manager'
             WHEN 'pending_manager' THEN 'legacy_manager'
             WHEN 'pending_ceo' THEN 'ceo'
             WHEN 'pending_bod' THEN 'bod'
           END AS authority
    FROM public.payment_vouchers v
    WHERE v.archived_at IS NULL
      AND v.status IN ('pending_hod','pending_finance_manager',
                       'pending_manager','pending_ceo','pending_bod')
  ), eligible AS (
    SELECT v.*,
      CASE
        WHEN v.authority='legacy_manager' THEN true
        ELSE public.jauhar_can_stage_act_v1(v.id,v.authority,'approve')
      END AS can_approve,
      CASE
        WHEN v.authority='legacy_manager' THEN true
        ELSE public.jauhar_can_stage_act_v1(v.id,v.authority,'return')
      END AS can_return,
      CASE
        WHEN v.authority='legacy_manager' THEN true
        ELSE public.jauhar_can_stage_act_v1(v.id,v.authority,'reject')
      END AS can_reject
    FROM candidates v
    WHERE
      (v_role='manager' AND v_department<>'Finance'
         AND v.authority='hod' AND v.origin_department=v_department)
      OR (v_role='manager' AND v_department='Finance'
         AND v.authority IN ('finance_manager','legacy_manager'))
      OR (v_role='ceo' AND v.authority='ceo')
      OR (v_role='bod' AND v.authority='bod')
  ), allowed AS (
    SELECT v.*
    FROM eligible v
    WHERE (v.can_approve OR v.can_return OR v.can_reject)
      AND (v.authority='legacy_manager'
        OR public.jauhar_active_authority_grant_v1(v.id,v.authority) IS NULL)
      AND (v.authority<>'legacy_manager' OR
        (v_role='manager' AND v_department='Finance'
         AND NOT EXISTS (
           SELECT 1 FROM public.payment_vouchers k
           WHERE k.id=v.id AND k.created_by=v_actor
         )))
    ORDER BY v.created_at ASC
    LIMIT 300
  ), details AS (
    SELECT v.*,
       m.requester_subdepartment,m.requester_branch,
       m.charge_department,m.charge_subdepartment,
       m.branch_code,m.cost_center,m.budget_code,
       COALESCE(NULLIF(btrim(l.description),''),NULLIF(btrim(v.description),''),
                NULLIF(btrim(v.payment_type),''),'Not specified') AS purpose,
       v.financial_tier IN ('T03','T05','T06','T07','T09') AS jr_required,
       CASE
         WHEN v.authority='ceo' AND (
           v.financial_tier IN ('T03','T04')
           OR (v.financial_tier='T06' AND v.jims_tier_policy_version='R1')
           OR (v.financial_tier='T07' AND v.jims_tier_policy_version IS NULL)
         ) THEN true
         WHEN v.authority='bod' THEN true
         WHEN v.authority='finance_manager' AND v.financial_tier IN ('T01','T02')
           THEN true
         ELSE false
       END AS final_authority,
       CASE
        WHEN v.authority='hod' THEN 'hod_decide_department_pv_v1'
        WHEN v.authority='legacy_manager' THEN 'manager_decide_pv'
        WHEN v.authority='finance_manager' AND v.origin_department<>'Finance'
          THEN 'finance_manager_decide_department_pv_v2'
        WHEN v.authority='finance_manager' AND v.financial_tier IN ('T03','T05','T06','T07','T09')
          THEN 'finance_manager_decide_jr_v1'
        WHEN v.authority='finance_manager' AND v.financial_tier='T08'
          THEN 'finance_manager_decide_t08_v1'
        WHEN v.authority='finance_manager' AND v.financial_tier='T04'
          THEN 'finance_manager_decide_t04_v1'
        WHEN v.authority='finance_manager' AND v.financial_tier IN ('T01','T02')
          THEN 'finance_manager_decide_t01_t02_v1'
        WHEN v.authority='ceo' AND v.origin_department<>'Finance'
          THEN 'ceo_decide_department_pv_v2'
        WHEN v.authority='ceo' AND v.financial_tier IN ('T03','T05','T06','T07','T09')
          THEN 'ceo_decide_jr_v1'
        WHEN v.authority='ceo' AND v.financial_tier='T08'
          THEN 'ceo_decide_t08_v1'
        WHEN v.authority='ceo' AND v.financial_tier='T04'
          THEN 'ceo_decide_t04_v1'
        WHEN v.authority='ceo' THEN 'ceo_decide_pv'
        WHEN v.authority='bod' AND v.origin_department<>'Finance'
          THEN 'bod_decide_department_pv_v2'
        WHEN v.authority='bod' AND v.financial_tier IN ('T03','T05','T06','T07','T09')
          THEN 'bod_decide_jr_v1'
        WHEN v.authority='bod' AND v.financial_tier='T08'
          THEN 'bod_decide_t08_v1'
        WHEN v.authority='bod' THEN 'bod_decide_pv'
       END AS decision_rpc
    FROM allowed v
    LEFT JOIN private.jims_financial_metadata_v1 m
      ON m.source_type='payment_voucher' AND m.source_id=v.id
    LEFT JOIN LATERAL (
      SELECT description
      FROM public.pv_line_items li
      WHERE li.voucher_id=v.id
      ORDER BY li.line_no LIMIT 1
    ) l ON true
  ), ready AS (
    SELECT d.*,
      (d.jr_required AND d.final_authority) AS jr_meeting_required,
      CASE
        WHEN NOT (d.jr_required AND d.final_authority) THEN true
        ELSE EXISTS (
          SELECT 1 FROM public.pv_jr_meeting_records r
          WHERE r.voucher_id=d.id
            AND r.approval_round=d.approval_round
            AND r.decision_tier=d.authority
            AND r.jr_document_id = (
              SELECT j.id
              FROM public.pv_justification_reports j
              JOIN storage.objects o
                ON o.bucket_id='jauhar-pv-jr' AND o.name=j.storage_path
              WHERE j.voucher_id=d.id
              ORDER BY j.version_num DESC LIMIT 1
            )
        )
      END AS jr_meeting_ready,
      CASE
        WHEN d.authority='hod' THEN 'pending_ap_finance'
        WHEN d.authority='legacy_manager' THEN 'pending_ceo'
        WHEN d.authority='finance_manager' AND d.financial_tier IN ('T01','T02')
          THEN 'fully_approved'
        WHEN d.authority='finance_manager' THEN 'pending_ceo'
        WHEN d.authority='bod' THEN 'fully_approved'
        WHEN d.authority='ceo' AND (
          d.financial_tier IN ('T03','T04')
          OR (d.financial_tier='T06' AND d.jims_tier_policy_version='R1')
          OR (d.financial_tier='T07' AND d.jims_tier_policy_version IS NULL)
        ) THEN 'fully_approved'
        WHEN d.authority='ceo' THEN 'pending_bod'
      END AS approved_next_status
    FROM details d
  )
  SELECT jsonb_build_object(
    'rows',COALESCE(jsonb_agg(
      jsonb_build_object(
       'id',r.id,'pv_number',r.pv_number,'tier',r.financial_tier,
       'authority',r.authority,'origin_department',r.origin_department,
       'requester_subdepartment',r.requester_subdepartment,
       'charge_department',r.charge_department,
       'charge_subdepartment',r.charge_subdepartment,
       'branch',COALESCE(r.branch_code,r.branch_department),
       'cost_center',r.cost_center,'budget_code',r.budget_code,
       'payee_name',r.payee_name,'purpose',r.purpose,'amount',r.amount,
       'created_at',r.created_at,'updated_at',r.updated_at,
       'approval_round',r.approval_round,
       'decision_rpc',r.decision_rpc,
       'approved_next_status',r.approved_next_status,
       'final_authority',r.final_authority,
       'can_approve',r.can_approve,'can_return',r.can_return,'can_reject',r.can_reject,
       'jr_required',r.jr_required,
       'jr_meeting_required',r.jr_meeting_required,
       'jr_meeting_ready',r.jr_meeting_ready
      ) ORDER BY r.created_at ASC
    ),'[]'::jsonb),
    'limit',300,
    'authority',CASE WHEN v_role='manager' AND v_department='Finance' THEN 'Finance Manager'
       WHEN v_role='manager' THEN 'HOD'
       WHEN v_role='ceo' THEN 'CEO'
       WHEN v_role='bod' THEN 'BOD' END
  ) INTO v_result FROM ready r;
  RETURN v_result;
END;
$jims57c5$;

REVOKE ALL ON FUNCTION public.jims_actual_approver_summary_v1()
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_actual_approver_summary_v1()
TO authenticated;
COMMENT ON FUNCTION public.jims_actual_approver_summary_v1() IS
'Step57C5 read-only HOD/FM/CEO/BOD ACTUAL authority summary. Uses private metadata and pre-existing row-specific approval authorization. No delegated authority impersonation.';

-- Security: no grants to read internal background metadata or payment information
-- beyond user-authorized projected summary rows. Existing approval RPCs unchanged.
