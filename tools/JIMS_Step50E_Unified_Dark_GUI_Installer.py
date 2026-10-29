#!/usr/bin/env python3
"""JIMS Step 50E — unify EVERY logged-in JIMS page with dark premium GUI.

Safeguarded CSS-only installation. Modifies App.jsx by ONE import statement,
creates app/src/JIMSUnifiedDarkV1.css and builds. No other code changes.
Uses exact GitHub branch and backup; auto-restores on build error.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

root = Path("/workspaces/Jauhar")
app = root / "app/src/App.jsx"
css_path = root / "app/src/JIMSUnifiedDarkV1.css"
branch = "jsync-gui-revamp-20261029"
ref = f"origin/{branch}:gui-patches/50E/JIMSUnifiedDarkV1.css"
dry = "--dry-run" in sys.argv

def stop(message):
    sys.exit("STOP: " + str(message))

def run(*args):
    return subprocess.check_output(list(args), cwd=root, text=True)

if not app.is_file():
    stop("App.jsx not found in /workspaces/Jauhar")
current = run("git", "branch", "--show-current").strip()
if current != branch:
    stop(f"Wrong branch: {current}; expected {branch}")
if css_path.exists():
    stop("Unified dark CSS already exists: no overwrite to protect local work")

old = app.read_text()
if "JIMSUnifiedDarkV1.css" in old:
    stop("Unified dark CSS already imported. No modifications.")
anchor = "import './JIMSFinancialApprovalTheme.css'"
if old.count(anchor) != 1:
    stop("Financial Approval GUI import missing/changed. Need tested 50D before 50E.")
if "jims-shell" not in old or "jims-finance-theme" not in old:
    stop("JIMS dashboard or finance scope missing. Nothing modified.")
for marker in ["import CashVoucher from './CashVoucher'",
               "import PaymentVoucher from './PaymentVoucher'",
               "import DelegationWorkspace from './DelegationWorkspace'",
               "import DelegationHub from './DelegationHub'"]:
    if marker not in old:
        stop("Protected business module reference missing: " + marker)
try:
    new_css = run("git", "show", ref)
except Exception as e:
    stop(f"GitHub 50E CSS not available; run git fetch origin {branch}. {e}")

required = ["JIMS STEP 50E", ".jims-shell>.content", "canvas[style*=",
            "JSYNC", "color-scheme:dark", "[style*=", "section.panel"]
# JSYNC isn't a magic deployment identifier; it is used in existing signature selectors.
for term in required:
    if term not in new_css:
        stop(f"CSS validation: missing expected token {term}")
if len(new_css) < 8000:
    stop("Downloaded CSS incomplete")
new_app = old.replace(anchor, anchor + "\nimport './JIMSUnifiedDarkV1.css'", 1)
assert new_app.replace("\nimport './JIMSUnifiedDarkV1.css'", "", 1) == old

print("=== JIMS STEP 50E — UNIFIED DARK GUI V1.1 ===")
print("Mode:", "DRY RUN" if dry else "INSTALL")
print("Coverage: Dashboard, all Financial Approval submenus, User Management, Audit, Profile, system admin")
print("Edits: App.jsx (ONE stylesheet import); new JIMSUnifiedDarkV1.css only")
print("Protected: Login, approval handlers, Supabase, PV/CV/Delegation components, forms logic, signed Excel")
if dry:
    print("DRY RUN PASSED. No files changed.")
    sys.exit(0)

backup = Path(str(app) + ".backup_before_jims_50E_" +
              datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
created_css = False
try:
    with backup.open("x") as f:
        f.write(old)
    with css_path.open("x") as f:
        f.write(new_css)
    created_css = True
    app.write_text(new_app)
    subprocess.run(["npm", "run", "build"], cwd=root/"app", check=True)
    print("JIMS UNIFIED DARK GUI INSTALLED — BUILD PASSED")
    print("Backup:", backup.name)
    print("Only CSS/import changed. No workflows or Supabase changed.")
except Exception as exc:
    try:
        if backup.exists():
            app.write_text(old)
        if created_css and css_path.exists():
            css_path.unlink()
    except Exception as rollback:
        stop(f"Build failed: {exc}. ROLLBACK ERROR: {rollback}. Manual restore from {backup.name}")
    stop("Build/install failed; original App.jsx restored: " + str(exc))
