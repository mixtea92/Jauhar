-- JIMS 57D7B7 — Finance-only Payment Date correction: READ-ONLY verification.
-- Zero business record mutation. Results inspect source, grants and role predicates.
-- They do NOT replace authenticated RPC negative tests in an isolated environment.
WITH f AS (
 SELECT pg_get_functiondef(p.oid) AS body,p.prosecdef,p.prorettype::regtype::text AS return_type,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_exec,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec
 FROM pg_proc p WHERE p.oid='public.manager_correct_pv_payment_date(uuid,date,text)'::regprocedure
), checks AS (
 SELECT 'M01'::text id,'Requires active Manager'::text check_name,
 body LIKE '%p.role = ''manager''%' AND body LIKE '%p.is_active = TRUE%' AS ok FROM f
 UNION ALL SELECT 'M02','Requires Finance Department',
 body LIKE '%p.department = ''Finance''%' FROM f
 UNION ALL SELECT 'M03','Anonymous RPC access blocked',NOT anon_exec FROM f
 UNION ALL SELECT 'M04','Authenticated RPC access retained',authenticated_exec FROM f
 UNION ALL SELECT 'M05','SECURITY DEFINER and pinned search_path retained',
 prosecdef AND body LIKE '%SET search_path TO ''''%' FROM f
 UNION ALL SELECT 'M06','Reason mandatory and bounded',
 body LIKE '%v_reason IS NULL OR LENGTH(v_reason) > 1000%' FROM f
 UNION ALL SELECT 'M07','Only paid and fully approved PV can be corrected',
 body LIKE '%v_pv.status <> ''fully_approved'' OR v_pv.payment_status <> ''paid''%' FROM f
 UNION ALL SELECT 'M08','Correction date bounded by approval and today',
 body LIKE '%p_payment_date > v_local_today%' AND body LIKE '%p_payment_date < (v_pv.final_approval_date AT TIME ZONE ''Asia/Kuala_Lumpur'')::date%' FROM f
 UNION ALL SELECT 'M09','Change audit recorded',
 body LIKE '%INSERT INTO public.pv_audit_events%' AND body LIKE '%manager_correct_payment_date%' FROM f
 UNION ALL SELECT 'M10','Return contract preserved',return_type='public.payment_vouchers' OR return_type='payment_vouchers' FROM f
 UNION ALL SELECT 'M11','Finance Manager passes role and department predicate',
 EXISTS(SELECT 1 FROM public.user_profiles WHERE is_active AND role='manager' AND department='Finance')
 UNION ALL SELECT 'M12','Operation Manager is excluded by new Department predicate',
 EXISTS(SELECT 1 FROM public.user_profiles WHERE is_active AND role='manager' AND department='Operation')
 AND EXISTS(SELECT 1 FROM f WHERE body LIKE '%p.department = ''Finance''%')
)
SELECT id,check_name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END result FROM checks ORDER BY id;