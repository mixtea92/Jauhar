
DO $do$
DECLARE original text; patched text; a text; b text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO original
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='jsync_cv_calculate_amount_v1';
 IF original IS NULL THEN RAISE EXCEPTION 'Cash voucher amount function not found'; END IF;
 patched:=original;
 FOR a,b IN SELECT * FROM (VALUES
 (' value text;',' v_amount_text text;'),
 ('  value:=btrim(coalesce(line->>''amount'',''''));','  v_amount_text:=btrim(coalesce(line->>''amount'',''''));'),
 ('  IF value<>'''' THEN','  IF v_amount_text<>'''' THEN'),
 ('   IF value !~','   IF v_amount_text !~'),
 (' OR value::numeric<=0',' OR v_amount_text::numeric<=0'),
 ('   a:=a+value::numeric;','   a:=a+v_amount_text::numeric;')
 ) AS x(old_fragment,new_fragment)
 LOOP
  IF length(patched)-length(replace(patched,a,''))<>length(a)
   THEN RAISE EXCEPTION 'Unexpected CV function anchor: %',a; END IF;
  patched:=replace(patched,a,b);
 END LOOP;
 EXECUTE rtrim(patched,';')||';';
END $do$;
