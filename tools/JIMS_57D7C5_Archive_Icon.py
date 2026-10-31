#!/usr/bin/env python3
"""57D7C5: Change ONLY the installed Finance Document Archive sidebar icon.

Usage in complete integration worktree:
  python3 tools/JIMS_57D7C5_Archive_Icon.py --dry-run
  python3 tools/JIMS_57D7C5_Archive_Icon.py --apply

No change to archive page, permissions, data, PV/CV or Supabase.
"""
import argparse
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app" / "src" / "App.jsx"

OLD_CLASS = "className={'nav-item jims-57d6c1-row nav-subitem jims-action-nav ' + (activePage === 'finance_document_archive' ? 'nav-active' : '')}"
NEW_CLASS = "className={'nav-item jims-57d6c1-row nav-subitem jims-action-nav jims-archive-nav ' + (activePage === 'finance_document_archive' ? 'nav-active' : '')}"

OLD_LABEL = """                  Finance Document Archive
                </button>"""
NEW_LABEL = """                  <svg className="jims-archive-nav-icon" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 8V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2" />
                    <rect x="3" y="9" width="18" height="11" rx="2" />
                    <path d="M9 13h6M11 16h2" />
                  </svg>
                  <span className="jims-archive-nav-label">Finance Document Archive</span>
                </button>"""

def planned_update(source):
    if "jims-archive-nav-icon" in source:
        raise ValueError("Icon already installed; no change made")
    if source.count(OLD_CLASS) != 1:
        raise ValueError("Finance Document Archive class not found uniquely")
    if source.count(OLD_LABEL) != 1:
        raise ValueError("Finance Document Archive sidebar label not found uniquely")
    result = source.replace(OLD_CLASS, NEW_CLASS, 1).replace(OLD_LABEL, NEW_LABEL, 1)
    if result.count("Finance Document Archive") != source.count("Finance Document Archive"):
        raise ValueError("Archive label unexpectedly changed")
    return result

def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not APP.exists():
        raise SystemExit("STOP: App.jsx missing")
    original = APP.read_text(encoding="utf-8")
    try:
        updated = planned_update(original)
    except ValueError as error:
        raise SystemExit("STOP: " + str(error))
    print("57D7C5 archive icon preflight: PASS")
    print("Only existing sidebar icon/label will change; permission and routes untouched")
    if args.dry_run:
        print("DRY RUN PASS — no files changed")
        return
    backup = ROOT.parent / (
        "JIMS_57D7C5_Archive_Icon_Backup_"
        + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S") + ".jsx"
    )
    shutil.copyfile(APP, backup)
    APP.write_text(updated, encoding="utf-8")
    if APP.read_text(encoding="utf-8") != updated:
        raise RuntimeError("Write verification failed")
    print("APPLIED: folder archive outline icon")
    print("BACKUP: " + str(backup))
    print("No Supabase changes; no commit/push/deploy")

if __name__ == "__main__":
    main()
