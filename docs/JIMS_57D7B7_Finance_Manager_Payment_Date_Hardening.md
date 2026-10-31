# JIMS — Step 57D7B7: Finance Manager Payment Date Authorization Hardening

**Date:** 2026-11-01 (Asia/Kuala_Lumpur)  
**Project:** `npaozikolbwlvnztvoef`  
**Branch:** `jsync-gui-revamp-20261029`  
**Status:** Single-function server-side security guard deployed and source verified. Read-only regression PASS; browser UAT pending.

## Locked requirement

- `public.manager_correct_pv_payment_date(uuid,date,text)` remains available only for **active Finance Managers**.
- Active Operation/other Department Managers must not be able to bypass Finance authority by calling the RPC directly.
- The existing Payment Voucher GUI and workflow **must not be changed**.
- Function name, parameters, return type, date validation, paid-PV status gate, reason field, transaction update and audit logging remain identical.
- CEO/BOD global Department = NULL requirement is unchanged.
- This security change does not alter any Approval, Delegation, Petty Cash, payment initiation, receipt, financial amount or existing account records.

## What changed

Only the existing `user_profiles` actor check in `manager_correct_pv_payment_date`:

Before:
```sql
WHERE p.id = v_actor AND p.role = 'manager' AND p.is_active = TRUE
```

After:
```sql
WHERE p.id = v_actor AND p.role = 'manager' AND p.department = 'Finance' AND p.is_active = TRUE
```

Applied via Supabase migration `jims_57d7b7_finance_only_payment_date_correction`, with an exact original-definition preflight guard. A first migration attempt failed to parse at a missing statement terminator and made **no live changes**; the original function was verified intact before the corrected migration succeeded.

## Verification evidence

- Static permission matrix **8/8 PASS**: active Finance Manager allowed by role predicate; active Operation Manager, Finance Executive, CEO, BOD, System Admin, inactive Finance Manager and NULL caller excluded.
- Post-deployment original-vs-new source **exact diff** verified: one predicate addition only.
- `SECURITY DEFINER`, pinned empty `search_path`, same RPC signature, and `payment_vouchers` return contract retained.
- Authenticated EXECUTE remains **true** (GUI RPC works in principle); anon EXECUTE remains **false**.
- Targeted read-only regression `uat/JIMS_57D7B7_Finance_Manager_Payment_Date_ReadOnly.sql`: **12 PASS / 0 FAIL**.
- Existing master regression `uat/JIMS_Regression_UAT_ReadOnly.sql`: **10 PASS / 1 NOT EXERCISED / 0 FAIL**. Not exercised: R1 JR final-approval document sample zero.
- Postcheck profile/PV/Petty Cash record counts unchanged: **9 profiles, 31 PV, 1 PC**.
- Security advisor counts unchanged: 115 authenticated SECURITY DEFINER warnings, 5 RLS/no-policy infos, one leaked password protection warning; 0 anonymous-executable public SECURITY DEFINER functions.

**Limit:** These checks do not prove real interactive authenticated denial/allowance. Do not conduct a live transaction mutation to test. Conduct role-based negative UAT against staging/test PV before go-live.

## Rollback source — exact previous function

Use **only if needed**, after review/approval and a fresh diff check against live; restoring removes the Finance-only protection and reopens the previously identified authorization gap. This is included solely for controlled recovery. Do not run as part of routine UAT.

```sql
CREATE OR REPLACE FUNCTION public.manager_correct_pv_payment_date(p_voucher_id uuid, p_payment_date date, p_reason text)
 RETURNS payment_vouchers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_pv public.payment_vouchers;
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_old_date DATE;
  v_local_today DATE := (NOW() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = v_actor AND p.role = 'manager' AND p.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Active Manager role required';
  END IF;

  IF v_reason IS NULL OR LENGTH(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Correction reason is required (maximum 1000 characters)';
  END IF;

  SELECT * INTO v_pv
  FROM public.payment_vouchers WHERE id = p_voucher_id FOR UPDATE;

  IF NOT FOUND OR v_pv.status <> 'fully_approved' OR v_pv.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Only Paid, fully approved vouchers can be corrected';
  END IF;

  IF p_payment_date IS NULL OR p_payment_date > v_local_today OR
     v_pv.final_approval_date IS NULL OR
     p_payment_date < (v_pv.final_approval_date AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN
    RAISE EXCEPTION 'Invalid Payment Date';
  END IF;

  IF v_pv.payment_date IS NOT DISTINCT FROM p_payment_date THEN
    RAISE EXCEPTION 'New Payment Date is the same as the existing date';
  END IF;

  v_old_date := v_pv.payment_date;
  UPDATE public.payment_vouchers
  SET payment_date = p_payment_date,
      updated_at = CLOCK_TIMESTAMP()
  WHERE id = p_voucher_id
  RETURNING * INTO v_pv;

  INSERT INTO public.pv_audit_events (voucher_id, actor_id, action, details)
  VALUES (
    p_voucher_id, v_actor, 'manager_correct_payment_date',
    jsonb_build_object(
      'pv_number', v_pv.pv_number,
      'old_payment_date', v_old_date,
      'new_payment_date', p_payment_date,
      'reason', v_reason
    )
  );

  RETURN v_pv;
END;
$function$;
```

## Reapply source — current protected function (reference only)

```sql
CREATE OR REPLACE FUNCTION public.manager_correct_pv_payment_date(p_voucher_id uuid, p_payment_date date, p_reason text)
 RETURNS payment_vouchers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_pv public.payment_vouchers;
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_old_date DATE;
  v_local_today DATE := (NOW() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = v_actor AND p.role = 'manager' AND p.department = 'Finance' AND p.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Active Manager role required';
  END IF;

  IF v_reason IS NULL OR LENGTH(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Correction reason is required (maximum 1000 characters)';
  END IF;

  SELECT * INTO v_pv
  FROM public.payment_vouchers WHERE id = p_voucher_id FOR UPDATE;

  IF NOT FOUND OR v_pv.status <> 'fully_approved' OR v_pv.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Only Paid, fully approved vouchers can be corrected';
  END IF;

  IF p_payment_date IS NULL OR p_payment_date > v_local_today OR
     v_pv.final_approval_date IS NULL OR
     p_payment_date < (v_pv.final_approval_date AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN
    RAISE EXCEPTION 'Invalid Payment Date';
  END IF;

  IF v_pv.payment_date IS NOT DISTINCT FROM p_payment_date THEN
    RAISE EXCEPTION 'New Payment Date is the same as the existing date';
  END IF;

  v_old_date := v_pv.payment_date;
  UPDATE public.payment_vouchers
  SET payment_date = p_payment_date,
      updated_at = CLOCK_TIMESTAMP()
  WHERE id = p_voucher_id
  RETURNING * INTO v_pv;

  INSERT INTO public.pv_audit_events (voucher_id, actor_id, action, details)
  VALUES (
    p_voucher_id, v_actor, 'manager_correct_payment_date',
    jsonb_build_object(
      'pv_number', v_pv.pv_number,
      'old_payment_date', v_old_date,
      'new_payment_date', p_payment_date,
      'reason', v_reason
    )
  );

  RETURN v_pv;
END;
$function$;
```

## Go-live HOLD checklist

1. In isolated staging, Finance Manager account can correct the payment date of a sample fully approved + Paid PV with a required reason, and the audit entry is present.
2. Operation Manager cannot call the RPC directly even with a known eligible PV ID; Finance Executive and System Admin also denied.
3. GUI Payment Voucher correction screen behaves exactly as before for active Finance Manager.
4. Historical PV/PC and dashboard regression continues to pass, and role UAT on desktop/browser is complete.
5. Separate issue: legacy `manager_decide_pv` still checks active Manager without explicit Finance Department; review separately to preserve legacy approval behavior. Do not consider this particular issue solved by 57D7B7.

**Read-only test:** https://github.com/mixtea92/Jauhar/blob/jsync-gui-revamp-20261029/uat/JIMS_57D7B7_Finance_Manager_Payment_Date_ReadOnly.sql
