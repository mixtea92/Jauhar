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
                  className={'nav-item jims-57d6c1-row nav-subitem jims-action-nav ' + (activePage === 'finance_document_archive' ? 'nav-active' : '')}
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
    # Anchor to the actual Cash Voucher / Petty Cash navigation BUTTON.
    # The latest JIMS sidebar may render a notification badge inside the button.
    # Insert AFTER the enclosing role guard, never INSIDE its conditional.
    nav_buttons = list(re.finditer(
        r'<button\\b[^>]*>(?:(?!</button>).)*?setActivePage\\([\\x27\\x22]cash_voucher[\\x27\\x22]\\)(?:(?!</button>).)*?</button>',
        source,
        flags=re.DOTALL
    ))
    # In actual JIMS, onClick and CSS template contain >, so use a simpler
    # boundary scan if the conservative regex cannot match a JSX attribute.
    if len(nav_buttons) == 1:
        end = nav_buttons[0].end()
    else:
        matches = []
        for m in re.finditer(r"setActivePage\\(['\\x22]cash_voucher['\\x22]\\)", source):
            start = source.rfind('<button', max(0, m.start() - 1000), m.start())
            close = source.find('</button>', m.end())
            if start < 0 or close < 0 or close - m.start() > 2500:
                continue
            # Verify this button is a named Petty Cash nav button, not an action.
            if not re.search(r'\\bPetty Cash\\b', source[m.end():close]):
                continue
            matches.append(close + len('</button>'))
        if len(matches) != 1:
            raise RuntimeError('Petty Cash navigation anchor not found uniquely (found %s). No files changed.' % len(matches))
        end = matches[0]

    # The Petty Cash button is wrapped by a JIMS role guard (... && (...)).
    guard = re.match(r'\\s*\\)\\}', source[end:])
    if not guard:
        raise RuntimeError('Petty Cash role-guard closing not recognized. No files changed.')
    pos = end + guard.end()
    source = source[:pos] + NAV + source[pos:]

    # Keep the finance group highlight AND finance main-panel theme on Archive.
    old_list = "'cash_voucher', 'delegation_workspace'"
    updated_count = source.count(old_list)
    if updated_count < 2 or updated_count > 5:
        raise RuntimeError('Finance active-page lists differ (found %s). No files changed.' % updated_count)
    source = source.replace(old_list, "'cash_voucher', 'finance_document_archive', 'delegation_workspace'")

    # Existing App navigation uses a JSX conditional chain for content pages.
    pattern = r'\)\s*:\s*activePage\s*===\s*["\x27]cash_voucher["\x27]\s*\?\s*\('
    content_matches = list(re.finditer(pattern, source))
    if len(content_matches) != 1:
        raise RuntimeError('CashVoucher page route not found uniquely (found %s). No file changed.' % len(content_matches))
    match = content_matches[0]
    source = source[:match.start()] + ')' + PAGE + source[match.start()+1:]

    # Page heading must display the exact locked title.
    heading_marker = ": activePage === 'cash_voucher' ? 'Petty Cash'"
    if source.count(heading_marker) != 1:
        raise RuntimeError('Petty Cash heading anchor missing/ambiguous. No files changed.')
    source = source.replace(
        heading_marker,
        ": activePage === 'finance_document_archive' ? 'Finance Document Archive'\n"
        "                  " + heading_marker,
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
