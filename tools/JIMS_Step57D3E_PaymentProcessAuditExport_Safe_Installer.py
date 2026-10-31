#!/usr/bin/env python3
"""JIMS Step 57D3.7 — Payment Process Audit Export SAFE INSTALLER.
Adds a single UI component into the EXISTING Report Generation page.
No rewrite of App.jsx, PV, Payment Process, approvals, payment ledger, PC or user permissions.
Usage:
  python3 /tmp/JIMS_57D3E.py --dry-run
  python3 /tmp/JIMS_57D3E.py
Rollback on Vite build error; timestamped backup of installed local Report Generation.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
PAGE=ROOT/'app/src/JIMSHistoryExports.jsx'
COMP=ROOT/'app/src/JIMS57D3PaymentProcessAuditExport.jsx'
DRY='--dry-run' in sys.argv
SOURCE='gui-patches/57D/JIMS57D3PaymentProcessAuditExport.jsx'

def stop(message):
    sys.exit('STOP: '+str(message)+' — no files modified.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def exactly_one(data,anchor,label):
    count=data.count(anchor)
    if count!=1:stop(label+' anchor expected once; got '+str(count))

if git('branch','--show-current').strip()!=BRANCH:
    stop('Codespaces branch must be '+BRANCH)
if not PAGE.exists():stop('Installed Report Generation component missing: '+str(PAGE))
if COMP.exists():stop('Audit Export component already exists; no duplicate install')
current=PAGE.read_text(encoding='utf-8')
if 'JIMS_STEP57D3E_AUDIT_EXPORT' in current:
    stop('Step 57D3E already installed')
for marker in (
    "export default function JIMSHistoryExports",
    "jims_finance_ap_operational_history_export_v1",
    "jims_owner_approval_history_export_v1",
    "jims_ap_report_document_manifest_v1",
    "Report Generation",
    "const [pvSearch,setPvSearch]",
    "const [dateFrom,setDateFrom]",
    "const [dateTo,setDateTo]",
    "const [branch,setBranch]",
    "const [tier,setTier]",
    "const [paymentStatus,setPaymentStatus]",
    "const [busy,setBusy]",
):
    if marker not in current:stop('Current Report Generation differs; missing '+marker)

source=git('show','origin/'+BRANCH+':'+SOURCE)
for required in (
    'jims_57d3_payment_process_audit_export_v1',
    'payment_planning_summary','payment_planning_tranches','payment_planning_changes',
    "import('exceljs')","export default function JIMS57D3PaymentProcessAuditExport"
):
    if required not in source:stop('Missing audit component feature '+required)
if any(op in source for op in (".insert(", ".update(", ".delete(", ".upload(")):
    stop('Audit export component must be financial read-only')
if source.count('export default function JIMS57D3PaymentProcessAuditExport')!=1:
    stop('Expected one audit export component')

import_anchor="import { supabase } from './lib/supabase'"
# May differ in whitespace; place new import BEFORE the current first line to avoid modifying others.
new="import JIMS57D3PaymentProcessAuditExport from './JIMS57D3PaymentProcessAuditExport'\n"+current
anchor="      {manifest&&manifestFilters===queryFilters&&<p className=\"muted\">"
exactly_one(new,anchor,'report footer')
block="""      {/* JIMS_STEP57D3E_AUDIT_EXPORT — additive, authorized AP/Accounting report */}
      <JIMS57D3PaymentProcessAuditExport
        filters={{pvSearch,dateFrom,dateTo,branch,tier,paymentStatus}}
        disabled={!!busy}/>
"""
new=new.replace(anchor,block+anchor,1)
# Guard all existing calls, UI groups and local customizations. Only import and block added.
for protected in (
    'jims_finance_ap_operational_history_export_v1',
    'jims_owner_approval_history_export_v1',
    'jims_ap_report_document_manifest_v1',
    'supabase.storage.from(f.bucket).download(f.storage_path)',
    'AP_REPORTS.map', 'selectedReports', 'selectedDocs',
    'runOwner', 'runReports', 'runEvidence', 'loadManifest',
):
    if current.count(protected)!=new.count(protected):
        stop('Existing report logic changed unexpectedly: '+protected)
if new.count('JIMS_STEP57D3E_AUDIT_EXPORT')!=1:stop('Duplicate audit component')

print('57D3E Report Generation source guards PASS')
print('Existing AP reports, Owner approvals, evidence ZIP and payment engine preserved.')
if DRY:
    print('JIMS 57D3E DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=ROOT/'app/gui-backups'/('57D3E_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'JIMSHistoryExports.jsx').write_text(current,encoding='utf-8')
try:
    COMP.write_text(source,encoding='utf-8')
    PAGE.write_text(new,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS 57D3E BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    PAGE.write_text(current,encoding='utf-8')
    COMP.unlink(missing_ok=True)
    sys.exit('STOP: build failed; Report Generation restored, export component removed: '+str(exc))
