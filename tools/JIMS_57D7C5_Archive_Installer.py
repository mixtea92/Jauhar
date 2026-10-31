#!/usr/bin/env python3
"""JIMS 57D7C5: guarded, additive App.jsx menu integration.

Run from integration worktree root:
  python3 tools/JIMS_57D7C5_Archive_Installer.py --dry-run
  python3 tools/JIMS_57D7C5_Archive_Installer.py --apply

Preserves original finance workflow; updates App.jsx only after exact
preflight assertions. Never modifies Supabase or touches other worktrees.
"""
import argparse
import difflib
from pathlib import Path
import re
import shutil
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app/src/App.jsx'
COMPONENT = ROOT / 'app/src/FinanceDocumentArchive.jsx'

IMPORT = """import FinanceDocumentArchive, { canAccessFinanceDocumentArchive } from './FinanceDocumentArchive'
"""
NAV = """
              {canAccessFinanceDocumentArchive(profile) && (
                <button type="button"
                  className={'nav-item nav-subitem ' + (activePage === 'finance_document_archive' ? 'nav-active' : '')}
                  onClick={() => setActivePage('finance_document_archive')}>
                  Finance Document Archive
                </button>
              )}
"""
PAGE = """ : activePage === 'finance_document_archive' ? (
              canAccessFinanceDocumentArchive(profile)
                ? <FinanceDocumentArchive profile={profile} />
                : <section className="panel" role="alert">Access Restricted</section>
          )"""

def apply_to(source):
    if 'finance_document_archive' in source or 'FinanceDocumentArchive' in source:
        raise RuntimeError('Archive appears already installed. No files changed.')
    if source.count("import CashVoucher from './CashVoucher'") != 1:
        raise RuntimeError("Expected CashVoucher import missing/ambiguous.")
    source = source.replace(
        "import CashVoucher from './CashVoucher'",
        "import CashVoucher from './CashVoucher'\n" + IMPORT.rstrip(),
        1
    )
    # Locate the Petty Cash sidebar BUTTON, not the title or payment body.
    matches = []
    for m in re.finditer(r'\bPetty Cash\b', source):
        start = max(0, m.start() - 750)
        preceding = source[start:m.start()]
        if "setActivePage('cash_voucher')" not in preceding and 'setActivePage("cash_voucher")' not in preceding:
            continue
        end = source.find('</button>', m.end())
        if end == -1 or end - m.end() > 250:
            continue
        matches.append(end + len('</button>'))
    if len(matches) != 1:
        raise RuntimeError('Petty Cash navigation anchor not found uniquely (found %s). Inspect App.jsx before changing anything.' % len(matches))
    pos = matches[0]
    source = source[:pos] + NAV + source[pos:]

    # Existing App navigation uses a JSX conditional chain for content pages.
    pattern = r'\)\s*:\s*activePage\s*===\s*["\x27]cash_voucher["\x27]\s*\?\s*\('
    content_matches = list(re.finditer(pattern, source))
    if len(content_matches) != 1:
        raise RuntimeError('CashVoucher page route not found uniquely (found %s). No file changed.' % len(content_matches))
    match = content_matches[0]
    source = source[:match.start()] + ')' + PAGE + source[match.start()+1:]

    # Optional heading and group-active enhancement; no other UI copy touched.
    marker = ": activePage === 'cash_voucher' ?"
    if marker in source:
        heading_marker = ": activePage === 'cash_voucher' ? '"
        if heading_marker in source:
            source = source.replace(
                heading_marker,
                ": activePage === 'finance_document_archive' ? 'Finance Document Archive'\n"
                "                   " + heading_marker,
                1
            )
    return source

def main():
    p = argparse.ArgumentParser()
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--dry-run', action='store_true')
    group.add_argument('--apply', action='store_true')
    args = p.parse_args()
    if not APP.is_file() or not COMPONENT.is_file():
        raise SystemExit('STOP: App.jsx or FinanceDocumentArchive.jsx missing.')
    before = APP.read_text(encoding='utf-8')
    try:
        after = apply_to(before)
    except RuntimeError as exc:
        raise SystemExit('STOP: ' + str(exc))
    print('57D7C5 preflight: PASS')
    print('Finance menu + protected route: planned')
    print('Existing characters preserved in original order: additive patch')
    if args.dry_run:
        print('DRY RUN PASS — no files written')
        return
    backup = ROOT.parent / ('JIMS_57D7C5_App_backup_' + datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S') + '.jsx')
    shutil.copyfile(APP, backup)
    APP.write_text(after, encoding='utf-8')
    assert APP.read_text(encoding='utf-8') == after
    print('APPLIED: ' + str(APP))
    print('BACKUP: ' + str(backup))
    print('No merge, no commit, no push, no Supabase changes.')

if __name__ == '__main__':
    main()
