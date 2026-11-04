-- JIMS STAGING ONLY: Recurring Payment (FM owns categories/instructions; AP only sees assigned tasks).
-- No changes to PV approvals, settlement or existing Payment Calendar RPCs.
CREATE TABLE IF NOT EXISTS private.jims_recurring_categories_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
 name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED UNIQUE,
 is_active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS private.jims_recurring_instructions_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 category_id uuid NOT NULL REFERENCES private.jims_recurring_categories_v1(id),
 supplier_name text NOT NULL CHECK (length(btrim(supplier_name)) BETWEEN 2 AND 150),
 branch_code text NOT NULL CHECK (branch_code IN ('GP','KM','PM','TD')),
 frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency='monthly'),
 amount_type text NOT NULL CHECK (amount_type IN ('fixed','variable')),
 fixed_amount numeric(18,2),
 due_day integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),
 start_month date NOT NULL CHECK (EXTRACT(day FROM start_month)=1),
 end_month date CHECK (end_month IS NULL OR EXTRACT(day FROM end_month)=1),
 assigned_ap_id uuid NOT NULL REFERENCES public.user_profiles(id),
 notes text NOT NULL DEFAULT '' CHECK (length(notes)<=500),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 updated_by uuid NOT NULL REFERENCES public.user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT jims_recurring_amount_valid CHECK (
   (amount_type='fixed' AND fixed_amount>0)
   OR (amount_type='variable' AND fixed_amount IS NULL)
 ),
 CONSTRAINT jims_recurring_period_valid CHECK (end_month IS NULL OR end_month>=start_month)
);
CREATE TABLE IF NOT EXISTS private.jims_recurring_ap_tasks_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 instruction_id uuid NOT NULL REFERENCES private.jims_recurring_instructions_v1(id),
 period_month date NOT NULL CHECK (EXTRACT(day FROM period_month)=1),
 due_date date NOT NULL,
 supplier_name text NOT NULL,
 category_name text NOT NULL,
 branch_code text NOT NULL,
 amount_type text NOT NULL,
 fixed_amount numeric(18,2),
 assigned_ap_id uuid NOT NULL REFERENCES public.user_profiles(id),
 status text NOT NULL DEFAULT 'pending_ap' CHECK (status IN ('pending_ap','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(instruction_id,period_month)
);
CREATE INDEX IF NOT EXISTS jims_recurring_ap_task_assignee_idx
 ON private.jims_recurring_ap_tasks_v1(assigned_ap_id,period_month,status);
CREATE TABLE IF NOT EXISTS private.jims_recurring_audit_v1 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid REFERENCES public.user_profiles(id),
 entity_type text NOT NULL,
 entity_id uuid NOT NULL,
 action text NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.jims_recurring_categories_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.jims_recurring_instructions_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.jims_recurring_ap_tasks_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.jims_recurring_audit_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.jims_recurring_categories_v1,private.jims_recurring_instructions_v1,private.jims_recurring_ap_tasks_v1,private.jims_recurring_audit_v1 FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.jims_recurring_is_fm_v1()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid()
  AND p.is_active IS TRUE AND p.department='Finance' AND p.role='manager'
 );
$$;

CREATE OR REPLACE FUNCTION private.jims_recurring_generate_v1()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_month date:=date_trunc('month',now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
 v_count integer;
BEGIN
 INSERT INTO private.jims_recurring_ap_tasks_v1
 (instruction_id,period_month,due_date,supplier_name,category_name,branch_code,amount_type,fixed_amount,assigned_ap_id)
 SELECT i.id,v_month,
    v_month+(least(i.due_day,extract(day from (v_month+interval '1 month - 1 day'))::integer)-1),
    i.supplier_name,c.name,i.branch_code,i.amount_type,i.fixed_amount,i.assigned_ap_id
 FROM private.jims_recurring_instructions_v1 i
 JOIN private.jims_recurring_categories_v1 c ON c.id=i.category_id
 JOIN public.user_profiles ap ON ap.id=i.assigned_ap_id
 WHERE i.status='active' AND c.is_active
   AND i.start_month<=v_month AND (i.end_month IS NULL OR i.end_month>=v_month)
   AND ap.is_active IS TRUE AND ap.role='executive'
   AND ap.department='Finance' AND ap.subdepartment='Accounts Payable'
 ON CONFLICT (instruction_id,period_month) DO NOTHING;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.jims_recurring_fm_dashboard_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_categories jsonb; v_instructions jsonb; v_tasks jsonb; v_ap jsonb;
BEGIN
 IF NOT public.jims_recurring_is_fm_v1() THEN
  RAISE EXCEPTION 'Finance Manager only: Recurring Payment' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM private.jims_recurring_categories_v1)>300
    OR (SELECT count(*) FROM private.jims_recurring_instructions_v1)>500
    OR (SELECT count(*) FROM private.jims_recurring_ap_tasks_v1)>3000 THEN
  RAISE EXCEPTION 'Recurring records exceed dashboard limit; pagination required' USING ERRCODE='54000';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.name),'[]'::jsonb) INTO v_categories
 FROM private.jims_recurring_categories_v1 c;
 SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.created_at DESC),'[]'::jsonb) INTO v_instructions
 FROM private.jims_recurring_instructions_v1 i;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.period_month DESC,t.created_at DESC),'[]'::jsonb) INTO v_tasks
 FROM private.jims_recurring_ap_tasks_v1 t WHERE t.period_month>=date_trunc('month',now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '12 months';
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username) ORDER BY p.username),'[]'::jsonb) INTO v_ap
 FROM public.user_profiles p WHERE p.is_active AND p.role='executive'
   AND p.department='Finance' AND p.subdepartment='Accounts Payable';
 RETURN jsonb_build_object('categories',v_categories,'instructions',v_instructions,
   'tasks',v_tasks,'ap_users',v_ap);
END;
$$;

CREATE OR REPLACE FUNCTION public.jims_recurring_fm_category_save_v1(
 p_id uuid,p_name text,p_is_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_id uuid; v_name text:=btrim(coalesce(p_name,''));
BEGIN
 IF NOT public.jims_recurring_is_fm_v1() THEN
  RAISE EXCEPTION 'Finance Manager only' USING ERRCODE='42501';
 END IF;
 IF length(v_name) NOT BETWEEN 2 AND 80 OR p_is_active IS NULL THEN
  RAISE EXCEPTION 'Category name (2-80 chars) and active state are required' USING ERRCODE='22023';
 END IF;
 IF p_id IS NULL THEN
  INSERT INTO private.jims_recurring_categories_v1(name,is_active,created_by)
  VALUES (v_name,p_is_active,auth.uid()) RETURNING id INTO v_id;
  INSERT INTO private.jims_recurring_audit_v1(actor_id,entity_type,entity_id,action,payload)
  VALUES(auth.uid(),'category',v_id,'created',jsonb_build_object('name',v_name,'active',p_is_active));
 ELSE
  IF NOT p_is_active AND EXISTS(
   SELECT 1 FROM private.jims_recurring_instructions_v1
   WHERE category_id=p_id AND status='active'
  ) THEN
   RAISE EXCEPTION 'Pause active instructions before deactivating this category' USING ERRCODE='23514';
  END IF;
  UPDATE private.jims_recurring_categories_v1
   SET name=v_name,is_active=p_is_active,updated_at=clock_timestamp() WHERE id=p_id
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Category not found' USING ERRCODE='22023'; END IF;
  INSERT INTO private.jims_recurring_audit_v1(actor_id,entity_type,entity_id,action,payload)
  VALUES(auth.uid(),'category',v_id,'updated',jsonb_build_object('name',v_name,'active',p_is_active));
 END IF;
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.jims_recurring_fm_instruction_save_v1(
 p_id uuid,p_category_id uuid,p_supplier_name text,p_branch_code text,
 p_amount_type text,p_fixed_amount numeric,p_due_day integer,p_start_month date,
 p_end_month date,p_assigned_ap_id uuid,p_notes text,p_status text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_id uuid; v_supplier text:=btrim(coalesce(p_supplier_name,''));
 v_notes text:=btrim(coalesce(p_notes,''));
BEGIN
 IF NOT public.jims_recurring_is_fm_v1() THEN
  RAISE EXCEPTION 'Finance Manager only' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.jims_recurring_categories_v1
                WHERE id=p_category_id AND is_active) THEN
  RAISE EXCEPTION 'Select an active recurring category' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles
     WHERE id=p_assigned_ap_id AND is_active AND department='Finance'
       AND role='executive' AND subdepartment='Accounts Payable') THEN
  RAISE EXCEPTION 'Select an active AP Executive' USING ERRCODE='22023';
 END IF;
 IF length(v_supplier) NOT BETWEEN 2 AND 150 OR length(v_notes)>500
    OR p_branch_code IS NULL OR p_branch_code NOT IN ('GP','KM','PM','TD')
    OR p_amount_type IS NULL OR p_amount_type NOT IN ('fixed','variable')
    OR (p_amount_type='fixed' AND (p_fixed_amount IS NULL OR p_fixed_amount<=0 OR p_fixed_amount>9999999999))
    OR (p_amount_type='variable' AND p_fixed_amount IS NOT NULL)
    OR p_due_day IS NULL OR p_due_day NOT BETWEEN 1 AND 31
    OR p_start_month IS NULL OR extract(day from p_start_month)<>1
    OR (p_end_month IS NOT NULL AND (extract(day from p_end_month)<>1 OR p_end_month<p_start_month))
    OR p_status IS NULL OR p_status NOT IN ('active','paused') THEN
   RAISE EXCEPTION 'Invalid recurring instruction fields' USING ERRCODE='22023';
 END IF;
 IF p_id IS NULL THEN
  INSERT INTO private.jims_recurring_instructions_v1
    (category_id,supplier_name,branch_code,amount_type,fixed_amount,due_day,
     start_month,end_month,assigned_ap_id,notes,status,created_by,updated_by)
  VALUES(p_category_id,v_supplier,p_branch_code,p_amount_type,p_fixed_amount,
    p_due_day,p_start_month,p_end_month,p_assigned_ap_id,v_notes,p_status,auth.uid(),auth.uid())
  RETURNING id INTO v_id;
 ELSE
  UPDATE private.jims_recurring_instructions_v1 SET
   category_id=p_category_id,supplier_name=v_supplier,branch_code=p_branch_code,
   amount_type=p_amount_type,fixed_amount=p_fixed_amount,due_day=p_due_day,
   start_month=p_start_month,end_month=p_end_month,assigned_ap_id=p_assigned_ap_id,
   notes=v_notes,status=p_status,updated_by=auth.uid(),updated_at=clock_timestamp()
   WHERE id=p_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Instruction not found' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO private.jims_recurring_audit_v1(actor_id,entity_type,entity_id,action,payload)
 VALUES(auth.uid(),'instruction',v_id,CASE WHEN p_id IS NULL THEN 'created' ELSE 'updated' END,
  jsonb_build_object('category_id',p_category_id,'supplier',v_supplier,'branch',p_branch_code,
  'amount_type',p_amount_type,'amount',p_fixed_amount,'due_day',p_due_day,
  'start_month',p_start_month,'end_month',p_end_month,'assigned_ap_id',p_assigned_ap_id,
  'status',p_status));
 -- Immediately queue this month's instruction, if active. Cron queues future months.
 IF p_status='active' THEN PERFORM private.jims_recurring_generate_v1(); END IF;
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.jims_recurring_fm_generate_now_v1()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
 IF NOT public.jims_recurring_is_fm_v1() THEN
  RAISE EXCEPTION 'Finance Manager only' USING ERRCODE='42501';
 END IF;
 RETURN private.jims_recurring_generate_v1();
END;
$$;

CREATE OR REPLACE FUNCTION public.jims_recurring_ap_tasks_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid()
  AND p.is_active AND p.role='executive'
  AND p.department='Finance' AND p.subdepartment='Accounts Payable'
 ) THEN
  RAISE EXCEPTION 'Accounts Payable Executive only' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM private.jims_recurring_ap_tasks_v1
     WHERE assigned_ap_id=auth.uid() AND status='pending_ap')>300 THEN
  RAISE EXCEPTION 'AP recurring tasks exceed 300; pagination required' USING ERRCODE='54000';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'period_month',t.period_month,'due_date',t.due_date,
    'supplier_name',t.supplier_name,'category_name',t.category_name,
    'branch_code',t.branch_code,'amount_type',t.amount_type,
    'fixed_amount',t.fixed_amount,'status',t.status,'created_at',t.created_at)
    ORDER BY t.due_date,t.created_at),'[]'::jsonb)
 INTO v_rows FROM private.jims_recurring_ap_tasks_v1 t
 WHERE t.assigned_ap_id=auth.uid() AND t.status='pending_ap';
 RETURN jsonb_build_object('tasks',v_rows);
END;
$$;

REVOKE ALL ON FUNCTION private.jims_recurring_generate_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jims_recurring_is_fm_v1() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_fm_dashboard_v1() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_fm_category_save_v1(uuid,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_fm_instruction_save_v1(uuid,uuid,text,text,text,numeric,integer,date,date,uuid,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_fm_generate_now_v1() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jims_recurring_ap_tasks_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jims_recurring_is_fm_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_fm_dashboard_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_fm_category_save_v1(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_fm_instruction_save_v1(uuid,uuid,text,text,text,numeric,integer,date,date,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_fm_generate_now_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.jims_recurring_ap_tasks_v1() TO authenticated;