-- JSYNC CV: immutable signer display-name snapshot (CV-only; PV/Delegation untouched).
ALTER TABLE public.cash_voucher_approvals
 ADD COLUMN IF NOT EXISTS approved_username text;
UPDATE public.cash_voucher_approvals a
 SET approved_username=p.username
 FROM public.user_profiles p
 WHERE a.approved_by=p.id AND a.approved_username IS NULL;

CREATE OR REPLACE FUNCTION public.jsync_cv_capture_signer_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE u text;
BEGIN
 IF NEW.approved_by IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'CV signature must belong to current authenticated approver' USING ERRCODE='42501';
 END IF;
 SELECT username INTO u
 FROM public.user_profiles
 WHERE id=NEW.approved_by AND is_active IS TRUE;
 IF nullif(btrim(u),'') IS NULL THEN
   RAISE EXCEPTION 'CV approver must have an active username' USING ERRCODE='42501';
 END IF;
 NEW.approved_username:=u;
 RETURN NEW;
END
$f$;
DROP TRIGGER IF EXISTS jsync_cv_capture_signer_v1 ON public.cash_voucher_approvals;
CREATE TRIGGER jsync_cv_capture_signer_v1
BEFORE INSERT ON public.cash_voucher_approvals
FOR EACH ROW EXECUTE FUNCTION public.jsync_cv_capture_signer_v1();

REVOKE ALL ON FUNCTION public.jsync_cv_capture_signer_v1() FROM PUBLIC,anon,authenticated;