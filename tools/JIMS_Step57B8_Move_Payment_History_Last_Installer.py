#!/usr/bin/env python3
"""JIMS Step 57B8 — move Paid/Payment History to absolute bottom of Payment Process.

Requires Step57B7 REV1 build-pass in Codespaces. This patch only moves the
existing Paid History button (with its original onClick and count) out of
the Payment Process Dashboard into a Payment History panel *after* the
Finance Manager review queue and AP Payment Completion queue.

No changes to payment approvals, full/partial settlement, RLS, SQL, alerts,
counter calculations, or history retrieval.
"""
from pathlib import Path
from datetime import datetime, timezone
import re
import subprocess
import sys

ROOT = Path('/workspaces/Jauhar')
BRANCH = 'jsync-gui-revamp-20261029'
TARGET = ROOT / 'app/src/PaymentVoucher.jsx'
DRY = '--dry-run' in sys.argv

def stop(message):
    sys.exit('STOP: ' + str(message))

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True)

if git('branch', '--show-current').strip() != BRANCH:
    stop('Switch to the working branch ' + BRANCH)
if not TARGET.is_file():
    stop('Missing app/src/PaymentVoucher.jsx')

original = TARGET.read_text()
required = (
    '<h2>Payment Process Dashboard</h2>',
    'JIMS_STEP_57B7_COMPLETION',
    'JIMS_STEP_57B5_INITIATED_LIST',
    "import JIMSPaymentCompletionQueue from './JIMSPaymentCompletionQueue'",
    "import JIMSV2FinanceManagerQueue from './JIMSV2FinanceManagerQueue'",
    '<JIMSPaymentCompletionQueue',
    '<JIMSV2FinanceManagerQueue',
    "const paymentLanding = dashboardSection === 'payment'",
)
for marker in required:
    if marker not in original:
        stop('Required installed 57B7 baseline not found: ' + marker)

if 'JIMS_STEP_57B8_HISTORY_LAST' in original:
    stop('Payment History has already been moved by Step57B8.')

dashboard = original.index('<h2>Payment Process Dashboard</h2>')
nonpayment_anchor = "      {workspaceMode === 'home' && !paymentLanding && ("
if original.count(nonpayment_anchor) != 1:
    stop('Cannot safely find Payment Process home section boundary')
bottom = original.index(nonpayment_anchor, dashboard)

# The original 57B7 button may have different formatting on local Codespaces,
# but must contain a Paid History label and still navigate to 'paid'.
history_positions = [
    m.start() for m in re.finditer(r'Paid History', original[dashboard:bottom])
]
if len(history_positions) != 1:
    stop('Expected one Paid History control in Payment Process dashboard; found '
         + str(len(history_positions)))

history_index = dashboard + history_positions[0]
button_start = original.rfind('<button', dashboard, history_index)
button_end_start = original.find('</button>', history_index, bottom)
if button_start < dashboard or button_end_start < 0:
    stop('Cannot isolate existing Paid History button')
button_end = button_end_start + len('</button>')
button = original[button_start:button_end]
if (len(button) > 1200 or
    len(button) < 70 or
    not re.search(r"openCategory\(\s*['\"]paid['\"]\s*\)", button) or
    'Paid History' not in button or
    '<button' in button[7:]):
    stop('Existing Paid History button differs; no changes applied')

# Ensure the button being moved belongs to the dashboard, not a PV details
# payment-history child or another unrelated section.
completion_mount = original.rfind('<JIMSPaymentCompletionQueue', dashboard, bottom)
fm_mount = original.rfind('<JIMSV2FinanceManagerQueue', dashboard, bottom)
if completion_mount < 0 or fm_mount < 0 or not (button_end < fm_mount < completion_mount):
    stop('Unexpected Payment Process order; history button must currently be in dashboard')

# Move the exact original button, retaining its existing navigation/count.
updated = original[:button_start] + original[button_end:]
if updated.count(nonpayment_anchor) != 1:
    stop('Unexpected home section after relocating button')

history_panel = """      {/* JIMS_STEP_57B8_HISTORY_LAST: final Payment Process section */} 
      {workspaceMode === 'home' && paymentLanding && (
        <section className="panel" id="jims-payment-history" aria-label="Payment History">
          <div className="panel-head">
            <div>
              <h2>Payment History</h2>
              <p className="muted">Completed payments and paid voucher history. Individual installment evidence remains in each voucher.</p>
            </div>
            BUTTON_SLOT
          </div>
        </section>
      )}

"""
history_panel = history_panel.replace('BUTTON_SLOT', button.strip())
updated = updated.replace(nonpayment_anchor, history_panel + nonpayment_anchor, 1)

# Strict non-functional safeguards: existing browser actions, counters, and
# all Supabase RPCs are untouched.
checks = (
    ('RPC count', original.count('supabase.rpc('), updated.count('supabase.rpc(')),
    ('Payment Tracking Panel', original.count('<PaymentTrackingPanel'), updated.count('<PaymentTrackingPanel')),
    ('FM review queue', original.count('<JIMSV2FinanceManagerQueue'), updated.count('<JIMSV2FinanceManagerQueue')),
    ('AP Completion queue', original.count('<JIMSPaymentCompletionQueue'), updated.count('<JIMSPaymentCompletionQueue')),
    ('Paid history click', len(re.findall(r"openCategory\(\s*['\"]paid['\"]\s*\)", original)),
     len(re.findall(r"openCategory\(\s*['\"]paid['\"]\s*\)", updated))),
)
for label, before, after in checks:
    if before != after:
        stop(label + ' changed; before=' + str(before) + ', after=' + str(after))

last_history = updated.index('JIMS_STEP_57B8_HISTORY_LAST')
if not (last_history > updated.index('<JIMSPaymentCompletionQueue') and
        last_history > updated.index('<JIMSV2FinanceManagerQueue') and
        last_history < updated.index(nonpayment_anchor, dashboard)):
    stop('Payment History not positioned last in Payment Process')

print('JIMS STEP57B8 — ' + ('DRY RUN' if DRY else 'INSTALL'))
print('Order: Pending Payment > Payment Initiated > Payment Completion > Payment History (LAST)')
print('Only PaymentVoucher.jsx layout changes. No database/payment workflow changes.')
if DRY:
    print('DRY RUN PASS — zero files changed.')
    sys.exit(0)

backup = ROOT / 'app/gui-backups' / (
    '57B8_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
)
backup.mkdir(parents=True, exist_ok=False)
(backup / 'PaymentVoucher.jsx').write_text(original)
try:
    TARGET.write_text(updated)
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT / 'app', check=True)
    print('JIMS STEP57B8 PAYMENT HISTORY LAST — BUILD PASS')
    print('Backup:', backup)
except Exception as e:
    TARGET.write_text(original)
    stop('Build failed; original PaymentVoucher.jsx restored: ' + str(e))
