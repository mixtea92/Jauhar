-- JIMS REGRESSION UAT — READ-ONLY SMOKE CHECKS
-- Created 2026-10-30; safe for live Supabase because SELECT only.
-- Re-run after each JIMS release. Any REVIEW needs investigation, not automatic mutation.
-- NOT EXERCISED != PASS (no sample exists).
-- Does not replace role-based browser UAT or negative authorization tests.

WITH checks AS (
SELECT 'PV unique active running numbers' AS test_name,
 (SELECT count(*) FROM public.payment_vouchers WHERE archived_at IS NULL) AS samples,
 (SELECT count(*) FROM (
   SELECT pv_number FROM public.payment_vouchers WHERE archived_at IS NULL
   GROUP BY pv_number HAVING count(*) > 1
 ) d) AS failures

UNION ALL
SELECT 'Tier R1 amount thresholds', 
 (SELECT count(*) FROM public.payment_vouchers WHERE jims_tier_policy_version = 'R1'),
 (SELECT count(*) FROM public.payment_vouchers
  WHERE jims_tier_policy_version = 'R1'
  AND (
    (financial_tier IN ('T02','T03') AND amount > 10000) OR
    (financial_tier IN ('T04','T05') AND amount <= 10000) OR
    (financial_tier='T06' AND amount > 1000) OR
    (financial_tier='T07' AND amount <= 1000)
  ))

UNION ALL
SELECT 'Final approved PV positive amount',
 (SELECT count(*) FROM public.payment_vouchers WHERE status='fully_approved'),
 (SELECT count(*) FROM public.payment_vouchers
   WHERE status='fully_approved' AND (amount IS NULL OR amount <= 0))

UNION ALL
SELECT 'No Paid flag before final approval',
 (SELECT count(*) FROM public.payment_vouchers WHERE payment_status='paid'),
 (SELECT count(*) FROM public.payment_vouchers
  WHERE payment_status='paid' AND status <> 'fully_approved')

UNION ALL
SELECT 'Paid partial tranche total within PV amount',
 (SELECT count(distinct voucher_id) FROM public.pv_payment_transactions WHERE status='paid'),
 (SELECT count(*) FROM (
   SELECT v.id FROM public.payment_vouchers v
   JOIN public.pv_payment_transactions t ON t.voucher_id=v.id AND t.status='paid'
   GROUP BY v.id,v.amount
   HAVING sum(coalesce(t.settled_amount,0))>v.amount+0.001
 ) bad)

UNION ALL
SELECT 'PV committed equals paid plus waiting',
 (SELECT count(*) FROM private.jims_financial_positions_v1 WHERE source_type='payment_voucher'),
 (SELECT count(*) FROM private.jims_financial_positions_v1
   WHERE source_type='payment_voucher'
     AND abs(committed_amount-paid_amount-waiting_to_pay_amount)>0.01)

UNION ALL
SELECT 'One background metadata record per PV',
 (SELECT count(*) FROM public.payment_vouchers),
 (SELECT count(*) FROM public.payment_vouchers v
   WHERE (SELECT count(*) FROM private.jims_financial_metadata_v1 m
          WHERE m.source_type='payment_voucher' AND m.source_id=v.id)<>1)

UNION ALL
SELECT 'One background metadata record per Petty Cash',
 (SELECT count(*) FROM public.cash_vouchers),
 (SELECT count(*) FROM public.cash_vouchers c
   WHERE (SELECT count(*) FROM private.jims_financial_metadata_v1 m
          WHERE m.source_type='petty_cash' AND m.source_id=c.id)<>1)

UNION ALL
SELECT 'Closed Petty Cash requires both HOD signatures',
 (SELECT count(*) FROM public.cash_vouchers WHERE status='closed'),
 (SELECT count(*) FROM public.cash_vouchers c
   WHERE c.status='closed'
     AND (NOT EXISTS (SELECT 1 FROM public.cash_voucher_approvals a
                      WHERE a.voucher_id=c.id AND a.authority='applicable_hod')
       OR NOT EXISTS (SELECT 1 FROM public.cash_voucher_approvals a
                      WHERE a.voucher_id=c.id AND a.authority='finance_hod')))

UNION ALL
SELECT 'R1 JR final approvals have a registered JR document',
 (SELECT count(*) FROM public.payment_vouchers
   WHERE jims_tier_policy_version='R1'
     AND financial_tier IN ('T03','T05','T06','T07','T09')
     AND status='fully_approved'),
 (SELECT count(*) FROM public.payment_vouchers v
   WHERE v.jims_tier_policy_version='R1'
     AND v.financial_tier IN ('T03','T05','T06','T07','T09')
     AND v.status='fully_approved'
     AND NOT EXISTS (SELECT 1 FROM public.pv_justification_reports j
                     WHERE j.voucher_id=v.id))

UNION ALL
SELECT 'Private financial metadata access denied to browser roles',
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='private' AND c.relname='jims_financial_metadata_v1'),
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='private' AND c.relname='jims_financial_metadata_v1'
    AND (has_table_privilege('anon',c.oid,'SELECT')
      OR has_table_privilege('authenticated',c.oid,'SELECT')))
)
SELECT test_name,samples,failures,
  CASE WHEN failures>0 THEN 'REVIEW'
       WHEN samples=0 THEN 'NOT EXERCISED'
       ELSE 'PASS' END AS result
FROM checks ORDER BY test_name;
