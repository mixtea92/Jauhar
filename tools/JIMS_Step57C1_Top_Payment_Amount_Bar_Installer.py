#!/usr/bin/env python3
"""JIMS Step 57C1 — amount bar at the VERY TOP of Payment Process.

Order: Pending Payment Amount (big), then Paid Amount / Partial Amount Paid /
Left to Pay; followed by the existing Payment Process Dashboard and status
groups. No SQL, payment workflow, notification, receipt, approval or RLS edits.
Safe to install immediately after the Step57B9 build-pass baseline.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT = Path('/workspaces/Jauhar')
BRANCH = 'jsync-gui-revamp-20261029'
# Frozen exact Step 57B9 UI artifacts, used as non-destructive baseline checks.
BASELINE = '1f32146b094993d0a699d522e20a175f5c324715'
JSX = ROOT / 'app/src/JIMSPaymentProcessBoard.jsx'
CSS = ROOT / 'app/src/JIMSPaymentProcessBoard.css'
DRY = '--dry-run' in sys.argv

def stop(message):
    sys.exit('STOP: ' + str(message))

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True)

def show(ref, path):
    try:
        return git('show', ref + ':' + path)
    except Exception as e:
        stop('Missing required Git reference/file ' + ref + ':' + path + ' — ' + str(e))

if git('branch', '--show-current').strip() != BRANCH:
    stop('Codespaces must be on ' + BRANCH)

paths = [
    ('gui-patches/57B/JIMSPaymentProcessBoard.jsx', JSX),
    ('gui-patches/57B/JIMSPaymentProcessBoard.css', CSS),
]
for _, path in paths:
    if not path.is_file():
        stop('Step 57B9 board missing: ' + str(path))

old_jsx = JSX.read_text()
old_css = CSS.read_text()
new_assets = []
for repo_path, local_path in paths:
    expected = show(BASELINE, repo_path)
    actual = local_path.read_text()
    if actual != expected:
        stop('Installed 57B9 asset differs from protected reference: '
             + str(local_path) + '. No files changed. '
             'Do NOT overwrite local customizations.')
    updated = show('origin/' + BRANCH, repo_path)
    if updated == actual:
        stop('Step 57C1 appears to be installed already: ' + str(local_path))
    new_assets.append(updated)

new_jsx, new_css = new_assets
for marker in (
    "JIMS_STEP_57C1_AMOUNT_BAR_FIRST",
    "const financialSummary=useMemo",
    "Pending Payment Amount",
    "Paid Amount",
    "Partial Amount Paid",
    "Left to Pay",
    "Full Payment Status",
    "Partial Payment Status",
    "Partially Paid — Outstanding Balance",
    "<h3>Payment History</h3>",
):
    if marker not in new_jsx:
        stop('New board missing required feature: ' + marker)
for marker in (
    "JIMS STEP 57C1",
    ".jims-pb-money-main",
    ".jims-pb-money-grid",
    ".jims-pb-money-outstanding",
):
    if marker not in new_css:
        stop('New amount-bar styling incomplete: ' + marker)
if new_jsx.count('<h3>Payment History</h3>') != 1:
    stop('Payment History must remain a single section')
if new_jsx.index('JIMS_STEP_57C1_AMOUNT_BAR_FIRST') > new_jsx.index('<div className="panel-head">'):
    stop('Amount bar MUST appear before Dashboard header')
for forbidden in ('.insert(', '.update(', '.upsert(', '.delete(', '.rpc(', '.upload('):
    if forbidden in new_jsx:
        stop('Amount summary must be read-only: ' + forbidden)
for important in ('supabase.from(', 'onOpenVoucher(', 'jims-pb-history'):
    if new_jsx.count(important) != old_jsx.count(important):
        stop('Protected payment list/navigation function changed: ' + important)

print('JIMS STEP57C1 — ' + ('DRY RUN' if DRY else 'INSTALL'))
print('TOP: Pending Payment Amount')
print('BELOW: Paid Amount | Partial Amount Paid | Left to Pay')
print('Existing Full/Partial workflow and one Payment History are preserved.')
print('No database or payment approval changes.')
if DRY:
    print('DRY RUN PASS — zero files changed.')
    sys.exit(0)

backup = ROOT / 'app/gui-backups' / (
    '57C1_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
)
backup.mkdir(parents=True, exist_ok=False)
(backup / JSX.name).write_text(old_jsx)
(backup / CSS.name).write_text(old_css)
try:
    JSX.write_text(new_jsx)
    CSS.write_text(new_css)
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT / 'app', check=True)
    print('JIMS STEP57C1 PAYMENT AMOUNT BAR TOP — BUILD PASS')
    print('Backup:', backup)
    print('Refresh Payment Process; amount summary must be above the dashboard title.')
except Exception as e:
    JSX.write_text(old_jsx)
    CSS.write_text(old_css)
    stop('Build failed. Original Step57B9 amount-free UI restored: ' + str(e))
