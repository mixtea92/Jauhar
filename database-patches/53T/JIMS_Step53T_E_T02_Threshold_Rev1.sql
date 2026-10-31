-- Preserve legacy T02 < RM10k; Rev1 T02 <= RM10k.
DO $t02fix$
DECLARE fn text; hits int;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='submit_finance_t01_t02_v2' AND p.prokind='f';
 hits:=(length(fn)-length(replace(fn,'IF v_pv.financial_tier = ''T02'' AND v_pv.amount >= 10000 THEN','')))/length('IF v_pv.financial_tier = ''T02'' AND v_pv.amount >= 10000 THEN');
 IF hits <> 1 THEN RAISE EXCEPTION 'T02 patch drift: expected 1 exact guard, found %',hits; END IF;
 EXECUTE replace(fn,'IF v_pv.financial_tier = ''T02'' AND v_pv.amount >= 10000 THEN','IF v_pv.financial_tier = ''T02'' AND ((v_pv.jims_tier_policy_version = ''R1'' AND v_pv.amount > 10000) OR (v_pv.jims_tier_policy_version IS NULL AND v_pv.amount >= 10000)) THEN');
END;
$t02fix$;
