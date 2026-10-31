#!/usr/bin/env python3
"""JIMS STEP 57D6C6 — MINIMAL PAGE CONTENT (NOT SIDEBAR).

Targets only nonessential visible explanatory copy INSIDE existing JIMS
screens: Payment Voucher, Payment Process (PV shared page), Petty Cash,
Delegation Workspace, Manage Delegation, My Approvals, user-admin and
related content. Other pages with essential status/limit notes stay intact.

Operations: exact literal JSX replacements only; no handler, condition,
state, status, role check, amount, approval rule, data call or route edits.
No edits to App.jsx, sidebar, login, Supabase or backend.
Dry-run read-only. Full per-file backups and rollback on build failure.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys
import tempfile

ROOT=Path('/workspaces/Jauhar')
APPDIR=ROOT/'app'
SRC=APPDIR/'src'
MAIN=SRC/'main.jsx'
BRANCH='jsync-gui-revamp-20261029'
REMOTE='gui-patches/57D/JIMS57D6C6PageContentMinimal.css'
STYLE=SRC/'JIMS57D6C6PageContentMinimal.css'
IMPORT="import './JIMS57D6C6PageContentMinimal.css'"
ANCHOR="import './JIMS57D6C4MobileDashboardActions.css'"
MARKER='JIMS_STEP57D6C6_PAGE_CONTENT_MINIMAL'
DRY='--dry-run' in sys.argv

def stop(msg):
    sys.exit('STOP: '+str(msg)+' — application source not modified.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch. Expected '+BRANCH)
if not MAIN.is_file() or not (SRC/'PaymentVoucher.jsx').is_file():
    stop('JIMS application source missing')
if STYLE.exists():
    stop('57D6C6 already exists; refuse overwrite')
old_main=MAIN.read_text(encoding='utf-8')
if old_main.count(ANCHOR)!=1 or IMPORT in old_main:
    stop('57D6C4 prerequisite import missing/duplicated or 57D6C6 already installed')
if not (SRC/'JIMS57D6C4MobileDashboardActions.css').is_file():
    stop('57D6C4 prerequisite missing')

# All replacements are literal, user-visible render copy ONLY.
# No generic CSS hiding; never remove warning/error/status/actionable guidance.
# Each tuple: original JSX, shorter JSX (empty = delete the whole decorative node).
PATCHES={
'PaymentVoucher.jsx':[
 ('<p className="muted">Counters reflect vouchers visible to your login. Select a card to open its filtered list.</p>',''),
 ('<small>{card.hint}</small>',''),
 ('<p className="muted">Acting authority only · Return to Delegation Workspace after reviewing.</p>',''),
 ('<p className="muted">Effective Date (template): 01-Nov-2026 · PV numbers are assigned by JAUHAR upon saving.</p>',''),
 ('<span className="muted">Ten rows come from the official Excel; extra rows are allowed.</span>',''),
 ('AP Finance — Department PV Verification','Department PV Verification'),
 ('<span>Pending Payment — Initiate</span>','<span>Initiate Payment</span>'),
 ('<span>Payment Initiated — Complete / Returned</span>','<span>Payment Initiated</span>'),
 # Keep all JR, upload requirements, tier/approval, payment and financial cautions.
],
'CashVoucher.jsx':[
 ('<p style={{marginTop:0}}>Post-disbursement recording, dual HOD approval with digital signatures, then CLOSED.</p>',
  '<p style={{marginTop:0}}>Two HOD approvals required.</p>'),
 ('<p>Original workbook, unchanged: PC (Digital), PC (Manual), List Expenses Category; A4 portrait one-page print areas.</p>',''),
 ('<p>Each selected CV receives a separate approval record and digital signature. Both stages must be signed before CLOSED.</p>',''),
 ('<p>Enter the same fields as the official XLSX. No new payment is made. Entries must fit the original 10-row printed form.</p>',''),
 ('<p style={{fontSize:12}}>The official claimant declaration, approval boxes, acknowledgment, logo and print layout stay in the original Excel. HOD signatures are captured digitally during approval.</p>',''),
 ('<p style={{fontSize:12}}>Every expense row requires a PDF/JPG/PNG/WEBP receipt (max 10 MB). Uploading a receipt auto-saves your Draft and marks Receipt Attached? = Yes. If you change a row after uploading, upload its receipt again before Submit. Mobile file uploads are disabled.</p>',
  '<p style={{fontSize:12}}>Receipt required per row (PDF/image, max 10 MB). Re-upload after editing a row. Desktop upload only.</p>'),
 ('<small>Original one-page Excel print layout. HOD digital signature, username and approval date appear in the existing signature blocks. For PDF, open the signed Excel in Microsoft Excel and choose Save as PDF.</small>',
  '<small>PDF: Open signed Excel → Save as PDF.</small>'),
],
'DelegationWorkspace.jsx':[
 ('<span className="muted">{m.hint}</span>',''),
 ('<p className="muted">All delegated financial approvals in one place. Your own approval authority stays in Payment Voucher.</p>',''),
 ('<p className="muted">Only authority that has passed independent authorization, valid dates and database permission checks is actionable. Acting decisions use your real login in the audit trail.</p>',''),
 ('<p className="muted">Approve / Return / Reject only where the delegated permission allows. Open a PV to make a decision.</p>',''),
 ('<p className="muted" style={{marginTop:14}}>Showing up to 300 actionable Payment Vouchers, as returned by the authorization RPC. Budget delegation will be integrated after the Budget Dashboard is developed.</p>',
  '<p className="muted" style={{marginTop:14}}>Showing up to 300 actionable PVs.</p>'),
 ('<p className="muted">Request, authorize, revoke, track expiry, and review delegation history.</p>',''),
],
'DelegationHub.jsx':[
 ('<p className="muted">Separate from Payment Voucher · independent authorization · full audit trail</p>',''),
 # Authority, eligibility, independent BOD and handover restrictions remain visible.
],
'ApprovalQueues.jsx':[
 ('<p className="muted">Own approval authority and delegated authority are always shown separately.</p>',''),
 ('<p className="muted" style={{marginTop:12}}>Shows up to 300 actionable PVs. Use Payment Voucher\'s full list for historical tracking.</p>',
  '<p className="muted" style={{marginTop:12}}>Showing up to 300 PVs.</p>'),
],
'JSYNCDelegationUnifiedOverview.jsx':[
 ('<p style={muted}>Your current independently-authorized approval authority. The matching pending PVs are in Delegated PV Inbox directly below.</p>',''),
 ('<p style={muted}>Draft / Returned work assigned to or handed over by you. This is editing authority, not approval authority.</p>',
  '<p style={muted}>Editing authority only — not approval.</p>'),
 ('<p style={muted}>For the transferred PV, use Payment Voucher to open and edit. Original created_by remains unchanged. The receiving Executive must not be allowed to delete the draft; that backend rule requires separate verification.</p>',
  '<p style={muted}>Open transferred PV in Payment Voucher to edit.</p>'),
 ('<p style={muted}>Delegation / handover history from the existing authorized dashboard. PV-level approval history is a separate audit control.</p>',''),
],
'UserOrganizationAssignment.jsx':[
 ('<p className="muted">System Admin only. This changes organization metadata, not roles, existing PVs or approval authority.</p>',
  '<p className="muted">Organization details only.</p>'),
],
'PVDelegationHistory.jsx':[
 ('<p className="muted" style={{margin:\'6px 0\'}}>Part of this PV Approval History · recorded real actors and authorizers.</p>',''),
],
'SystemAdminDelegationViewer.jsx':[
 ('<p>System Admin may view all delegation records and audit events. No operational actions are available.</p>','<p>Read-only.</p>'),
],
'JIMSPaymentPlanning57D3.jsx':[
 ('<p className="muted">Step 57D3 · Supplier Due Date is the contractual obligation.\n        FM-approved schedule is a separate plan, not a replacement due date.</p>',
  '<p className="muted">Supplier Due Date and FM schedule are separate.</p>'),
 ('<small className="muted" style={{display:\'block\',marginTop:13}}>\n        Stored by role-checked Supabase RPCs. KPI-ready history is captured automatically.\n        This feature does not mark a PV paid or change approval authority.\n      </small>',
  '<small className="muted" style={{display:\'block\',marginTop:13}}>Planning does not mark a PV as paid.</small>'),
],
'JIMSPaymentCalendar57D5.jsx':[
 ('<p className="jims-cal-footnote">Calendar uses Supplier Due Date. Changing the FM payment schedule does not move the obligation date.</p>',
  '<p className="jims-cal-footnote">Calendar uses Supplier Due Date, not the FM schedule.</p>'),
],
'JIMSPettyCash57D1E.jsx':[
 ('<p style={{fontSize:12,margin:\'0 0 12px\'}}>Department is taken from the existing Petty Cash form. Select its Sub-Department and Cost Center before submitting. These fields are stored in JIMS metadata and do not modify the official one-page Excel.</p>',
  '<p style={{fontSize:12,margin:\'0 0 12px\'}}>Select Sub-Department and Cost Center before submitting.</p>'),
 ('<p style={{fontSize:12,margin:\'10px 0 0\'}}>Petty Cash number is issued automatically upon the first Save Draft, and is read-only. Historical CV numbers remain unchanged.</p>',
  '<p style={{fontSize:12,margin:\'10px 0 0\'}}>Number assigned on Save Draft.</p>'),
],
}
# Future code paths not yet installed may not exist; skip without creating them.
original={}
changes={}
report={}
for name,pairs in PATCHES.items():
    path=SRC/name
    if not path.exists():
        report[name]='not installed — skipped'
        continue
    source=path.read_text(encoding='utf-8')
    current=source
    applied=0
    for old,new in pairs:
        count=current.count(old)
        if count==0:
            continue  # Different installed revision; do not guess or overwrite.
        # Different installed PV revisions can render one shared home grid
        # or two grids (approval + payment). Both are valid and text-only.
        # Refuse any unexpected extra matches rather than guessing.
        if old=='<small>{card.hint}</small>':
            if name!='PaymentVoucher.jsx' or count not in (1,2):
                stop(name+': unexpected PV hint count: '+str(count))
        elif count!=1:
            stop(name+': ambiguous source match for '+repr(old[:65])+': '+str(count))
        current=current.replace(old,new)
        applied+=count
    if current!=source:
        # These are exclusively literal render string/node replacements.
        if current.count('<button')!=source.count('<button'):
            stop('Button count changed in '+name)
        if current.count('onClick=')!=source.count('onClick='):
            stop('Click handler count changed in '+name)
        if current.count('.rpc(')!=source.count('.rpc('):
            stop('RPC call count changed in '+name)
        if current.count('supabase.')!=source.count('supabase.'):
            stop('Supabase reference count changed in '+name)
        original[path]=source
        changes[path]=current
    report[name]=str(applied)+' text fragments simplified'

if SRC/'PaymentVoucher.jsx' not in changes:
    stop('Current PV page has no recognized removable copy; review current local revision')
if len(changes)<3:
    stop('Fewer than 3 pages recognized. No changes; check local installed versions')

updated_main=old_main.replace(ANCHOR,ANCHOR+'\n'+IMPORT,1)
if updated_main.replace(ANCHOR+'\n'+IMPORT,ANCHOR,1)!=old_main:
    stop('main.jsx stylesheet mount not purely additive')
try:
    css=git('show','origin/'+BRANCH+':'+REMOTE)
except subprocess.CalledProcessError:
    stop('Remote scoped stylesheet missing; git fetch origin '+BRANCH)
if css.count(MARKER)!=1:
    stop('Stylesheet marker incorrect')
for bad in ('.sidebar','.topbar','.login-page','@import','display:none','visibility:hidden','pointer-events:none'):
    if bad in css:
        stop('Unexpected CSS selector/behavior: '+bad)

with tempfile.TemporaryDirectory(prefix='jims_57d6c6_preflight_') as td:
    folder=Path(td)
    files=[]
    for f,content in [*changes.items(),(MAIN,updated_main)]:
        p=folder/f.name
        p.write_text(content,encoding='utf-8')
        files.append(str(p))
    cp=folder/STYLE.name
    cp.write_text(css,encoding='utf-8')
    js=(
        "const fs=require('node:fs');"
        "Promise.all([import('vite'),import('postcss')]).then(async([v,p])=>{"
        "for(const file of process.argv.slice(1,-1))"
        "await v.transformWithOxc(fs.readFileSync(file,'utf8'),file);"
        "const css=p.default.parse(fs.readFileSync(process.argv.at(-1),'utf8'));"
        "let n=0;css.walkRules(rule=>{n++;"
        "if(rule.selector.split(',').some(s=>!s.trim().startsWith("
        "'.jims-shell>.content .pv-home-grid ')))"
        "throw Error('Unscoped CSS selector: '+rule.selector);"
        "});"
        "if(n<3)throw Error('Missing PV card styles');"
        "console.log('JIMS 57D6C6 JSX + CSS PARSER PASS');"
        "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    test=subprocess.run(['node','-e',js,*files,str(cp)],
        cwd=APPDIR,capture_output=True,text=True)
    if test.returncode:
        stop('JSX/CSS preflight failed: '+(test.stderr or test.stdout)[-2200:])
    print(test.stdout.strip())

print('JIMS 57D6C6 PAGE-CONTENT TEXT SAFETY CHECK PASS')
for name,count in report.items():
    print(' - '+name+': '+count)
print('Sidebar, topbar, login, PV/payment/CV functions, permissions unchanged.')
if DRY:
    print('JIMS 57D6C6 DRY RUN PASS — no files modified.')
    sys.exit(0)

backup=APPDIR/'gui-backups'/('57D6C6_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
for f,content in [*original.items(),(MAIN,old_main)]:
    (backup/f.name).write_text(content,encoding='utf-8')
try:
    for path,content in changes.items():
        path.write_text(content,encoding='utf-8')
    MAIN.write_text(updated_main,encoding='utf-8')
    STYLE.write_text(css,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APPDIR,check=True)
    print('JIMS 57D6C6 BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    for f,content in original.items():
        f.write_text(content,encoding='utf-8')
    MAIN.write_text(old_main,encoding='utf-8')
    STYLE.unlink(missing_ok=True)
    sys.exit('STOP: Build failed, all originals restored: '+str(exc))
