// JIMS 57D7C7 / F3. Run from app/:
// npm install --no-save --package-lock=false @electric-sql/pglite
// node tests/invoiceDetailsIsolatedDbF3.mjs
//
// REAL PostgreSQL queries on a disposable, in-memory PGlite instance.
// Never connects to Supabase Cloud or any JIMS database. No Docker.
// IMPORTANT: F3 is a constrained fixture test, NOT full Supabase RLS / UAT.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {dirname,resolve} from 'node:path'
import {PGlite} from '@electric-sql/pglite'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const sql=async name=>readFile(resolve(root,'supabase/migrations',name),'utf8')
const db=new PGlite()
let passed=0
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const outsider='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const voucher='11111111-1111-4111-8111-111111111111'
const line='22222222-2222-4222-8222-222222222222'
const exec=async query=>db.exec(query)
const query=async (q,params=[])=>db.query(q,params)
async function as(user){
 await query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user])
}
async function test(name,fn){
 try {await fn();passed++;console.log('PASS '+name)}
 catch(e){console.error('FAIL '+name+': '+e.message);throw e}
}
async function rejected(fn,pattern){
 let error=null
 try{await fn()}catch(e){error=e}
 assert.ok(error,'Expected PostgreSQL to reject this action')
 assert.match(error.message,pattern)
}
async function submit(){
 return query("UPDATE public.payment_vouchers SET status='pending_manager' WHERE id=$1 RETURNING status",[voucher])
}
const insertItems=(rows)=>query(
 "SELECT public.jims_save_invoice_item_details_v1($1::uuid,$2::jsonb) AS result",
 [line,JSON.stringify(rows)]
)
const validItems=[
 {item_description:'Syringes',category:'Consumables',quantity:'10',unit_price:'100',gl_code:'5001'},
 {item_description:'Gloves',category:'Consumables',quantity:'20',unit_price:'25',gl_code:'5001'}
]
const bootstrap=String.raw`
DO $roles$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END$roles$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$fn$;
CREATE TABLE public.user_profiles(
 id uuid PRIMARY KEY, role text NOT NULL, department text, subdepartment text,
 cost_center text, is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.payment_vouchers(
 id uuid PRIMARY KEY, pv_number text, created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid, status text NOT NULL DEFAULT 'draft', payment_status text,
 branch_department text, origin_department text, financial_tier text, payee_name text,
 archived_at timestamptz, amount numeric(18,2), sst_amount numeric(18,2) DEFAULT 0
);
CREATE TABLE public.pv_line_items(
 id uuid PRIMARY KEY, voucher_id uuid NOT NULL REFERENCES public.payment_vouchers(id),
 line_no integer, invoice_reference text, description text,
 gl_code text, amount numeric(18,2)
);
CREATE TABLE public.pv_invoice_documents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 line_item_id uuid, voucher_id uuid, storage_path text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.pv_audit_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 voucher_id uuid, actor_id uuid, action text, details jsonb
);
CREATE TABLE storage.objects(bucket_id text,name text,PRIMARY KEY(bucket_id,name));
CREATE OR REPLACE FUNCTION public.jims_finance_non_ap_user_v1()
 RETURNS boolean LANGUAGE sql AS $fn$ SELECT false $fn$;
CREATE OR REPLACE FUNCTION public.jims_finance_non_ap_fm_v1()
 RETURNS boolean LANGUAGE sql AS $fn$ SELECT false $fn$;
CREATE OR REPLACE FUNCTION public.jauhar_is_current_requester_v1(p_id uuid)
 RETURNS boolean LANGUAGE sql STABLE AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.payment_vouchers
 WHERE id=p_id AND created_by=auth.uid())
$fn$;
`;
try{
 await exec(bootstrap);
 await test('Apply actual Invoice Details item / audit / trigger migration',async()=>{
   await exec(await sql('20261101153413_jims_invoice_details_items_v1.sql'))
 });
 await test('Apply actual mandatory breakdown submit guard migration',async()=>{
   await exec(await sql('20261102100000_jims_invoice_required_breakdown_submit_guard_v1.sql'))
 });
 await test('Apply actual Finance-only three-sheet report migration',async()=>{
   await exec(await sql('20261101153444_jims_invoice_details_report_v1.sql'))
 });
 await query("INSERT INTO public.user_profiles(id,role,department,subdepartment,is_active) VALUES($1,'executive','Finance','Accounts Payable',true)",[actor]);
 await query("INSERT INTO public.user_profiles(id,role,department,subdepartment,is_active) VALUES($1,'executive','Medical','Medical',true)",[outsider]);
 await query("INSERT INTO public.payment_vouchers(id,pv_number,created_by,origin_department,branch_department,status,amount,sst_amount,payee_name) VALUES($1,'PV-F3-0001',$2,'Finance','GP','draft',1500,0,'Demo Supplier')",[voucher,actor]);
 await query("INSERT INTO public.pv_line_items(id,voucher_id,line_no,invoice_reference,description,gl_code,amount) VALUES($1,$2,1,'INV-F3-001','Demo medical supplies','5001',1500)",[line,voucher]);
 await as(actor);
 await test('Block PV Submit when no item breakdown exists',async()=>{
   await rejected(submit,/item breakdown missing/i)
 });
 await test('Reject an item breakdown whose amounts do not reconcile',async()=>{
   await rejected(()=>insertItems([{item_description:'Gloves',category:'Consumables',quantity:'1',unit_price:'1400'}]),/does not match/i)
   const {rows}=await query('SELECT count(*)::int AS n FROM public.pv_invoice_item_details')
   assert.equal(rows[0].n,0,'Failed save must roll back atomically')
 });
 await test('Reject non-owner/non-Finance saving invoice items',async()=>{
   await as(outsider)
   await rejected(()=>insertItems(validItems),/only current requester|not permitted/i)
   await as(actor)
 });
 await test('Save 2 valid invoice items; check total, audit and atomic result',async()=>{
   const r=await insertItems(validItems)
   assert.equal(r.rows[0].result.success,true)
   assert.equal(r.rows[0].result.item_count,2)
   const v=await query('SELECT count(*)::int AS n,sum(total_amount)::numeric AS amount FROM public.pv_invoice_item_details')
   assert.equal(v.rows[0].n,2)
   assert.equal(Number(v.rows[0].amount),1500)
   const a=await query("SELECT count(*)::int AS n FROM public.pv_audit_events WHERE action='invoice_item_details_saved'")
   assert.equal(a.rows[0].n,1)
 });
 await test('Still block PV Submit when invoice proof is missing',async()=>{
   await rejected(submit,/upload an actual invoice/i)
 });
 await test('Registered proof path without private storage object is not enough',async()=>{
   await query("INSERT INTO public.pv_invoice_documents(voucher_id,line_item_id,storage_path) VALUES($1,$2,'demo/f3-invoice.pdf')",[voucher,line])
   await rejected(submit,/upload an actual invoice/i)
 });
 await test('Block changed invoice amount even if item total previously matched',async()=>{
   await query('UPDATE public.pv_line_items SET amount=1499 WHERE id=$1',[line])
   await rejected(submit,/invoice totals plus sst/i)
   await query('UPDATE public.pv_line_items SET amount=1500 WHERE id=$1',[line])
   await query('UPDATE public.pv_invoice_item_details SET unit_price=99 WHERE line_item_id=$1 AND item_no=1',[line])
   await rejected(submit,/invoice item totals do not match/i)
   await query('UPDATE public.pv_invoice_item_details SET unit_price=100 WHERE line_item_id=$1 AND item_no=1',[line])
 });
 await test('Submit succeeds once all item values match and actual storage proof exists',async()=>{
   await query("INSERT INTO storage.objects(bucket_id,name) VALUES('jauhar-pv-invoices','demo/f3-invoice.pdf')")
   const r=await submit();assert.equal(r.rows[0].status,'pending_manager')
 });
 await test('Finance report returns three real SQL-generated sheet datasets',async()=>{
   const q=await query("SELECT public.jims_invoice_details_report_v1() AS report")
   const report=q.rows[0].report
   assert.equal(report.invoice_summary.length,1)
   assert.equal(report.invoice_item_details.length,2)
   assert.equal(report.invoice_proof_register.length,1)
   assert.equal(Number(report.invoice_summary[0].breakdown_total),1500)
   assert.equal(report.invoice_proof_register[0].proof_status,'Uploaded')
 });
 await test('Medical user cannot invoke Finance-only invoice report',async()=>{
   await as(outsider)
   await rejected(()=>query('SELECT public.jims_invoice_details_report_v1()'),/restricted to authorised Finance/i)
   await as(actor)
 });
 await test('Historical approved or paid PV does not trigger new Draft-only guard',async()=>{
   await query("UPDATE public.payment_vouchers SET status='fully_approved' WHERE id=$1",[voucher])
   await query("UPDATE public.pv_invoice_item_details SET unit_price=90 WHERE line_item_id=$1 AND item_no=1",[line])
   const q=await query("UPDATE public.payment_vouchers SET status='paid' WHERE id=$1 RETURNING status",[voucher])
   assert.equal(q.rows[0].status,'paid')
 });
 console.log('\nF3 isolated PostgreSQL: '+passed+'/13 checks PASS')
 console.log('This is NOT Supabase Cloud UAT, auth/RLS end-to-end testing, or approval regression.')
}finally{
 await db.close()
}
