
-- Harden only new JSYNC Cash Voucher V1 submit checks.
CREATE OR REPLACE FUNCTION public.jsync_cv_validate_template_values_v1(form jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE sheet text:=form->>'source_sheet';l jsonb;category text;d text;
BEGIN
 IF sheet NOT IN ('PC (Digital)','PC (Manual)') THEN RAISE EXCEPTION 'Choose the official PC Digital or PC Manual worksheet'; END IF;
 IF coalesce(form->>'legacy_category','')<>'' AND btrim(form->>'legacy_category') NOT IN
 ('Petrol / Mileage','Courier / Postage','Parking / Toll','Stationery','Urgent Office Purchase','Medical Supplies','Refreshments','Others')
 THEN RAISE EXCEPTION 'Invalid C18 legacy category'; END IF;
 FOR d IN SELECT unnest(ARRAY[form->>'date_of_request',form->>'date_disbursed']) LOOP
   IF d IS NULL OR d !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(to_date(d,'YYYY-MM-DD'),'YYYY-MM-DD')<>d THEN
    RAISE EXCEPTION 'Valid request and actual disbursement dates are required'; END IF;
 END LOOP;
 FOR l IN SELECT value FROM jsonb_array_elements(coalesce(form->'lines','[]'::jsonb)) LOOP
  d:=l->>'receipt_date';
  IF d IS NULL OR d !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(to_date(d,'YYYY-MM-DD'),'YYYY-MM-DD')<>d THEN
   RAISE EXCEPTION 'Invalid receipt date'; END IF;
  category:=btrim(coalesce(l->>'expense_category',''));
  IF sheet='PC (Digital)' THEN
    IF category NOT IN (
      'General & Administrative Expenses','Cleaning & Housekeeping','Courier & Postage','Fuel Expenses',
      'Toll & Parking','Transportation & Mileage','Vehicle Maintenance','Meals & Refreshments',
      'Staff Welfare & Benefits','Gifts & CSR','Event Expenses','Marketing & Promotion',
      'Medical Supplies & Consumables','Medicines & Pharmaceuticals','Medical Equipment & Tools',
      'Facility Maintenance & Repairs','Landscaping & Plants','Utilities','IT & System Expenses','Staff Accommodation'
    ) THEN RAISE EXCEPTION 'Expense Category must be in the official PC Digital dropdown: %',category; END IF;
  ELSE
    IF category NOT IN ('Petrol','Courier','Parking / Toll','Stationery','Office Supplies','Medical Supplies','Refreshments','Others')
    THEN RAISE EXCEPTION 'Expense Category must be in the official PC Manual dropdown: %',category; END IF;
  END IF;
 END LOOP;
END; $fn$;
REVOKE ALL ON FUNCTION public.jsync_cv_validate_template_values_v1(jsonb) FROM PUBLIC,anon,authenticated;
DO $do$
DECLARE source_text text; anchor text:=' PERFORM public.jsync_cv_calculate_amount_v1(f,true);';
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO source_text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='jsync_cv_submit_v1';
 IF source_text IS NULL OR length(source_text)-length(replace(source_text,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'Cash Voucher V1 submit function changed unexpectedly';
 END IF;
 source_text:=replace(source_text,anchor,anchor||E'\n PERFORM public.jsync_cv_validate_template_values_v1(f);');
 EXECUTE rtrim(source_text,';')||';';
END $do$;
