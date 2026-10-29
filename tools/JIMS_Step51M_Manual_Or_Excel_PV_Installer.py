#!/usr/bin/env python3
"""JIMS Step 51M: PV New Draft can be created manually OR via validated Excel.
UI-only optional-import change; existing draft, approval, payments, JR, CV,
delegation, and Supabase functions are not modified.

Accepts local PV at exact 51UI or 51H guarded baseline. Backs up source,
checks all anchors and existing RPC call lines, builds, rolls back on failure.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys

ROOT = Path('/workspaces/Jauhar')
BRANCH = 'jsync-gui-revamp-20261029'
PV = ROOT / 'app/src/PaymentVoucher.jsx'
DRY = '--dry-run' in sys.argv

def stop(message):
    sys.exit('STOP: ' + str(message))

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True)

def remote(path):
    try:
        return git('show', 'origin/' + BRANCH + ':' + path)
    except Exception as exc:
        stop('GitHub baseline missing ' + path + '. Run git fetch origin first. ' + str(exc))

def replace_one(source, before, after, name):
    count = source.count(before)
    if count != 1:
        stop(name + ': expected one matching section, found ' + str(count) + '. No files changed.')
    return source.replace(before, after, 1)

if git('branch', '--show-current').strip() != BRANCH:
    stop('Wrong branch. Expected ' + BRANCH)
if not PV.is_file():
    stop('PaymentVoucher.jsx not found in Codespaces.')

old = PV.read_text()
baseline = None
for name, path in (
    ('51UI', 'gui-patches/51UI/PaymentVoucher.jsx'),
    ('51H', 'gui-patches/51H/PaymentVoucher.jsx'),
):
    if old.strip() == remote(path).strip():
        baseline = name
        break
if baseline is None:
    stop('Your local PV source is not the exact protected 51UI/51H baseline; no overwrite. Send the current PV diff for a safe custom patch.')

new = old
changes = [
    (
        "budget_classification: '', financial_tier: '', template_version: '',",
        "budget_classification: '', financial_tier: '', template_version: REQUIRED_TEMPLATE_REVISION,",
        'Manual draft uses current form-schema revision 0000',
    ),
    (
        """    if (newPvValidated && !window.confirm(
      'Replace the previously imported form and all your unsaved edits with this new Excel?'
    )) return""",
        """    if ((newPvValidated || JSON.stringify(form) !== JSON.stringify(blankForm())) && !window.confirm(
      'Importing Excel will replace your current unsaved PV form details. Continue?'
    )) return""",
        'Prevent overwriting unsaved manual fields during Excel import',
    ),
    (
        """    if (workspaceMode === 'new' && !newPvValidated) {
      setError('Upload and validate the official JAUHAR Excel template before creating a PV.')
      return
    }
""",
        '',
        'Remove mandatory Excel upload validation only',
    ),
    (
        'New PV requires a valid official Excel upload. Existing Draft edits do not require another upload.',
        'New PV: fill the form manually, or upload the official Excel for auto-fill. Both options use the same validation and approval workflow.',
        'Update manual/Excel page intro',
    ),
    (
        '<strong>Download is optional. Upload is compulsory.</strong>',
        '<strong>Two options: Manual Entry or Excel Import.</strong>',
        'Make Excel optional in guide',
    ),
    (
        "{' '}If you already have the current Excel template, use it directly.",
        "{' '}Complete the form below yourself, or upload a completed template to auto-fill it.",
        'Manual entry guidance',
    ),
    (
        'Upload Completed Official PV Excel (.xlsx) *',
        'Upload Completed Official PV Excel (.xlsx) — Optional',
        'Remove compulsory marker from Excel import label',
    ),
    (
        "{(workspaceMode === 'edit' || newPvValidated) ? (",
        "{(workspaceMode === 'edit' || workspaceMode === 'new') ? (",
        'Unlock New PV form immediately',
    ),
    (
        """          </form>
          ) : (
            <div className="pv-notice" role="status">
              <strong><span aria-hidden="true">🔒</span> New PV form locked.</strong>
              {' '}Upload a valid, completed Blank Form Excel template above to unlock editing.
            </div>
          )}""",
        """          </form>
          )}""",
        'Remove outdated locked-form message',
    ),
    (
        'Ten rows come from the official Excel; extra rows are allowed.',
        'Enter invoice lines manually or import them from Excel; extra rows are allowed.',
        'Invoice line help for both entry methods',
    ),
    (
        'Complete the <strong>Blank Form</strong> tab and choose PV Tier in cell K12.',
        'If importing: complete the <strong>Blank Form</strong> tab and choose PV Tier in cell K12.',
        'Excel-only import guidance',
    ),
]

for before, after, label in changes:
    new = replace_one(new, before, after, label)

def rpc_lines(source):
    return sorted(line.strip() for line in source.splitlines() if '.rpc(' in line)

if rpc_lines(new) != rpc_lines(old):
    stop('Protected RPC calls changed unexpectedly.')
for protected in (
    "supabase.rpc('create_pv_draft_v4'",
    '<PaymentTrackingPanel',
    '<JRPanel',
    'async function handleSave(event)',
    'async function openVoucher(voucherId)',
    'p_template_version: form.template_version',
    'form.template_version !== REQUIRED_TEMPLATE_REVISION',
    'if (!FINANCIAL_TIERS[form.financial_tier])',
):
    if old.count(protected) != new.count(protected):
        stop('Protected workflow marker unexpectedly changed: ' + protected)

if new.count('Download Official Template (Optional)') != old.count('Download Official Template (Optional)'):
    stop('Official Excel template download was modified.')
if new.count('async function handleExcelImport(event)') != old.count('async function handleExcelImport(event)'):
    stop('Existing Excel import functionality changed.')

print('JIMS STEP 51M — ' + ('DRY RUN' if DRY else 'INSTALL'))
print('Detected protected GUI baseline:', baseline)
print('New PV supports (1) manual data entry (2) validated official Excel auto-fill')
print('Excel remains downloadable; existing JR/tier/approval/payment safeguards unchanged')
print('Scope: ONLY app/src/PaymentVoucher.jsx. Supabase and DB NOT modified.')
if DRY:
    print('DRY RUN PASS. No files changed.')
    sys.exit(0)

backup_dir = ROOT / ('app/gui-backups/51M_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup_dir.mkdir(parents=True, exist_ok=False)
backup = backup_dir / 'PaymentVoucher.jsx'
backup.write_text(old)
try:
    PV.write_text(new)
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT / 'app', check=True)
    print('JIMS PV MANUAL + EXCEL OPTIONS INSTALLED — BUILD PASS')
    print('Backup:', backup)
except Exception as exc:
    PV.write_text(old)
    stop('Build failed. Original PaymentVoucher.jsx restored. ' + str(exc))
