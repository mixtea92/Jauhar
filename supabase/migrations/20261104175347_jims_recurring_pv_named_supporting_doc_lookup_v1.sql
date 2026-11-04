
CREATE OR REPLACE FUNCTION public.jims_recurring_pv_support_v1(p_voucher_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_data jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
 SELECT 1 FROM public.user_profiles p JOIN public.payment_vouchers v ON v.id=p_voucher_id
 WHERE p.id=auth.uid() AND p.is_active AND v.archived_at IS NULL AND
  (v.created_by=p.id OR (p.role='manager' AND p.department='Finance')
  OR p.role IN('ceo','bod','system_admin'))
 ) THEN RETURN NULL;END IF;
 SELECT jsonb_build_object(
  'document_id',d.id,'document_name',d.document_name,
  'original_filename',d.original_filename,
  'storage_path',d.storage_path,'valid_from',d.effective_from,
  'valid_to',d.effective_to,'period_month',t.period_month,
  'task_id',t.id,'document_valid',
  (d.confirmed_at IS NOT NULL AND d.is_active AND
    (d.effective_from IS NULL OR d.effective_from<=t.due_date) AND
    (d.effective_to IS NULL OR d.effective_to>=t.due_date))
 ) INTO v_data
 FROM private.jims_recurring_ap_tasks_v1 t
 JOIN private.jims_recurring_support_docs_v1 d ON d.id=t.supporting_document_id
 WHERE t.linked_voucher_id=p_voucher_id AND t.status='pv_linked'
  AND t.document_requirement='recurring_supporting';
 RETURN v_data;
END;
$fn$;
REVOKE ALL ON FUNCTION public.jims_recurring_pv_support_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_recurring_pv_support_v1(uuid) TO authenticated;