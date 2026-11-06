-- JIMS R12 / STAGING ONLY:
-- The SECURITY DEFINER PV Unified History RPC must deny Finance AR users
-- even when the voucher is fully approved. Underlying PV/PC workflows remain
-- unchanged; audit data is retained.
DO $migration$
DECLARE
  source_sql text;
  prior_gate text := 'IF v_staff.role = ''non_executive'' THEN';
  restricted_gate text :=
    'IF v_staff.role = ''non_executive'' OR (v_staff.role = ''executive'' ' ||
    'AND v_staff.department = ''Finance'' ' ||
    'AND coalesce(v_staff.subdepartment, '''') NOT IN (''Accounts Payable'', ''Accounting'')) THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO source_sql
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='jauhar_pv_unified_history_v1'
    AND p.prokind='f';
  IF source_sql IS NULL THEN
    RAISE EXCEPTION 'R12 baseline missing: PV Unified History RPC';
  END IF;
  IF strpos(source_sql, restricted_gate)>0 THEN
    RETURN; -- idempotent on already-patched staging
  END IF;
  IF (length(source_sql)-length(replace(source_sql,prior_gate,'')))<>length(prior_gate) THEN
    RAISE EXCEPTION 'R12 baseline changed: expected one original role guard';
  END IF;
  EXECUTE replace(source_sql, prior_gate, restricted_gate);
END;
$migration$;
