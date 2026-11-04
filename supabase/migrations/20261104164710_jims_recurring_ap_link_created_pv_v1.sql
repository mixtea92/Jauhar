-- Additive AP acknowledgement: link the actual AP-created PV to the monthly FM instruction.
-- No PV creation, status or approval authority changes.
ALTER TABLE private.jims_recurring_ap_tasks_v1
 ADD COLUMN IF NOT EXISTS linked_voucher_id uuid UNIQUE REFERENCES public.payment_vouchers(id);
ALTER TABLE private.jims_recurring_ap_tasks_v1
 DROP CONSTRAINT IF EXISTS jims_recurring_ap_tasks_v1_status_check;
ALTER TABLE private.jims_recurring_ap_tasks_v1
 ADD CONSTRAINT jims_recurring_ap_tasks_v1_status_check CHECK (status IN ('pending_ap','pv_linked','cancelled'));

CREATE OR REPLACE FUNCTION public.jims_recurring_ap_tasks_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid()
  AND p.is_active AND p.role='executive' AND p.department='Finance'
  AND p.subdepartment='Accounts Payable'
 ) THEN
  RAISE EXCEPTION 'Accounts Payable Executive only' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM private.jims_recurring_ap_tasks_v1
     WHERE assigned_ap_id=auth.uid() AND status IN ('pending_ap','pv_linked'))>300 THEN
  RAISE EXCEPTION 'AP recurring task list exceeds 300; pagination required' USING ERRCODE='54000';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'period_month',t.period_month,'due_date',t.due_date,
    'supplier_name',t.supplier_name,'category_name',t.category_name,
    'branch_code',t.branch_code,'amount_type',t.amount_type,
    'fixed_amount',t.fixed_amount,'status',t.status,
    'created_at',t.created_at,'linked_voucher_id',t.linked_voucher_id,
    'linked_pv_number',v.pv_number,'linked_pv_status',v.status,
    'linked_payment_status',v.payment_status)
    ORDER BY t.due_date DESC,t.created_at DESC),'[]'::jsonb)
 INTO v_rows
 FROM private.jims_recurring_ap_tasks_v1 t
 LEFT JOIN public.payment_vouchers v ON v.id=t.linked_voucher_id
 WHERE t.assigned_ap_id=auth.uid() AND t.status IN ('pending_ap','pv_linked');
 RETURN jsonb_build_object('tasks',v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.jims_recurring_ap_link_pv_v1(
 p_task_id uuid,p_pv_number text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE t private.jims_recurring_ap_tasks_v1;
 v public.payment_vouchers;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.is_active
   AND p.role='executive' AND p.department='Finance'
   AND p.subdepartment='Accounts Payable'
 ) THEN
  RAISE EXCEPTION 'Accounts Payable Executive only' USING ERRCODE='42501';
 END IF;
 SELECT * INTO t FROM private.jims_recurring_ap_tasks_v1
 WHERE id=p_task_id AND assigned_ap_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR t.status<>'pending_ap' OR t.linked_voucher_id IS NOT NULL THEN
  RAISE EXCEPTION 'This AP task is unavailable or already linked' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v FROM public.payment_vouchers
 WHERE pv_number=btrim(coalesce(p_pv_number,''))
   AND created_by=auth.uid() AND archived_at IS NULL;
 IF NOT FOUND OR v.status IN ('rejected') THEN
  RAISE EXCEPTION 'PV not found under your AP account or is rejected' USING ERRCODE='22023';
 END IF;
 IF lower(btrim(coalesce(v.payee_name,'')))<>lower(btrim(t.supplier_name)) THEN
  RAISE EXCEPTION 'Supplier on PV must match the recurring instruction' USING ERRCODE='22023';
 END IF;
 UPDATE private.jims_recurring_ap_tasks_v1
 SET linked_voucher_id=v.id,status='pv_linked'
 WHERE id=t.id;
 INSERT INTO private.jims_recurring_audit_v1(actor_id,entity_type,entity_id,action,payload)
 VALUES(auth.uid(),'task',t.id,'linked_pv',
   jsonb_build_object('pv_id',v.id,'pv_number',v.pv_number,'period_month',t.period_month));
 RETURN v.id;
END;
$$;
REVOKE ALL ON FUNCTION public.jims_recurring_ap_link_pv_v1(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_recurring_ap_link_pv_v1(uuid,text) TO authenticated;