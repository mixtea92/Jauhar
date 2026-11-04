-- Narrow recurring support exception; everything else in approval functions remains unchanged.
CREATE OR REPLACE FUNCTION public.submit_finance_t01_t02_v2(p_voucher_id uuid, p_expected_updated_at timestamp with time zone)
 RETURNS payment_vouchers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_pv public.payment_vouchers;
  v_lines integer;
  v_total numeric;
  v_was_returned boolean := false;
  v_target_round integer;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_actor AND role = 'executive' AND department = 'Finance'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active Finance Executive may submit Finance T01/T02.';
  END IF;

  SELECT * INTO v_pv
  FROM public.payment_vouchers
  WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND OR NOT public.jauhar_is_current_requester_v1(p_voucher_id) THEN
    RAISE EXCEPTION 'Voucher not found or requester is not the owner.';
  END IF;
  IF v_pv.status NOT IN ('draft','returned') OR v_pv.financial_tier NOT IN ('T01','T02') THEN
    RAISE EXCEPTION 'Only Finance T01/T02 Drafts or Returned PVs can be submitted.';
  END IF;
  IF NOT (v_pv.source_template_version IS NOT DISTINCT FROM '0000' OR (v_pv.source_template_version IS NOT DISTINCT FROM '0001' AND v_pv.jims_tier_policy_version IS NOT DISTINCT FROM 'R1')) THEN
    RAISE EXCEPTION 'Draft must use the approved template revision.';
  END IF;
  IF p_expected_updated_at IS NULL OR v_pv.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Voucher changed. Close and reopen before submitting.';
  END IF;
  -- Returned PVs must have an actual Finance Manager Return action in
  -- the CURRENT round. Previous Executive verification stays as history.
  v_was_returned := v_pv.status = 'returned';
  IF v_was_returned AND NOT EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_pv.approval_round
      AND a.tier = 'finance_manager' AND a.action = 'return'
  ) THEN
    RAISE EXCEPTION 'Returned PV has no matching Finance Manager return record.';
  END IF;

  -- Every resubmission creates a fresh round; old approval records are
  -- NEVER overwritten. This also prevents a second actor sign-off in the
  -- same round after an amendment.
  v_target_round := v_pv.approval_round + CASE WHEN v_was_returned THEN 1 ELSE 0 END;
  IF v_target_round IS NULL OR v_target_round > 2147483647 THEN
    RAISE EXCEPTION 'Invalid approval round. Contact System Admin.';
  END IF;

  IF nullif(btrim(coalesce(v_pv.payee_name, '')), '') IS NULL OR v_pv.amount <= 0 THEN
    RAISE EXCEPTION 'Payee and valid amount are required.';
  END IF;
  IF lower(coalesce(v_pv.budget_classification,'')) <> 'budgeted' THEN
    RAISE EXCEPTION 'Finance T01/T02 must be Budgeted. Review Financial Tier.';
  END IF;
  -- T02: unfixed within approved budget, less than RM10,000.
  IF v_pv.financial_tier = 'T02' AND ((v_pv.jims_tier_policy_version = 'R1' AND v_pv.amount > 10000) OR (v_pv.jims_tier_policy_version IS NULL AND v_pv.amount >= 10000)) THEN
    RAISE EXCEPTION 'T02 requires amount below RM10,000. Review Financial Tier.';
  END IF;
  IF v_pv.payment_method = 'Online Transfer' AND (
     nullif(btrim(coalesce(v_pv.bank_name,'')), '') IS NULL OR
     nullif(btrim(coalesce(v_pv.bank_account_no,'')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Bank name and account number are required for online transfer.';
  END IF;

  SELECT count(*), coalesce(sum(amount),0) INTO v_lines, v_total
  FROM public.pv_line_items WHERE voucher_id = v_pv.id;
  IF v_lines < 1 OR v_pv.sst_amount IS NULL OR v_pv.sst_amount < 0
     OR round(v_total + v_pv.sst_amount,2) <> v_pv.amount THEN
    RAISE EXCEPTION 'Invoice lines, SST and total amount do not match.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
      AND nullif(btrim(coalesce(l.invoice_reference,'')),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invoice number is required on every invoice line.';
  END IF;

  -- No duplicate invoice numbers within this voucher.
  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
    GROUP BY lower(btrim(l.invoice_reference))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate invoice numbers within this voucher.';
  END IF;

  -- Conservative duplicate block across non-rejected vouchers for the same supplier.
  -- Exceptional Finance/CEO release is not yet implemented, so do not bypass.
  IF EXISTS (
    SELECT 1
    FROM public.pv_line_items current_line
    JOIN public.pv_line_items previous_line
      ON lower(btrim(previous_line.invoice_reference)) = lower(btrim(current_line.invoice_reference))
     AND previous_line.voucher_id <> v_pv.id
    JOIN public.payment_vouchers previous_pv ON previous_pv.id = previous_line.voucher_id
    WHERE current_line.voucher_id = v_pv.id
      AND previous_pv.status <> 'rejected'
      AND (
        (nullif(btrim(coalesce(v_pv.supplier_code,'')), '') IS NOT NULL
         AND lower(btrim(coalesce(previous_pv.supplier_code,''))) = lower(btrim(v_pv.supplier_code)))
        OR lower(btrim(previous_pv.payee_name)) = lower(btrim(v_pv.payee_name))
      )
  ) THEN
    RAISE EXCEPTION 'Supplier invoice number already exists in another PV. Refer to Finance Manager.';
  END IF;

  -- REAL invoice proof required for every invoice line. Merely ticking the
  -- supporting-document checklist is not acceptable evidence.
  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
      AND NOT EXISTS (
        SELECT 1 FROM public.pv_invoice_documents d
        JOIN storage.objects o
          ON o.bucket_id = 'jauhar-pv-invoices'
         AND o.name = d.storage_path
        WHERE d.voucher_id = v_pv.id
          AND d.line_item_id = l.id
      )
      AND NOT public.jims_recurring_has_valid_supporting_v1(v_pv.id)
  ) THEN
    RAISE EXCEPTION 'Provide registered invoice evidence, or a valid FM-linked Recurring Payment Supporting Document.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_target_round
      AND a.tier = 'executive'
  ) THEN
    RAISE EXCEPTION 'Requester already verified this approval round.';
  END IF;

  UPDATE public.payment_vouchers
  SET status='pending_finance_manager',
      approval_round = v_target_round,
      updated_at=clock_timestamp()
  WHERE id=v_pv.id RETURNING * INTO v_pv;

  INSERT INTO public.pv_approval_actions
    (voucher_id,approval_round,tier,action,actor_id,remarks)
  VALUES (v_pv.id,v_pv.approval_round,'executive','verify',v_actor,NULL);

  INSERT INTO public.pv_audit_events (voucher_id,actor_id,action,details)
  VALUES (v_pv.id,v_actor,CASE WHEN v_was_returned THEN 'finance_t01_t02_resubmitted' ELSE 'finance_t01_t02_submitted' END,
    jsonb_build_object('tier',v_pv.financial_tier,
      'from_status',CASE WHEN v_was_returned THEN 'returned' ELSE 'draft' END,'to_status','pending_finance_manager',
      'approval_round',v_pv.approval_round));
  RETURN v_pv;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_finance_t04_v1(p_voucher_id uuid, p_expected_updated_at timestamp with time zone)
 RETURNS payment_vouchers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_pv public.payment_vouchers;
  v_lines integer;
  v_total numeric;
  v_was_returned boolean := false;
  v_target_round integer;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_actor AND role = 'executive' AND department = 'Finance'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active Finance Executive may submit Finance T04.';
  END IF;

  SELECT * INTO v_pv
  FROM public.payment_vouchers
  WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND OR NOT public.jauhar_is_current_requester_v1(p_voucher_id) THEN
    RAISE EXCEPTION 'Voucher not found or requester is not the owner.';
  END IF;
  IF v_pv.status NOT IN ('draft','returned') OR v_pv.financial_tier IS DISTINCT FROM 'T04' THEN
    RAISE EXCEPTION 'Only Finance T04 Drafts or Returned PVs can be submitted.';
  END IF;
  IF NOT (v_pv.source_template_version IS NOT DISTINCT FROM '0000' OR (v_pv.source_template_version IS NOT DISTINCT FROM '0001' AND v_pv.jims_tier_policy_version IS NOT DISTINCT FROM 'R1')) THEN
    RAISE EXCEPTION 'Draft must use the approved template revision.';
  END IF;
  IF p_expected_updated_at IS NULL OR v_pv.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Voucher changed. Close and reopen before submitting.';
  END IF;
  -- Returned PVs must have an actual Finance Manager Return action in
  -- the CURRENT round. Previous Executive verification stays as history.
  v_was_returned := v_pv.status = 'returned';
  IF v_was_returned AND NOT EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_pv.approval_round
      AND a.tier IN ('finance_manager','ceo') AND a.action = 'return'
  ) THEN
    RAISE EXCEPTION 'Returned PV has no matching Finance Manager return record.';
  END IF;

  -- Every resubmission creates a fresh round; old approval records are
  -- NEVER overwritten. This also prevents a second actor sign-off in the
  -- same round after an amendment.
  v_target_round := v_pv.approval_round + CASE WHEN v_was_returned THEN 1 ELSE 0 END;
  IF v_target_round IS NULL OR v_target_round > 2147483647 THEN
    RAISE EXCEPTION 'Invalid approval round. Contact System Admin.';
  END IF;

  IF nullif(btrim(coalesce(v_pv.payee_name, '')), '') IS NULL OR v_pv.amount <= 0 THEN
    RAISE EXCEPTION 'Payee and valid amount are required.';
  END IF;
  IF lower(coalesce(v_pv.budget_classification,'')) <> 'budgeted' THEN
    RAISE EXCEPTION 'Finance T04 must be Budgeted. Review Financial Tier.';
  END IF;
  -- T04: Ad Hoc variable cost, within approved budget, strictly > RM10,000.
  IF v_pv.amount <= 10000 THEN
    RAISE EXCEPTION 'T04 requires total amount above RM10,000.';
  END IF;
  IF v_pv.expense_nature IS DISTINCT FROM 'Ad Hoc' THEN
    RAISE EXCEPTION 'T04 requires Expense Nature = Ad Hoc.';
  END IF;
  IF v_pv.payment_method = 'Online Transfer' AND (
     nullif(btrim(coalesce(v_pv.bank_name,'')), '') IS NULL OR
     nullif(btrim(coalesce(v_pv.bank_account_no,'')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Bank name and account number are required for online transfer.';
  END IF;

  SELECT count(*), coalesce(sum(amount),0) INTO v_lines, v_total
  FROM public.pv_line_items WHERE voucher_id = v_pv.id;
  IF v_lines < 1 OR v_pv.sst_amount IS NULL OR v_pv.sst_amount < 0
     OR round(v_total + v_pv.sst_amount,2) <> v_pv.amount THEN
    RAISE EXCEPTION 'Invoice lines, SST and total amount do not match.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
      AND nullif(btrim(coalesce(l.invoice_reference,'')),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invoice number is required on every invoice line.';
  END IF;

  -- No duplicate invoice numbers within this voucher.
  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
    GROUP BY lower(btrim(l.invoice_reference))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate invoice numbers within this voucher.';
  END IF;

  -- Conservative duplicate block across non-rejected vouchers for the same supplier.
  -- Exceptional Finance/CEO release is not yet implemented, so do not bypass.
  IF EXISTS (
    SELECT 1
    FROM public.pv_line_items current_line
    JOIN public.pv_line_items previous_line
      ON lower(btrim(previous_line.invoice_reference)) = lower(btrim(current_line.invoice_reference))
     AND previous_line.voucher_id <> v_pv.id
    JOIN public.payment_vouchers previous_pv ON previous_pv.id = previous_line.voucher_id
    WHERE current_line.voucher_id = v_pv.id
      AND previous_pv.status <> 'rejected'
      AND (
        (nullif(btrim(coalesce(v_pv.supplier_code,'')), '') IS NOT NULL
         AND lower(btrim(coalesce(previous_pv.supplier_code,''))) = lower(btrim(v_pv.supplier_code)))
        OR lower(btrim(previous_pv.payee_name)) = lower(btrim(v_pv.payee_name))
      )
  ) THEN
    RAISE EXCEPTION 'Supplier invoice number already exists in another PV. Refer to Finance Manager.';
  END IF;

  -- REAL invoice proof required for every invoice line. Merely ticking the
  -- supporting-document checklist is not acceptable evidence.
  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
      AND NOT EXISTS (
        SELECT 1 FROM public.pv_invoice_documents d
        JOIN storage.objects o
          ON o.bucket_id = 'jauhar-pv-invoices'
         AND o.name = d.storage_path
        WHERE d.voucher_id = v_pv.id
          AND d.line_item_id = l.id
      )
      AND NOT public.jims_recurring_has_valid_supporting_v1(v_pv.id)
  ) THEN
    RAISE EXCEPTION 'Provide registered invoice evidence, or a valid FM-linked Recurring Payment Supporting Document.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_target_round
      AND a.tier = 'executive'
  ) THEN
    RAISE EXCEPTION 'Requester already verified this approval round.';
  END IF;

  UPDATE public.payment_vouchers
  SET status='pending_finance_manager',
      approval_round = v_target_round,
      updated_at=clock_timestamp()
  WHERE id=v_pv.id RETURNING * INTO v_pv;

  INSERT INTO public.pv_approval_actions
    (voucher_id,approval_round,tier,action,actor_id,remarks)
  VALUES (v_pv.id,v_pv.approval_round,'executive','verify',v_actor,NULL);

  INSERT INTO public.pv_audit_events (voucher_id,actor_id,action,details)
  VALUES (v_pv.id,v_actor,CASE WHEN v_was_returned THEN 'finance_t04_resubmitted' ELSE 'finance_t04_submitted' END,
    jsonb_build_object('tier',v_pv.financial_tier,
      'from_status',CASE WHEN v_was_returned THEN 'returned' ELSE 'draft' END,'to_status','pending_finance_manager',
      'approval_round',v_pv.approval_round));
  RETURN v_pv;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_finance_t08_v1(p_voucher_id uuid, p_expected_updated_at timestamp with time zone)
 RETURNS payment_vouchers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_pv public.payment_vouchers;
  v_lines integer;
  v_total numeric;
  v_was_returned boolean := false;
  v_target_round integer;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_actor AND role = 'executive' AND department = 'Finance'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active Finance Executive may submit Finance T08.';
  END IF;

  SELECT * INTO v_pv
  FROM public.payment_vouchers
  WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND OR NOT public.jauhar_is_current_requester_v1(p_voucher_id) THEN
    RAISE EXCEPTION 'Voucher not found or requester is not the owner.';
  END IF;
  IF v_pv.status NOT IN ('draft','returned') OR v_pv.financial_tier IS DISTINCT FROM 'T08' THEN
    RAISE EXCEPTION 'Only Finance T08 Drafts or Returned PVs can be submitted.';
  END IF;
  IF NOT (v_pv.source_template_version IS NOT DISTINCT FROM '0000' OR (v_pv.source_template_version IS NOT DISTINCT FROM '0001' AND v_pv.jims_tier_policy_version IS NOT DISTINCT FROM 'R1')) THEN
    RAISE EXCEPTION 'Draft must use the approved template revision.';
  END IF;
  IF p_expected_updated_at IS NULL OR v_pv.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Voucher changed. Close and reopen before submitting.';
  END IF;
  -- Returned PVs must have an actual Finance Manager Return action in
  -- the CURRENT round. Previous Executive verification stays as history.
  v_was_returned := v_pv.status = 'returned';
  IF v_was_returned AND NOT EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_pv.approval_round
      AND a.tier IN ('finance_manager','ceo','bod') AND a.action = 'return'
  ) THEN
    RAISE EXCEPTION 'Returned T08 PV requires a Finance Manager, CEO or BOD Return action in the current round.';
  END IF;

  -- Every resubmission creates a fresh round; old approval records are
  -- NEVER overwritten. This also prevents a second actor sign-off in the
  -- same round after an amendment.
  v_target_round := v_pv.approval_round + CASE WHEN v_was_returned THEN 1 ELSE 0 END;
  IF v_target_round IS NULL OR v_target_round > 2147483647 THEN
    RAISE EXCEPTION 'Invalid approval round. Contact System Admin.';
  END IF;

  IF nullif(btrim(coalesce(v_pv.payee_name, '')), '') IS NULL OR v_pv.amount <= 0 THEN
    RAISE EXCEPTION 'Payee and valid amount are required.';
  END IF;
  IF lower(coalesce(v_pv.budget_classification,'')) <> 'budgeted' THEN
    RAISE EXCEPTION 'Finance T08 must be Budgeted. Review Financial Tier.';
  END IF;
  -- T08 Payroll Within Budget pilot. Payroll expense type and RM limits
  -- are NOT yet finalized by Finance: do not impose guessed amount/expense rules.
  -- T08 selection, Budgeted classification, verified invoice evidence,
  -- ownership and approval authority remain mandatory.
  IF v_pv.payment_method = 'Online Transfer' AND (
     nullif(btrim(coalesce(v_pv.bank_name,'')), '') IS NULL OR
     nullif(btrim(coalesce(v_pv.bank_account_no,'')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Bank name and account number are required for online transfer.';
  END IF;

  SELECT count(*), coalesce(sum(amount),0) INTO v_lines, v_total
  FROM public.pv_line_items WHERE voucher_id = v_pv.id;
  IF v_lines < 1 OR v_pv.sst_amount IS NULL OR v_pv.sst_amount < 0
     OR round(v_total + v_pv.sst_amount,2) <> v_pv.amount THEN
    RAISE EXCEPTION 'Invoice lines, SST and total amount do not match.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
      AND nullif(btrim(coalesce(l.invoice_reference,'')),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invoice number is required on every invoice line.';
  END IF;

  -- No duplicate invoice numbers within this voucher.
  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
    GROUP BY lower(btrim(l.invoice_reference))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate invoice numbers within this voucher.';
  END IF;

  -- Conservative duplicate block across non-rejected vouchers for the same supplier.
  -- Exceptional Finance/CEO release is not yet implemented, so do not bypass.
  IF EXISTS (
    SELECT 1
    FROM public.pv_line_items current_line
    JOIN public.pv_line_items previous_line
      ON lower(btrim(previous_line.invoice_reference)) = lower(btrim(current_line.invoice_reference))
     AND previous_line.voucher_id <> v_pv.id
    JOIN public.payment_vouchers previous_pv ON previous_pv.id = previous_line.voucher_id
    WHERE current_line.voucher_id = v_pv.id
      AND previous_pv.status <> 'rejected'
      AND (
        (nullif(btrim(coalesce(v_pv.supplier_code,'')), '') IS NOT NULL
         AND lower(btrim(coalesce(previous_pv.supplier_code,''))) = lower(btrim(v_pv.supplier_code)))
        OR lower(btrim(previous_pv.payee_name)) = lower(btrim(v_pv.payee_name))
      )
  ) THEN
    RAISE EXCEPTION 'Supplier invoice number already exists in another PV. Refer to Finance Manager.';
  END IF;

  -- REAL invoice proof required for every invoice line. Merely ticking the
  -- supporting-document checklist is not acceptable evidence.
  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
      AND NOT EXISTS (
        SELECT 1 FROM public.pv_invoice_documents d
        JOIN storage.objects o
          ON o.bucket_id = 'jauhar-pv-invoices'
         AND o.name = d.storage_path
        WHERE d.voucher_id = v_pv.id
          AND d.line_item_id = l.id
      )
      AND NOT public.jims_recurring_has_valid_supporting_v1(v_pv.id)
  ) THEN
    RAISE EXCEPTION 'Provide registered invoice evidence, or a valid FM-linked Recurring Payment Supporting Document.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_target_round
      AND a.tier = 'executive'
  ) THEN
    RAISE EXCEPTION 'Requester already verified this approval round.';
  END IF;

  UPDATE public.payment_vouchers
  SET status='pending_finance_manager',
      approval_round = v_target_round,
      updated_at=clock_timestamp()
  WHERE id=v_pv.id RETURNING * INTO v_pv;

  INSERT INTO public.pv_approval_actions
    (voucher_id,approval_round,tier,action,actor_id,remarks)
  VALUES (v_pv.id,v_pv.approval_round,'executive','verify',v_actor,NULL);

  INSERT INTO public.pv_audit_events (voucher_id,actor_id,action,details)
  VALUES (v_pv.id,v_actor,CASE WHEN v_was_returned THEN 'finance_t08_resubmitted' ELSE 'finance_t08_submitted' END,
    jsonb_build_object('tier',v_pv.financial_tier,
      'from_status',CASE WHEN v_was_returned THEN 'returned' ELSE 'draft' END,'to_status','pending_finance_manager',
      'approval_round',v_pv.approval_round));
  RETURN v_pv;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_finance_jr_v1(p_voucher_id uuid, p_expected_updated_at timestamp with time zone)
 RETURNS payment_vouchers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_pv public.payment_vouchers;
  v_lines integer;
  v_total numeric;
  v_was_returned boolean := false;
  v_target_round integer;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_actor AND role = 'executive' AND department = 'Finance'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active Finance Executive may submit Finance JR.';
  END IF;

  SELECT * INTO v_pv
  FROM public.payment_vouchers
  WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND OR NOT public.jauhar_is_current_requester_v1(p_voucher_id) THEN
    RAISE EXCEPTION 'Voucher not found or requester is not the owner.';
  END IF;
  IF v_pv.status NOT IN ('draft','returned') OR v_pv.financial_tier NOT IN ('T03','T05','T06','T07','T09') THEN
    RAISE EXCEPTION 'Only Finance JR Drafts or Returned PVs can be submitted.';
  END IF;
  IF NOT (v_pv.source_template_version IS NOT DISTINCT FROM '0000' OR (v_pv.source_template_version IS NOT DISTINCT FROM '0001' AND v_pv.jims_tier_policy_version IS NOT DISTINCT FROM 'R1')) THEN
    RAISE EXCEPTION 'Draft must use the approved template revision.';
  END IF;
  IF p_expected_updated_at IS NULL OR v_pv.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Voucher changed. Close and reopen before submitting.';
  END IF;
  -- Returned PVs must have an actual Finance Manager Return action in
  -- the CURRENT round. Previous Executive verification stays as history.
  v_was_returned := v_pv.status = 'returned';
  IF v_was_returned AND NOT EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_pv.approval_round
      AND a.tier IN ('finance_manager','ceo','bod') AND a.action = 'return'
  ) THEN
    RAISE EXCEPTION 'Returned JR PV requires a Finance Manager, CEO or BOD Return action in the current round.';
  END IF;

  -- Every resubmission creates a fresh round; old approval records are
  -- NEVER overwritten. This also prevents a second actor sign-off in the
  -- same round after an amendment.
  v_target_round := v_pv.approval_round + CASE WHEN v_was_returned THEN 1 ELSE 0 END;
  IF v_target_round IS NULL OR v_target_round > 2147483647 THEN
    RAISE EXCEPTION 'Invalid approval round. Contact System Admin.';
  END IF;

  IF nullif(btrim(coalesce(v_pv.payee_name, '')), '') IS NULL OR v_pv.amount <= 0 THEN
    RAISE EXCEPTION 'Payee and valid amount are required.';
  END IF;
  IF v_pv.financial_tier IN ('T03','T05') AND lower(coalesce(v_pv.budget_classification,'')) <> 'budgeted' THEN
    RAISE EXCEPTION 'Budgeted classification required for T03/T05.';
  END IF;
  IF v_pv.financial_tier IN ('T06','T07') AND lower(coalesce(v_pv.budget_classification,'')) <> 'unbudgeted' THEN
    RAISE EXCEPTION 'Unbudgeted classification required for T06/T07.';
  END IF;
  -- T08 Payroll Within Budget pilot. Payroll expense type and RM limits
  -- are NOT yet finalized by Finance: do not impose guessed amount/expense rules.
  -- T08 selection, Budgeted classification, verified invoice evidence,
  -- ownership and approval authority remain mandatory.
  IF v_pv.payment_method = 'Online Transfer' AND (
     nullif(btrim(coalesce(v_pv.bank_name,'')), '') IS NULL OR
     nullif(btrim(coalesce(v_pv.bank_account_no,'')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Bank name and account number are required for online transfer.';
  END IF;

  SELECT count(*), coalesce(sum(amount),0) INTO v_lines, v_total
  FROM public.pv_line_items WHERE voucher_id = v_pv.id;
  IF v_lines < 1 OR v_pv.sst_amount IS NULL OR v_pv.sst_amount < 0
     OR round(v_total + v_pv.sst_amount,2) <> v_pv.amount THEN
    RAISE EXCEPTION 'Invoice lines, SST and total amount do not match.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
      AND nullif(btrim(coalesce(l.invoice_reference,'')),'') IS NULL
  ) THEN
    RAISE EXCEPTION 'Invoice number is required on every invoice line.';
  END IF;

  -- No duplicate invoice numbers within this voucher.
  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
    GROUP BY lower(btrim(l.invoice_reference))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate invoice numbers within this voucher.';
  END IF;

  -- Conservative duplicate block across non-rejected vouchers for the same supplier.
  -- Exceptional Finance/CEO release is not yet implemented, so do not bypass.
  IF EXISTS (
    SELECT 1
    FROM public.pv_line_items current_line
    JOIN public.pv_line_items previous_line
      ON lower(btrim(previous_line.invoice_reference)) = lower(btrim(current_line.invoice_reference))
     AND previous_line.voucher_id <> v_pv.id
    JOIN public.payment_vouchers previous_pv ON previous_pv.id = previous_line.voucher_id
    WHERE current_line.voucher_id = v_pv.id
      AND previous_pv.status <> 'rejected'
      AND (
        (nullif(btrim(coalesce(v_pv.supplier_code,'')), '') IS NOT NULL
         AND lower(btrim(coalesce(previous_pv.supplier_code,''))) = lower(btrim(v_pv.supplier_code)))
        OR lower(btrim(previous_pv.payee_name)) = lower(btrim(v_pv.payee_name))
      )
  ) THEN
    RAISE EXCEPTION 'Supplier invoice number already exists in another PV. Refer to Finance Manager.';
  END IF;

  -- REAL invoice proof required for every invoice line. Merely ticking the
  -- supporting-document checklist is not acceptable evidence.
  IF EXISTS (
    SELECT 1 FROM public.pv_line_items l
    WHERE l.voucher_id = v_pv.id
      AND NOT EXISTS (
        SELECT 1 FROM public.pv_invoice_documents d
        JOIN storage.objects o
          ON o.bucket_id = 'jauhar-pv-invoices'
         AND o.name = d.storage_path
        WHERE d.voucher_id = v_pv.id
          AND d.line_item_id = l.id
      )
      AND NOT public.jims_recurring_has_valid_supporting_v1(v_pv.id)
  ) THEN
    RAISE EXCEPTION 'Provide registered invoice evidence, or a valid FM-linked Recurring Payment Supporting Document.';
  END IF;


  -- Require a registered, private JR PDF. Versions are immutable.
  -- On Return, upload a revised JR if the justification actually changes;
  -- otherwise the existing registered JR remains valid evidence.
  IF NOT EXISTS (
   SELECT 1 FROM public.pv_justification_reports j
   JOIN storage.objects o ON o.bucket_id='jauhar-pv-jr' AND o.name=j.storage_path
   WHERE j.voucher_id=v_pv.id
  ) THEN RAISE EXCEPTION 'Upload and register a JR PDF before submitting this tier'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_target_round
      AND a.tier = 'executive'
  ) THEN
    RAISE EXCEPTION 'Requester already verified this approval round.';
  END IF;

  UPDATE public.payment_vouchers
  SET status='pending_finance_manager',
      approval_round = v_target_round,
      updated_at=clock_timestamp()
  WHERE id=v_pv.id RETURNING * INTO v_pv;

  INSERT INTO public.pv_approval_actions
    (voucher_id,approval_round,tier,action,actor_id,remarks)
  VALUES (v_pv.id,v_pv.approval_round,'executive','verify',v_actor,NULL);

  INSERT INTO public.pv_audit_events (voucher_id,actor_id,action,details)
  VALUES (v_pv.id,v_actor,CASE WHEN v_was_returned THEN 'finance_jr_resubmitted' ELSE 'finance_jr_submitted' END,
    jsonb_build_object('tier',v_pv.financial_tier,
      'from_status',CASE WHEN v_was_returned THEN 'returned' ELSE 'draft' END,'to_status','pending_finance_manager',
      'approval_round',v_pv.approval_round));
  RETURN v_pv;
END;
$function$;

