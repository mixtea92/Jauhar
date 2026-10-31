-- JIMS 57D7B6 — Sales Department Naming & Authority Compatibility
-- READ-ONLY test. Safe to run on JIMS live database. No writes or mutations.
-- Expected: 10 PASS. Does NOT substitute for authenticated role/browser UAT.
WITH checks AS (
 SELECT 'S01'::text id,'User profile accepts canonical Sales & Marketing'::text label,
 pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='public.user_profiles'::regclass AND conname='user_profiles_department_allowed_chk')) LIKE '%Sales & Marketing%' ok
 UNION ALL SELECT 'S02','PV origin accepts canonical Sales & Marketing',
 pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='public.payment_vouchers'::regclass AND conname='jauhar_origin_department_valid')) LIKE '%Sales & Marketing%'
 UNION ALL SELECT 'S03','System Admin edit normalizes legacy Sales input',
 pg_get_functiondef('public.jauhar_update_user_organization_v2(uuid,text,text,text,text)'::regprocedure) LIKE '%Sales and Marketing%Sales & Marketing%'
 UNION ALL SELECT 'S04','System Admin gate retained',
 pg_get_functiondef('public.jauhar_update_user_organization_v2(uuid,text,text,text,text)'::regprocedure) LIKE '%Only an active System Admin may manage organization fields%'
 UNION ALL SELECT 'S05','Organization edit audit retained',
 pg_get_functiondef('public.jauhar_update_user_organization_v2(uuid,text,text,text,text)'::regprocedure) LIKE '%INSERT INTO public.user_management_audit%'
 UNION ALL SELECT 'S06','HOD authority uses department equality',
 pg_get_functiondef('public.jauhar_can_stage_act_v1(uuid,text,text)'::regprocedure) LIKE '%p.department=v.origin_department%'
 UNION ALL SELECT 'S07','Petty Cash still requires HOD department equality',
 pg_get_functiondef('public.jsync_cv_approve_many_v1(uuid[],text,text)'::regprocedure) LIKE '%actor.department IS DISTINCT FROM v.applicable_department%'
 UNION ALL SELECT 'S08','Delegation still uses exact department scope',
 pg_get_functiondef('public.request_pv_delegation_v1(text,text,text,timestamp with time zone,timestamp with time zone,text[],text,boolean,text)'::regprocedure) LIKE '%principal.department=sc%'
 UNION ALL SELECT 'S09','CEO/BOD existing profiles retain NULL Department',
 (select count(*) from public.user_profiles where role in('ceo','bod') and department is not null)=0
 UNION ALL SELECT 'S10','Anonymous cannot execute public SECURITY DEFINER functions',
 NOT EXISTS(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE'))
)
SELECT id,label,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks ORDER BY id;
