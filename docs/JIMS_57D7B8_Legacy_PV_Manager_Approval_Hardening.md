# JIMS 57D7B8 — Legacy PV Manager Approval Finance-only Hardening

**Date:** 2026-11-01 (Asia/Kuala_Lumpur)  
**Supabase project:** `npaozikolbwlvnztvoef`  
**GitHub branch:** `jsync-gui-revamp-20261029`  
**Migration:** `jims_57d7b8_legacy_pv_finance_manager_gate`  
**Result:** Applied and source-verified. Role/browser UAT still pending.

## Why this was needed

The old `public.manager_decide_pv(uuid,text,timestamp with time zone,text)` is an authenticated-callable SECURITY DEFINER RPC. It previously required only an active `manager` role, allowing Operation/other-department Managers to pass the actor predicate. The currently active JIMS UI still uses the RPC in its legacy `pending_manager` decision section, while current tiered vouchers use newer routes.

Prior to patch:
- Zero PVs in `pending_manager` status.
- Two historical legacy `manager` approvals, both by the current Finance Manager on Finance-origin, Financial Tier NULL vouchers.
- No active tier-null drafts: the one observed tier-null draft was archived.
- Tiered PVs already blocked from transitioning into `pending_manager` via `pv_prevent_financial_tier_legacy_route`.

## Exact, minimum production change

Only the role predicate changed inside `manager_decide_pv`:

Before:
```sql
AND p.role = 'manager'
AND p.is_active = TRUE
```

After:
```sql
AND p.role = 'manager'
AND p.department = 'Finance'
AND p.is_active = TRUE
```

Unchanged:
- SECURITY DEFINER, pinned empty search_path, function signature and `payment_vouchers` return type.
- `Approve / Return for Amendment / Reject Permanently`, requiring remarks on Return/Reject.
- `pending_manager` status validation, `FOR UPDATE` lock, `updated_at` optimistic concurrency check.
- Requirement for preceding Executive verification, duplicate Manager decision guard, existing status transitions.
- Approval action insert and audit event insert; no existing records updated.
- Function grants: `authenticated EXECUTE=true`; `anon EXECUTE=false`.
- No React/GUI, Edge Function, payment initiation, payment completion, Petty Cash, Delegation or RLS modifications.

Migration included an exact old-source concurrency guard and a post-creation Finance-predicate check. The post-migration source matched the intended text after normalizing newline characters and roundtripped exactly to the saved original source by removing only the added clause.

## Tests

- Static authorization matrix: **12 PASS** for active Finance Manager, non-Finance Managers, inactive Finance Manager, and unrelated roles.
- Workflow invariants: **15 intact**; only Finance Department authorization added.
- Targeted read-only SQL `uat/JIMS_57D7B8_Legacy_Manager_Approval_ReadOnly.sql`: **15 PASS / 0 FAIL**.
- Existing master read-only regression: **10 PASS / 1 NOT EXERCISED / 0 FAIL**; JR final-approval document sample count zero.
- Postcheck counts unchanged: 9 user profiles, 31 PV, 1 Petty Cash, 0 current pending_manager vouchers, 2 historical `manager` approval actions.
- All public SECURITY DEFINER functions: 0 executable by anon, 115 by authenticated; advisor warning counts unchanged. These warnings alone do not prove exploitation.

## GUI and deployment caveat

The existing `app/src/PaymentVoucher.jsx` legacy UI decision panel checks `canManage` (generic Manager role) for `pending_manager`, not `profile.department === 'Finance'`. That panel was intentionally **not edited** in this backend-only security patch to avoid modifying the complex existing GUI without a build and browser UAT. An Operation Manager viewing an otherwise visible legacy pending_manager PV may see an action that the now-secure RPC denies. There are currently no vouchers in this status; do not call the GUI fully signed off.

The full app frontend build or browser UAT was not run in this step. No paid voucher, payment date, signature, approval or payment record was mutated to simulate a role.

## Rollback — exact previous function source (DO NOT APPLY AS ROUTINE)

Restoring the old version will **reintroduce the unauthorized non-Finance Manager privilege**. Only run after explicit review and emergency rollback decision, and consider a safer alternate fix first. Never delete or edit approval histories to roll back a code change.

```sql
CREATE OR REPLACE FUNCTION public.manager_decide_pv(p_voucher_id uuid, p_decision text, p_expected_updated_at timestamp with time zone, p_remarks text DEFAULT NULL::text)
 RETURNS payment_vouchers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_pv public.payment_vouchers;
  v_decision TEXT := lower(btrim(coalesce(p_decision, '')));
  v_remarks TEXT := nullif(btrim(coalesce(p_remarks, '')), '');
  v_new_status TEXT;
BEGIN
  -- The Finance Manager role must be ACTIVE.
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = v_actor
      AND p.role = 'manager'
      AND p.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Only an active Manager may decide a PV';
  END IF;

  IF v_decision NOT IN ('approve', 'return', 'reject') THEN
    RAISE EXCEPTION 'Invalid decision: approve, return, or reject required';
  END IF;

  IF v_decision IN ('return', 'reject') AND v_remarks IS NULL THEN
    RAISE EXCEPTION 'Remarks are required when returning or rejecting a PV';
  END IF;

  IF length(coalesce(v_remarks, '')) > 2000 THEN
    RAISE EXCEPTION 'Remarks must be 2000 characters or fewer';
  END IF;

  -- Lock PV to guard against two approvers acting at the same time.
  SELECT * INTO v_pv
  FROM public.payment_vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment Voucher not found';
  END IF;

  IF v_pv.status <> 'pending_manager' THEN
    RAISE EXCEPTION 'Only Pending Manager vouchers can be decided by Manager';
  END IF;

  IF p_expected_updated_at IS NULL
     OR v_pv.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Voucher has changed. Close and reopen before deciding';
  END IF;

  -- Enforce sequential approval: Executive Tier 1 must exist in same round.
  IF NOT EXISTS (
    SELECT 1
    FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_pv.approval_round
      AND a.tier = 'executive'
      AND a.action = 'verify'
  ) THEN
    RAISE EXCEPTION 'Executive Tier 1 verification is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_pv.approval_round
      AND a.tier = 'manager'
  ) THEN
    RAISE EXCEPTION 'This round already has a Manager decision';
  END IF;

  v_new_status := CASE v_decision
    WHEN 'approve' THEN 'pending_ceo'
    WHEN 'return'  THEN 'returned'
    WHEN 'reject'  THEN 'rejected'
  END;

  INSERT INTO public.pv_approval_actions (
    voucher_id, approval_round, tier, action, actor_id, remarks
  ) VALUES (
    v_pv.id, v_pv.approval_round, 'manager', v_decision, v_actor, v_remarks
  );

  UPDATE public.payment_vouchers
  SET status = v_new_status,
      updated_at = clock_timestamp()
  WHERE id = v_pv.id
  RETURNING * INTO v_pv;

  INSERT INTO public.pv_audit_events (
    voucher_id, actor_id, action, details
  ) VALUES (
    v_pv.id, v_actor, 'manager_' || v_decision,
    jsonb_build_object(
      'pv_number', v_pv.pv_number,
      'approval_round', v_pv.approval_round,
      'from_status', 'pending_manager',
      'to_status', v_new_status,
      'tier', 'manager',
      'remarks', v_remarks
    )
  );

  RETURN v_pv;
END;
$function$;
```

## Reapply — secured source reference

```sql
CREATE OR REPLACE FUNCTION public.manager_decide_pv(p_voucher_id uuid, p_decision text, p_expected_updated_at timestamp with time zone, p_remarks text DEFAULT NULL::text)
 RETURNS payment_vouchers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_pv public.payment_vouchers;
  v_decision TEXT := lower(btrim(coalesce(p_decision, '')));
  v_remarks TEXT := nullif(btrim(coalesce(p_remarks, '')), '');
  v_new_status TEXT;
BEGIN
  -- The Finance Manager role must be ACTIVE.
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = v_actor
      AND p.role = 'manager'
      AND p.department = 'Finance'
      AND p.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Only an active Manager may decide a PV';
  END IF;

  IF v_decision NOT IN ('approve', 'return', 'reject') THEN
    RAISE EXCEPTION 'Invalid decision: approve, return, or reject required';
  END IF;

  IF v_decision IN ('return', 'reject') AND v_remarks IS NULL THEN
    RAISE EXCEPTION 'Remarks are required when returning or rejecting a PV';
  END IF;

  IF length(coalesce(v_remarks, '')) > 2000 THEN
    RAISE EXCEPTION 'Remarks must be 2000 characters or fewer';
  END IF;

  -- Lock PV to guard against two approvers acting at the same time.
  SELECT * INTO v_pv
  FROM public.payment_vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment Voucher not found';
  END IF;

  IF v_pv.status <> 'pending_manager' THEN
    RAISE EXCEPTION 'Only Pending Manager vouchers can be decided by Manager';
  END IF;

  IF p_expected_updated_at IS NULL
     OR v_pv.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Voucher has changed. Close and reopen before deciding';
  END IF;

  -- Enforce sequential approval: Executive Tier 1 must exist in same round.
  IF NOT EXISTS (
    SELECT 1
    FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_pv.approval_round
      AND a.tier = 'executive'
      AND a.action = 'verify'
  ) THEN
    RAISE EXCEPTION 'Executive Tier 1 verification is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pv_approval_actions a
    WHERE a.voucher_id = v_pv.id
      AND a.approval_round = v_pv.approval_round
      AND a.tier = 'manager'
  ) THEN
    RAISE EXCEPTION 'This round already has a Manager decision';
  END IF;

  v_new_status := CASE v_decision
    WHEN 'approve' THEN 'pending_ceo'
    WHEN 'return'  THEN 'returned'
    WHEN 'reject'  THEN 'rejected'
  END;

  INSERT INTO public.pv_approval_actions (
    voucher_id, approval_round, tier, action, actor_id, remarks
  ) VALUES (
    v_pv.id, v_pv.approval_round, 'manager', v_decision, v_actor, v_remarks
  );

  UPDATE public.payment_vouchers
  SET status = v_new_status,
      updated_at = clock_timestamp()
  WHERE id = v_pv.id
  RETURNING * INTO v_pv;

  INSERT INTO public.pv_audit_events (
    voucher_id, actor_id, action, details
  ) VALUES (
    v_pv.id, v_actor, 'manager_' || v_decision,
    jsonb_build_object(
      'pv_number', v_pv.pv_number,
      'approval_round', v_pv.approval_round,
      'from_status', 'pending_manager',
      'to_status', v_new_status,
      'tier', 'manager',
      'remarks', v_remarks
    )
  );

  RETURN v_pv;
END;
$function$;
```

## Next gate

- Isolated staging negative-auth UAT: Finance Manager allowed to approve, return and reject eligible legacy test PVs; Operation Manager and other Departments receive authorization denial when calling the RPC directly.
- Verify archived or tiered PVs cannot enter the legacy route.
- Verify frontend shows only relevant manager decisions; if necessary adjust the legacy button guard **in a separately tested, reversible frontend-only change**.
- Run original PV tier approval, payment tracking, petty cash, delegation and role-based browser regressions before production go-live.

**Go-live remains HOLD.** This step is locked as a *verified database authorization patch*, not an end-to-end GUI UAT sign-off.
