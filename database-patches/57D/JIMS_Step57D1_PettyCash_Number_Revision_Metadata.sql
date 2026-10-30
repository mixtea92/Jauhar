-- JIMS STEP 57D1 — Petty Cash numbering + allocation metadata.
-- FORMAT: PC/RV01/MMYY/0001. MMYY is Malaysia-local creation month.
-- Revision belongs to system-issued numbering configuration. Revision change
-- affects ONLY NEW Petty Cash records; previously issued PC/CV are immutable.
-- Counter is per MMYY, independent of revision; it resets every new month.
-- Existing CV-YYYY-NNNNNN records remain fully intact.
-- Data migration: metadata stays in the existing private.jims_financial_metadata_v1.

CREATE TABLE IF NOT EXISTS private.jims_pc_number_config_v1 (
 id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
 current_revision smallint NOT NULL DEFAULT 1
    CHECK (current_revision BETWEEN 1 AND 99),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES public.user_profiles(id)
);
INSERT INTO private.jims_pc_number_config_v1(id,current_revision)
VALUES(1,1) ON CONFLICT(id) DO NOTHING;
REVOKE ALL ON private.jims_pc_number_config_v1 FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS private.jims_pc_number_counters_v1 (
 period_mmyy text PRIMARY KEY
   CHECK (period_mmyy ~ '^(0[1-9]|1[0-2])[0-9]{2}$'),
 last_number integer NOT NULL CHECK (last_number BETWEEN 1 AND 9999)
);
REVOKE ALL ON private.jims_pc_number_counters_v1 FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS private.jims_pc_revision_audit_v1 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 previous_revision smallint NOT NULL,
 next_revision smallint NOT NULL,
 reason text NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON private.jims_pc_revision_audit_v1 FROM PUBLIC,anon,authenticated;

-- Turn off historical CV global sequence default. The new PC number is ALWAYS
-- issued in a BEFORE INSERT trigger. Legacy sequence itself is not deleted.
ALTER TABLE public.cash_vouchers ALTER COLUMN cv_number DROP DEFAULT;

CREATE OR REPLACE FUNCTION private.jims_pc_issue_number_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $pc_number$
DECLARE
 v_period text;
 v_revision integer;
 v_next integer;
BEGIN
 IF new.cv_number IS NOT NULL THEN
   RAISE EXCEPTION 'Petty Cash number is system-generated; manual numbers are not allowed'
     USING ERRCODE='42501';
 END IF;
 SELECT current_revision INTO v_revision
 FROM private.jims_pc_number_config_v1 WHERE id=1;
 IF v_revision IS NULL THEN
   RAISE EXCEPTION 'Petty Cash revision not configured';
 END IF;
 v_period:=to_char(current_timestamp AT TIME ZONE 'Asia/Kuala_Lumpur','MMYY');
 INSERT INTO private.jims_pc_number_counters_v1(period_mmyy,last_number)
 VALUES(v_period,1)
 ON CONFLICT(period_mmyy) DO UPDATE
   SET last_number=private.jims_pc_number_counters_v1.last_number+1
 RETURNING last_number INTO v_next;
 IF v_next>9999 THEN
   RAISE EXCEPTION 'Petty Cash numbering capacity reached for month %',v_period
     USING ERRCODE='22003';
 END IF;
 NEW.cv_number:='PC/RV'||lpad(v_revision::text,2,'0')||'/'||
    v_period||'/'||lpad(v_next::text,4,'0');
 RETURN NEW;
END;
$pc_number$;
REVOKE ALL ON FUNCTION private.jims_pc_issue_number_v1() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS jims_57d1_pc_issue_number_trg ON public.cash_vouchers;
CREATE TRIGGER jims_57d1_pc_issue_number_trg
BEFORE INSERT ON public.cash_vouchers FOR EACH ROW
EXECUTE FUNCTION private.jims_pc_issue_number_v1();

CREATE OR REPLACE FUNCTION private.jims_pc_number_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $immutable$
BEGIN
 IF NEW.cv_number IS DISTINCT FROM OLD.cv_number THEN
  RAISE EXCEPTION 'Petty Cash running number cannot be edited after issuance'
    USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$immutable$;
REVOKE ALL ON FUNCTION private.jims_pc_number_immutable_v1() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS jims_57d1_pc_immutable_trg ON public.cash_vouchers;
CREATE TRIGGER jims_57d1_pc_immutable_trg
BEFORE UPDATE ON public.cash_vouchers
FOR EACH ROW EXECUTE FUNCTION private.jims_pc_number_immutable_v1();

CREATE UNIQUE INDEX IF NOT EXISTS jims_57d1_pc_unique_number
ON public.cash_vouchers(cv_number);

-- Version bump is a system-configuration task only, not a financial approval.
-- Must move RV01 -> RV02 -> RV03; no reset/downgrade. Already issued docs fixed.
CREATE OR REPLACE FUNCTION public.jims_pc_set_next_revision_v1(
 p_next_revision integer,p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $revision$
DECLARE v_old integer; v_actor uuid:=auth.uid(); v_new text;
BEGIN
 IF NOT private.is_active_system_admin() THEN
   RAISE EXCEPTION 'Only active System Admin can change PC numbering revision'
     USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(p_reason,'')))<8 OR length(p_reason)>500 THEN
   RAISE EXCEPTION 'Give a reason (8–500 characters) for changing PC revision'
     USING ERRCODE='22023';
 END IF;
 SELECT current_revision INTO v_old
 FROM private.jims_pc_number_config_v1 WHERE id=1 FOR UPDATE;
 IF p_next_revision IS NULL OR p_next_revision<>v_old+1 OR p_next_revision>99 THEN
   RAISE EXCEPTION 'PC revision must advance exactly one step (RV% to RV%)',
      lpad(v_old::text,2,'0'),lpad((v_old+1)::text,2,'0')
      USING ERRCODE='22023';
 END IF;
 UPDATE private.jims_pc_number_config_v1
   SET current_revision=p_next_revision,updated_at=clock_timestamp(),updated_by=v_actor
 WHERE id=1;
 INSERT INTO private.jims_pc_revision_audit_v1
   (previous_revision,next_revision,reason,actor_id)
 VALUES(v_old,p_next_revision,btrim(p_reason),v_actor);
 RETURN jsonb_build_object('previous_revision','RV'||lpad(v_old::text,2,'0'),
   'current_revision','RV'||lpad(p_next_revision::text,2,'0'),
   'effective_for','future Petty Cash numbers only');
END;
$revision$;
REVOKE ALL ON FUNCTION public.jims_pc_set_next_revision_v1(integer,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_pc_set_next_revision_v1(integer,text)
 TO authenticated;

CREATE OR REPLACE FUNCTION public.jims_pc_number_status_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $status$
DECLARE v_rev integer; v_period text;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.user_profiles p
   WHERE p.id=auth.uid() AND p.is_active IS TRUE AND
     (p.role='system_admin' OR
      (p.department='Finance' AND p.role IN ('executive','manager')
        AND (p.subdepartment IS NULL OR
        p.subdepartment IN ('Accounts Payable','Accounting'))))
 ) THEN
   RAISE EXCEPTION 'You are not allowed to view Petty Cash numbering settings'
     USING ERRCODE='42501';
 END IF;
 SELECT current_revision INTO v_rev FROM private.jims_pc_number_config_v1 WHERE id=1;
 v_period:=to_char(current_timestamp AT TIME ZONE 'Asia/Kuala_Lumpur','MMYY');
 RETURN jsonb_build_object('revision','RV'||lpad(v_rev::text,2,'0'),
   'period_mmyy',v_period,
   'format','PC/RV'||lpad(v_rev::text,2,'0')||'/'||v_period||'/NNNN',
   'monthly_reset',true,'number_editable',false);
END;
$status$;
REVOKE ALL ON FUNCTION public.jims_pc_number_status_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.jims_pc_number_status_v1() TO authenticated;

-- Allocation fields are extra metadata, not modifications to the official
-- one-page Petty Cash Excel. They are stored in form_data, then projected into
-- the SAME private financial metadata table used by PV.
CREATE OR REPLACE FUNCTION private.jims_pc_validate_allocation_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $validate$
DECLARE
 v_dept text;
 v_sub text;
 v_center text;
 v_valid boolean;
BEGIN
 IF NEW.cv_number !~ '^PC/RV[0-9]{2}/(0[1-9]|1[0-2])[0-9]{2}/[0-9]{4}$' THEN
   RETURN NEW; -- historic CV numbers remain exempt; no retroactive change
 END IF;
 v_dept:=NULLIF(btrim(coalesce(NEW.applicable_department,NEW.form_data->>'department','')),'');
 v_sub:=NULLIF(btrim(coalesce(NEW.form_data->>'charge_subdepartment','')),'');
 v_center:=NULLIF(btrim(coalesce(NEW.form_data->>'charge_cost_center','')),'');
 IF v_center IS NOT NULL AND v_center NOT IN ('Management','Operation') THEN
    RAISE EXCEPTION 'PC Cost Center must be Management or Operation';
 END IF;
 v_valid:=CASE
   WHEN v_dept='Finance' THEN
      v_sub IN ('Accounting','Accounts Payable','Accounts Receivable','Strategic Finance')
   WHEN v_dept='Operation' THEN
      v_sub IN ('Medication','Panel','Clinical','Equipment and 3rd Party Medical Service','Human Resources (HR)')
   WHEN v_dept IN ('System, Project & Infrastructure','System, Project & Infra',
                   'System, Project & Infrastructure Department') THEN
      v_sub IN ('Online Management System','IT Software & Hardware','Facility','Project')
   WHEN v_dept='Medical' THEN
      v_sub IN ('Branch Medical PIC','Branch Medical Resident')
   WHEN v_dept IN ('Sales & Marketing','Sales and Marketing') THEN
      v_sub IN ('Marketing','Sale')
   ELSE false
 END;
 IF v_sub IS NOT NULL AND NOT coalesce(v_valid,false) THEN
   RAISE EXCEPTION 'PC Sub-Department does not match selected Department';
 END IF;
 IF NEW.status<>'draft' AND
    (v_dept IS NULL OR v_sub IS NULL OR v_center IS NULL) THEN
   RAISE EXCEPTION 'PC needs Department, Sub-Department and Cost Center before submission';
 END IF;
 RETURN NEW;
END;
$validate$;
REVOKE ALL ON FUNCTION private.jims_pc_validate_allocation_v1() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS jims_57d1_pc_allocation_validate_trg ON public.cash_vouchers;
CREATE TRIGGER jims_57d1_pc_allocation_validate_trg
BEFORE INSERT OR UPDATE OF form_data,applicable_department,status
ON public.cash_vouchers FOR EACH ROW
EXECUTE FUNCTION private.jims_pc_validate_allocation_v1();

CREATE OR REPLACE FUNCTION private.jims_pc_apply_allocation_metadata_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $metadata$
DECLARE
 v_sub text;
 v_cc text;
BEGIN
 IF NEW.cv_number !~ '^PC/RV[0-9]{2}/(0[1-9]|1[0-2])[0-9]{2}/[0-9]{4}$' THEN
   RETURN NEW;
 END IF;
 -- Preserve the user's actual final pre-submission selection. Once Submitted,
 -- status prevents altering allocation even when profile details change.
 IF NEW.status='draft' THEN
    v_sub:=NULLIF(btrim(coalesce(NEW.form_data->>'charge_subdepartment','')),'');
    v_cc:=NULLIF(btrim(coalesce(NEW.form_data->>'charge_cost_center','')),'');
    UPDATE private.jims_financial_metadata_v1 m
    SET charge_subdepartment=v_sub,cost_center=v_cc,auto_updated_at=clock_timestamp()
    WHERE m.source_type='petty_cash' AND m.source_id=NEW.id
      AND NOT m.allocation_locked;
 END IF;
 RETURN NEW;
END;
$metadata$;
REVOKE ALL ON FUNCTION private.jims_pc_apply_allocation_metadata_v1() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS jims_57d1_pc_metadata_allocation_trg ON public.cash_vouchers;
CREATE TRIGGER jims_57d1_pc_metadata_allocation_trg
AFTER INSERT OR UPDATE OF form_data,applicable_department,status
ON public.cash_vouchers FOR EACH ROW
EXECUTE FUNCTION private.jims_pc_apply_allocation_metadata_v1();

-- No update to old CV numbers; no revision of PV numbers.
