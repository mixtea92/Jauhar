CREATE OR REPLACE FUNCTION public.jims_recurring_has_valid_supporting_v1(p_voucher_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(
 SELECT 1 FROM private.jims_recurring_ap_tasks_v1 t
 JOIN private.jims_recurring_support_docs_v1 d ON d.id=t.supporting_document_id
 JOIN storage.objects o ON o.bucket_id='jauhar-recurring-supporting'
  AND o.name=d.storage_path
 JOIN public.payment_vouchers v ON v.id=t.linked_voucher_id
 WHERE t.linked_voucher_id=p_voucher_id AND t.status='pv_linked'
   AND t.document_requirement='recurring_supporting'
   AND d.confirmed_at IS NOT NULL AND d.is_active
   AND (d.effective_from IS NULL OR d.effective_from<=t.due_date)
   AND (d.effective_to IS NULL OR d.effective_to>=t.due_date)
   AND v.archived_at IS NULL AND v.created_by=auth.uid()
   AND v.payee_name=t.supplier_name AND v.branch_department=t.branch_code
   AND (t.amount_type<>'fixed' OR round(v.amount,2)=round(t.fixed_amount,2))
   AND (SELECT count(*) FROM public.pv_line_items l WHERE l.voucher_id=v.id)=1
   AND EXISTS(SELECT 1 FROM public.pv_line_items l WHERE l.voucher_id=v.id
     AND l.invoice_reference='RECUR-'||left(t.id::text,8)||'-'||to_char(t.period_month,'YYYYMM'))
 );
$function$;