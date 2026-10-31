#!/usr/bin/env python3
"""JIMS Step 50C — guarded GUI-only installation on existing Codespaces branch.

Only changes app/src/App.jsx and creates app/src/JIMSDashboardHome.jsx/.css.
Never edits PV, CV, Delegation, login, authentication, Supabase, or migrations.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT = Path("/workspaces/Jauhar")
APP = ROOT / "app/src/App.jsx"
HOME = ROOT / "app/src/JIMSDashboardHome.jsx"
STYLE = ROOT / "app/src/JIMSDashboardHome.css"
BRANCH = "jsync-gui-revamp-20261029"
PREFIX = "origin/jsync-gui-revamp-20261029:gui-patches/50C/"
DRY = "--dry-run" in sys.argv

def stop(message):
    sys.exit("STOP: " + str(message))

def run(*args):
    return subprocess.check_output(list(args), cwd=ROOT, text=True)

if not APP.is_file():
    stop("Run in Codespaces /workspaces/Jauhar; App.jsx missing")
if run("git", "branch", "--show-current").strip() != BRANCH:
    stop("Wrong Git branch. Required: " + BRANCH)
if HOME.exists() or STYLE.exists():
    stop("Dashboard UI files already exist. Refusing to overwrite.")

try:
    component = run("git", "show", PREFIX + "JIMSDashboardHome.jsx")
    styles = run("git", "show", PREFIX + "JIMSDashboardHome.css")
except subprocess.CalledProcessError:
    stop("Remote GUI files unavailable. Run git fetch origin first.")

old = APP.read_text()
if "JIMSDashboardHome" in old:
    stop("Dashboard already installed.")
if "import CashVoucher from './CashVoucher'" not in old:
    stop("Protected Cash Voucher import missing.")
if "import DelegationWorkspace from './DelegationWorkspace'" not in old:
    stop("Protected delegation import missing.")

def once(source, original, replacement, label):
    count = source.count(original)
    if count != 1:
        stop(f"{label}: expected one anchor, got {count}. Nothing changed.")
    return source.replace(original, replacement, 1)

new = old
new = once(new,
    "import JSYNCLogin from './login/JSYNCLogin'",
    "import JSYNCLogin from './login/JSYNCLogin'\n"
    "import JIMSDashboardHome from './JIMSDashboardHome'\n"
    "import './JIMSDashboardHome.css'",
    "Dashboard import")
new = once(new,
    '<div className="layout">',
    '<div className="layout jims-shell">',
    "Main shell")

new = once(new,
    '          <div className="sidebar-title">JAUHAR MEDICAL CLINIC</div>\n'
    '          <div className="sidebar-sub">STAFF DASHBOARD SYSTEM</div>',
    '          <div className="jims-brand">\n'
    '            <img\n'
    '              className="jims-brand-logo"\n'
    '              src="/branding/JIMS_Logo.png"\n'
    '              alt="JIMS — JAUHAR Integrated Management System"\n'
    "              onError={e => e.currentTarget.closest('.jims-brand')?.classList.add('jims-brand--text')}\n"
    '            />\n'
    '            <div className="jims-brand-text" aria-hidden="true">\n'
    '              <strong>JIMS</strong>\n'
    '              <small>JAUHAR INTEGRATED<br />MANAGEMENT SYSTEM</small>\n'
    '            </div>\n'
    '          </div>',
    "Logo in sidebar")

new = once(new,
    '        </aside>\n\n        <main className="content">',
    '          <div className="jims-sidebar-footer">\n'
    '            <span className="jims-footer-line" />\n'
    '            <span>JAUHAR MEDICAL CLINIC</span>\n'
    '            <small>Internal management workspace</small>\n'
    '          </div>\n'
    '        </aside>\n\n        <main className="content">',
    "Sidebar footer")

new = once(new,
    '            <button className="btn" onClick={handleLogout}>Logout</button>',
    '            <div className="jims-topbar-right">\n'
    '              <div className="jims-branch-indicator">\n'
    '                <span className="jims-branch-label">BRANCH</span>\n'
    "                <strong>{profile.branch || 'All / Not Assigned'}</strong>\n"
    '              </div>\n'
    '              <button type="button" className="btn jims-logout" onClick={handleLogout}>\n'
    '                <span aria-hidden="true">⇥</span> Logout\n'
    '              </button>\n'
    '            </div>',
    "Topbar right")

# Locate only the existing Home dashboard fallback. All earlier PV/CV/Delegation
# rendering branches remain byte-identical. All login/auth logic stays unchanged.
start_marker = "          ) : profile.role === 'system_admin' ? ("
start = new.find(start_marker, new.find("          ) : activePage === 'cash_voucher' ? ("))
if start == -1:
    stop("Dashboard fallback not found. Existing application structure changed.")
end = new.find("\n        </main>", start)
if end == -1:
    stop("Dashboard fallback end not found.")
part = new[start:end]
for marker in ['className="cards"', "Total Users", "Jauhar Modules",
               "Finance Workspace", "System Admin has full visibility"]:
    if marker not in part:
        stop("Dashboard fallback mismatch: " + marker)

replacement = """          ) : (
            <JIMSDashboardHome
              profile={profile}
              stats={profile.role === 'system_admin' ? { totalUsers, activeUsers, disabledUsers } : null}
              canManageDelegation={canManagePvDelegation(profile)}
              onNavigate={page => {
                setActivePage(page)
                setEditingUser(null)
                setOrganizationUser(null)
                setResetUser(null)
              }}
            />
          )}"""

new = new[:start] + replacement + new[end:]

print("JIMS STEP 50C — " + ("DRY RUN" if DRY else "INSTALL"))
print("Current branch:", BRANCH)
print("App.jsx: only sidebar brand, outer CSS class, topbar, dashboard fallback and imports")
print("New files:", HOME.name, STYLE.name)
print("No changes to: Login, PV, CV, Delegation, Supabase, approvals, data.")
if DRY:
    print("DRY RUN PASSED. No files changed.")
    sys.exit(0)

backup = Path(str(APP) + ".backup_before_jims_50C_" +
              datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
try:
    with backup.open("x") as f:
        f.write(old)
    with HOME.open("x") as f:
        f.write(component)
    with STYLE.open("x") as f:
        f.write(styles)
    APP.write_text(new)
    print("INSTALLED. Backup:", backup.name)
except Exception as exc:
    if backup.exists():
        APP.write_text(backup.read_text())
    for p in (HOME, STYLE):
        if p.exists():
            p.unlink()
    stop("Rolled back: " + str(exc))
