#!/usr/bin/env python3
"""JIMS 57D6C4 — Mobile Dashboard Action Cards, safe CSS-only installer.

After 57D6C3: on small mobile screens (<=540px), replace two tiny
columns of dashboard shortcuts with compact readable one-column rows.

Only writes:
  app/src/main.jsx: add one stylesheet import
  app/src/JIMS57D6C4MobileDashboardActions.css: new scoped CSS

No changes to App.jsx, JIMSDashboardHome.jsx, sidebar, login, route
handlers, permissions, badges, PV/PC/Calendar, Supabase or desktop GUI.
Read-only --dry-run, JSX/CSS preflight, backup, build and rollback.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys
import tempfile

ROOT = Path('/workspaces/Jauhar')
APPDIR = ROOT / 'app'
SRC = APPDIR / 'src'
MAIN = SRC / 'main.jsx'
HOME = SRC / 'JIMSDashboardHome.jsx'
HOME_CSS = SRC / 'JIMSDashboardHome.css'
C3_CSS = SRC / 'JIMS57D6C3MobileTopbar.css'
C2_CSS = SRC / 'JIMS57D6C2MobileNav.css'
TARGET = SRC / 'JIMS57D6C4MobileDashboardActions.css'
BRANCH = 'jsync-gui-revamp-20261029'
REMOTE = 'gui-patches/57D/JIMS57D6C4MobileDashboardActions.css'
ANCHOR = "import './JIMS57D6C3MobileTopbar.css'"
IMPORT = "import './JIMS57D6C4MobileDashboardActions.css'"
MARKER = 'JIMS_STEP57D6C4_MOBILE_DASHBOARD_ACTIONS'
DRY = '--dry-run' in sys.argv

def stop(msg):
    sys.exit('STOP: ' + str(msg) + ' — application files unchanged.')

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True)

if git('branch', '--show-current').strip() != BRANCH:
    stop('Expected branch ' + BRANCH)
for path in (MAIN, HOME, HOME_CSS, C3_CSS, C2_CSS):
    if not path.is_file():
        stop('Missing prerequisite: ' + str(path))
if TARGET.exists():
    stop('57D6C4 already exists; refuse to overwrite local modifications')

old_main = MAIN.read_text(encoding='utf-8')
home = HOME.read_text(encoding='utf-8')
dashboard_css = HOME_CSS.read_text(encoding='utf-8')
c3 = C3_CSS.read_text(encoding='utf-8')
c2 = C2_CSS.read_text(encoding='utf-8')

if old_main.count(ANCHOR) != 1 or IMPORT in old_main:
    stop('57D6C3 import missing/duplicated or 57D6C4 already mounted')
if c3.count('JIMS_STEP57D6C3_MOBILE_TOPBAR') != 1:
    stop('57D6C3 mobile topbar prerequisite marker missing')
if c2.count('JIMS_STEP57D6C2_MOBILE_DRAWER') != 1:
    stop('57D6C2 mobile sidebar prerequisite marker missing')
for required in (
    'jims-dashboard', 'jims-actions-grid', 'jims-action-card',
    'jims-action-card-top', 'jims-action-icon', 'jims-action-title',
    'jims-action-desc', 'jims-action-tag', 'jims-home-panel',
    'jims-link-row'
):
    if required not in home or required not in dashboard_css:
        stop('Dashboard structure changed, missing ' + required)

try:
    styles = git('show', 'origin/' + BRANCH + ':' + REMOTE)
except subprocess.CalledProcessError:
    stop('Remote 57D6C4 CSS unavailable; git fetch origin ' + BRANCH)

if styles.count(MARKER) != 1:
    stop('Expected CSS marker missing/duplicated')
for required in (
    '@media (max-width:540px)',
    '.jims-actions-grid',
    '.jims-action-card',
    'grid-template-columns:minmax(0,1fr)!important',
    'grid-template-columns:42px minmax(0,1fr)',
    'font-size:14px',
    'min-height:106px',
):
    if required not in styles:
        stop('Required CSS feature missing: ' + required)
if any(s in styles for s in (
    '@import', 'supabase', '.jims-shell>.content>.topbar',
    '.jims-shell .sidebar', '.pv-', '.cv-', '.login-page',
    'pointer-events:none', 'display:none!important',
)):
    stop('CSS unexpectedly reaches protected module/interaction')

updated = old_main.replace(ANCHOR, ANCHOR + '\n' + IMPORT, 1)
if updated.replace(ANCHOR + '\n' + IMPORT, ANCHOR, 1) != old_main:
    stop('main.jsx edit is not purely additive')
if updated.count(IMPORT) != 1:
    stop('Duplicate CSS import')

with tempfile.TemporaryDirectory(prefix='jims_57d6c4_preflight_') as td:
    folder = Path(td)
    css_copy = folder / TARGET.name
    main_copy = folder / MAIN.name
    css_copy.write_text(styles, encoding='utf-8')
    main_copy.write_text(updated, encoding='utf-8')
    js = (
        "const fs=require('node:fs');"
        "Promise.all([import('postcss'),import('vite')]).then(async([p,v])=>{"
        "const root=p.default.parse(fs.readFileSync(process.argv[1],'utf8'));"
        "const all=root.nodes.filter(n=>n.type!=='comment');"
        "if(all.length!==1 || all[0].type!=='atrule' || "
        "all[0].name!=='media' || all[0].params.replace(/\\s+/g,'')!=='(max-width:540px)')"
        "throw Error('Expected one mobile-only CSS media block');"
        "let count=0;"
        "root.walkRules(rule=>{count++;"
        "if(rule.selector.split(',').some(s=>!s.trim().startsWith("
        "'.jims-shell .jims-dashboard ')))"
        "throw Error('Unscoped dashboard selector: '+rule.selector);"
        "});"
        "if(count<10)throw Error('Incomplete action-card CSS');"
        "await v.transformWithOxc(fs.readFileSync(process.argv[2],'utf8'),"
        "process.argv[2]);"
        "console.log('JIMS 57D6C4 JSX + CSS PARSER PASS ('+count+' scoped rules)');"
        "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    test = subprocess.run(
        ['node', '-e', js, str(css_copy), str(main_copy)],
        cwd=APPDIR, capture_output=True, text=True
    )
    if test.returncode:
        stop('Preflight failed: ' + (test.stderr or test.stdout)[-2000:])
    print(test.stdout.strip())

print('JIMS 57D6C4 GUI-ONLY SAFETY CHECK PASS')
print('Mobile <=540px: Action Required cards one-column, compact and readable.')
print('Desktop, dark/light colors, navigation, counts and finance logic unchanged.')
if DRY:
    print('JIMS 57D6C4 DRY RUN PASS — no application files changed.')
    sys.exit(0)

backup = APPDIR / 'gui-backups' / (
    '57D6C4_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
)
backup.mkdir(parents=True, exist_ok=False)
(backup / MAIN.name).write_text(old_main, encoding='utf-8')
try:
    TARGET.write_text(styles, encoding='utf-8')
    MAIN.write_text(updated, encoding='utf-8')
    subprocess.run(['npm', 'run', 'build'], cwd=APPDIR, check=True)
    print('JIMS 57D6C4 BUILD PASS')
    print('Backup:', backup)
except Exception as err:
    MAIN.write_text(old_main, encoding='utf-8')
    TARGET.unlink(missing_ok=True)
    sys.exit('STOP: Build failed, original main.jsx restored and CSS removed: ' + str(err))
