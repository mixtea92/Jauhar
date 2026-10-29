-- JIMS STEP 57B6 — Fix 405 / SQLSTATE 25006 for Finance Manager V2 queue.
-- Root cause verified in Supabase API logs: PostgREST invokes the STABLE RPC
-- in a read-only transaction, while its existing approval authority check
-- takes a SELECT ... FOR SHARE row-lock.
--
-- Change ONLY the function's volatility classification to VOLATILE.
-- The function BODY, SECURITY DEFINER, access grants, queue filters,
-- payment amounts and statuses are unchanged.
DO $guard$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'jims_v2_my_fm_review_queue_v1'
     AND p.pronargs = 0 AND p.prosecdef
     AND p.provolatile IN ('s','v')
 ) THEN
   RAISE EXCEPTION 'Required secured 57B4 queue function not found';
 END IF;
END $guard$;

ALTER FUNCTION public.jims_v2_my_fm_review_queue_v1() VOLATILE;

COMMENT ON FUNCTION public.jims_v2_my_fm_review_queue_v1() IS
  '57B6: VOLATILE because current Finance Manager authority RPC checks active delegations using row locks. Callable via PostgREST POST. Remains server-authorized and read-only for business data.';

NOTIFY pgrst, 'reload schema';