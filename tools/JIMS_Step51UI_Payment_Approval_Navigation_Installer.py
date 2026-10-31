#!/usr/bin/env python3
"""JIMS 51UI: separate approval and payment DASHBOARD entrances only.
No Supabase, status, workflow, permissions, tracking handlers or database changes.
Safe installer: checks exact protected component baselines, backs up all modified
files, builds, restores them on build failure. Intended for Codespaces only.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT = Path("/workspaces/Jauhar")
BRANCH = "jsync-gui-revamp-20261029"
PRE = f"origin/{BRANCH}:"
APP = ROOT / "app/src/App.jsx"
PV = ROOT / "app/src/PaymentVoucher.jsx"
TRACKING = ROOT / "app/src/payment/PaymentTrackingPanel.jsx"
HOME = ROOT / "app/src/JIMSDashboardHome.jsx"
CSS = ROOT / "app/src/JIMSPaymentSeparation.css"
DRY = "--dry-run" in sys.argv

def stop(message):
    raise SystemExit("STOP: " + str(message))

def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True)

def exactly(source, old, new, label):
    count = source.count(old)
    if count != 1:
        stop(f"{label}: expected 1 unique anchor, found {count}. No files changed.")
    return source.replace(old, new, 1)

def remote(path):
    try:
        return git("show", PRE + path)
    except subprocess.CalledProcessError:
        stop("Missing GitHub source " + path + " — fetch origin first.")

if git("branch", "--show-current").strip() != BRANCH:
    stop("Wrong Codespaces branch. Must be " + BRANCH)
for f in (APP, PV, TRACKING, HOME):
    if not f.is_file():
        stop("Missing protected local source: " + str(f))
if CSS.exists():
    stop("51UI CSS already present. Do not overwrite (maybe already installed).")

old_app,old_pv,old_home = [p.read_text() for p in (APP, PV, HOME)]
# All protected approval/payment business code is sourced from the exact
# existing unchanged 50C reference; refuse to replace any unknown user edits.
if old_pv.strip() != remote("app/src/PaymentVoucher.jsx").strip():
    stop("Your PaymentVoucher.jsx differs from protected GitHub baseline. No overwrite.")
if old_home.strip() != remote("gui-patches/50C/JIMSDashboardHome.jsx").strip():
    stop("Dashboard Home contains local changes. No overwrite.")
if "import './JIMSUnifiedDarkV1.css'" not in old_app:
    stop("Locked Unified Dark GUI 50E is missing.")
if "className=\"layout jims-shell\"" not in old_app:
    stop("Protected JIMS shell not found.")
if "jims-finance-theme" not in old_app:
    stop("Protected Financial Approval theme not found.")
if "payment_process" in old_app or "JIMSPaymentSeparation.css" in old_app:
    stop("Payment Process navigation may already exist.")

new_pv = remote("gui-patches/51UI/PaymentVoucher.jsx")
new_home = remote("gui-patches/51UI/JIMSDashboardHome.jsx")
new_css = remote("gui-patches/51UI/JIMSPaymentSeparation.css")
for marker in ["paymentLanding", "Payment Process Dashboard", "openCategory('payment_initiated')", "reviewMode !== 'delegated'"]:
    if marker not in new_pv:
        stop("Payment view patch incomplete: " + marker)
for marker in ["page:'payment_process'", "onNavigate('payment_process')"]:
    if marker not in new_home:
        stop("Dashboard shortcut patch incomplete: " + marker)
if "jims-actions-grid" not in new_css:
    stop("Navigation CSS is incomplete.")

# Verify protected business functions in the CORRECT owner component.
# Payment Voucher implements approval, while payment execution RPCs live in
# payment/PaymentTrackingPanel.jsx (which this installer NEVER modifies).
protected_pv = [
    "'create_pv_draft_v4'",
    "<PaymentTrackingPanel", "async function submitAndVerify()",
    "async function openVoucher(voucherId)"
]
for marker in protected_pv:
    if marker not in old_pv or marker not in new_pv:
        stop("Protected PaymentVoucher source missing: " + marker)
tracking_source = TRACKING.read_text()
for marker in [
    "'initiate_pv_payment_v1'", "'review_pv_payment_initiation_v1'",
    "'complete_pv_payment_v1'"
]:
    if marker not in tracking_source:
        stop("Protected PaymentTrackingPanel source missing: " + marker)

# Payment tracking MUST remain byte-identical: no writes touch TRACKING.
# Also ensure the approval/payment RPC call set inside PV is unchanged.
pv_rpc_lines = lambda src: sorted(line.strip() for line in src.splitlines() if ".rpc(" in line)
if pv_rpc_lines(old_pv) != pv_rpc_lines(new_pv):
    stop("PV RPC call lines changed unexpectedly. No files changed.")

new_app = old_app
new_app = exactly(new_app,
    "import './JIMSUnifiedDarkV1.css'",
    "import './JIMSUnifiedDarkV1.css'\nimport './JIMSPaymentSeparation.css'",
    "Navigation CSS import")
# The same route list occurs in BOTH the Finance sidebar active-state
# and 50D's scoped dark theme <main>. Include payment_process in both places.
old_pages = "['payment_voucher', 'cash_voucher', 'delegation_workspace', 'delegation_review', 'manage_delegation']"
new_pages = "['payment_voucher', 'payment_process', 'cash_voucher', 'delegation_workspace', 'delegation_review', 'manage_delegation']"
if new_app.count(old_pages) != 2:
    stop("Expected Finance sidebar and dark-theme scope route lists (2 occurrences).")
new_app = new_app.replace(old_pages, new_pages)
new_app = exactly(new_app,
    "              {/* JSYNC_STEP_48A_CASH_VOUCHER_MENU */}",
    """              {/* 51UI: payment dashboard, same existing PV approval/payment engine */}
              <button type="button"
                className={`nav-item nav-subitem ${activePage === 'payment_process' ? 'nav-active' : ''}`}
                onClick={() => {
                  setActivePage('payment_process')
                  setEditingUser(null)
                  setResetUser(null)
                }}>
                Payment Process
              </button>
              {/* JSYNC_STEP_48A_CASH_VOUCHER_MENU */}""",
    "Payment Process sidebar")
new_app = exactly(new_app,
    ": activePage === 'payment_voucher' ? 'Payment Voucher'",
    ": activePage === 'payment_process' ? 'Payment Process'\n                  : activePage === 'payment_voucher' ? 'Payment Voucher'",
    "Page heading")
new_app = exactly(new_app,
    """    ) : activePage === 'payment_voucher' ? (
            <PaymentVoucher profile={profile} openRequest={voucherOpenRequest}
              onOpenRequestHandled={() => setVoucherOpenRequest(null)} />
          ) : activePage === 'delegation_workspace' ? (""",
    """    ) : activePage === 'payment_voucher' ? (
            <PaymentVoucher key="pv-approval-route" profile={profile}
              dashboardSection="approval" openRequest={voucherOpenRequest}
              onOpenRequestHandled={() => setVoucherOpenRequest(null)} />
          ) : activePage === 'payment_process' ? (
            <PaymentVoucher key="pv-payment-route" profile={profile}
              dashboardSection="payment" />
          ) : activePage === 'delegation_workspace' ? (""",
    "Separate visual-only routes")

# Verify the only existing <PaymentVoucher> handler paths are preserved.
if "onOpenRequestHandled={() => setVoucherOpenRequest(null)}" not in new_app:
    stop("Existing PV open request handler would be lost.")
if "reviewMode=\"delegated\"" not in new_app:
    stop("Existing Delegation review route would be lost.")

print("JIMS STEP 51UI — " + ("DRY RUN" if DRY else "INSTALL"))
print("Payment Voucher = Draft / Submitted / Approved")
print("Payment Process = Pending Payment / Initiated / Paid")
print("Main Dashboard = fifth Payment Process shortcut; sidebar = separate page")
print("PV engine, all functions, RPCs, roles, Supabase, CV, delegation, login unchanged")
print("Files changed: App.jsx (navigation only), PaymentVoucher.jsx (home display only), JIMSDashboardHome.jsx (shortcuts), new CSS")
if DRY:
    print("DRY RUN PASS — no file changed.")
    sys.exit(0)

backup_dir = ROOT / ("app/gui-backups/51UI_" +
                      datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
backup_dir.mkdir(parents=True,exist_ok=False)
originals = {APP:old_app, PV:old_pv, HOME:old_home}
for source,old in originals.items():
    (backup_dir/source.name).write_text(old)

try:
    APP.write_text(new_app)
    PV.write_text(new_pv)
    HOME.write_text(new_home)
    with CSS.open("x") as f:
        f.write(new_css)
    subprocess.run(["npm","run","build"],cwd=ROOT/"app",check=True)
    print("JIMS PAYMENT / APPROVAL DASHBOARD SEPARATION INSTALLED — BUILD PASS")
    print("Backups:",backup_dir)
except Exception as exc:
    for source,old in originals.items():
        source.write_text(old)
    CSS.unlink(missing_ok=True)
    stop("Build failed; all three originals restored. " + str(exc))
