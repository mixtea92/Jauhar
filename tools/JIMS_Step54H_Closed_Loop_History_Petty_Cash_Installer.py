#!/usr/bin/env python3
"""JIMS Step 54H — Closed-loop PV/Payment/Petty Cash histories and UI rename.

Guarded, presentation-only installer for the tested Codespaces 51UI + 53T-C stack.
Handles optional preinstalled 51H history without replacing any complete module.
No changes to approval/payment RPCs, logic, statuses, signed CV Excel, or Supabase.
All current local PV edits (manual/Excel Rev1 + policy R1) remain intact.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
APP=ROOT/'app/src/App.jsx'
PV=ROOT/'app/src/PaymentVoucher.jsx'
CV=ROOT/'app/src/CashVoucher.jsx'
HOME=ROOT/'app/src/JIMSDashboardHome.jsx'
CSS=ROOT/'app/src/JIMSClosedLoopHistory.css'
DRY='--dry-run' in sys.argv

def stop(message):
    sys.exit('STOP: '+str(message))
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def replace_one(source,old,new,label):
    count=source.count(old)
    if count!=1:
        stop(f'{label}: expected one exact anchor; found {count}. No files touched.')
    return source.replace(old,new,1)
def remote(path):
    try: return git('show','origin/'+BRANCH+':'+path)
    except Exception as e: stop('Fetch missing '+path+'. Run git fetch origin first. '+str(e))
def remove_once(source,token,label):
    return replace_one(source,token,'',label)
def replace_section(source,start,end,new_section,label):
    if source.count(start)!=1:
        stop(label+': missing or duplicate section start.')
    i=source.index(start)
    j=source.find(end,i)
    if j<0: stop(label+': missing closing boundary.')
    j+=len(end)
    return source[:i]+new_section+source[j:]
def rpc_lines(source):
    return sorted(line.strip() for line in source.splitlines() if '.rpc(' in line)
def calls(source, needle):
    return source.count(needle)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch: expected '+BRANCH)
for path in (APP,PV,CV,HOME):
    if not path.is_file(): stop('Missing required Codespaces file: '+str(path))
if CSS.exists(): stop('Step 54H CSS already installed; no overwrite.')
old_app,old_pv,old_cv,old_home=[path.read_text() for path in (APP,PV,CV,HOME)]

for required in (
    'Two options: Manual Entry or Excel Import.',
    'parseRevisionOneWorkbook',
    "supabase.rpc('create_pv_draft_v6'",
    'dashboardSection = "approval"',
    'paymentLanding',
    '<PaymentTrackingPanel'
):
    if required not in old_pv: stop('Protected 53T-C PV source missing: '+required)
if 'jims-finance-theme' not in old_app or 'payment_process' not in old_app:
    stop('Protected dark JIMS + payment-separation navigation missing.')
if 'cash_voucher' not in old_app or 'cash_voucher' not in old_home:
    stop('Petty Cash/CV navigation identifiers missing.')
if "supabase.from('cash_vouchers')" not in old_cv or 'downloadSignedCVExcel' not in old_cv:
    stop('Protected original Cash Voucher implementation missing.')
if 'JIMSClosedLoopHistory' in old_app or 'jims-closed-history' in old_pv:
    stop('Step 54H may already be installed.')

new_css=remote('gui-patches/54H/JIMSClosedLoopHistory.css')
if '.jims-closed-history' not in new_css: stop('Invalid 54H stylesheet.')

# PV approval dashboard — show work in progress only.
pv=old_pv
if "{ id:'approved', label:'Approved', hint:'Final approval by designated authority' }" in pv:
    pv=remove_once(pv,
       "{ id:'approved', label:'Approved', hint:'Final approval by designated authority' }",
       'Remove completed-approval card from active workspace')
else:
    if 'PV History' not in pv: stop('PV Approved active card missing unexpectedly.')

if "{ id:'paid', label:'Paid', hint:'Final PDF receipt and transaction details' }" in pv:
    pv=remove_once(pv,
       "{ id:'paid', label:'Paid', hint:'Final PDF receipt and transaction details' }",
       'Remove Paid from active Payment Process')
else:
    if 'Payment History' not in pv: stop('Payment Paid card missing unexpectedly.')

# We need a real count of rejected PVs for History, not an assumed 0.
if "pending_ceo, pending_bod, rejected] = await Promise.all([" not in pv:
    pv=replace_one(pv,
      'pending_ceo, pending_bod] = await Promise.all([',
      'pending_ceo, pending_bod, rejected] = await Promise.all([',
      'Add rejected counter result')
    pv=replace_one(pv,
      "        count(q => q.eq('status', 'pending_bod'))\n      ])",
      "        count(q => q.eq('status', 'pending_bod')),\n        count(q => q.eq('status', 'rejected'))\n      ])",
      'Query rejected counter')
    pv=replace_one(pv,
      'pending_ceo, pending_bod })',
      'pending_ceo, pending_bod, rejected })',
      'Save rejected counter')

pv_history="""          <section className="panel jims-closed-history" aria-label="PV History">
            <h2>PV History</h2>
            <p>Closed-loop PVs only. Fully Approved but unpaid PVs remain in Payment Process.</p>
            <div className="jims-closed-history-grid">
              <button type="button" className="jims-closed-history-card"
                onClick={() => openCategory('paid')}>
                <strong>Paid · Closed Loop</strong>
                <small>Full payment recorded with final bank receipt</small>
                <em>{dashboardCounts?.paid == null ? '—' : dashboardCounts.paid + ' records'} ↗</em>
              </button>
              <button type="button" className="jims-closed-history-card"
                onClick={() => openCategory('rejected')}>
                <strong>Rejected Permanently</strong>
                <small>Approval ended without payment</small>
                <em>{dashboardCounts?.rejected == null ? '—' : dashboardCounts.rejected + ' records'} ↗</em>
              </button>
            </div>
          </section>"""

if 'aria-label="PV History"' in pv:
    pv=replace_section(pv,
       '<section className="panel jims-history-section" aria-label="PV History">',
       '</section>',pv_history,'Upgrade previous PV History to fully closed-loop')
else:
    pv=replace_one(pv,
      '          <ApprovalQueues profile={profile} onOpenVoucher={openVoucher} mode="actual" refreshKey={allDelegationRecords.length + allHandoverRecords.length} />',
      '          <ApprovalQueues profile={profile} onOpenVoucher={openVoucher} mode="actual" refreshKey={allDelegationRecords.length + allHandoverRecords.length} />\n'+pv_history,
      'Append PV History below approval queues')
    pv=remove_once(pv,
      """              <button type="button" className="btn" style={{background:'#68788d'}}
                onClick={() => openCategory('rejected')}>
                Rejected Archive
              </button>""",
      'Remove redundant Rejected archive action')

if 'Payment History' not in pv:
    payment_history="""        </section>
      )}
      {workspaceMode === 'home' && paymentLanding && (
        <section className="panel jims-closed-history" aria-label="Payment History">
          <h2>Payment History</h2>
          <p>Payment executions with final receipt. Not included in active initiation or verification queues.</p>
          <div className="jims-closed-history-grid">
            <button type="button" className="jims-closed-history-card"
              onClick={() => openCategory('paid')}>
              <strong>Paid</strong>
              <small>View payment records and receipt details</small>
              <em>{dashboardCounts?.paid == null ? '—' : dashboardCounts.paid + ' records'} ↗</em>
            </button>
          </div>
        </section>"""
    pv=replace_one(pv,
      """          <p className="muted">Existing Full Payment V1 workflow remains unchanged. Partial Payment V2 will be integrated separately.</p>
        </section>""",
      """          <p className="muted">Existing Full Payment V1 workflow remains unchanged. Partial Payment V2 will be integrated separately.</p>
"""+payment_history,
      'Add Payment History after payment actions')

# Existing 51H already has Payment History; leave its read-only card intact.
if pv.count('PV History')<1 or 'onClick={() => openCategory(\'paid\')}' not in pv:
    stop('History categories incomplete.')
if "onClick={() => openCategory('approved')}" in pv:
    stop('Fully Approved remains incorrectly classified under History.')
if pv.count('onClick={() => openCategory(\'rejected\')}')!=1:
    stop('Rejected archive is duplicated or missing.')
if rpc_lines(pv)!=rpc_lines(old_pv):
    stop('PV RPC integration would be changed. Refusing to install.')
if calls(pv,'<PaymentTrackingPanel')!=calls(old_pv,'<PaymentTrackingPanel'):
    stop('Full Payment tracking integration changed unexpectedly.')

# Cash Voucher -> Petty Cash is a USER-FACING rename only. CV storage,
# print/export, database table names and RPC names remain identical.
cv=old_cv
if "const [filter,setFilter]=useState('all')" in cv:
    cv=replace_one(cv,"const [filter,setFilter]=useState('all')",
      "const [filter,setFilter]=useState('active')",'Petty Cash active default')
    cv=replace_one(cv,
      "const displayRows=rows.filter(v=>filter==='all'||v.status===filter)",
      """const displayRows=rows.filter(v=>filter==='active'
    ? v.status==='draft'||v.status==='pending_approval' : v.status===filter)
  const historyRows=rows.filter(v=>v.status==='closed')""",
      'Petty Cash active vs closed data split')
    cv=replace_one(cv,
      "['Draft',totals.draft],['Pending Dual HOD',totals.pending_approval],['Closed',totals.closed],['Action Required',myAttention]",
      "['Draft',totals.draft],['Pending Dual HOD',totals.pending_approval],['Action Required',myAttention]",
      'Remove closed records from Petty Cash active KPI')
    cv=replace_one(cv,
      """{['all','draft','pending_approval','closed'].map(s=>
          <button key={s} type="button" style={smallButton} aria-pressed={filter===s} onClick={()=>setFilter(s)}>
            {s==='all'?'All':s.replaceAll('_',' ').toUpperCase()}""",
      """{['active','draft','pending_approval'].map(s=>
          <button key={s} type="button" style={smallButton} aria-pressed={filter===s} onClick={()=>setFilter(s)}>
            {s==='active'?'ACTIVE':s.replaceAll('_',' ').toUpperCase()}""",
      'Remove Closed from Petty Cash active filter')
else:
    if "const [filter,setFilter]=useState('active')" not in cv or 'historyRows' not in cv:
        stop('Unexpected Cash Voucher filter version.')

petty_history="""      <section className="jims-closed-history" aria-label="Petty Cash History">
        <h3>Petty Cash History</h3>
        <p>Closed records after both HOD signatures. Existing CV identifiers and official signed Excel stay unchanged.</p>
        <details>
          <summary>View Closed Petty Cash ({historyRows.length} loaded records)</summary>
          <div className="jims-history-scroll">
            <table>
              <thead><tr><th>CV Number</th><th>Claimant</th><th>Amount</th>
                <th>Status</th><th>Date</th><th>Action</th></tr></thead>
              <tbody>
                {historyRows.map(v=><tr key={v.id}>
                  <td>{v.cv_number}</td>
                  <td>{v.form_data?.claimant_name||'—'}</td>
                  <td>{money(v.total_amount)}</td>
                  <td>Closed</td>
                  <td>{dateLabel(v.created_at)}</td>
                  <td><button type="button" style={smallButton}
                    onClick={()=>inspect(v)}>View</button></td>
                </tr>)}
                {!historyRows.length&&<tr><td colSpan={6}>No Closed Petty Cash yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <small>Showing records currently loaded, up to the latest 500. Original approval audit and signed Excel remain available.</small>
        </details>
      </section>"""

if 'aria-label="CV History"' in cv:
    cv=replace_section(cv,'<section className="jims-cv-history jims-history-section" aria-label="CV History">',
      '</section>',petty_history,'Update existing CV History to Petty Cash History')
else:
    cv=replace_one(cv,
      """      </>}
    </>}
    {mode==='form'&&isAP&&<>""",
      """      </>}
"""+petty_history+"""
    </>}
    {mode==='form'&&isAP&&<>""",
      'Add closed Petty Cash History below active/HOD queues')

# Only natural language in JSX and notices, never internal identifiers.
cv=cv.replace('Cash Vouchers','Petty Cash records')
cv=cv.replace('Cash Voucher(s)','Petty Cash vouchers')
cv=cv.replace('Cash Voucher','Petty Cash')
cv=cv.replace('Back to CV Dashboard','Back to Petty Cash Dashboard')
cv=cv.replace('Closed and digitally signed Petty Cash records','Closed and digitally signed Petty Cash records')
if 'Cash Voucher' in cv or 'Petty Cash History' not in cv:
    stop('Petty Cash UI rename/history incomplete.')
if rpc_lines(cv)!=rpc_lines(old_cv):
    stop('Petty Cash approval RPC changed unexpectedly.')
for critical in ("supabase.from('cash_vouchers')",'downloadSignedCVExcel','canSign=','SignaturePad',
                 "supabase.from('cash_voucher_approvals')"):
    if cv.count(critical)!=old_cv.count(critical):
        stop('Protected Petty Cash approval/storage function changed: '+critical)

# User-facing main navigation and Home cards. Keep cash_voucher route keys.
app=replace_one(old_app,"import './JIMSPaymentSeparation.css'",
    "import './JIMSPaymentSeparation.css'\nimport './JIMSClosedLoopHistory.css'",
    'Dark-theme CSS import')
app=replace_one(app,'                Cash Voucher\n              </button>',
    '                Petty Cash\n              </button>',
    'Financial Approval sidebar rename')
app=replace_one(app,"activePage === 'cash_voucher' ? 'Cash Voucher'",
    "activePage === 'cash_voucher' ? 'Petty Cash'",
    'Topbar Petty Cash heading')
home=old_home.replace("title:'Cash Voucher'","title:'Petty Cash'")
home=home.replace('title="Cash Voucher"','title="Petty Cash"')
home=home.replace('Open cash voucher records and approvals',
                  'Petty Cash entries and dual-HOD approval')
home=home.replace('Petty cash records and signed Excel',
                  'Petty Cash records and signed Excel')

for label,source in (('App',app),('Dashboard Home',home)):
    if 'Petty Cash' not in source: stop(label+': rename not confirmed.')
if home.count("page:'cash_voucher'")!=old_home.count("page:'cash_voucher'"):
    stop('Home Cash Voucher routing identifiers changed.')
if app.count("setActivePage('cash_voucher')")!=old_app.count("setActivePage('cash_voucher')"):
    stop('Sidebar routing changed.')
if app.count('onOpenRequestHandled')!=old_app.count('onOpenRequestHandled'):
    stop('Delegation handler changed.')

print('JIMS STEP 54H — '+('DRY RUN' if DRY else 'INSTALL'))
print('Payment Voucher: Draft/Submitted active; Paid + Rejected Permanently in PV History below.')
print('Payment Process: Pending/Initiated active; Paid in Payment History below.')
print('Petty Cash: Draft/Pending dual HOD active; Closed in Petty Cash History below.')
print('Rename Cash Voucher -> Petty Cash across GUI only, CV IDs/database/print unchanged.')
print('No Supabase edits, no payment/approval logic edits, no overwrite of tested 53T-C source.')
if DRY:
    print('DRY RUN PASS — no files changed.')
    sys.exit(0)

originals={APP:old_app,PV:old_pv,CV:old_cv,HOME:old_home}
backup=ROOT/('app/gui-backups/54H_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
for path,old in originals.items():
    (backup/path.name).write_text(old)
created_css=False
try:
    with CSS.open('x') as f:
        f.write(new_css)
    created_css=True
    APP.write_text(app)
    PV.write_text(pv)
    CV.write_text(cv)
    HOME.write_text(home)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP 54H PETTY CASH + CLOSED-LOOP HISTORY — BUILD PASS')
    print('Backups:',backup)
except Exception as e:
    for path,old in originals.items():
        path.write_text(old)
    if created_css: CSS.unlink(missing_ok=True)
    stop('Build/install failed; ALL FOUR source files restored. '+str(e))
