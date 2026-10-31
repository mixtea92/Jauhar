-- JIMS 57D7B9 Final backend role/access preflight, READ-ONLY.
-- Queries only metadata and aggregate role/security indicators; zero writes.
-- PASS validates a policy/source condition, NOT actual authenticated browser access.
-- FINDING requires manual review. No change in this test.
WITH tests AS (
 SELECT 'B9-01'::text id, 'All public tables have RLS'::text test_name, ((SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r')) AS pass
 UNION ALL
 SELECT 'B9-02'::text id, 'No authenticated direct PV update'::text test_name, (NOT has_table_privilege('authenticated','public.payment_vouchers','UPDATE')) AS pass
 UNION ALL
 SELECT 'B9-03'::text id, 'No authenticated direct CV update'::text test_name, (NOT has_table_privilege('authenticated','public.cash_vouchers','UPDATE')) AS pass
 UNION ALL
 SELECT 'B9-04'::text id, 'PV nonexecutive restrictive policy'::text test_name, (EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.payment_vouchers'::regclass AND polname='jauhar_deny_nonexecutive_finance_v1' AND polpermissive=false AND polcmd='*')) AS pass
 UNION ALL
 SELECT 'B9-05'::text id, 'PV Finance segmentation restrictive policy'::text test_name, (EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.payment_vouchers'::regclass AND polname='jims_57c7_ap_finance_segmentation' AND polpermissive=false AND polcmd='r')) AS pass
 UNION ALL
 SELECT 'B9-06'::text id, 'PV approval action nonexecutive restrictive'::text test_name, (EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.pv_approval_actions'::regclass AND polname='jauhar_deny_nonexecutive_finance_v1' AND polpermissive=false)) AS pass
 UNION ALL
 SELECT 'B9-07'::text id, 'Legacy PV Finance Manager authority'::text test_name, (pg_get_functiondef('public.manager_decide_pv(uuid,text,timestamp with time zone,text)'::regprocedure) LIKE '%p.department = ''Finance''%') AS pass
 UNION ALL
 SELECT 'B9-08'::text id, 'Payment Date correction Finance Manager authority'::text test_name, (pg_get_functiondef('public.manager_correct_pv_payment_date(uuid,date,text)'::regprocedure) LIKE '%p.department = ''Finance''%') AS pass
 UNION ALL
 SELECT 'B9-09'::text id, 'PV stage requires active caller'::text test_name, (pg_get_functiondef('public.jauhar_can_stage_act_v1(uuid,text,text)'::regprocedure) LIKE '%p.id=u AND p.is_active%') AS pass
 UNION ALL
 SELECT 'B9-10'::text id, 'HOD stage checks Department'::text test_name, (pg_get_functiondef('public.jauhar_can_stage_act_v1(uuid,text,text)'::regprocedure) LIKE '%p.department=v.origin_department%') AS pass
 UNION ALL
 SELECT 'B9-11'::text id, 'Full payment initiation Finance Executive'::text test_name, (pg_get_functiondef('public.initiate_pv_payment_v1(uuid,uuid,timestamp with time zone)'::regprocedure) LIKE '%p.role=''executive'' AND p.department=''Finance''%') AS pass
 UNION ALL
 SELECT 'B9-12'::text id, 'Full payment completion Finance Executive'::text test_name, (pg_get_functiondef('public.complete_pv_payment_v1(uuid,date,text,text,numeric,timestamp with time zone)'::regprocedure) LIKE '%p.role=''executive'' AND p.department=''Finance''%') AS pass
 UNION ALL
 SELECT 'B9-13'::text id, 'V2 partial payment creation Finance Executive'::text test_name, (pg_get_functiondef('public.jims_v2_create_payment_draft_v1(uuid,numeric,uuid,timestamp with time zone)'::regprocedure) LIKE '%p.role = ''executive'' AND p.department = ''Finance''%') AS pass
 UNION ALL
 SELECT 'B9-14'::text id, 'V2 partial proof requirement'::text test_name, (pg_get_functiondef('public.jims_v2_submit_installment_v1(uuid,text,timestamp with time zone)'::regprocedure) LIKE '%Each installment requires a unique PDF/image initiation proof%') AS pass
 UNION ALL
 SELECT 'B9-15'::text id, 'V2 partial review authority check'::text test_name, (pg_get_functiondef('public.jims_v2_review_installment_v1(uuid,text,text,timestamp with time zone)'::regprocedure) LIKE '%jauhar_can_stage_act_v1(v.id,''finance_manager'',act)%') AS pass
 UNION ALL
 SELECT 'B9-16'::text id, 'V2 settlement requires FM review'::text test_name, (pg_get_functiondef('public.jims_v2_complete_installment_v1(uuid,date,text,text,timestamp with time zone)'::regprocedure) LIKE '%Finance Manager verification required before settlement%') AS pass
 UNION ALL
 SELECT 'B9-17'::text id, 'Petty Cash AP creation gate'::text test_name, (pg_get_functiondef('public.jsync_cv_save_draft_v1(uuid,jsonb)'::regprocedure) LIKE '%jsync_cv_is_finance_ap_v1(a)%') AS pass
 UNION ALL
 SELECT 'B9-18'::text id, 'Petty Cash HOD Department stage'::text test_name, (pg_get_functiondef('public.jsync_cv_approve_many_v1(uuid[],text,text)'::regprocedure) LIKE '%actor.department IS DISTINCT FROM v.applicable_department%') AS pass
 UNION ALL
 SELECT 'B9-19'::text id, 'Petty Cash double authority closure'::text test_name, (pg_get_functiondef('public.jsync_cv_approve_many_v1(uuid[],text,text)'::regprocedure) LIKE '%count(*) FROM public.cash_voucher_approvals ca WHERE ca.voucher_id=vid)=2%') AS pass
 UNION ALL
 SELECT 'B9-20'::text id, 'Delegation manages only Finance CEO BOD'::text test_name, (pg_get_functiondef('public.jauhar_can_manage_pv_delegation_v1()'::regprocedure) LIKE '%p.department=''Finance''%' AND pg_get_functiondef('public.jauhar_can_manage_pv_delegation_v1()'::regprocedure) LIKE '%p.role IN (''ceo'',''bod'')%') AS pass
 UNION ALL
 SELECT 'B9-21'::text id, 'Org editor active System Admin'::text test_name, (pg_get_functiondef('public.jauhar_update_user_organization_v2(uuid,text,text,text,text)'::regprocedure) LIKE '%role=''system_admin'' AND is_active IS TRUE%') AS pass
 UNION ALL
 SELECT 'B9-22'::text id, 'Cost Center editor active System Admin'::text test_name, (pg_get_functiondef('public.jauhar_set_user_cost_center_v1(uuid,text)'::regprocedure) LIKE '%a.role=''system_admin'' AND a.is_active IS TRUE%') AS pass
 UNION ALL
 SELECT 'B9-23'::text id, 'CEO and BOD NULL Departments'::text test_name, (NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE role IN('ceo','bod') AND department IS NOT NULL)) AS pass
 UNION ALL
 SELECT 'B9-24'::text id, 'Approval history export owner-only'::text test_name, (pg_get_functiondef('public.jims_owner_approval_history_export_v1()'::regprocedure) LIKE '%jims_is_system_owner_v1()%') AS pass
 UNION ALL
 SELECT 'B9-25'::text id, 'Five operational storage buckets private'::text test_name, ((SELECT count(*) FROM storage.buckets WHERE id IN('jauhar-pv-invoices','jauhar-pv-jr','jauhar-pv-payment-initiation','jauhar-pv-receipts','jsync-cv-receipts') AND public IS FALSE)=5) AS pass
 UNION ALL
 SELECT 'B9-26'::text id, 'No anon SECURITY DEFINER callable'::text test_name, (NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef AND has_function_privilege('anon',oid,'EXECUTE'))) AS pass
 UNION ALL
 SELECT 'B9-27'::text id, 'Anon cannot TRUNCATE legacy test table'::text test_name, (NOT has_table_privilege('anon','public.jauhar_test','TRUNCATE')) AS pass
)
SELECT id,test_name,CASE WHEN pass THEN 'PASS' ELSE 'FINDING' END result FROM tests ORDER BY id;
