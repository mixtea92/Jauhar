-- JIMS 57D7B8: Legacy PV Finance Manager approval, READ-ONLY regression.
-- SELECT only. Source/predicate checks are NOT authenticated negative-RPC tests.
WITH f AS (
 SELECT pg_get_functiondef(p.oid) body,p.prosecdef AS definer,
        pg_get_function_result(p.oid) result_type,
        has_function_privilege('authenticated',p.oid,'EXECUTE') auth_exec,
        has_function_privilege('anon',p.oid,'EXECUTE') anon_exec
 FROM pg_proc p
 WHERE p.oid='public.manager_decide_pv(uuid,text,timestamp with time zone,text)'::regprocedure
),
checks AS (
 SELECT 'B8-01'::text id,'Finance Manager active-role authorization'::text title,
  body LIKE '%p.role = ''manager''%p.department = ''Finance''%p.is_active = TRUE%' ok FROM f
 UNION ALL SELECT 'B8-02','Anonymous function access denied',NOT anon_exec FROM f
 UNION ALL SELECT 'B8-03','Authenticated RPC EXECUTE preserved',auth_exec FROM f
 UNION ALL SELECT 'B8-04','SECURITY DEFINER + search_path pinned',
   definer AND body LIKE '%SET search_path TO ''''%' FROM f
 UNION ALL SELECT 'B8-05','Only pending_manager vouchers eligible',
   body LIKE '%v_pv.status <> ''pending_manager''%' FROM f
 UNION ALL SELECT 'B8-06','Optimistic concurrency lock retained',
   body LIKE '%FOR UPDATE%' AND body LIKE '%v_pv.updated_at IS DISTINCT FROM p_expected_updated_at%' FROM f
 UNION ALL SELECT 'B8-07','Executive first-tier verification required',
   body LIKE '%a.tier = ''executive''%' AND body LIKE '%a.action = ''verify''%' FROM f
 UNION ALL SELECT 'B8-08','Duplicate Manager decision blocked',
   body LIKE '%a.tier = ''manager''%' AND body LIKE '%already has a Manager decision%' FROM f
 UNION ALL SELECT 'B8-09','Approve, Return, Reject options preserved',
   body LIKE '%''approve'', ''return'', ''reject''%' FROM f
 UNION ALL SELECT 'B8-10','Return/Reject remarks required and length bounded',
   body LIKE '%v_decision IN (''return'', ''reject'') AND v_remarks IS NULL%'
   AND body LIKE '%length(coalesce(v_remarks, '''')) > 2000%' FROM f
 UNION ALL SELECT 'B8-11','All three legacy state transitions preserved',
   body LIKE '%''approve'' THEN ''pending_ceo''%'
   AND body LIKE '%''return''  THEN ''returned''%'
   AND body LIKE '%''reject''  THEN ''rejected''%' FROM f
 UNION ALL SELECT 'B8-12','Approval and audit histories persisted',
   body LIKE '%INSERT INTO public.pv_approval_actions%'
   AND body LIKE '%INSERT INTO public.pv_audit_events%' FROM f
 UNION ALL SELECT 'B8-13','Legacy function output contract unchanged',
   result_type='payment_vouchers' FROM f
 UNION ALL SELECT 'B8-14','No tiered PV may enter legacy approval path',
   pg_get_functiondef('public.pv_prevent_financial_tier_legacy_route()'::regprocedure)
   LIKE '%NEW.financial_tier IS NOT NULL%NEW.status = ''pending_manager''%' 
 UNION ALL SELECT 'B8-15','Non-Finance Manager cannot satisfy required Department predicate',
   EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.is_active AND p.role='manager' AND p.department <> 'Finance')
   AND EXISTS(SELECT 1 FROM f WHERE body LIKE '%AND p.department = ''Finance''%')
)
SELECT id,title,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END result FROM checks ORDER BY id;