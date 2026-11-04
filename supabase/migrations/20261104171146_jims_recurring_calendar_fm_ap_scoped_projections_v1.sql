-- UAT-R04 staging only: FM/AP scoped recurring tasks & future monthly projections for Payment Calendar.
-- Existing PV calendar RPC, PV approval authority and settlement calculations remain unchanged.
CREATE OR REPLACE FUNCTION public.jims_recurring_calendar_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
 v_actor uuid := auth.uid();
 v_role text;
 v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
 v_month date := date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
 v_existing integer;
 v_active integer;
 v_records jsonb;
BEGIN
 SELECT CASE
   WHEN p.role='manager' AND p.department='Finance' THEN 'finance_manager'
   WHEN p.role='executive' AND p.department='Finance'
        AND p.subdepartment='Accounts Payable' THEN 'ap_executive'
   ELSE NULL END INTO v_role
 FROM public.user_profiles p
 WHERE p.id=v_actor AND p.is_active IS TRUE;

 IF v_role IS NULL THEN
  RAISE EXCEPTION 'Recurring Payment Calendar is available only to Finance Manager or assigned AP Executive'
    USING ERRCODE='42501';
 END IF;

 SELECT count(*) INTO v_existing
 FROM private.jims_recurring_ap_tasks_v1 t
 WHERE v_role='finance_manager' OR t.assigned_ap_id=v_actor;
 SELECT count(*) INTO v_active
 FROM private.jims_recurring_instructions_v1 i
 JOIN private.jims_recurring_categories_v1 c ON c.id=i.category_id
 WHERE i.status='active' AND c.is_active
   AND (v_role='finance_manager' OR i.assigned_ap_id=v_actor)
   AND (i.end_month IS NULL OR i.end_month>=v_month)
   AND i.start_month<=(v_month+interval '12 months')::date;
 IF v_existing>2500 OR v_active>150 OR v_existing+13*v_active>4500 THEN
  RAISE EXCEPTION 'Recurring Calendar exceeded safe data limits; pagination is required'
    USING ERRCODE='54000';
 END IF;

 WITH existing AS (
   SELECT
     t.id::text AS id, 'task'::text AS source,
     t.instruction_id,t.period_month,t.due_date,t.status,
     t.supplier_name,t.category_name,t.branch_code,
     t.amount_type,t.fixed_amount,t.assigned_ap_id,ap.username AS assigned_ap_name,
     t.linked_voucher_id,v.pv_number AS linked_pv_number,
     v.status AS linked_pv_status,v.payment_status AS linked_payment_status
   FROM private.jims_recurring_ap_tasks_v1 t
   LEFT JOIN public.user_profiles ap ON ap.id=t.assigned_ap_id
   LEFT JOIN public.payment_vouchers v ON v.id=t.linked_voucher_id
   WHERE v_role='finance_manager' OR t.assigned_ap_id=v_actor
 ), projected AS (
   SELECT
     (i.id::text || '-' || to_char(gs.month_dt,'YYYY-MM')) AS id,
     'projection'::text AS source,
     i.id AS instruction_id,
     gs.month_dt::date AS period_month,
     (gs.month_dt::date +
       (least(i.due_day,EXTRACT(day FROM
         (gs.month_dt + interval '1 month - 1 day'))::integer)-1))::date AS due_date,
     'scheduled'::text AS status,
     i.supplier_name,c.name AS category_name,i.branch_code,
     i.amount_type,i.fixed_amount,i.assigned_ap_id,
     ap.username AS assigned_ap_name,
     NULL::uuid AS linked_voucher_id,
     NULL::text AS linked_pv_number,
     NULL::text AS linked_pv_status,
     NULL::text AS linked_payment_status
   FROM private.jims_recurring_instructions_v1 i
   JOIN private.jims_recurring_categories_v1 c ON c.id=i.category_id
   JOIN public.user_profiles ap ON ap.id=i.assigned_ap_id
   CROSS JOIN LATERAL generate_series(
     v_month::timestamp,
     (v_month+interval '12 months')::timestamp,
     interval '1 month'
   ) AS gs(month_dt)
   WHERE i.status='active' AND c.is_active
     AND ap.is_active AND ap.role='executive'
     AND ap.department='Finance' AND ap.subdepartment='Accounts Payable'
     AND (v_role='finance_manager' OR i.assigned_ap_id=v_actor)
     AND i.start_month<=gs.month_dt::date
     AND (i.end_month IS NULL OR i.end_month>=gs.month_dt::date)
     AND NOT EXISTS(
       SELECT 1 FROM private.jims_recurring_ap_tasks_v1 t
       WHERE t.instruction_id=i.id AND t.period_month=gs.month_dt::date
     )
 ), combined AS (
   SELECT * FROM existing
   UNION ALL
   SELECT * FROM projected
 )
 SELECT coalesce(
   jsonb_agg(to_jsonb(r) ORDER BY r.due_date,r.supplier_name,r.id),
   '[]'::jsonb
 ) INTO v_records FROM combined r;

 RETURN jsonb_build_object(
   'role',v_role,'today',v_today,'records',v_records,
   'count',jsonb_array_length(v_records),
   'rules','Recurring tasks and forecasts are informational and never added to PV outstanding totals.'
 );
END;
$fn$;

REVOKE ALL ON FUNCTION public.jims_recurring_calendar_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_recurring_calendar_v1() TO authenticated;