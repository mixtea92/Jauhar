DO $do$
DECLARE s text;
 oldpart text:='v.applicable_department NOT IN (''Finance'',''Operation'',''Sales & Marketing'',''Medical'',''System, Project & Infrastructure'')';
 newpart text:='v.applicable_department NOT IN (''Finance'',''Operation'',''Sales & Marketing'',''Sales and Marketing'',''Medical'',''System, Project & Infrastructure'',''System, Project & Infra'',''System, Project & Infrastructure Department'')';
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO s FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
 WHERE n.nspname='public' AND p.proname='jsync_cv_submit_v1';
 IF s IS NULL OR length(s)-length(replace(s,oldpart,''))<>length(oldpart)
 THEN RAISE EXCEPTION 'CV submit department rule changed unexpectedly'; END IF;
 EXECUTE rtrim(replace(s,oldpart,newpart),';')||';';
END $do$;