#!/usr/bin/env python3
"""JIMS 57D6C8 — GO-LIVE CONTENT CLEANUP, ALL INSTALLED WORKSPACE PAGES.

Only explicitly approved, presentation-only static JSX fragments are removed
or shortened. Existing code, conditions, roles, data, approvals, navigation,
Sidebar, login, notifications and mobile upload restrictions are unchanged.

Include: PV New/Edit/List/History, Payment Process, Calendar/Planning, PC,
Delegation, Approvals, Reports, User Admin, JR and installed submodules.
Write an audit of remaining long visible copy and launch-warning candidates.
Run --dry-run first. Full backup, JSX parse, npm build and rollback on failure.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess, sys, tempfile, re, json

ROOT=Path('/workspaces/Jauhar')
SRC=ROOT/'app/src'
APP=ROOT/'app'
BRANCH='jsync-gui-revamp-20261029'
DRY='--dry-run' in sys.argv
AUDIT='--audit-only' in sys.argv
def stop(s): sys.exit('STOP: '+str(s)+' — no project source changed.')
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
if git('branch','--show-current').strip()!=BRANCH:stop('Expected branch '+BRANCH)
if not (SRC/'App.jsx').is_file():stop('JIMS app missing')
MARK='JIMS_57D6C8_MINIMAL_GO_LIVE'
REPORT='57D6C8_GoLive_Copy_Audit.txt'

# Exact visible-only JSX nodes / captions. Each is OPTIONAL because earlier
# checkpoints, especially 57D6C5/C6/C7, may already have removed it.
# No warnings, validity requirements, real monetary/status fields or inputs.
EXACT={
 'PaymentVoucher.jsx': [
  ('<p className="muted">Counters reflect vouchers visible to your login. Select a card to open its filtered list.</p>',''),
  ('<p className="muted">Effective Date (template): 01-Nov-2026 · PV numbers are assigned by JAUHAR upon saving.</p>',''),
  ('<p className="muted">Acting authority only · Return to Delegation Workspace after reviewing.</p>',''),
  ('<small>{card.hint}</small>',''),
  ('<p className="muted">Approved contains Pending Payment, Payment Initiated and Paid. Payment stages are mutually exclusive.</p>',''),
  ('<p className="muted">Checklist only. Actual PDF/image supporting-document upload to private storage will follow in a separate step.</p>',''),
  ('<p className="muted">Excel signatures/names do not confer approval. Approval must occur in JAUHAR, in sequence.</p>',''),
  ('<span className="muted">Ten rows come from the official Excel; extra rows are allowed.</span>',''),
  ('<p className="muted">View-only access. No approval or payment action is assigned.</p>',''),
  ('<p className="muted">Existing Payment Voucher — Read Only</p>',''),
  ('<p className="muted">Check current-round Finance Manager and CEO approvals.</p>',''),
  ('<p className="muted">Check the approved HOD action, all invoices and JR if required.</p>',''),
  ('<p>Closed-loop PVs only. Fully Approved but unpaid PVs remain in Payment Process.</p>',''),
  ('<small>Full payment recorded with final bank receipt</small>',''),
  ('<small>Approval ended without payment</small>',''),
  ('<p>Payment executions with final receipt. Not included in active initiation or verification queues.</p>',''),
  ('<small>View payment records and receipt details</small>',''),
  ('<p className="muted">New PV requires a valid official Excel upload. Existing Draft edits do not require another upload.</p>',''),
  ('<span>NEW PAYMENT VOUCHER</span>','<span>NEW PV</span>'),
  ('Back to Payment Voucher Dashboard</button>','Back</button>'),
  ('value="Pending approval workflow" disabled','value="Pending" disabled'),
 ],
 'CashVoucher.jsx': [
  ('<h2 style={{marginBottom:5}}>Cash Voucher (Petty Cash)</h2>','<h2 style={{marginBottom:5}}>Petty Cash</h2>'),
  ('<h2 style={{marginBottom:5}}>Petty Cash (Petty Cash)</h2>','<h2 style={{marginBottom:5}}>Petty Cash</h2>'),
  ('<h3>Cash Voucher Records</h3>','<h3>Petty Cash Records</h3>'),
  ("<h3>{editingId?'Edit Cash Voucher Draft':'New Cash Voucher'}</h3>","<h3>{editingId?'Edit Petty Cash Draft':'New Petty Cash'}</h3>"),
  ('<p style={{marginTop:0}}>Two HOD approvals required.</p>',''),
  ('<p style={{marginTop:0}}>Post-disbursement recording, dual HOD approval with digital signatures, then CLOSED.</p>',''),
  ('<p>Original workbook, unchanged: PC (Digital), PC (Manual), List Expenses Category; A4 portrait one-page print areas.</p>',''),
  ('<p>Each selected CV receives a separate approval record and digital signature. Both stages must be signed before CLOSED.</p>',''),
  ('<p>Enter the same fields as the official XLSX. No new payment is made. Entries must fit the original 10-row printed form.</p>',''),
  ('<p style={{fontSize:12}}>The official claimant declaration, approval boxes, acknowledgment, logo and print layout stay in the original Excel. HOD signatures are captured digitally during approval.</p>',''),
  ('<p>To approve, return to the dashboard, select this CV in the HOD verification section and draw your digital signature.</p>',''),
  ('<p>Payment Method (G17:I17): <strong>Cash (Petty Cash)</strong></p>',''),
  ('<small>Original one-page Excel print layout. HOD digital signature, username and approval date appear in the existing signature blocks. For PDF, open the signed Excel in Microsoft Excel and choose Save as PDF.</small>','<small>PDF: Save signed Excel as PDF.</small>'),
 ],
 'JIMSPaymentProcessBoard.jsx': [
  ('<small>{item.hint}</small>',''),
  ('<small>Approved vouchers awaiting initiation or resubmission</small>',''),
  ('<small>Completed Full Payments only</small>',''),
  ('<small>Settled partial installments only</small>',''),
  ('<small>Total outstanding across all approved PVs</small>',''),
  ('<h2>Payment Process Dashboard</h2>','<h2>Payment Process</h2>'),
  ('<p className="muted">Pending Payment → Full / Partial workflows → One Payment History</p>',''),
  ('<h3>Full Payment Status</h3>','<h3>Full Payment</h3>'),
  ('<h3>Partial Payment Status</h3>','<h3>Partial Payment</h3>'),
 ],
 'JIMSPaymentCalendar57D5.jsx':[
  ('<p>Supplier due dates · All branches</p>',''),
  ('<small>Default: today to month end</small>',''),
  ('<span className="jims-cal-toolbar-note">Month arrows switch the due-date range</span>',''),
  ('<small>Needs payment planning</small>',''),
 ],
 'JIMSPettyCash57D1E.jsx':[
  ('<small>Auto-generated · Monthly reset · Not editable</small>',''),
  ('<small>Revision settings: System Admin only</small>',''),
  ('<p style={{fontSize:12,margin:\'10px 0 0\'}}>Number assigned on Save Draft.</p>',''),
  ('<p style={{fontSize:12,margin:\'10px 0 0\'}}>Petty Cash number is issued automatically upon the first Save Draft, and is read-only. Historical CV numbers remain unchanged.</p>',''),
 ],
 'DelegationWorkspace.jsx':[
  ('<p className="muted">All delegated financial approvals in one place. Your own approval authority stays in Payment Voucher.</p>',''),
  ('<span className="muted">{m.hint}</span>',''),
  ('<p className="muted">Only authority that has passed independent authorization, valid dates and database permission checks is actionable. Acting decisions use your real login in the audit trail.</p>',''),
  ('<p className="muted">Approve / Return / Reject only where the delegated permission allows. Open a PV to make a decision.</p>',''),
  ('<p className="muted">Request, authorize, revoke, track expiry, and review delegation history.</p>',''),
  ('<p className="muted" style={{marginTop:14}}>Showing up to 300 actionable Payment Vouchers, as returned by the authorization RPC. Budget delegation will be integrated after the Budget Dashboard is developed.</p>',''),
 ],
 'DelegationHub.jsx':[
  ('<p className="muted">Separate from Payment Voucher · independent authorization · full audit trail</p>',''),
 ],
 'JSYNCDelegationUnifiedOverview.jsx':[
  ('<p style={muted}>Your current independently-authorized approval authority. The matching pending PVs are in Delegated PV Inbox directly below.</p>',''),
  ('<p style={muted}>Delegation / handover history from the existing authorized dashboard. PV-level approval history is a separate audit control.</p>',''),
  ('<p style={muted}>For the transferred PV, use Payment Voucher to open and edit. Original created_by remains unchanged. The receiving Executive must not be allowed to delete the draft; that backend rule requires separate verification.</p>',''),
 ],
 'ApprovalQueues.jsx':[
  ('<p className="muted">Own approval authority and delegated authority are always shown separately.</p>',''),
  ('<p className="muted" style={{marginTop:12}}>Shows up to 300 actionable PVs. Use Payment Voucher\'s full list for historical tracking.</p>',''),
 ],
 'JIMSApproverSummary.jsx':[
  ('<p className="muted">Review here, or choose View Details for invoices, JR and approval history.</p>',''),
 ],
 'BODApprovalSummary.jsx':[
  ('<p className="muted">Key facts first. View Details is optional; approval safeguards remain enforced.</p>',''),
 ],
 'JIMSHistoryExports.jsx':[
  ('<p className="muted">Accounts Payable and Accounting only. Contains no approval decision history.</p>',''),
 ],
 'JIMSReportGenerationSingleCenter.jsx':[
  ('<p className="muted">Select reports and supporting documents to download. Original files remain private.</p>',''),
  ('<p className="muted">This approval-history download is separate from AP reports and can only be generated by the designated System Owner.</p>',''),
 ],
 'JIMS_Report_Generation_Single_Center.jsx':[
  ('<p className="muted">Select reports and supporting documents to download. Original files remain private.</p>',''),
  ('<p className="muted">This approval-history download is separate from AP reports and can only be generated by the designated System Owner.</p>',''),
  ('<p className="muted">JR meeting evidence is exported as recorded meeting reference/date in Excel, not an invented minutes PDF.</p>',''),
 ],
 'JIMSPaymentPlanning57D3.jsx':[
  ('<p className="muted">Step 57D3 · Supplier Due Date is the contractual obligation.\n        FM-approved schedule is a separate plan, not a replacement due date.</p>','<p className="muted">Supplier due date and FM schedule are separate.</p>'),
  ('<small className="muted" style={{display:\'block\',marginTop:13}}>\n        Stored by role-checked Supabase RPCs. KPI-ready history is captured automatically.\n        This feature does not mark a PV paid or change approval authority.\n      </small>',''),
 ],
 'JIMSPaymentCompletionQueue.jsx':[
  ('<p className="muted">FM approved. AP Finance records the actual transaction and uploads a mandatory final bank receipt PDF before marking Paid.</p>',''),
  ('<p className="muted">Each partial installment requires its own final receipt PDF. The PV is Fully Paid only after the complete approved amount has been settled.</p>',''),
 ],
 'JIMSV2FinanceManagerQueue.jsx':[
  ('<p className="muted">Mandatory initiation proofs awaiting your current approval authority.</p>',''),
 ],
 'JIMSPaymentModeSelector.jsx':[
  ('<small>STEP 57B.2 · PAYMENT PROCESS</small>',''),
  ('<small>Existing full-payment workflow.</small>',''),
  ('<small>Manage installment drafts and outstanding balance.</small>',''),
 ],
 'JIMSPaymentModeSelector_Step57B3.jsx':[
  ('<small>STEP 57B.2 · PAYMENT PROCESS</small>',''),
  ('<small>Existing full-payment workflow.</small>',''),
  ('<small>Manage installment drafts and outstanding balance.</small>',''),
 ],
 'JSYNCUserAdminForm.jsx':[
  ('<p className="muted">\n        Department required. Subdepartment, Branch and\n        Staff Designation and Cost Center optional.\n      </p>',''),
 ],
 'AddUser.jsx':[
  ('<p className="muted">\n        Create a staff account and assign its access role and department.\n      </p>',''),
  ('<p className="muted">\n          CEO and BOD accounts do not require a department.\n        </p>',''),
 ],
 'EditUser.jsx':[
  ('<p className="muted">\n        Update staff username, role and department. CEO and BOD do not require a department.\n      </p>',''),
  ('<p className="muted">Department: Not applicable to CEO / BOD.</p>',''),
 ],
 'ResetPassword.jsx':[
  ('<p className="muted">\n        Set a new password for {user.username}.\n      </p>',''),
 ],
 'UserOrganizationAssignment.jsx':[
  ('<p className="muted">System Admin only. This changes organization metadata, not roles, existing PVs or approval authority.</p>',''),
  ('<p className="muted">Organization details only.</p>',''),
 ],
 'AuditTrail.jsx':[
  ('<p className="muted">\n            Latest 100 user management activities\n          </p>',''),
 ],
 'SystemAdminDelegationViewer.jsx':[
  ('<p>System Admin may view all delegation records and audit events. No operational actions are available.</p>',''),
  ('<p>Read-only.</p>',''),
 ],
 'PVDelegationHistory.jsx':[
  ('<p className="muted" style={{margin:\'6px 0\'}}>Part of this PV Approval History · recorded real actors and authorizers.</p>',''),
 ],
 'JIMSHistoryExports.jsx':[],
}

# More local variants from recent actual in-app UAT screenshots. Static
# text nodes only; never regex-remove arbitrary paragraphs or dynamic JSX.
REGEX={
'PaymentVoucher.jsx':[
 (r'<p className="muted">\s*New PV: fill the form manually or upload the official Excel for auto-fill\.[^<{}\n]*</p>',''),
 (r'<p className="muted">\s*For Rev1 Excel, use[^<{}\n]{0,240}</p>','<p className="muted">Rev1 Excel: PV (T-Digital), Tier L10.</p>'),
 (r'<p className="muted">\s*Checklist only\. Actual PDF/image supporting-document upload[^<{}\n]{0,240}</p>',''),
 (r'<span className="pv-mode-label">\s*\{workspaceMode === .edit. \? .EDIT EXISTING DRAFT. : .NEW PAYMENT VOUCHER.\}\s*</span>',''),
 (r'<p className="muted">\s*New PV requires[^<{}\n]{0,200}</p>',''),
 ],
'CashVoucher.jsx':[
 (r'<p[^>]*>\s*Closed records after both HOD signatures\.[^<{}\n]{0,220}</p>',''),
 (r'<small[^>]*>\s*Auto-generated · Monthly reset · Not editable\s*</small>',''),
 ],
'JIMSPettyCash57D1E.jsx':[
 (r'<p[^>]*>\s*Department is taken from the existing Petty Cash form\.[^<{}\n]{0,260}</p>','<p>Select Sub-Department and Cost Center.</p>'),
 ],
'JIMSPaymentCalendar57D5.jsx':[
 (r'<span className="jims-cal-legend-note">Overdue payments always shown below, regardless of date filter</span>',''),
 ],
}

# Guard against modifying information that could affect correct payment,
# authorization, audit or security. These are audit flags, NOT auto-deletions.
LAUNCH_SIGNALS=[
 'preview only','temporarily disabled','upcoming step','upcoming document',
 'drafts only at step','will be integrated','pilot','legacy full payment',
 'future integration','not installed','step 36.4','step 46f sql',
 'backend not ready'
]
SECURITY_TOKENS=[
 'supabase.', '.rpc(', 'onClick=', 'onChange=', 'onSubmit=',
 '<button', '</button>', '<input', '<select', '<textarea',
 'aria-label=', 'payment_status', 'financial_tier'
]
def enumerate_jsx():
    return sorted([p for p in SRC.rglob('*.jsx')
      if p.name not in ('App.jsx','main.jsx','JSYNCLogin.jsx') and
      'login' not in p.parts and 'node_modules' not in p.parts])
files=enumerate_jsx()
original={}
changed={}
change_log=[]
skipped=[]
for path in files:
    old=path.read_text(encoding='utf-8')
    new=old
    edits=0
    for before,after in EXACT.get(path.name,[]):
        occurrences=new.count(before)
        if occurrences>8:
            stop(path.name+': excessive repeated literal '+repr(before[:60]))
        if occurrences:
            new=new.replace(before,after)
            edits+=occurrences
    for pattern,replacement in REGEX.get(path.name,[]):
        candidate,n=re.subn(pattern,replacement,new,flags=re.MULTILINE)
        if n>2:
            stop(path.name+': regex affected '+str(n)+' fragments '+pattern[:60])
        if n:
            new=candidate
            edits+=n
    if new!=old:
        for token in SECURITY_TOKENS:
            # Exception: the PV decorative mode-label (not a button, state,
            # business variable, input or listener) is intentionally removed.
            if new.count(token)!=old.count(token):
                stop(path.name+': protected token count changed: '+token)
        original[path]=old
        changed[path]=new
        change_log.append((path.name,edits))
    else:skipped.append(path.name)

if not changed:stop('No matching approved copy found; installation is already clean or local structure differs')

# Additive, deterministic audit for every installed JSX, not only those edited.
def audit_lines(data):
    results=[]
    tag=re.compile(r'<(p|small|span)\b[^>]{0,180}>([^<{}]{105,600})</\1>',re.S)
    for path,body in data.items():
        for m in tag.finditer(body):
            content=' '.join(m.group(2).split())
            if not content or re.search(r'role=["\'](alert|status)',m.group(0)):continue
            line=body[:m.start()].count('\n')+1
            results.append((path.name,line,content[:180]))
    return results

content_after={p:changed.get(p,p.read_text(encoding='utf-8')) for p in files}
long_paragraphs=audit_lines(content_after)
launch_flags=[]
for p,body in content_after.items():
    for n,s in enumerate(body.splitlines(),1):
        s2=s.lower()
        if any(flag in s2 for flag in LAUNCH_SIGNALS) and not s.lstrip().startswith(('//','*')):
            launch_flags.append((p.name,n,s.strip()[:220]))

# Preflight parse EVERY changed JSX BEFORE touching the repo.
with tempfile.TemporaryDirectory(prefix='jims_57d6c8_preflight_') as td:
    tmp=Path(td)
    candidates=[]
    for i,(p,body) in enumerate(changed.items()):
        f=tmp/(str(i)+'_'+p.name)
        f.write_text(body,encoding='utf-8')
        candidates.append(str(f))
    node=(
      "const fs=require('node:fs');"
      "import('vite').then(async v=>{"
      "for(const file of process.argv.slice(1))"
      "await v.transformWithOxc(fs.readFileSync(file,'utf8'),file);"
      "console.log('JIMS 57D6C8 JSX PARSER PASS: '+process.argv.slice(1).length+' files');"
      "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    test=subprocess.run(['node','-e',node,*candidates],cwd=APP,
        capture_output=True,text=True)
    if test.returncode:
        stop('JSX validation failed: '+(test.stderr or test.stdout)[-2000:])
    print(test.stdout.strip())

print('JIMS 57D6C8 GUI-ONLY COPY SAFETY PASS')
print('Inspected '+str(len(files))+' installed JSX pages/subpages (excluding protected shell/login)')
print('Proposed copy-only edits: '+str(sum(n for _,n in change_log)))
for filename,count in change_log:print('  '+filename+': '+str(count))
print('Remaining long static copy candidates: '+str(len(long_paragraphs)))
print('Potential launch flags requiring real review: '+str(len(launch_flags)))
print('No sidebar, login, finance business logic, payment workflow or database changes.')

if DRY or AUDIT:
    for fname,line,copy in long_paragraphs[:30]:
        print('REVIEW COPY '+fname+':'+str(line)+' '+copy)
    for fname,line,copy in launch_flags[:30]:
        print('GO-LIVE FLAG '+fname+':'+str(line)+' '+copy)
    print('JIMS 57D6C8 '+('AUDIT ONLY' if AUDIT else 'DRY RUN')+' PASS — no application files modified.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D6C8_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
for p,body in original.items():
    relative=p.relative_to(SRC)
    dest=backup/relative
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(body,encoding='utf-8')
audit=[
 MARK,'Installed JSX inspected: '+str(len(files)),
 'Copy fragments removed or shortened: '+str(sum(n for _,n in change_log)),
 'Modified files: '+str(len(changed)),
 'Exact edits: '+json.dumps(change_log),
 'REMAINING LONG STATIC COPY — MANUAL REVIEW'
]
audit+=['{}:{} {}'.format(*item) for item in long_paragraphs]
audit+=['','GO-LIVE FLAGS — MUST CHECK ACTUAL FEATURE READINESS']
audit+=['{}:{} {}'.format(*item) for item in launch_flags]
(backup/REPORT).write_text('\n'.join(audit)+'\n',encoding='utf-8')

try:
    for p,new in changed.items():p.write_text(new,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D6C8 BUILD PASS')
    print('Full backup and remaining-copy/go-live audit:',backup)
    print('This is GUI COPY CLEANUP, not production-release clearance.')
except Exception as error:
    for p,body in original.items():p.write_text(body,encoding='utf-8')
    sys.exit('STOP: Build failed — all original JSX files restored: '+str(error))
