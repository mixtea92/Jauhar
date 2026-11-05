-- JIMS STAGING R11C security hotfix: Supabase grants some functions to anon by default.
-- Prevent unauthenticated direct execution of approval and official PDF RPCs.
REVOKE EXECUTE ON FUNCTION public.jims_r11c_pc_finance_approve_v1(uuid[]) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.jims_r11c_pc_official_snapshot_v1(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.jims_r11c_pc_finance_approve_v1(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_r11c_pc_official_snapshot_v1(uuid) TO authenticated;
