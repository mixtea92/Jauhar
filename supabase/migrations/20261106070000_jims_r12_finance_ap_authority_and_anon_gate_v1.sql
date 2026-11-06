-- JIMS R12 / STAGING ONLY: enforce AP/Accounting authority in the shared
-- Petty Cash role check used by draft, receipt, submit and official PDF RPCs.
-- This does not change Finance Manager or System Admin privileges.
CREATE OR REPLACE FUNCTION public.jsync_cv_is_finance_ap_v1(a uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT a IS NOT NULL
    AND a = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles p
      WHERE p.id = a
        AND p.is_active IS TRUE
        AND p.role = 'executive'
        AND p.department = 'Finance'
        AND p.subdepartment IN ('Accounts Payable','Accounting')
    );
$function$;

-- An anonymous caller never has an authorized FM delegation.
-- Close this unnecessary SECURITY DEFINER API endpoint to anonymous access.
REVOKE EXECUTE ON FUNCTION public.jims_r11a_can_delegated_fm_plan_v1(uuid)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.jims_r11a_can_delegated_fm_plan_v1(uuid)
  TO authenticated;
