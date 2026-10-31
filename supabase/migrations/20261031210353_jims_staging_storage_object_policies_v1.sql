-- 57D7C7: JIMS-STAGING Storage RLS policy baseline copied from production definitions.
-- Applied to staging as migration 20261031210353.
CREATE POLICY "JAUHAR Department JR private PDF upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-jr'::text) AND (name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'::text) AND (EXISTS ( SELECT 1
   FROM (payment_vouchers v
     JOIN user_profiles p ON ((p.id = auth.uid())))
  WHERE (((v.id)::text = split_part(objects.name, '/'::text, 1)) AND (v.created_by = auth.uid()) AND (v.origin_department = p.department) AND (v.origin_department <> 'Finance'::text) AND (v.status = ANY (ARRAY['draft'::text, 'returned'::text])) AND (v.archived_at IS NULL) AND (v.financial_tier = ANY (ARRAY['T03'::text, 'T05'::text, 'T06'::text, 'T07'::text, 'T09'::text])) AND (p.role = 'executive'::text) AND (p.is_active = true))))));

CREATE POLICY "JAUHAR JR private PDF read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jauhar-pv-jr'::text) AND (EXISTS ( SELECT 1
   FROM pv_justification_reports j
  WHERE ((j.storage_path = objects.name) AND jauhar_can_read_jr_v1(j.voucher_id))))));

CREATE POLICY "JAUHAR JR private PDF upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-jr'::text) AND (name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'::text) AND (EXISTS ( SELECT 1
   FROM (payment_vouchers v
     JOIN user_profiles p ON ((p.id = auth.uid())))
  WHERE (((v.id)::text = split_part(objects.name, '/'::text, 1)) AND (v.created_by = auth.uid()) AND (v.status = ANY (ARRAY['draft'::text, 'returned'::text])) AND (v.archived_at IS NULL) AND (v.financial_tier = ANY (ARRAY['T03'::text, 'T05'::text, 'T06'::text, 'T07'::text, 'T09'::text])) AND (p.role = 'executive'::text) AND (p.department = 'Finance'::text) AND (p.is_active = true))))));

CREATE POLICY "JAUHAR PV final PDF receipt upload v2" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-receipts'::text) AND (name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'::text) AND (EXISTS ( SELECT 1
   FROM (payment_vouchers v
     JOIN user_profiles p ON ((p.id = auth.uid())))
  WHERE (((v.id)::text = split_part(objects.name, '/'::text, 1)) AND (v.status = 'fully_approved'::text) AND (v.archived_at IS NULL) AND (v.payment_status = 'payment_initiated'::text) AND (v.payment_initiation_manager_decision = 'approved'::text) AND (p.department = 'Finance'::text) AND (p.role = 'executive'::text) AND (p.is_active = true))))));

CREATE POLICY "JAUHAR PV receipt read v2" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jauhar-pv-receipts'::text) AND jauhar_can_read_payment_proof_v1(
CASE
    WHEN (split_part(name, '/'::text, 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) THEN (split_part(name, '/'::text, 1))::uuid
    ELSE NULL::uuid
END)));

CREATE POLICY "JAUHAR PV receipt upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-receipts'::text) AND (split_part(name, '/'::text, 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg|jpeg|webp)$'::text) AND (split_part(name, '/'::text, 3) = ''::text) AND (EXISTS ( SELECT 1
   FROM (payment_vouchers v
     JOIN user_profiles p ON ((p.id = ( SELECT auth.uid() AS uid))))
  WHERE (((v.id)::text = split_part(objects.name, '/'::text, 1)) AND (v.created_by = ( SELECT auth.uid() AS uid)) AND (v.status = 'fully_approved'::text) AND (v.payment_status = 'pending_payment'::text) AND (p.role = 'executive'::text) AND (p.is_active = true))))));

CREATE POLICY "JAUHAR invoice storage read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jauhar-pv-invoices'::text) AND (EXISTS ( SELECT 1
   FROM ((payment_vouchers v
     JOIN pv_line_items li ON ((li.voucher_id = v.id)))
     JOIN user_profiles p ON ((p.id = auth.uid())))
  WHERE (((v.id)::text = split_part(objects.name, '/'::text, 1)) AND ((li.id)::text = split_part(objects.name, '/'::text, 2)) AND (p.is_active = true) AND (v.archived_at IS NULL) AND (((v.status = ANY (ARRAY['draft'::text, 'returned'::text])) AND (v.created_by = auth.uid()) AND ((v.status = 'draft'::text) OR ((v.financial_tier = ANY (ARRAY['T01'::text, 'T02'::text, 'T04'::text, 'T08'::text, 'T03'::text, 'T05'::text, 'T06'::text, 'T07'::text, 'T09'::text])) AND (p.department = 'Finance'::text) AND (p.role = 'executive'::text)))) OR (EXISTS ( SELECT 1
           FROM pv_invoice_documents d
          WHERE ((d.voucher_id = v.id) AND (d.line_item_id = li.id) AND (d.storage_path = objects.name))))))))));

CREATE POLICY "JAUHAR invoice storage upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-invoices'::text) AND (split_part(name, '/'::text, 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg|webp)$'::text) AND (split_part(name, '/'::text, 4) = ''::text) AND (EXISTS ( SELECT 1
   FROM ((payment_vouchers v
     JOIN pv_line_items li ON ((li.voucher_id = v.id)))
     JOIN user_profiles p ON ((p.id = auth.uid())))
  WHERE (((v.id)::text = split_part(objects.name, '/'::text, 1)) AND ((li.id)::text = split_part(objects.name, '/'::text, 2)) AND (v.created_by = auth.uid()) AND (v.archived_at IS NULL) AND (v.status = ANY (ARRAY['draft'::text, 'returned'::text])) AND (p.role = 'executive'::text) AND (p.is_active = true) AND (p.department = v.origin_department))))));

CREATE POLICY "JAUHAR payment initiation proof read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jauhar-pv-payment-initiation'::text) AND (EXISTS ( SELECT 1
   FROM pv_payment_initiation_proofs doc
  WHERE ((doc.storage_path = objects.name) AND jauhar_can_read_payment_proof_v1(doc.voucher_id))))));

CREATE POLICY "JAUHAR payment initiation proof upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-payment-initiation'::text) AND (name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg|webp)$'::text) AND (EXISTS ( SELECT 1
   FROM (payment_vouchers v
     JOIN user_profiles p ON ((p.id = auth.uid())))
  WHERE (((v.id)::text = split_part(objects.name, '/'::text, 1)) AND (v.status = 'fully_approved'::text) AND (v.archived_at IS NULL) AND ((v.payment_status = 'pending_payment'::text) OR ((v.payment_status = 'payment_initiated'::text) AND (v.payment_initiation_manager_decision = 'returned'::text))) AND (p.role = 'executive'::text) AND (p.department = 'Finance'::text) AND (p.is_active = true))))));

CREATE POLICY "JAUHAR prevent archived invoice upload" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id <> 'jauhar-pv-invoices'::text) OR (EXISTS ( SELECT 1
   FROM payment_vouchers v
  WHERE (((v.id)::text = split_part(objects.name, '/'::text, 1)) AND (v.archived_at IS NULL))))));

CREATE POLICY "jauhar_delegate_invoice_file_read_v1" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jauhar-pv-invoices'::text) AND (EXISTS ( SELECT 1
   FROM pv_invoice_documents d
  WHERE ((d.storage_path = objects.name) AND jauhar_can_view_delegation_docs_v1(d.voucher_id))))));

CREATE POLICY "jauhar_delegate_jr_file_read_v1" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jauhar-pv-jr'::text) AND (EXISTS ( SELECT 1
   FROM pv_justification_reports d
  WHERE ((d.storage_path = objects.name) AND jauhar_can_view_delegation_docs_v1(d.voucher_id))))));

CREATE POLICY "jauhar_delegate_payment_proof_read_v1" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jauhar-pv-payment-initiation'::text) AND (EXISTS ( SELECT 1
   FROM pv_payment_initiation_proofs d
  WHERE ((d.storage_path = objects.name) AND jauhar_can_view_delegation_docs_v1(d.voucher_id))))));

CREATE POLICY "jauhar_handover_invoice_file_upload_v1" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-invoices'::text) AND (EXISTS ( SELECT 1
   FROM (payment_vouchers v
     JOIN pv_line_items li ON ((li.voucher_id = v.id)))
  WHERE ((v.archived_at IS NULL) AND (v.status = ANY (ARRAY['draft'::text, 'returned'::text])) AND jauhar_is_current_requester_v1(v.id) AND (objects.name ~* (((('^'::text || (v.id)::text) || '/'::text) || (li.id)::text) || '/[0-9a-f-]{36}\.(pdf|png|jpg|jpeg|webp)$'::text)))))));

CREATE POLICY "jauhar_handover_jr_file_upload_v1" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-jr'::text) AND (EXISTS ( SELECT 1
   FROM payment_vouchers v
  WHERE ((v.archived_at IS NULL) AND (v.status = ANY (ARRAY['draft'::text, 'returned'::text])) AND (v.financial_tier = ANY (ARRAY['T03'::text, 'T05'::text, 'T06'::text, 'T07'::text, 'T09'::text])) AND jauhar_is_current_requester_v1(v.id) AND (objects.name ~* (('^'::text || (v.id)::text) || '/[0-9a-f-]{36}\.pdf$'::text)))))));

CREATE POLICY "jims_57c8_ap_report_registered_files" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((jims_can_export_ap_history_v1() AND (((bucket_id = 'jauhar-pv-invoices'::text) AND (EXISTS ( SELECT 1
   FROM pv_invoice_documents d
  WHERE (d.storage_path = objects.name)))) OR ((bucket_id = 'jauhar-pv-jr'::text) AND (EXISTS ( SELECT 1
   FROM pv_justification_reports d
  WHERE (d.storage_path = objects.name)))) OR ((bucket_id = 'jauhar-pv-payment-initiation'::text) AND ((EXISTS ( SELECT 1
   FROM pv_payment_initiation_proofs d
  WHERE (d.storage_path = objects.name))) OR (EXISTS ( SELECT 1
   FROM pv_payment_transactions t
  WHERE (t.initiation_proof_path = objects.name))) OR (EXISTS ( SELECT 1
   FROM jims_v2_payment_documents d
  WHERE ((d.kind = 'initiation'::text) AND (d.storage_path = objects.name)))))) OR ((bucket_id = 'jauhar-pv-receipts'::text) AND ((EXISTS ( SELECT 1
   FROM payment_vouchers v
  WHERE (v.receipt_path = objects.name))) OR (EXISTS ( SELECT 1
   FROM pv_payment_transactions t
  WHERE (t.final_receipt_path = objects.name))) OR (EXISTS ( SELECT 1
   FROM jims_v2_payment_documents d
  WHERE ((d.kind = 'final_receipt'::text) AND (d.storage_path = objects.name)))))))));

CREATE POLICY "jims_57c8_ar_ap_storage_guard" ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (((bucket_id <> ALL (ARRAY['jauhar-pv-invoices'::text, 'jauhar-pv-jr'::text, 'jauhar-pv-payment-initiation'::text, 'jauhar-pv-receipts'::text, 'jsync-cv-receipts'::text])) OR (NOT jims_finance_non_ap_user_v1()) OR (jims_finance_non_ap_fm_v1() AND (((bucket_id = 'jsync-cv-receipts'::text) AND (EXISTS ( SELECT 1
   FROM (cash_voucher_receipts cr
     JOIN cash_vouchers cv ON ((cv.id = cr.voucher_id)))
  WHERE ((cr.storage_path = objects.name) AND (cv.status = 'pending_approval'::text))))) OR ((bucket_id <> 'jsync-cv-receipts'::text) AND (EXISTS ( SELECT 1
   FROM payment_vouchers v
  WHERE ((v.status = ANY (ARRAY['pending_finance_manager'::text, 'pending_manager'::text])) AND ((v.id)::text = split_part(objects.name, '/'::text, 1))))))))));

CREATE POLICY "jims_v2_initiation_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-payment-initiation'::text) AND (split_part(name, '/'::text, 1) ~* '^[0-9a-f-]{36}$'::text) AND (split_part(name, '/'::text, 2) ~* '^[0-9a-f-]{36}$'::text) AND (split_part(name, '/'::text, 3) ~* '^[0-9a-f-]{36}\.(pdf|png|jpg|jpeg|webp)$'::text) AND (split_part(name, '/'::text, 4) = ''::text) AND (EXISTS ( SELECT 1
   FROM ((pv_payment_transactions t
     JOIN payment_vouchers v ON ((v.id = t.voucher_id)))
     JOIN user_profiles p ON ((p.id = ( SELECT auth.uid() AS uid))))
  WHERE (((t.id)::text = split_part(objects.name, '/'::text, 2)) AND ((v.id)::text = split_part(objects.name, '/'::text, 1)) AND (t.status = ANY (ARRAY['draft'::text, 'returned'::text])) AND (v.payment_mode = 'partial'::text) AND (v.status = 'fully_approved'::text) AND (v.archived_at IS NULL) AND (v.payment_status = 'pending_payment'::text) AND (p.role = 'executive'::text) AND (p.department = 'Finance'::text) AND p.is_active)))));

CREATE POLICY "jims_v2_initiation_read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jauhar-pv-payment-initiation'::text) AND (EXISTS ( SELECT 1
   FROM jims_v2_payment_documents d
  WHERE ((d.storage_path = objects.name) AND (d.kind = 'initiation'::text) AND (jauhar_can_read_payment_proof_v1(d.voucher_id) OR jauhar_can_view_delegation_docs_v1(d.voucher_id)))))));

CREATE POLICY "jims_v2_receipt_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jauhar-pv-receipts'::text) AND (split_part(name, '/'::text, 1) ~* '^[0-9a-f-]{36}$'::text) AND (split_part(name, '/'::text, 2) ~* '^[0-9a-f-]{36}$'::text) AND (split_part(name, '/'::text, 3) ~* '^[0-9a-f-]{36}\.pdf$'::text) AND (split_part(name, '/'::text, 4) = ''::text) AND (EXISTS ( SELECT 1
   FROM ((pv_payment_transactions t
     JOIN payment_vouchers v ON ((v.id = t.voucher_id)))
     JOIN user_profiles p ON ((p.id = ( SELECT auth.uid() AS uid))))
  WHERE (((t.id)::text = split_part(objects.name, '/'::text, 2)) AND ((v.id)::text = split_part(objects.name, '/'::text, 1)) AND (t.status = 'approved'::text) AND (t.review_decision = 'approved'::text) AND (v.payment_mode = 'partial'::text) AND (v.status = 'fully_approved'::text) AND (v.archived_at IS NULL) AND (v.payment_status = 'pending_payment'::text) AND (p.role = 'executive'::text) AND (p.department = 'Finance'::text) AND p.is_active)))));

CREATE POLICY "jims_v2_receipt_read" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jauhar-pv-receipts'::text) AND (EXISTS ( SELECT 1
   FROM jims_v2_payment_documents d
  WHERE ((d.storage_path = objects.name) AND (d.kind = 'final_receipt'::text) AND (jauhar_can_read_payment_proof_v1(d.voucher_id) OR jauhar_can_view_delegation_docs_v1(d.voucher_id)))))));

CREATE POLICY "jsync_cv_receipt_download_v1" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'jsync-cv-receipts'::text) AND (EXISTS ( SELECT 1
   FROM cash_voucher_receipts r
  WHERE ((r.storage_path = objects.name) AND (EXISTS ( SELECT 1
           FROM cash_vouchers v
          WHERE (v.id = r.voucher_id))))))));

CREATE POLICY "jsync_cv_receipt_upload_v1" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'jsync-cv-receipts'::text) AND (name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(10|[1-9])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg|jpeg|webp)$'::text) AND jsync_cv_is_finance_ap_v1(auth.uid()) AND (EXISTS ( SELECT 1
   FROM cash_vouchers v
  WHERE (((v.id)::text = split_part(objects.name, '/'::text, 1)) AND (v.created_by = auth.uid()) AND (v.status = 'draft'::text))))));
