-- JIMS Step 53T-B: optional manual input and Revision 1 Excel support.
-- Additive v6 wrapper only; all previous draft versions remain unchanged.
-- v6 accepts legacy Excel revision 0000 or 2026-11-01 Revision 1 (0001).
-- Rev 1 still follows original secure v5 create -> T01..T09 -> JR -> approval flow.
CREATE FUNCTION public.create_pv_draft_v6(
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
 v_version text := btrim(coalesce(p_template_version,''));
 v_pv public.payment_vouchers;
BEGIN
 IF v_version NOT IN ('0000','0001') THEN
  RAISE EXCEPTION 'Supported PV form revisions: 0000 or 0001';
 END IF;
 -- v5 validates Finance Executive, tier, invoice rows, amounts and unique numbering.
 -- Its legacy 0000 gate is only an internal format metadata requirement.
 v_pv := public.create_pv_draft_v5(
  p_financial_tier => p_financial_tier,
  p_template_version => '0000',
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
 UPDATE public.payment_vouchers
 SET source_template_version=v_version,
     updated_at=clock_timestamp()
 WHERE id=v_pv.id AND status='draft'
   AND created_by=v_actor
   AND jims_tier_policy_version='R1'
 RETURNING * INTO v_pv;
 IF NOT FOUND OR v_pv.source_template_version IS DISTINCT FROM v_version THEN
  RAISE EXCEPTION 'PV Revision 1 metadata could not be saved. All changes rolled back.';
 END IF;
 INSERT INTO public.pv_audit_events(voucher_id,actor_id,action,details)
 VALUES(v_pv.id,v_actor,'jims_pv_template_revision_used',
        jsonb_build_object('template_revision',v_version,
                           'financial_tier',v_pv.financial_tier,
                           'pv_number',v_pv.pv_number));
 RETURN v_pv;
END;
$$;
REVOKE ALL ON FUNCTION public.create_pv_draft_v6(text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,jsonb,text,text,date)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_pv_draft_v6(text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,jsonb,text,text,date)
TO authenticated;
COMMENT ON FUNCTION public.create_pv_draft_v6(text,text,text,jsonb,text,text,text,text,text,text,text,text,text,numeric,text,jsonb,text,text,date) IS
'JIMS new PV revision-aware wrapper; security, numbering, tiers, invoice validation delegated to existing v5; records 0000/0001.';
