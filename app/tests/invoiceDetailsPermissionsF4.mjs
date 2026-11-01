// JIMS F4: isolated permission and RLS integration tests (PGlite, no Cloud).
// Run from /app: node tests/invoiceDetailsPermissionsF4.mjs
// New invoice migrations are real. Legacy PV RLS + JWT functions are minimal
// test fixtures, NOT full Supabase UAT. No production/staging data is accessed.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {PGlite} from '@electric-sql/pglite'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const migration=f=>readFile(resolve(root,'supabase/migrations',f),'utf8')
const db=new PGlite()
const q=(s,p=[])=>db.query(s,p)
const x=s=>db.exec(s)
const id={
 ap:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 acct:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 other:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 ar:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 medical:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 admin:'ffffffff-ffff-4fff-8fff-ffffffffffff',
 inactive:'10000000-0000-4000-8000-000000000001',
 nonexec:'10000000-0000-4000-8000-000000000002'
}
const pv='20000000-0000-4000-8000-000000000001'
const line='30000000-0000-4000-8000-000000000001'
let passes=0
async function as(who,role='authenticated'){
 await x('RESET ROLE')
 await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[who||''])
 await x('SET ROLE '+(role==='anon'?'anon':'authenticated'))
}
async function t(label,fn){
 try{await fn();passes++;console.log('PASS '+label)}
 catch(e){console.error('FAIL '+label+': '+e.message);throw e}
}
async function denied(fn,pattern){
 let e=null
 try{await fn()}catch(err){e=err}
 assert.ok(e,'Expected rejected action')
 assert.match(e.message,pattern)
}
const read=()=>q('SELECT item_no,item_description,category,total_amount FROM public.pv_invoice_item_details')
const save=()=>q('SELECT public.jims_save_invoice_item_details_v1($1::uuid,$2::jsonb) AS result',
 [line,JSON.stringify([{item_description:'Syringe',category:'Consumables',quantity:'10',unit_price:'150'}])])
const report=()=>q('SELECT public.jims_invoice_details_report_v1() AS result')
const fixture=String.raw`
DO $role$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $role$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$fn$;
CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,role text,department text,
 subdepartment text,cost_center text,is_active boolean);
CREATE TABLE public.payment_vouchers(id uuid PRIMARY KEY,pv_number text,
 created_at timestamptz DEFAULT now(),created_by uuid,status text DEFAULT 'draft',
 payment_status text,branch_department text,origin_department text,financial_tier text,
 payee_name text,archived_at timestamptz,amount numeric(18,2),sst_amount numeric(18,2) DEFAULT 0);
CREATE TABLE public.pv_line_items(id uuid PRIMARY KEY,voucher_id uuid,
 line_no integer,invoice_reference text,description text,gl_code text,amount numeric(18,2));
CREATE TABLE public.pv_invoice_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 line_item_id uuid,voucher_id uuid,storage_path text,created_at timestamptz DEFAULT now());
CREATE TABLE public.pv_audit_events(voucher_id uuid,actor_id uuid,action text,details jsonb);
CREATE TABLE storage.objects(bucket_id text,name text);
-- Test only: stub existing JIMS helper RPCs and baseline PV row visibility.
CREATE FUNCTION public.jauhar_is_current_requester_v1(p_id uuid)
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.payment_vouchers v
  WHERE v.id=p_id AND v.created_by=auth.uid())
$fn$;
CREATE FUNCTION public.jims_finance_non_ap_user_v1()
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.user_profiles p
  WHERE p.id=auth.uid() AND p.department='Finance'
  AND coalesce(p.subdepartment,'') NOT IN ('Accounts Payable','Accounting'))
$fn$;
CREATE FUNCTION public.jims_finance_non_ap_fm_v1()
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.user_profiles p
  WHERE p.id=auth.uid() AND p.department='Finance' AND p.role='manager')
$fn$;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON public.user_profiles,public.payment_vouchers,public.pv_line_items TO authenticated;
ALTER TABLE public.payment_vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_pv_read ON public.payment_vouchers FOR SELECT TO authenticated USING(
 created_by=auth.uid()
 OR EXISTS(SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid()
  AND p.is_active=true AND (p.role='system_admin' OR
   (p.department='Finance' AND p.subdepartment IN ('Accounts Payable','Accounting'))))
);
ALTER TABLE public.pv_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_line_read ON public.pv_line_items FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.payment_vouchers v WHERE v.id=voucher_id)
);
`;
try{
 await x(fixture)
 await x(await migration('20261101153413_jims_invoice_details_items_v1.sql'))
 await x(await migration('20261102100000_jims_invoice_required_breakdown_submit_guard_v1.sql'))
 await x(await migration('20261101153444_jims_invoice_details_report_v1.sql'))
 await t('All 3 actual Invoice Details SQL migrations apply',async()=>{
  const r=await q("SELECT relrowsecurity AS rls FROM pg_class WHERE oid='public.pv_invoice_item_details'::regclass")
  assert.equal(r.rows[0].rls,true)
 })
 const people=[
  [id.ap,'executive','Finance','Accounts Payable',true],
  [id.acct,'manager','Finance','Accounting',true],
  [id.other,'executive','Finance','Accounting',true],
  [id.ar,'executive','Finance','Accounts Receivable',true],
  [id.medical,'executive','Medical','',true],
  [id.admin,'system_admin','System','',true],
  [id.inactive,'executive','Finance','Accounts Payable',false],
  [id.nonexec,'non_executive','Operation','',true]
 ]
 for(const p of people)await q('INSERT INTO public.user_profiles(id,role,department,subdepartment,is_active) VALUES($1,$2,$3,$4,$5)',p)
 await q("INSERT INTO public.payment_vouchers(id,pv_number,created_by,origin_department,branch_department,amount,payee_name) VALUES($1,'F4-PV-001',$2,'Finance','GP',1500,'Demo Supplier')",[pv,id.ap])
 await q("INSERT INTO public.pv_line_items(id,voucher_id,invoice_reference,description,amount) VALUES($1,$2,'F4-INV-001','Medical Supplies',1500)",[line,pv])
 await q("INSERT INTO public.pv_invoice_documents(voucher_id,line_item_id,storage_path) VALUES($1,$2,'demo/proof.pdf')",[pv,line])
 await q("INSERT INTO storage.objects(bucket_id,name) VALUES('jauhar-pv-invoices','demo/proof.pdf')")
 await t('AP Executive saves items through audited RPC',async()=>{
  await as(id.ap)
  assert.equal((await save()).rows[0].result.success,true)
 })
 await t('AP Executive reads own invoice via RLS',async()=>{
  await as(id.ap);assert.equal((await read()).rows.length,1)
 })
 await t('Accounting Manager reads but cannot save as Executive',async()=>{
  await as(id.acct);assert.equal((await read()).rows.length,1)
  await denied(save,/not permitted/i)
 })
 await t('Other Accounting Executive cannot edit invoice they do not own',async()=>{
  await as(id.other);assert.equal((await read()).rows.length,1)
  await denied(save,/Only current requester/i)
 })
 await t('Accounts Receivable Executive cannot read AP invoice items',async()=>{
  await as(id.ar);assert.equal((await read()).rows.length,0)
 })
 await t('Medical Executive cannot read unrelated Finance invoice',async()=>{
  await as(id.medical);assert.equal((await read()).rows.length,0)
 })
 await t('Non-executive cannot read invoice breakdown',async()=>{
  await as(id.nonexec);assert.equal((await read()).rows.length,0)
 })
 await t('System Admin can view, but cannot modify invoice details',async()=>{
  await as(id.admin);assert.equal((await read()).rows.length,1)
  await denied(save,/Only current requester|not permitted/i)
  await denied(()=>q("UPDATE public.pv_invoice_item_details SET category='bad'"),/permission denied/i)
 })
 await t('AP user cannot directly UPDATE or DELETE item rows (RPC only)',async()=>{
  await as(id.ap)
  await denied(()=>q("UPDATE public.pv_invoice_item_details SET category='bad'"),/permission denied/i)
  await denied(()=>q("DELETE FROM public.pv_invoice_item_details"),/permission denied/i)
 })
 await t('Anon cannot read or execute protected RPCs',async()=>{
  await as('', 'anon')
  await denied(read,/permission denied/i)
  await denied(save,/permission denied/i)
  await denied(report,/permission denied/i)
 })
 await t('AP Executive can export all three report datasets',async()=>{
  await as(id.ap);const data=(await report()).rows[0].result
  assert.equal(data.invoice_summary.length,1)
  assert.equal(data.invoice_item_details.length,1)
  assert.equal(data.invoice_proof_register[0].proof_status,'Uploaded')
 })
 await t('Accounting Manager can export Invoice Details',async()=>{
  await as(id.acct);assert.equal((await report()).rows[0].result.invoice_summary.length,1)
 })
 for(const [name,who] of [
  ['Accounts Receivable',id.ar],['Medical',id.medical],
  ['System Admin',id.admin],['Inactive AP',id.inactive],
  ['Non-executive',id.nonexec]
 ]){
  await t(name+' cannot export Finance invoice report',async()=>{
   await as(who)
   await denied(report,/restricted to authorised Finance staff/i)
  })
 }
 await t('Inactive AP cannot save invoice details',async()=>{
  await as(id.inactive);await denied(save,/Only current requester|not permitted/i)
 })
 await t('Denied attempts did not modify original invoice',async()=>{
  await as(id.ap)
  const rows=(await read()).rows
  assert.equal(rows.length,1)
  assert.equal(rows[0].item_description,'Syringe')
  assert.equal(rows[0].category,'Consumables')
 })
 console.log('\nF4 role/RLS checks: '+passes+'/'+passes+' PASS')
 console.log('Fixture limitation: actual Supabase auth and legacy JIMS RLS still need UAT.')
}finally{
 await x('RESET ROLE')
 await db.close()
}
