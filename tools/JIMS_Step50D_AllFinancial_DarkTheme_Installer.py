#!/usr/bin/env python3
"""JIMS Step 50D — apply ONE consistent dark GUI to all Financial Approval pages.

Runs in Codespaces. Changes ONLY App.jsx's finance page styling hook
and adds JIMSFinancialApprovalTheme.css. NEVER edits PV/CV/Delegation/login logic.
A local backup is created; npm build failure triggers automatic restoration.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

root = Path("/workspaces/Jauhar")
app = root / "app/src/App.jsx"
style = root / "app/src/JIMSFinancialApprovalTheme.css"
branch = "jsync-gui-revamp-20261029"
remote_css = "origin/" + branch + ":gui-patches/50D/JIMSFinancialApprovalTheme.css"
dry = "--dry-run" in sys.argv

def stop(message):
    sys.exit("STOP: " + str(message))

def run(*args):
    return subprocess.check_output(list(args), cwd=root, text=True)

if not app.is_file():
    stop("App.jsx not found. Use the project's Codespaces.")
if run("git","branch","--show-current").strip() != branch:
    stop("Wrong branch. Expected " + branch)
if style.exists():
    stop("Financial theme CSS already exists. Refusing overwrite.")

original = app.read_text()
if "JIMSFinancialApprovalTheme.css" in original or "jims-finance-theme" in original:
    stop("Financial theme appears to be already installed. No changes made.")

# Precheck current App wiring. This never overwrites the working PV/CV code.
if "import './JIMSDashboardHome.css'" not in original:
    stop("Dashboard GUI import missing. Step 50C must exist first.")
if "import CashVoucher from './CashVoucher'" not in original or "import PaymentVoucher from './PaymentVoucher'" not in original:
    stop("PV/CV imports differ from protected baseline.")
if "import DelegationWorkspace from './DelegationWorkspace'" not in original or "import DelegationHub from './DelegationHub'" not in original:
    stop("Delegation imports differ from protected baseline.")

anchor = '<main className="content">'
if original.count(anchor) != 1:
    stop("Expected one main content anchor; found " + str(original.count(anchor)))
pages = ("'payment_voucher', 'cash_voucher', 'delegation_workspace', "
         "'delegation_review', 'manage_delegation'")
replacement = (
    "<main className={[" + pages + "].includes(activePage) "
    "? 'content jims-finance-theme' : 'content'}>"
)
updated = original.replace(
    "import './JIMSDashboardHome.css'",
    "import './JIMSDashboardHome.css'\nimport './JIMSFinancialApprovalTheme.css'",
    1
).replace(anchor,replacement,1)

try:
    css = run("git","show",remote_css)
except subprocess.CalledProcessError:
    stop("GitHub theme CSS not found. Run git fetch origin " + branch)

if "JIMS Step 50D" not in css or ".jims-finance-theme" not in css:
    stop("Remote CSS content does not match expected finance theme.")
if len(css) < 6000:
    stop("Remote CSS appears incomplete.")

print("JIMS 50D — " + ("DRY RUN" if dry else "INSTALL"))
print("Scope: Payment Voucher, Cash Voucher, Delegation Workspace, Manage Delegation, Delegated PV Review")
print("Files: app/src/App.jsx (styling class + CSS import only); app/src/JIMSFinancialApprovalTheme.css (new)")
print("Protected: PV/CV/Delegation code, auth, login, Supabase, finance permissions and status workflows")
if dry:
    print("DRY RUN PASSED. No files changed.")
    sys.exit(0)

backup = Path(str(app) + ".backup_before_jims_50D_" +
              datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
try:
    with backup.open("x") as f:
        f.write(original)
    with style.open("x") as f:
        f.write(css)
    app.write_text(updated)
    subprocess.run(["npm","run","build"],cwd=root/"app",check=True)
    print("JIMS FINANCIAL APPROVAL DARK GUI INSTALLED")
    print("Backup:",backup.name)
    print("No payment/approval workflow files modified.")
except Exception as exc:
    if backup.exists():
        app.write_text(original)
    try:
        style.unlink(missing_ok=True)
    except OSError:
        pass
    stop("Build/install failed; original App restored. " + str(exc))
