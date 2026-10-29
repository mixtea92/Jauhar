-- JIMS FINANCIAL TIER REVISION 1 (2026-10-29)
-- REV1: T06 <= RM1,000 CEO final; T07 > RM1,000 BOD final.
-- Existing PVs (including 2 fully approved T06/T07) retain LEGACY mapping.
-- No existing PV values, approvals or audit events are modified.
-- Keep all function signatures, auth, RLS, JR requirements, and approval steps intact.

ALTER TABLE public.payment_vouchers
  ADD COLUMN jims_tier_policy_version text;
ALTER TABLE public.payment_vouchers
  ALTER COLUMN jims_tier_policy_version SET DEFAULT 'R1';
ALTER TABLE public.payment_vouchers
  ADD CONSTRAINT jims_tier_policy_version_check
  CHECK (jims_tier_policy_version IS NULL OR jims_tier_policy_version = 'R1');

-- New-policy category checks occur when a new draft is SUBMITTED, not when saved.
-- Thus users can save incomplete drafts, but cannot submit a misclassified tier.
CREATE FUNCTION public.jims_check_tier_rev1_on_submit()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $trigger$
BEGIN
  IF NEW.jims_tier_policy_version IS DISTINCT FROM 'R1'
    OR OLD.status NOT IN ('draft','returned')
    OR NEW.status NOT IN ('pending_hod','pending_ap_finance','pending_manager','pending_finance_manager')
  THEN RETURN NEW; END IF;
  IF (NEW.financial_tier IN ('T02','T03') AND NEW.amount > 10000)
    OR (NEW.financial_tier IN ('T04','T05') AND NEW.amount <= 10000)
    OR (NEW.financial_tier = 'T06' AND NEW.amount > 1000)
    OR (NEW.financial_tier = 'T07' AND NEW.amount <= 1000)
  THEN RAISE EXCEPTION 'PV financial tier does not match approved amount threshold (Revision 1)'; END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER jims_check_tier_rev1_on_submit_trg
BEFORE UPDATE OF status ON public.payment_vouchers
FOR EACH ROW EXECUTE FUNCTION public.jims_check_tier_rev1_on_submit();

-- Precision patches to the TESTED RPC definitions: the only changed
-- branches are T06/T07 final authority and meeting target, plus T02 <=.
-- Each source has a strict expected-match count, otherwise ALL DDL rolls back.

DO $fn_ceo_decide_jr_v1$
DECLARE v_ddl text; v_actual int;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_ddl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='ceo_decide_jr_v1' AND p.prokind='f';
 v_actual := (length(v_ddl)-length(replace(v_ddl,'IF v_pv.financial_tier IN (''T03'', ''T07'') THEN','')))/length('IF v_pv.financial_tier IN (''T03'', ''T07'') THEN');
 IF v_actual <> 2 THEN
  RAISE EXCEPTION 'Unsafe routine drift for ceo_decide_jr_v1, expected 2 matches, found %', v_actual;
 END IF;
 EXECUTE replace(v_ddl, 'IF v_pv.financial_tier IN (''T03'', ''T07'') THEN', 'IF (v_pv.financial_tier = ''T03'' OR (v_pv.financial_tier = ''T06'' AND v_pv.jims_tier_policy_version = ''R1'') OR (v_pv.financial_tier = ''T07'' AND v_pv.jims_tier_policy_version IS NULL)) THEN');
END;
$fn_ceo_decide_jr_v1$;

DO $fn_record_jr_offline_meeting_v1$
DECLARE v_ddl text; v_actual int;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_ddl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='record_jr_offline_meeting_v1' AND p.prokind='f';
 v_actual := (length(v_ddl)-length(replace(v_ddl,'IF v_pv.financial_tier IN (''T03'', ''T07'') THEN','')))/length('IF v_pv.financial_tier IN (''T03'', ''T07'') THEN');
 IF v_actual <> 1 THEN
  RAISE EXCEPTION 'Unsafe routine drift for record_jr_offline_meeting_v1, expected 1 matches, found %', v_actual;
 END IF;
 EXECUTE replace(v_ddl, 'IF v_pv.financial_tier IN (''T03'', ''T07'') THEN', 'IF (v_pv.financial_tier = ''T03'' OR (v_pv.financial_tier = ''T06'' AND v_pv.jims_tier_policy_version = ''R1'') OR (v_pv.financial_tier = ''T07'' AND v_pv.jims_tier_policy_version IS NULL)) THEN');
END;
$fn_record_jr_offline_meeting_v1$;

DO $fn_bod_decide_jr_v1$
DECLARE v_ddl text; v_actual int;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_ddl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='bod_decide_jr_v1' AND p.prokind='f';
 v_actual := (length(v_ddl)-length(replace(v_ddl,'v_pv.financial_tier NOT IN (''T05'', ''T06'', ''T09'')','')))/length('v_pv.financial_tier NOT IN (''T05'', ''T06'', ''T09'')');
 IF v_actual <> 1 THEN
  RAISE EXCEPTION 'Unsafe routine drift for bod_decide_jr_v1, expected 1 matches, found %', v_actual;
 END IF;
 EXECUTE replace(v_ddl, 'v_pv.financial_tier NOT IN (''T05'', ''T06'', ''T09'')', '(v_pv.financial_tier NOT IN (''T05'', ''T06'', ''T07'', ''T09'') OR (v_pv.financial_tier = ''T06'' AND v_pv.jims_tier_policy_version = ''R1'') OR (v_pv.financial_tier = ''T07'' AND v_pv.jims_tier_policy_version IS NULL))');
END;
$fn_bod_decide_jr_v1$;

DO $fn_ceo_decide_department_pv_v2$
DECLARE v_ddl text; v_actual int;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_ddl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='ceo_decide_department_pv_v2' AND p.prokind='f';
 v_actual := (length(v_ddl)-length(replace(v_ddl,'v.financial_tier IN (''T03'',''T04'',''T07'')','')))/length('v.financial_tier IN (''T03'',''T04'',''T07'')');
 IF v_actual <> 1 THEN
  RAISE EXCEPTION 'Unsafe routine drift for ceo_decide_department_pv_v2, expected 1 matches, found %', v_actual;
 END IF;
 EXECUTE replace(v_ddl, 'v.financial_tier IN (''T03'',''T04'',''T07'')', '(v.financial_tier IN (''T03'',''T04'') OR (v.financial_tier = ''T06'' AND v.jims_tier_policy_version = ''R1'') OR (v.financial_tier = ''T07'' AND v.jims_tier_policy_version IS NULL))');
END;
$fn_ceo_decide_department_pv_v2$;

DO $fn_bod_decide_department_pv_v2$
DECLARE v_ddl text; v_actual int;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_ddl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='bod_decide_department_pv_v2' AND p.prokind='f';
 v_actual := (length(v_ddl)-length(replace(v_ddl,'v.financial_tier NOT IN (''T05'',''T06'',''T08'',''T09'')','')))/length('v.financial_tier NOT IN (''T05'',''T06'',''T08'',''T09'')');
 IF v_actual <> 1 THEN
  RAISE EXCEPTION 'Unsafe routine drift for bod_decide_department_pv_v2, expected 1 matches, found %', v_actual;
 END IF;
 EXECUTE replace(v_ddl, 'v.financial_tier NOT IN (''T05'',''T06'',''T08'',''T09'')', '(v.financial_tier NOT IN (''T05'',''T06'',''T07'',''T08'',''T09'') OR (v.financial_tier = ''T06'' AND v.jims_tier_policy_version = ''R1'') OR (v.financial_tier = ''T07'' AND v.jims_tier_policy_version IS NULL))');
END;
$fn_bod_decide_department_pv_v2$;

DO $fn_jauhar_check_department_evidence_v1$
DECLARE v_ddl text; v_actual int;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT v_ddl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='jauhar_check_department_evidence_v1' AND p.prokind='f';
 v_actual := (length(v_ddl)-length(replace(v_ddl,'IF v.financial_tier=''T02'' AND v.amount>=10000','')))/length('IF v.financial_tier=''T02'' AND v.amount>=10000');
 IF v_actual <> 1 THEN
  RAISE EXCEPTION 'Unsafe routine drift for jauhar_check_department_evidence_v1, expected 1 matches, found %', v_actual;
 END IF;
 EXECUTE replace(v_ddl, 'IF v.financial_tier=''T02'' AND v.amount>=10000', 'IF v.financial_tier=''T02'' AND ((v.jims_tier_policy_version=''R1'' AND v.amount>10000) OR (v.jims_tier_policy_version IS NULL AND v.amount>=10000))');
END;
$fn_jauhar_check_department_evidence_v1$;

COMMENT ON COLUMN public.payment_vouchers.jims_tier_policy_version IS
'NULL=legacy tier meaning and authority (prior PVs); R1=2026-10-29 Tier definitions T06 <= 1000 CEO and T07 > 1000 BOD.';
COMMENT ON FUNCTION public.jims_check_tier_rev1_on_submit() IS
'New-tier amount validation on submission only. Existing approved PVs and historical routing untouched.';
