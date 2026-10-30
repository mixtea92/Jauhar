# JIMS 57CC1 — Code cleaning

57CC1 cleans the installed Codespaces source. Repository `app/src` remains the
historical base used by installers; do not overwrite the installed application
with that base. Flow remains: cleaning → final UAT → readiness → go-live.

## Reviewed edits

- Remove the unreachable, superseded ExcelJS Petty Cash export. Keep the same
  exported async wrapper delegating to the existing OOXML implementation.
- Remove the unused legacy signature-rendering helpers in the OOXML module.
  Keep the active captured-signature export and protection path unchanged.
- Remove an unused XML insertion helper and delegation timestamp formatter.
- Remove unused bindings for AddUser, EditUser, UserOrganizationAssignment and
  useMemo. Preserve local module evaluation with bare imports.

No changes to JSX content, CSS, routes, hooks/state/effect dependencies, access
rules, RPCs, storage, database, payment amounts/statuses, or package versions.

## Installation

On branch `jsync-gui-revamp-20261029`, with app dependencies already installed:

```bash
cd /workspaces/Jauhar
git fetch origin jsync-gui-revamp-20261029
git show origin/jsync-gui-revamp-20261029:tools/JIMS_Step57CC1_Code_Cleaning_Safe_Installer.py > /tmp/JIMS_57CC1.py
python3 /tmp/JIMS_57CC1.py --dry-run && python3 /tmp/JIMS_57CC1.py
```

Exact reviewed source must match. Unused bindings must also be confirmed by
current lint results; otherwise that edit is skipped. Both builds run in an
isolated copy first. Every production artifact must be byte-identical and lint
must introduce no new findings. Only then does install back up the complete src
outside the repository, apply the edits, and build the installed app. A failure
restores changed source and the original validated build artifacts. Environment
values are never printed. No application data or database is accessed.

## Validation

Tested against repository base `d00c05a3bb0d7a1b4703451bdd3d89f938482510`:

- Dry-run and installation pass: eight edits across six source files.
- All 11 production artifacts are byte-identical before/after cleaning.
- Lint findings reduced from 44 to 34; no new findings or suppressed rules.
- Backup contains every original source byte; repeat install makes no changes.
- Injected installed-build failure restores original source and build artifacts.
- A helper made live/referenced in a fixture is retained; dry-run changes no source.

These counts describe the checked repository base. The installer validates the
actual installed working tree and prints its own counts. React state/effect and
other behavior-sensitive lint findings are retained for separate review. Existing
large-chunk build warnings are retained. This is not final UAT or readiness, and
no live role-by-role/database workflow testing was performed in this environment.
