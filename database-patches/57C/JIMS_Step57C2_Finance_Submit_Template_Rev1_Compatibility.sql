-- JIMS Step 57C2 — Finance PV submission supports official Revision 1 (0001).
-- Full rollback if any of the 5 protected submission functions has drifted.
-- No vouchers, payment records, approval decisions, evidence, or audit rows are updated.
-- Preserve all existing submit validations: actor, ownership, JR/invoice proof, amount, tier, rounds.
--
-- Valid pairings:
--   source_template_version = '0000'                         => legacy (unchanged)
--   source_template_version = '0001' AND tier policy = 'R1'  => Revision 1 only
--
-- Not accepted: blank/unknown source revision, or 0001 without approved R1 tier policy.
BEGIN;
DO $jims57c2$
DECLARE
  v_function text;
  v_ddl text;
  v_old text := 'IF v_pv.source_template_version IS DISTINCT FROM ''0000'' THEN';
  v_new text := 'IF NOT (v_pv.source_template_version IS NOT DISTINCT FROM ''0000'' OR (v_pv.source_template_version IS NOT DISTINCT FROM ''0001'' AND v_pv.jims_tier_policy_version IS NOT DISTINCT FROM ''R1'')) THEN';
  v_matches integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_vouchers'
      AND column_name='jims_tier_policy_version'
  ) THEN
    RAISE EXCEPTION 'JIMS Tier Revision 1 migration is required';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
      'submit_finance_t01_t02_v1',
      'submit_finance_t01_t02_v2',
      'submit_finance_t04_v1',
      'submit_finance_t08_v1',
      'submit_finance_jr_v1'
  ]
  LOOP
    SELECT pg_get_functiondef(p.oid)
    INTO STRICT v_ddl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname=v_function
      AND p.prokind='f'
      AND p.pronargs=2
      AND p.prosecdef;

    v_matches := (length(v_ddl)-length(replace(v_ddl,v_old,'')))/length(v_old);
    IF v_matches <> 1 THEN
      RAISE EXCEPTION 'Unsafe function drift in %; expected exactly one legacy revision check, found %', v_function,v_matches;
    END IF;
    IF position('CREATE OR REPLACE FUNCTION public.'||v_function IN v_ddl)=0 THEN
      RAISE EXCEPTION 'Unexpected function definition for %',v_function;
    END IF;

    EXECUTE replace(v_ddl,v_old,v_new);
    RAISE NOTICE 'JIMS Revision 1 template allowed in % with original approval protections',v_function;
  END LOOP;
END;
$jims57c2$;
COMMIT;

-- Read-only post-install verification:
WITH funcs AS (
  SELECT p.proname,pg_get_functiondef(p.oid) AS ddl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('submit_finance_t01_t02_v1','submit_finance_t01_t02_v2',
      'submit_finance_t04_v1','submit_finance_t08_v1','submit_finance_jr_v1')
)
SELECT proname,
  position('v_pv.jims_tier_policy_version IS NOT DISTINCT FROM ''R1''' IN ddl)>0 AS revision_1_guard_present,
  position('v_pv.source_template_version IS NOT DISTINCT FROM ''0000''' IN ddl)>0 AS legacy_revision_preserved
FROM funcs ORDER BY proname;