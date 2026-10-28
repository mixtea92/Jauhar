-- JSYNC Cash Voucher Step 48K: repair receipt Storage RLS helper permission.
-- Root cause from storage_logs at 2026-10-28 12:01-12:02 UTC:
-- permission denied for function jsync_cv_is_finance_ap_v1.
-- Minimal CV-only fix. PV, Delegation, Cash Voucher approval flow untouched.
--
-- Restrict the callable helper to the currently authenticated account, so
-- granting permission to authenticated cannot be used to probe other users.
CREATE OR REPLACE FUNCTION public.jsync_cv_is_finance_ap_v1(a uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT
    a IS NOT NULL
    AND a = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles p
      WHERE p.id = a
        AND p.is_active IS TRUE
        AND p.role = 'executive'
        AND p.department = 'Finance'
    );
$fn$;
REVOKE ALL ON FUNCTION public.jsync_cv_is_finance_ap_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsync_cv_is_finance_ap_v1(uuid)
  TO authenticated;
