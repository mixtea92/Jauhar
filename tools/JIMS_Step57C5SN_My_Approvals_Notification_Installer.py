#!/usr/bin/env python3
"""JIMS 57C5S — Standalone My Approvals Sidebar + Dashboard, HOD / FM / CEO / BOD.
Replaces superseded 57C5 in-PV-home design. Does NOT require running 57C4 or 57C5.
Backend universal actual-authority summary RPC is already installed in Supabase.
NO changes to approval RPCs, PV business rules, payment, Petty Cash, invoice, budgets.
"""
from pathlib import Path
from datetime import datetime, timezone
import re
import subprocess
import sys
import tempfile

ROOT = Path("/workspaces/Jauhar")
BRANCH = "jsync-gui-revamp-20261029"
APP = ROOT / "app/src/App.jsx"
PV = ROOT / "app/src/PaymentVoucher.jsx"
COMP = ROOT / "app/src/JIMSApproverSummary.jsx"
CSS = ROOT / "app/src/JIMSApproverSummary.css"
REMOTE = "gui-patches/57C/"
DRY = "--dry-run" in sys.argv

def stop(msg):
    sys.exit("STOP: " + str(msg))

def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True)

def remote(path):
    try:
        return git("show", "origin/" + BRANCH + ":" + path)
    except Exception as exc:
        stop("Missing remote file " + path + ": " + str(exc))

def exactly_one(text, needle, label):
    n = text.count(needle)
    if n != 1:
        stop(label + ": expected 1 exact occurrence, found " + str(n) + ". No files changed.")

def choose_anchor(text, choices, label):
    for anchor in choices:
        if text.count(anchor) == 1:
            return anchor
    stop(label + ": no unique safe insertion point. No files changed.")

if git("branch", "--show-current").strip() != BRANCH:
    stop("Switch to branch " + BRANCH + " first.")
if not APP.is_file() or not PV.is_file():
    stop("Required installed App.jsx or PaymentVoucher.jsx missing.")
# Upgrade in-place if the standalone sidebar is already installed.
already_installed = False

app_old = APP.read_text(encoding="utf-8")
pv_old = PV.read_text(encoding="utf-8")
already_installed = "JIMS_STEP_57C5S_MY_APPROVALS" in app_old
if "my_approvals" in app_old and not already_installed:
    stop("Existing My Approvals sidebar has unknown layout; refuse duplicate.")
if "JIMS_STEP_57C5SN_APPROVAL_BADGE" in app_old:
    stop("Step57C5SN badge already installed; no duplicate.")
if already_installed:
    if not COMP.is_file() or not CSS.is_file() or "JIMSApproverSummary" not in app_old:
        stop("Existing My Approvals installation incomplete; refuse unsafe patch.")
else:
    if COMP.exists() or CSS.exists():
        stop("Summary component files exist without sidebar; refuse overwrite.")
    if "JIMS_STEP_57C5_ALL_APPROVERS" in pv_old or "JIMS_STEP_57C4_BOD_SUMMARY" in pv_old:
        stop("An older approval summary is installed in PV; inspect first.")

widget_jsx = remote(REMOTE + "JIMSApproverSummary.jsx")
widget_css = remote(REMOTE + "JIMSApproverSummary.css")
for required in (
    "jims_actual_approver_summary_v1",
    "View Details", "Cost Center", "Subdept", "Branch",
    "hod_decide_department_pv_v1",
    "finance_manager_decide_department_pv_v2",
    "ceo_decide_jr_v1", "bod_decide_jr_v1",
    "jr_meeting_ready",
):
    if required not in widget_jsx:
        stop("Missing mandatory summary capability: " + required)
if any(x in widget_jsx for x in (".insert(", ".update(", ".delete(", ".upload(")):
    stop("Summary contains unexpected direct DB write/upload.")
if "JIMS Step57C5" not in widget_css:
    stop("Incorrect summary CSS revision.")

app_new = app_old
pv_new = pv_old
if not already_installed:
    # 1. App import + single centralized role gate. Never assign approval to admin.
    import_rx = re.compile(
        r"(?m)^([ \t]*import[ \t]+PaymentVoucher[ \t]+from[ \t]+['\"]\./PaymentVoucher['\"];?)[ \t]*$"
    )
    matches = list(import_rx.finditer(app_old))
    if len(matches) != 1:
        stop("App PaymentVoucher import is missing or ambiguous; " + str(len(matches)) + " matches.")
    m = matches[0]
    app_new = app_old[:m.end()] + (
        "\nimport JIMSApproverSummary from './JIMSApproverSummary'"
    ) + app_old[m.end():]
    guard = """// JIMS_STEP_57C5S_MY_APPROVALS: actual approval roles only (no System Admin).
    function jimsCanSeeMyApprovals(p) {
      return p?.is_active === true && (
        p.role === 'ceo' || p.role === 'bod' ||
        (p.role === 'manager' && Boolean(p.department))
      )
    }

    """
    if app_new.count("function App()") != 1:
        stop("App function declaration changed; no safe role-gate anchor.")
    app_new = app_new.replace("function App()", guard + "function App()", 1)

    # 2. Own top-level sidebar item; not buried in PV or financial submenu.
    sidebar_anchor = choose_anchor(app_new, [
        "          {/* SYSTEM ADMIN: USER MANAGEMENT */}",
        "          {profile.role === 'non_executive' && (",
        "    {/* FINANCE APPROVAL: MAIN MENU WITH SUBMENU */}",
        "          {/* FINANCE APPROVAL: MAIN MENU WITH SUBMENU */}",
    ], "My Approvals sidebar position")
    sidebar = """          {/* JIMS 57C5S: Standalone role-specific Approval Dashboard. */}
              {jimsCanSeeMyApprovals(profile) && (
                <button
                  type="button"
                  className={\u0060nav-item \u0024{activePage === 'my_approvals' ? 'nav-active' : ''}\u0060}
                  onClick={() => {
                    setVoucherOpenRequest(null)
                    setActivePage('my_approvals')
                    setEditingUser(null)
                    setResetUser(null)
                  }}
                >
                  My Approvals
                </button>
              )}

    """
    app_new = app_new.replace(sidebar_anchor, sidebar + sidebar_anchor, 1)

    # 3. Page title and separate page route, with one-way View Details deep link.
    title_rx = re.compile(r"(?m)^([ \t]*): activePage === 'payment_voucher' \? 'Payment Voucher'")
    title_hits = list(title_rx.finditer(app_new))
    if len(title_hits) != 1:
        stop("My Approvals title anchor unavailable/ambiguous.")
    h = title_hits[0]
    app_new = app_new[:h.start()] + (
        h.group(1) + ": activePage === 'my_approvals' ? 'My Approvals'\n" +
        h.group(1) + ": activePage === 'payment_voucher' ? 'Payment Voucher'"
    ) + app_new[h.end():]

    route_rx = re.compile(r"\)\s*:\s*activePage\s*===\s*['\"]payment_voucher['\"]\s*\?\s*\(")
    route_hits = list(route_rx.finditer(app_new))
    if len(route_hits) != 1:
        stop("Payment Voucher routing anchor unavailable/ambiguous.")
    r = route_hits[0]
    new_route = """) : activePage === 'my_approvals' ? (
                jimsCanSeeMyApprovals(profile) ? (
                  <JIMSApproverSummary
                    profile={profile}
                    onOpenVoucher={id => {
                      setVoucherOpenRequest({ id, key: Date.now() })
                      setActivePage('payment_voucher')
                    }}
                  />
                ) : (
                  <section className="panel">
                    <h2>Access Restricted</h2>
                    <p>This approval dashboard is available to HOD, Finance Manager, CEO and BOD only.</p>
                  </section>
                )
              ) : activePage === 'payment_voucher' ? ("""
    app_new = app_new[:r.start()] + new_route + app_new[r.end():]

    # 4. Retire only the old embedded Actual Authority queue in PV home, if present.
    #    Delegated approval workflow has its own workspace and MUST stay untouched.
    pv_new = pv_old
    pv_queue = re.compile(
        r"(?m)^[ \t]*<ApprovalQueues\b(?:(?!/>)[\s\S]){0,900}?\bmode\s*=\s*['\"]actual['\"]"
        r"(?:(?!/>)[\s\S]){0,500}?/>[ \t]*\r?\n?"
    )
    queue_hits = list(pv_queue.finditer(pv_old))
    if len(queue_hits) > 1:
        stop("Multiple old actual queues found, no safe removal.")
    if len(queue_hits) == 1:
        k = queue_hits[0]
        pv_new = pv_old[:k.start()] + pv_old[k.end():]
        if not re.search(r"<ApprovalQueues\b", pv_new):
            pv_new = re.sub(
                r"(?m)^[ \t]*import\s+ApprovalQueues\s+from\s+['\"]\./ApprovalQueues['\"];?[ \t]*\r?\n",
                "", pv_new
            )
    else:
        print("NOTE: Old embedded PV queue not found; existing PV preserved.")


# 5. Step57C5SN — Small notification number on standalone My Approvals.
#    Uses exactly the same secured actual-authority RPC as the dashboard.
#    A zero / unknown count is hidden; failures never show a misleading zero.
if "JIMS_STEP_57C5SN_APPROVAL_BADGE" in app_new:
    stop("Badge duplicate detected before patch.")
if "jimsCanSeeMyApprovals" not in app_new:
    stop("Role guard missing from My Approvals sidebar.")
react_import = "import { useCallback, useEffect, useState } from 'react'"
exactly_one(app_new, react_import, "React hooks import")
app_new = app_new.replace(
    react_import,
    "import { useCallback, useEffect, useRef, useState } from 'react'",
    1
)
state_anchor = "  const [activePage, setActivePage] = useState('dashboard')"
exactly_one(app_new, state_anchor, "My Approvals badge state")
badge_logic = """
  // JIMS_STEP_57C5SN_APPROVAL_BADGE — actual authority notifications only.
  const [myApprovalBadge, setMyApprovalBadge] = useState(null)
  const myApprovalBadgeSequence = useRef(0)
  const refreshMyApprovalBadge = useCallback(async () => {
    const sequence = ++myApprovalBadgeSequence.current
    if (!jimsCanSeeMyApprovals(profile)) {
      setMyApprovalBadge(null)
      return
    }
    try {
      const { data, error: badgeError } =
        await supabase.rpc('jims_actual_approver_summary_v1')
      if (sequence !== myApprovalBadgeSequence.current) return
      if (badgeError || !Array.isArray(data?.rows)) {
        setMyApprovalBadge(null)
        return
      }
      setMyApprovalBadge(data.rows.length)
    } catch {
      if (sequence === myApprovalBadgeSequence.current) setMyApprovalBadge(null)
    }
  }, [profile?.role, profile?.department, profile?.is_active])

  useEffect(() => {
    // Refresh on role/login, return to tab, selected page and periodically.
    if (!jimsCanSeeMyApprovals(profile)) {
      ++myApprovalBadgeSequence.current
      setMyApprovalBadge(null)
      return
    }
    void refreshMyApprovalBadge()
    const onFocus = () => void refreshMyApprovalBadge()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshMyApprovalBadge()
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshMyApprovalBadge()
    }, 60000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [profile?.role, profile?.department, profile?.is_active,
      activePage, refreshMyApprovalBadge])
"""
app_new = app_new.replace(state_anchor, state_anchor + badge_logic, 1)
nav_anchor = "              My Approvals\n            </button>"
exactly_one(app_new, nav_anchor, "My Approvals sidebar label")
app_new = app_new.replace(nav_anchor, """              <span>My Approvals</span>
              {myApprovalBadge !== null && myApprovalBadge > 0 && (
                <span className="jims-my-approval-badge"
                  aria-label={myApprovalBadge + ' pending approvals'}>
                  {myApprovalBadge >= 100 ? '99+' : myApprovalBadge}
                </span>
              )}
            </button>""", 1)
summary_anchor = """              <JIMSApproverSummary
                profile={profile}
                onOpenVoucher={id => {"""
exactly_one(app_new, summary_anchor, "Standalone approval dashboard component")
app_new = app_new.replace(summary_anchor, """              <JIMSApproverSummary
                profile={profile}
                onDecisionRecorded={refreshMyApprovalBadge}
                onOpenVoucher={id => {""", 1)
css_anchor = "  .nav-active { background: #28517d; color: white; font-weight: 700; }"
exactly_one(app_new, css_anchor, "Nav style anchor")
app_new = app_new.replace(css_anchor, css_anchor + """
  .jims-my-approval-badge {
    float: right; display: inline-flex; align-items: center; justify-content: center;
    min-width: 23px; height: 22px; padding: 0 7px; border-radius: 999px;
    background: #c6a15c; color: #211a10; font-size: 12px; font-weight: 800;
    line-height: 1; margin-left: 9px;
  }""", 1)

if "jims_actual_approver_summary_v1" not in widget_jsx:
    stop("Missing installed universal RPC call.")

def existing_rpc_calls(x):
    return sorted(line.strip() for line in x.splitlines() if "supabase.rpc(" in line)
if existing_rpc_calls(pv_old) != existing_rpc_calls(pv_new):
    stop("Existing PV approval/payment RPC references changed unexpectedly.")
allowed_new_app_call = "await supabase.rpc('jims_actual_approver_summary_v1')"
app_calls_before = existing_rpc_calls(app_old)
app_calls_after = existing_rpc_calls(app_new)
if app_calls_after != sorted(app_calls_before + [allowed_new_app_call]):
    stop("Unexpected App RPC change; only the read-only approval summary count is allowed.")
for token in ("PaymentTrackingPanel", "PVDelegationHistory", "bodDecide", "financeManagerDecide"):
    if pv_old.count(token) != pv_new.count(token):
        stop("Protected PaymentVoucher behavior changed: " + token)
for token in ("DelegationWorkspace", "PaymentVoucher", "CashVoucher"):
    if app_old.count(token) != app_new.count(token):
        stop("Protected App module affected: " + token)

# Validate JSX syntax prior to any edits, if parser installed.
if (ROOT / "app/node_modules/@babel/parser").is_dir():
    with tempfile.TemporaryDirectory(prefix="jims_57c5s_preflight_") as tmp:
        temp = Path(tmp)
        paths = []
        for filename, src in (
            ("App.jsx", app_new),
            ("PaymentVoucher.jsx", pv_new),
            ("JIMSApproverSummary.jsx", widget_jsx)
        ):
            path = temp / filename
            path.write_text(src, encoding="utf-8")
            paths.append(str(path))
        checker = (
            "const fs=require('fs'),p=require('@babel/parser');"
            "for(const f of process.argv.slice(1))"
            "p.parse(fs.readFileSync(f,'utf8'),{sourceType:'module',plugins:['jsx']});"
            "console.log('JIMS 57C5S JSX PARSER PASS')"
        )
        preflight = subprocess.run(
            ["node", "-e", checker, *paths],
            cwd=ROOT / "app", capture_output=True, text=True
        )
        if preflight.returncode != 0:
            stop("JSX preflight failed: " + preflight.stderr[-3000:])
        print(preflight.stdout.strip())
else:
    print("NOTE: Babel parser missing; npm build will validate JSX.")

print("JIMS STEP57C5SN — " + ("DRY RUN" if DRY else "INSTALL"))
print("Standalone sidebar 'My Approvals' and notification badge ONLY for HOD/FM/CEO/BOD.")
print("Role-specific dashboard; summary and quick decisions outside PV home.")
print("View Details -> existing full Payment Voucher (JR/invoice/history).")
print("Gold badge = number of actual approvals; updates every 60s/focus/decision.")
print("No change to PV, Payment Process, Petty Cash or approval RPC logic.")
if DRY:
    print("DRY RUN PASS — no project files changed.")
    sys.exit(0)

backup = ROOT / "app/gui-backups" / (
    "57C5SN_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
)
backup.mkdir(parents=True, exist_ok=False)
(backup / "App.jsx").write_text(app_old, encoding="utf-8")
(backup / "PaymentVoucher.jsx").write_text(pv_old, encoding="utf-8")

try:
    APP.write_text(app_new, encoding="utf-8")
    PV.write_text(pv_new, encoding="utf-8")
    if not already_installed:
        COMP.write_text(widget_jsx, encoding="utf-8")
        CSS.write_text(widget_css, encoding="utf-8")
    subprocess.run(["npm", "run", "build"], cwd=ROOT / "app", check=True)
    print("JIMS STEP57C5SN MY APPROVALS + NOTIFICATION BADGE — BUILD PASS")
    print("Backup:", backup)
except Exception as exc:
    APP.write_text(app_old, encoding="utf-8")
    PV.write_text(pv_old, encoding="utf-8")
    if not already_installed:
        COMP.unlink(missing_ok=True)
        CSS.unlink(missing_ok=True)
    stop("Build failed. Original App and PV restored: " + str(exc))
