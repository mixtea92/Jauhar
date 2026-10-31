-- JIMS STEP 52N / PV NUMBER FORMAT v1
-- New PV: PV/T01/RV01/1026/0001 (tier/revision/MMYY/sequence).
-- Existing PV numbers are intentionally UNCHANGED.
-- New PV uses create_pv_draft_v5 only; v4 and v2 remain intact.
-- Re-submit after return: approval_round 2 -> RV02; draft tier change
-- gets a new counter for the new tier, preserving original MMYY.
-- All transitions remain within original protected approval RPCs.

CREATE TABLE public.jims_pv_number_counters_v1 (
  financial_tier text NOT NULL CHECK (financial_tier ~ '^T0[1-9]$'),
  period_mmyy text NOT NULL CHECK (period_mmyy ~ '^(0[1-9]|1[0-2])[0-9]{2}$'),
  last_number integer NOT NULL CHECK (last_number BETWEEN 1 AND 9999),
  PRIMARY KEY(financial_tier,period_mmyy)
);
ALTER TABLE public.jims_pv_number_counters_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jims_pv_number_counters_v1 FROM PUBLIC,anon,authenticated;

CREATE TABLE public.jims_pv_number_history_v1(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 voucher_id uuid NOT NULL REFERENCES public.payment_vouchers(id) ON DELETE RESTRICT,
 old_number text NOT NULL,
 new_number text NOT NULL,
 reason text NOT NULL CHECK(reason IN ('draft_tier_changed','resubmitted_revision','tier_and_revision_changed')),
 actor_id uuid,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT jims_pv_number_history_unique UNIQUE(voucher_id,old_number,new_number)
);
CREATE INDEX jims_pv_number_history_voucher_idx
 ON public.jims_pv_number_history_v1 (voucher_id,changed_at DESC);
ALTER TABLE public.jims_pv_number_history_v1 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "JIMS PV history inherits visible voucher"
 ON public.jims_pv_number_history_v1
 FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.payment_vouchers pv WHERE pv.id=voucher_id));
REVOKE ALL ON TABLE public.jims_pv_number_history_v1 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.jims_pv_number_history_v1 TO authenticated;

CREATE FUNCTION public.jims_update_pv_number_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
 v_old_tier text;
 v_old_period text;
 v_old_seq text;
 v_seq integer;
 v_rev integer;
 v_reason text;
BEGIN
  -- Legacy payment vouchers must NEVER be renumbered.
  IF OLD.pv_number IS NULL OR OLD.pv_number !~
     '^PV/T0[1-9]/RV[0-9]{2}/(0[1-9]|1[0-2])[0-9]{2}/[0-9]{4}$'
  THEN RETURN NEW; END IF;

  IF NEW.financial_tier IS NOT DISTINCT FROM OLD.financial_tier
     AND NEW.approval_round IS NOT DISTINCT FROM OLD.approval_round
  THEN RETURN NEW; END IF;

  IF NEW.financial_tier NOT IN
     ('T01','T02','T03','T04','T05','T06','T07','T08','T09')
  THEN RAISE EXCEPTION 'Financial tier not eligible for PV numbering'; END IF;

  v_rev := NEW.approval_round;
  IF v_rev IS NULL OR v_rev < 1 OR v_rev > 99 THEN
    RAISE EXCEPTION 'Maximum PV revision RV99 exceeded';
  END IF;

  v_old_tier := split_part(OLD.pv_number,'/',2);
  v_old_period := split_part(OLD.pv_number,'/',4);
  v_old_seq := split_part(OLD.pv_number,'/',5);

  IF NEW.financial_tier IS DISTINCT FROM OLD.financial_tier THEN
    IF OLD.status NOT IN ('draft','returned')
       OR NEW.status NOT IN ('draft','returned')
    THEN RAISE EXCEPTION 'PV tier cannot change after submission'; END IF;

    INSERT INTO public.jims_pv_number_counters_v1
      (financial_tier,period_mmyy,last_number)
    VALUES(NEW.financial_tier,v_old_period,1)
    ON CONFLICT(financial_tier,period_mmyy)
    DO UPDATE SET last_number=public.jims_pv_number_counters_v1.last_number+1
    RETURNING last_number INTO v_seq;
    v_old_seq := lpad(v_seq::text,4,'0');
  END IF;

  NEW.pv_number := 'PV/'||NEW.financial_tier||'/RV'||
     lpad(v_rev::text,2,'0')||'/'||v_old_period||'/'||v_old_seq;

  IF NEW.pv_number IS DISTINCT FROM OLD.pv_number THEN
    v_reason := CASE
       WHEN NEW.financial_tier IS DISTINCT FROM OLD.financial_tier
          AND NEW.approval_round IS DISTINCT FROM OLD.approval_round
         THEN 'tier_and_revision_changed'
       WHEN NEW.financial_tier IS DISTINCT FROM OLD.financial_tier
         THEN 'draft_tier_changed'
       ELSE 'resubmitted_revision' END;

    INSERT INTO public.jims_pv_number_history_v1
       (voucher_id,old_number,new_number,reason,actor_id)
    VALUES(OLD.id,OLD.pv_number,NEW.pv_number,v_reason,auth.uid());

    INSERT INTO public.pv_audit_events(voucher_id,actor_id,action,details)
    VALUES(OLD.id,auth.uid(),'pv_number_revised_v1',
       jsonb_build_object('old_pv_number',OLD.pv_number,
                          'new_pv_number',NEW.pv_number,
                          'reason',v_reason,
                          'approval_round',NEW.approval_round));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER jims_pv_number_revision_v1_trg
BEFORE UPDATE OF financial_tier,approval_round
ON public.payment_vouchers
FOR EACH ROW
EXECUTE FUNCTION public.jims_update_pv_number_v1();

-- Same function signature and input validations as v4. Exactly ONE new
-- operation: replace temporary legacy serial number after creation.
CREATE FUNCTION public.create_pv_draft_v5(
 p_financial_tier text,
 p_template_version text,
 p_payee_name text,
 p_items jsonb,
 p_supplier_tin text DEFAULT NULL,
 p_supplier_code text DEFAULT NULL,
 p_bank_name text DEFAULT NULL,
 p_bank_account_no text DEFAULT NULL,
 p_branch_department text DEFAULT NULL,
 p_payment_method text DEFAULT NULL,
 p_payment_type text DEFAULT NULL,
 p_expense_nature text DEFAULT NULL,
 p_budget_classification text DEFAULT NULL,
 p_sst_amount numeric DEFAULT 0,
 p_remarks text DEFAULT NULL,
 p_supporting_types jsonb DEFAULT '[]'::jsonb,
 p_supporting_other_text text DEFAULT NULL,
 p_source_voucher_no text DEFAULT NULL,
 p_source_pv_date date DEFAULT NULL
)
RETURNS public.payment_vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
 v_actor uuid := auth.uid();
 v_tier text := upper(btrim(coalesce(p_financial_tier,'')));
 v_period text := to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','MMYY');
 v_number integer;
 v_pv public.payment_vouchers;
 v_old_number text;
BEGIN
 IF v_actor IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.user_profiles
   WHERE id=v_actor AND is_active=true AND role='executive'
   AND department='Finance'
 ) THEN RAISE EXCEPTION 'Only an active Finance Executive can create a Payment Voucher'; END IF;

 IF v_tier NOT IN ('T01','T02','T03','T04','T05','T06','T07','T08','T09')
 THEN RAISE EXCEPTION 'Invalid financial tier'; END IF;

 -- Existing full validation, data save, invoice rows, approval metadata
 -- and audit still handled atomically by the tested v4 implementation.
 v_pv := public.create_pv_draft_v4(
  p_financial_tier => v_tier,
  p_template_version => p_template_version,
  p_payee_name => p_payee_name,
  p_items => p_items,
  p_supplier_tin => p_supplier_tin,
  p_supplier_code => p_supplier_code,
  p_bank_name => p_bank_name,
  p_bank_account_no => p_bank_account_no,
  p_branch_department => p_branch_department,
  p_payment_method => p_payment_method,
  p_payment_type => p_payment_type,
  p_expense_nature => p_expense_nature,
  p_budget_classification => p_budget_classification,
  p_sst_amount => p_sst_amount,
  p_remarks => p_remarks,
  p_supporting_types => p_supporting_types,
  p_supporting_other_text => p_supporting_other_text,
  p_source_voucher_no => p_source_voucher_no,
  p_source_pv_date => p_source_pv_date
 );

 v_old_number := v_pv.pv_number;

 INSERT INTO public.jims_pv_number_counters_v1
   (financial_tier,period_mmyy,last_number)
 VALUES(v_tier,v_period,1)
 ON CONFLICT(financial_tier,period_mmyy)
 DO UPDATE SET last_number=public.jims_pv_number_counters_v1.last_number+1
 RETURNING last_number INTO v_number;

 IF v_number > 9999 THEN RAISE EXCEPTION 'Monthly per-tier PV number limit reached'; END IF;

 UPDATE public.payment_vouchers
 SET pv_number='PV/'||v_tier||'/RV01/'||v_period||'/'||lpad(v_number::text,4,'0')
 WHERE id=v_pv.id AND created_by=v_actor AND status='draft'
   AND financial_tier=v_tier AND approval_round=1
 RETURNING * INTO v_pv;

 IF NOT FOUND OR v_pv.pv_number IS NULL OR
     v_pv.pv_number !~ '^PV/T0[1-9]/RV01/(0[1-9]|1[0-2])[0-9]{2}/[0-9]{4}$'
 THEN RAISE EXCEPTION 'New PV numbering could not be confirmed; save rolled back'; END IF;

 INSERT INTO public.pv_audit_events(voucher_id,actor_id,action,details)
 VALUES(v_pv.id,v_actor,'pv_number_issued_v1',
   jsonb_build_object('old_temp_number',v_old_number,'pv_number',v_pv.pv_number,
                      'tier',v_tier,'revision','RV01','period',v_period));
 RETURN v_pv;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pv_draft_v5(
 text,text,text,jsonb,text,text,text,text,text,text,text,text,text,
 numeric,text,jsonb,text,text,date
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_pv_draft_v5(
 text,text,text,jsonb,text,text,text,text,text,text,text,text,text,
 numeric,text,jsonb,text,text,date
) TO authenticated;
REVOKE ALL ON FUNCTION public.jims_update_pv_number_v1() FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION public.create_pv_draft_v5(
 text,text,text,jsonb,text,text,text,text,text,text,text,text,text,
 numeric,text,jsonb,text,text,date
) IS 'JIMS PV format: PV/TXX/RVXX/MMYY/NNNN. Reuses tested v4 draft creation, never renumbers legacy PVs.';
