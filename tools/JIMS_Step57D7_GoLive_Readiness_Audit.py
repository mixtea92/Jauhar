#!/usr/bin/env python3
"""JIMS Step 57D7 — non-destructive go-live readiness audit.

Inspects the installed Codespaces working tree, not a stale GitHub template.
No application source, database, user roles, approvals, or CSS changes.
Writes a diagnostic report only under /tmp. 'npm run build' generates
standard Vite dist output but does not modify application source.
Never prints environment variable values or credentials.
"""
from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import json
import os
import re
import subprocess
import sys

ROOT = Path("/workspaces/Jauhar")
APP = ROOT / "app"
SRC = APP / "src"
REPORT = Path("/tmp/JIMS_57D7_GoLive_Readiness_Report.txt")
BRANCH = "jsync-gui-revamp-20261029"
NO_BUILD = "--skip-build" in sys.argv
NO_LINT = "--skip-lint" in sys.argv

items = []
def add(severity, topic, detail):
    items.append((severity, topic, detail))

def run(command, cwd=ROOT, timeout=160):
    try:
        result = subprocess.run(command, cwd=cwd, text=True, capture_output=True,
                                timeout=timeout, check=False)
        return result.returncode, (result.stdout or "") + "\n" + (result.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "Timed out"
    except FileNotFoundError:
        return 127, "Executable not found"

def visible_path(path):
    try:
        return path.relative_to(ROOT).as_posix()
    except Exception:
        return path.name

if not SRC.is_dir():
    print("STOP: /workspaces/Jauhar/app/src not found. No files changed.")
    sys.exit(1)

branch_code, branch = run(["git", "branch", "--show-current"])
branch = branch.strip()
if branch_code != 0:
    add("P0", "Git", "Unable to read repository branch.")
elif branch != BRANCH:
    add("P1", "Git branch", f"Current branch {branch!r} differs from expected {BRANCH!r}.")
else:
    add("PASS", "Git branch", branch)
commit_code, commit = run(["git", "rev-parse", "--short", "HEAD"])
if commit_code == 0:
    add("INFO", "Current commit", commit.strip())
dirty_code, dirty = run(["git", "status", "--porcelain", "--untracked-files=normal"])
if dirty_code == 0:
    count = len([line for line in dirty.splitlines() if line.strip()])
    if count:
        add("P1", "Uncommitted application state",
            f"{count} tracked/untracked change(s) in working tree. Capture release snapshot before deployment.")
    else:
        add("PASS", "Git working tree", "Clean")
else:
    add("P1", "Git status", "Unable to inspect working tree.")

# Check build prerequisites. Only report variable names/presence, NEVER values.
env_names = ("VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY")
env_status = {key: bool(os.environ.get(key)) for key in env_names}
env_file_names = (".env", ".env.local", ".env.production", ".env.production.local")
env_files = [APP/name for name in env_file_names if (APP/name).is_file()]
for env_file in env_files:
    try:
        content = env_file.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        continue
    for key in env_names:
        if re.search(r"(?m)^\s*(?:export\s+)?" + re.escape(key) + r"\s*=\s*[^#\s]+", content):
            env_status[key] = True
for key in env_names:
    if env_status[key]:
        add("PASS", key, "Defined in process environment or local Vite env file (value not shown).")
    else:
        add("P1", key, "Not present locally. Confirm production deployment environment provides it.")
if not (APP/"package.json").exists():
    add("P0", "Application package", "app/package.json missing.")
else:
    try:
        package = json.loads((APP/"package.json").read_text(encoding="utf-8"))
        scripts = package.get("scripts", {})
        if "build" not in scripts:
            add("P0", "Build script", "npm run build is not configured.")
        else:
            add("PASS", "Build script", "npm run build configured")
        if "lint" not in scripts:
            add("P1", "Lint script", "No lint command defined; source lint not checked.")
    except (OSError, ValueError) as err:
        add("P0", "Application package", f"Cannot parse app/package.json ({type(err).__name__}).")

# Source scan intentionally avoids reading secret files, bundles and DB data.
source_files = sorted(p for p in SRC.rglob("*")
                      if p.is_file() and p.suffix in (".jsx",".tsx",".js",".ts")
                      and "node_modules" not in p.parts)
add("INFO", "Source files scanned", str(len(source_files)))
flag_patterns = [
    ("Feature marked unavailable", re.compile(
        r"\b(?:TIER_PERSISTENCE_BACKEND_READY|EXTENDED_INVOICE_BACKEND_READY)\s*=\s*false\b",re.I)),
    ("Testing/development wording", re.compile(
        r"development pilot only|demo only|test mode|preview only|temporary pilot|"
        r"under development|coming soon|modules are being developed",re.I)),
    ("Unfinished feature wording", re.compile(
        r"temporarily disabled|not yet implemented|will be integrated|"
        r"drafts only at step|upcoming document-upload step",re.I)),
    ("Old visible branding", re.compile(
        r"['\"\x60][^'\"\x60\n]{0,130}\bJSYNC\b[^'\"\x60\n]{0,130}['\"\x60]|"
        r"alt\s*=\s*['\"][^'\"]*\bJSYNC\b",re.I)),
]
matches = Counter()
for file in source_files:
    try:
        lines = file.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        continue
    for idx,line in enumerate(lines,1):
        s=line.strip()
        if not s or s.startswith(("//","*","/*","#")):
            continue
        for title,pattern in flag_patterns:
            if pattern.search(s):
                matches[title] += 1
                # Safe: output only category and source position; no code, URL or secret.
                severity = "P0" if title == "Feature marked unavailable" else "REVIEW"
                add(severity, title, f"{visible_path(file)}:{idx}")

# Critical app safeguards are manual verification; code presence alone is not proof.
code = {}
for filename in ("CashVoucher.jsx","PaymentVoucher.jsx","App.jsx"):
    path = SRC/filename
    if path.is_file():
        try:
            code[filename] = path.read_text(encoding="utf-8")
        except (OSError,UnicodeError):
            pass
cv = code.get("CashVoucher.jsx","")
if re.search(r"(?:isMobileUpload|isMobile).*(?:return|disabled)", cv):
    add("INFO", "Mobile upload restriction", "Frontend mobile restriction found; must still verify on device.")
else:
    add("REVIEW", "Mobile upload restriction", "Cannot confirm mobile upload restriction from installed Petty Cash source.")
if "system_admin" in code.get("App.jsx",""):
    add("INFO", "System Admin", "System Admin role found; must still verify read-only and RLS.")
else:
    add("REVIEW", "System Admin", "Could not confirm System Admin role in App.jsx.")

# Files with sensitive names in tracked repository should never be pushed publicly.
check_code, tracked = run(["git", "ls-files"])
if check_code == 0:
    bad=[]
    for path in tracked.splitlines():
        name=Path(path).name.lower()
        if (name.startswith(".env") and not name.endswith(".example")) or \
           name.endswith((".pem",".p12",".pfx",".key")) or name in ("credentials.json","service-account.json"):
            bad.append(path)
    if bad:
        add("P0","Potential tracked secrets", f"{len(bad)} sensitive-name file(s) tracked. Inspect git ls-files privately; do NOT paste secrets.")
    else:
        add("PASS","Tracked sensitive file names","No known secret-name files detected (content scan not performed).")

# Build and lint reflect CURRENT installed working tree.
if NO_BUILD:
    add("REVIEW","Production build","Skipped by --skip-build.")
else:
    rc,output = run(["npm","run","build"],cwd=APP,timeout=240)
    if rc == 0:
        add("PASS","Production build","npm run build completed successfully.")
    else:
        add("P0","Production build",f"npm run build FAILED (exit {rc}). Output tail:")
        # build output can include source, avoid printing env values. Print only summary lines.
        safe=[s.strip() for s in output.splitlines() if any(w in s.lower() for w in
              ("error:","failed to","cannot resolve","module not found","syntaxerror","parse_error"))]
        for s in safe[:8]:
            add("INFO","Build error summary",s[:230])
if NO_LINT:
    add("REVIEW","Lint","Skipped by --skip-lint.")
elif (APP/"package.json").exists():
    rc, output = run(["npm","run","lint"],cwd=APP,timeout=160)
    if rc==0:
        add("PASS","Lint","npm run lint completed successfully.")
    else:
        add("P1","Lint",f"npm run lint returned nonzero (exit {rc}); inspect local lint output before release.")
        safe=[line.strip() for line in output.splitlines() if re.search(
              r"\b(error|warning|problem)\b", line,re.I)]
        for line in safe[:8]:
            add("INFO","Lint summary",line[:200])

# These require real UAT against production/staging, not code-only approval.
manual=[
 "Login/logout, session expiration, and account disable/reactivate.",
 "Roles: AP Exec, HOD, Finance Manager, CEO, BOD, System Admin read-only, non-executive.",
 "PV tiers T01–T09; JR exceptions, approve/return/reject, audit history.",
 "Full/partial payment with mandatory proof, manager verification and final PDF.",
 "Petty Cash dual-HOD signature and receipts; browser mobile uploads blocked.",
 "Correct row-level access across four branches and departments (Supabase RLS).",
 "Final deployed domain: TLS/HTTPS, environment variables, no exposed privileged keys.",
 "Restore/backup and controlled release/rollback plan."
]

priority = Counter(level for level,_,_ in items)
lines = [
 "JIMS 57D7 — GO-LIVE READINESS REPORT",
 "Generated UTC: "+datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
 "Checks are from THIS Codespaces working tree; no production DB access was used.",
 "Build may regenerate app/dist; no source or Supabase changes made.",
 "",
 "SUMMARY",
 f"P0: {priority['P0']} | P1: {priority['P1']} | Review: {priority['REVIEW']} | Pass: {priority['PASS']}",
 "RELEASE STATUS: NOT CLEARED — live role/UAT/security checks are still required.",
 "",
 "AUTOMATED FINDINGS",
]
lines.extend(f"[{level}] {title}: {detail}" for level,title,detail in items)
lines += ["","MANUAL GO-LIVE UAT (NOT YET VERIFIED)"]
lines.extend(f"{i}. {name}" for i,name in enumerate(manual,1))
REPORT.write_text("\n".join(lines)+"\n",encoding="utf-8")

print("\n".join(lines[:11]))
for level,title,detail in items:
    if level in ("P0","P1","REVIEW"):
        print(f"[{level}] {title}: {detail}")
print("\nReport saved:",REPORT)
print("Audit done. No frontend source, backend, database or permissions changed.")
