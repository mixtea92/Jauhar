-- JIMS Step 57C3 — Private background financial metadata and positions.
-- NO frontend fields, invoice edits, PV/PC number edits, status/payment changes.
-- Payment Process reuses PV source ID; no third cost source / double counting.
-- Snapshot creator department/subdepartment/branch and explicit document branch.
-- Charge-to org remains unmapped unless explicitly captured (Petty Cash department).
-- Records payment positions from live source; never infers 'Paid' from approvals.
BEGIN;

CREATE TABLE IF NOT EXISTS private.jims_financial_metadata_v1 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN ('payment_voucher','petty_cash')),
  source_id uuid NOT NULL,
  requester_id uuid,
  requester_department text,
  requester_subdepartment text,
  requester_branch text,
  requester_cost_center text,
  charge_department text,
  charge_subdepartment text,
  branch_code text CHECK (branch_code IN ('GP','KM','PM','TD') OR branch_code IS NULL),
  cost_center text,
  budget_code text,
  allocation_locked boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL DEFAULT now(),
  auto_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jims_financial_metadata_source_unique_v1 UNIQUE (source_type,source_id)
);

COMMENT ON TABLE private.jims_financial_metadata_v1 IS
'57C3 hidden per-source metadata; no GUI or invoice fields. PV Payment Process shares PV ID. No budget ownership inferred from creator Finance; cost/budget code may be null.';
COMMENT ON COLUMN private.jims_financial_metadata_v1.requester_department IS
'Creator/origin department snapshot, NOT necessarily the charge-to budget owner.';
COMMENT ON COLUMN private.jims_financial_metadata_v1.charge_department IS
'Explicit charge-to department only; null means needs assignment, not Finance by default.';
COMMENT ON COLUMN private.jims_financial_metadata_v1.branch_code IS
'Explicit source-document branch (GP/KM/PM/TD), not inferred from profile office.';
COMMENT ON COLUMN private.jims_financial_metadata_v1.budget_code IS
'Reserved for later validated budget code mapping; never guessed automatically.';

REVOKE ALL ON TABLE private.jims_financial_metadata_v1 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE private.jims_financial_metadata_v1_id_seq FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.jims_branch_code_v1(p_raw text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $normalize$
SELECT CASE upper(
 regexp_replace(
  regexp_replace(btrim(coalesce(p_raw,'')),'^JMC[-_ ]*','','i'),
  '[-_ ]+','','g'))
WHEN 'GP' THEN 'GP'
WHEN 'GELANGPATAH' THEN 'GP'
WHEN 'KM' THEN 'KM'
WHEN 'KOTAMASAI' THEN 'KM'
WHEN 'PM' THEN 'PM'
WHEN 'PULAIMUTIARA' THEN 'PM'
WHEN 'TD' THEN 'TD'
WHEN 'TAMANDAYA' THEN 'TD'
ELSE NULL END;
$normalize$;
REVOKE ALL ON FUNCTION private.jims_branch_code_v1(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.jims_capture_source_metadata_v1(
 p_source_type text, p_source_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $capture$
DECLARE
  v_creator uuid;
  v_origin text;
  v_charge text;
  v_branch_raw text;
  v_status text;
  v_profile public.user_profiles%ROWTYPE;
  v_doc_branch text;
  v_charge_subdept text;
  v_charge_cc text;
  v_editable boolean;
BEGIN
  IF p_source_type='payment_voucher' THEN
    SELECT created_by,origin_department,branch_department,status
    INTO v_creator,v_origin,v_branch_raw,v_status
    FROM public.payment_vouchers WHERE id=p_source_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PV missing for metadata capture'; END IF;
    -- PV origin department is requester's department, NOT proven budget owner.
    v_charge:=NULL;
  ELSIF p_source_type='petty_cash' THEN
    SELECT created_by,
       NULLIF(btrim(form_data->>'department'),''),
       COALESCE(NULLIF(btrim(applicable_department),''),
                NULLIF(btrim(form_data->>'department'),'')),
       COALESCE(NULLIF(btrim(form_data->>'branch'),''),
                NULLIF(btrim(form_data->'lines'->0->>'expenses_branch'),'')),
       status
    INTO v_creator,v_origin,v_charge,v_branch_raw,v_status
    FROM public.cash_vouchers WHERE id=p_source_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Petty Cash missing for metadata capture'; END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported financial metadata source';
  END IF;

  SELECT * INTO v_profile FROM public.user_profiles WHERE id=v_creator;
  IF v_origin IS NULL THEN v_origin:=NULLIF(btrim(v_profile.department),''); END IF;
  v_doc_branch:=private.jims_branch_code_v1(v_branch_raw);

  -- Never guess charge-to subdepartment/cost center from another branch or dept.
  IF v_charge IS NOT NULL
     AND v_charge IS NOT DISTINCT FROM v_profile.department
     AND v_doc_branch IS NOT NULL
     AND v_doc_branch IS NOT DISTINCT FROM private.jims_branch_code_v1(v_profile.branch)
  THEN
    v_charge_subdept:=NULLIF(btrim(v_profile.subdepartment),'');
    v_charge_cc:=NULLIF(btrim(v_profile.cost_center),'');
  ELSE
    v_charge_subdept:=NULL;
    v_charge_cc:=NULL;
  END IF;

  -- Creation data stays snapshot after submission; revised drafts can capture
  -- changed explicit document allocation, but never change budget_code.
  v_editable := v_status IN ('draft','returned');

  INSERT INTO private.jims_financial_metadata_v1 (
    source_type,source_id,requester_id,requester_department,
    requester_subdepartment,requester_branch,requester_cost_center,
    charge_department,charge_subdepartment,branch_code,cost_center
  ) VALUES (
    p_source_type,p_source_id,v_creator,v_origin,
    NULLIF(btrim(v_profile.subdepartment),''),
    NULLIF(btrim(v_profile.branch),''),
    NULLIF(btrim(v_profile.cost_center),''),
    v_charge,v_charge_subdept,v_doc_branch,v_charge_cc
  )
  ON CONFLICT (source_type,source_id) DO UPDATE
  SET charge_department=EXCLUDED.charge_department,
      charge_subdepartment=EXCLUDED.charge_subdepartment,
      branch_code=EXCLUDED.branch_code,
      cost_center=EXCLUDED.cost_center,
      auto_updated_at=now()
  WHERE v_editable AND NOT private.jims_financial_metadata_v1.allocation_locked;
END;
$capture$;

REVOKE ALL ON FUNCTION private.jims_capture_source_metadata_v1(text,uuid)
FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.jims_capture_source_metadata_trigger_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $trigger$
BEGIN
  IF TG_TABLE_NAME='payment_vouchers' THEN
    PERFORM private.jims_capture_source_metadata_v1('payment_voucher',NEW.id);
  ELSIF TG_TABLE_NAME='cash_vouchers' THEN
    PERFORM private.jims_capture_source_metadata_v1('petty_cash',NEW.id);
  ELSE
    RAISE EXCEPTION 'Unsupported metadata trigger table';
  END IF;
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION private.jims_capture_source_metadata_trigger_v1()
FROM PUBLIC,anon,authenticated;

CREATE TRIGGER jims_57c3_pv_metadata_capture_trg
AFTER INSERT OR UPDATE OF branch_department, origin_department, status
ON public.payment_vouchers
FOR EACH ROW
EXECUTE FUNCTION private.jims_capture_source_metadata_trigger_v1();

CREATE TRIGGER jims_57c3_pc_metadata_capture_trg
AFTER INSERT OR UPDATE OF applicable_department,form_data,status
ON public.cash_vouchers
FOR EACH ROW
EXECUTE FUNCTION private.jims_capture_source_metadata_trigger_v1();

-- Capture all existing sources without touching any PV or PC business data.
DO $backfill$
DECLARE v_id uuid;
BEGIN
 FOR v_id IN SELECT id FROM public.payment_vouchers
 LOOP PERFORM private.jims_capture_source_metadata_v1('payment_voucher',v_id); END LOOP;
 FOR v_id IN SELECT id FROM public.cash_vouchers
 LOOP PERFORM private.jims_capture_source_metadata_v1('petty_cash',v_id); END LOOP;
END $backfill$;

-- Live source facts. Never aggregate Payment Process as an additional source.
-- "Committed" means approved/closed obligation, NOT the sum of Committed + Paid.
-- For Petty Cash, dual-signed 'closed' is approval, NOT proof of disbursement:
-- its balance remains unverified until cash-payment confirmation is implemented.
CREATE VIEW private.jims_financial_positions_v1 AS
WITH partial_paid AS (
  SELECT voucher_id,
         sum(COALESCE(settled_amount,0))::numeric AS paid
  FROM public.pv_payment_transactions
  WHERE status='paid'
  GROUP BY voucher_id
),
pv_base AS (
 SELECT v.id,v.pv_number,v.status,v.payment_status,v.payment_mode,
        v.amount::numeric AS requested_amount,
        CASE WHEN v.status='fully_approved' THEN greatest(0,v.amount) ELSE 0 END::numeric AS committed_amount,
        CASE WHEN v.status<>'fully_approved' THEN 0
             WHEN v.payment_mode='partial' THEN
               least(greatest(0,v.amount),greatest(0,coalesce(pp.paid,0)))
             WHEN v.payment_status='paid' THEN greatest(0,v.amount)
             ELSE 0 END::numeric AS paid_amount
 FROM public.payment_vouchers v
 LEFT JOIN partial_paid pp ON pp.voucher_id=v.id
)
SELECT
 m.source_type,m.source_id,v.pv_number AS source_number,
 v.status AS workflow_status,v.payment_status AS payment_status,
 m.requester_id,m.requester_department,m.requester_subdepartment,
 m.requester_branch,m.requester_cost_center,
 m.charge_department,m.charge_subdepartment,m.branch_code,m.cost_center,m.budget_code,
 CASE WHEN m.charge_department IS NOT NULL AND m.charge_subdepartment IS NOT NULL
                AND m.branch_code IS NOT NULL AND m.cost_center IS NOT NULL
                AND m.budget_code IS NOT NULL
      THEN 'mapped' ELSE 'needs_mapping' END::text AS allocation_state,
 v.requested_amount,
 v.committed_amount,
 greatest(0,v.committed_amount-v.paid_amount)::numeric AS waiting_to_pay_amount,
 v.paid_amount,
 greatest(0,v.committed_amount-v.paid_amount)::numeric AS outstanding_amount,
 0::numeric AS payment_unverified_amount,
 'verified_by_payment_workflow'::text AS payment_evidence_status
FROM private.jims_financial_metadata_v1 m
JOIN pv_base v ON m.source_type='payment_voucher' AND m.source_id=v.id

UNION ALL

SELECT
 m.source_type,m.source_id,c.cv_number,
 c.status,'not_separately_tracked'::text AS payment_status,
 m.requester_id,m.requester_department,m.requester_subdepartment,
 m.requester_branch,m.requester_cost_center,
 m.charge_department,m.charge_subdepartment,m.branch_code,m.cost_center,m.budget_code,
 CASE WHEN m.charge_department IS NOT NULL AND m.charge_subdepartment IS NOT NULL
                AND m.branch_code IS NOT NULL AND m.cost_center IS NOT NULL
                AND m.budget_code IS NOT NULL
      THEN 'mapped' ELSE 'needs_mapping' END::text AS allocation_state,
 c.total_amount::numeric AS requested_amount,
 CASE WHEN c.status='closed' THEN greatest(0,c.total_amount) ELSE 0 END::numeric AS committed_amount,
 -- A PC 'closed' record may already have been physically disbursed;
 -- its amount must NOT be asserted as confirmed paid.
 CASE WHEN c.status='closed' THEN greatest(0,c.total_amount) ELSE 0 END::numeric AS waiting_to_pay_amount,
 0::numeric AS paid_amount,
 CASE WHEN c.status='closed' THEN greatest(0,c.total_amount) ELSE 0 END::numeric AS outstanding_amount,
 CASE WHEN c.status='closed' THEN greatest(0,c.total_amount) ELSE 0 END::numeric AS payment_unverified_amount,
 'petty_cash_disbursement_unverified'::text AS payment_evidence_status
FROM private.jims_financial_metadata_v1 m
JOIN public.cash_vouchers c ON m.source_type='petty_cash' AND m.source_id=c.id;

REVOKE ALL ON private.jims_financial_positions_v1 FROM PUBLIC,anon,authenticated;

CREATE VIEW private.jims_financial_budget_breakdown_v1 AS
SELECT source_type,requester_department,requester_subdepartment,
       charge_department,charge_subdepartment,branch_code,cost_center,budget_code,
       allocation_state,payment_evidence_status,
       count(*)::bigint source_count,
       coalesce(sum(requested_amount),0)::numeric requested_amount,
       coalesce(sum(committed_amount),0)::numeric committed_amount,
       coalesce(sum(waiting_to_pay_amount),0)::numeric waiting_to_pay_amount,
       coalesce(sum(paid_amount),0)::numeric paid_amount,
       coalesce(sum(outstanding_amount),0)::numeric outstanding_amount,
       coalesce(sum(payment_unverified_amount),0)::numeric payment_unverified_amount
FROM private.jims_financial_positions_v1
GROUP BY source_type,requester_department,requester_subdepartment,
         charge_department,charge_subdepartment,branch_code,cost_center,budget_code,
         allocation_state,payment_evidence_status;

REVOKE ALL ON private.jims_financial_budget_breakdown_v1 FROM PUBLIC,anon,authenticated;

COMMENT ON VIEW private.jims_financial_positions_v1 IS
'57C3 private live reporting: one PV row including Payment Process, one PC row. Committed is approved obligation; waiting=committed-paid. Petty Cash payment unverified until explicit disbursement verification exists.';
COMMENT ON VIEW private.jims_financial_budget_breakdown_v1 IS
'57C3 groupable budget facts per Department/Subdepartment/Branch/Cost Center/Budget Code. Needs_mapping is NOT an approved budget allocation. Do not add committed+waiting+paid.';

COMMIT;
