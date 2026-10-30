#!/usr/bin/env python3
"""JIMS 57D4 — Safe additive Finance PV duplicate invoice warning + submit preflight.
No changes to approval decisions, payment process, petty cash, report export, or auth.
Uses backend global 57D4 submit trigger for final authority.
Codespaces:
  python3 /tmp/JIMS_57D4.py --dry-run && python3 /tmp/JIMS_57D4.py
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PV=ROOT/'app/src/PaymentVoucher.jsx'
PANEL=ROOT/'app/src/JIMS57D4DuplicateInvoiceWarning.jsx'
SOURCE='gui-patches/57D/JIMS57D4DuplicateInvoiceWarning.jsx'
DRY='--dry-run' in sys.argv
MARKER='JIMS_STEP57D4_Duplicate_Invoice_UI'

def stop(message):
    sys.exit('STOP: '+str(message)+' — no financial files changed.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def exactly_once(content,anchor,label):
    n=content.count(anchor)
    if n!=1:stop(label+' expected once but saw '+str(n))
def protect(original,modified,token):
    if original.count(token)!=modified.count(token):
        stop('Protected existing functionality changed: '+token)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch — expected '+BRANCH)
if not PV.exists():stop('Codespaces PaymentVoucher.jsx not found')
if PANEL.exists():stop('57D4 warning component already exists')
old=PV.read_text(encoding='utf-8')
if MARKER in old:stop('Step 57D4 already installed')
component=git('show','origin/'+BRANCH+':'+SOURCE)
if component.count('export default function JIMS57D4DuplicateInvoiceWarning')!=1:
    stop('Invalid duplicate warning component')
for need in ('jims_57d4_check_draft_v1','p_exclude_pv','p_invoice_references'):
    if need not in component:stop('Missing warning capability '+need)
if any(x in component for x in ('.insert(','.update(','.delete(','.upload(')):
    stop('Draft warning cannot mutate financial data')

import_anchor="import "
if not old.startswith(import_anchor) and import_anchor not in old[:300]:
    stop('Unexpected PV module import section')
new="import JIMS57D4DuplicateInvoiceWarning from './JIMS57D4DuplicateInvoiceWarning'\n"+old

# The draft form has ONE invoice line table and ONE total summary.
totals_anchor='            <div className="pv-totals">'
exactly_once(new,totals_anchor,'PV invoice totals')
warning="""            {/* JIMS_STEP57D4_Duplicate_Invoice_UI — read-only draft warning */}
            <JIMS57D4DuplicateInvoiceWarning
              payeeName={form.payee_name}
              supplierCode={form.supplier_code}
              supplierTin={form.supplier_tin}
              lines={form.lines}
              excludeVoucherId={editingVoucher?.id||null}/>
"""
new=new.replace(totals_anchor,warning+totals_anchor,1)

# Preflight returns structured matches AND records a durable blocked-attempt audit event.
# Existing backend still handles the final submission; direct REST clients are blocked
# by 57D4 database trigger even if UI preflight is skipped.
rpc_anchor="      const rpcName = nonFinanceExecutive ? 'submit_department_pv_v1'"
exactly_once(new,rpc_anchor,'Finance PV submission')
preflight="""      // JIMS 57D4 preflight: AP blocked attempts are recorded before a rejected submit.
      // Other department workflows still get the same global DB status-transition guard.
      if (!nonFinanceExecutive) {
        const {data:duplicateCheck,error:duplicateError}=await supabase.rpc(
          'jims_57d4_preflight_submit_v1',{p_voucher_id:voucher.id}
        )
        if(duplicateError)throw duplicateError
        if(duplicateCheck?.can_submit!==true) {
          const pvMatches=(duplicateCheck?.matches||[]).slice(0,4)
            .map(x=>x.existing_pv).filter(Boolean)
          setSubmitMessage('Duplicate supplier invoice detected. Already in '+
            (pvMatches.join(', ')||'another Payment Voucher')+
            '. Review invoice reference before submitting.')
          return
        }
      }
"""
new=new.replace(rpc_anchor,preflight+rpc_anchor,1)
for token in (
  'submit_finance_jr_v1','submit_finance_t08_v1','submit_finance_t04_v1',
  'submit_finance_t01_t02_v2','submit_pv_for_approval','submit_department_pv_v1',
  "setSubmittingVoucher(false)","const { data, error: submitError } = await supabase.rpc(rpcName",
  "setViewingVoucher(data)",'onSubmit={handleSave}',
  'invoiceDocuments','viewLines','refreshApprovalHistory',
  'window.confirm','pv-notice','jauhar_my_active_delegations_v1'
):
    protect(old,new,token)
if new.count(MARKER)!=1:stop('Duplicate patch marker')
if new.count("jims_57d4_preflight_submit_v1")!=1:stop('Duplicate preflight call')
if new.count('<JIMS57D4DuplicateInvoiceWarning')!=1:stop('Duplicate panel')

print('57D4 safe UI anchors PASS')
print('Existing PV approvals, create/edit, evidence, and payment processing untouched.')
if DRY:
    print('JIMS 57D4 DRY RUN PASS — no files changed.')
    sys.exit(0)
backup=ROOT/'app/gui-backups'/('57D4_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'PaymentVoucher.jsx').write_text(old,encoding='utf-8')
try:
    PANEL.write_text(component,encoding='utf-8')
    PV.write_text(new,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS 57D4 BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    PV.write_text(old,encoding='utf-8')
    PANEL.unlink(missing_ok=True)
    sys.exit('STOP: build failed. Original PaymentVoucher restored and component removed: '+str(exc))
