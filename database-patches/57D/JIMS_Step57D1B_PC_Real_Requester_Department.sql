-- JIMS 57D1B: keep requester vs charged department distinct for all NEW PC.
-- The creator is an AP Finance employee; Charge Department is from the PC
-- allocation / Applicable HOD. Historical CV metadata stays untouched.
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
 IF NEW.status='draft' THEN
    v_sub:=NULLIF(btrim(coalesce(NEW.form_data->>'charge_subdepartment','')),'');
    v_cc:=NULLIF(btrim(coalesce(NEW.form_data->>'charge_cost_center','')),'');
    UPDATE private.jims_financial_metadata_v1 m
    SET charge_subdepartment=v_sub,cost_center=v_cc,
        requester_department=(SELECT p.department
          FROM public.user_profiles p WHERE p.id=NEW.created_by),
        auto_updated_at=clock_timestamp()
    WHERE m.source_type='petty_cash' AND m.source_id=NEW.id
      AND NOT m.allocation_locked;
 END IF;
 RETURN NEW;
END;
$metadata$;
REVOKE ALL ON FUNCTION private.jims_pc_apply_allocation_metadata_v1() FROM PUBLIC,anon,authenticated;
