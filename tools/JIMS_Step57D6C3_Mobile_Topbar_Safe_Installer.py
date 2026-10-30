#!/usr/bin/env python3
"""JIMS Step 57D6C3 — mobile topbar usability, GUI-only safe installer.

After 57D6C2, arrange mobile topbar as:
  hamburger | title/user | theme
  branch context         | logout

Restores branch visibility hidden by earlier <=540px dashboard CSS.
Only creates app/src/JIMS57D6C3MobileTopbar.css and adds one import
to app/src/main.jsx. No App.jsx or component edits. No business logic.
Dry-run, guarded CSS/JSX preflight, local backup, build, rollback.
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
APP = SRC / 'App.jsx'
C2 = SRC / 'JIMS57D6C2MobileNav.jsx'
C2CSS = SRC / 'JIMS57D6C2MobileNav.css'
THEME = SRC / 'JIMS57D6Theme.css'
TARGET = SRC / 'JIMS57D6C3MobileTopbar.css'
BRANCH = 'jsync-gui-revamp-20261029'
REMOTE = 'gui-patches/57D/JIMS57D6C3MobileTopbar.css'
MARKER = 'JIMS_STEP57D6C3_MOBILE_TOPBAR'
ANCHOR = "import JIMS57D6C2MobileNav from './JIMS57D6C2MobileNav'"
IMPORT = "import './JIMS57D6C3MobileTopbar.css'"
DRY = '--dry-run' in sys.argv

def stop(why):
    sys.exit('STOP: ' + str(why) + ' — application files unchanged.')

def git(*args):
    return subprocess.check_output(
        ['git', *args], cwd=ROOT, text=True
    )

if git('branch', '--show-current').strip() != BRANCH:
    stop('Expected branch ' + BRANCH)

for path in (MAIN, APP, C2, C2CSS, THEME):
    if not path.is_file():
        stop('Missing prerequisite ' + str(path))
if TARGET.exists():
    stop('57D6C3 already installed or customized; refuse overwrite')

old_main = MAIN.read_text(encoding='utf-8')
old_app = APP.read_text(encoding='utf-8')
if old_main.count(ANCHOR) != 1 or IMPORT in old_main:
    stop('57D6C2 import missing/duplicate, or 57D6C3 already imported')
if old_main.count('<JIMS57D6C2MobileNav />') != 1:
    stop('57D6C2 mobile drawer is not mounted exactly once')
if old_main.count('<JIMS57D6ThemeController />') != 1:
    stop('Existing theme controller is not mounted exactly once')
if 'JIMS_STEP57D6C2_MOBILE_DRAWER' not in C2CSS.read_text(encoding='utf-8'):
    stop('57D6C2 mobile drawer CSS marker not found')
if 'JIMS_STEP57D6B2_TRUE_LIGHT_MODE' not in THEME.read_text(encoding='utf-8'):
    stop('Approved Light Mode prerequisite not found')
for expected in (
    'jims-shell', 'className="topbar"', 'jims-topbar-right',
    'jims-branch-indicator', 'jims-branch-label', 'jims-logout'
):
    if expected not in old_app:
        stop('Known JIMS topbar identity missing: ' + expected)

try:
    styles = git('show', 'origin/' + BRANCH + ':' + REMOTE)
except subprocess.CalledProcessError:
    stop('Remote 57D6C3 CSS unavailable; run git fetch origin ' + BRANCH)

if styles.count(MARKER) != 1:
    stop('Remote stylesheet marker missing/duplicated')
for required in (
    'grid-template-areas:', '"menu title theme"', '"branch branch logout"',
    '.jims-57d6c2-menu-button', '.jims-branch-indicator',
    '.jims-logout', '.jims-57d6-theme-toggle',
    'display:contents!important', 'min-height:44px',
    '@media (max-width:800px)', '@media (max-width:540px)'
):
    if required not in styles:
        stop('Mobile-only CSS requirement missing: ' + required)
if any(x in styles for x in (
    '@import', 'supabase', '.pv-', '.jims-dashboard .jims-action-card',
    '.jims-shell .sidebar', '.login-page'
)):
    stop('Stylesheet reaches protected module or login/sidebar')

new_main = old_main.replace(ANCHOR, ANCHOR + '\n' + IMPORT, 1)
if new_main.replace(ANCHOR + '\n' + IMPORT, ANCHOR, 1) != old_main:
    stop('main.jsx integration is not purely additive')

# Read-only preflight against exactly the current local main.jsx.
with tempfile.TemporaryDirectory(prefix='jims_57d6c3_preflight_') as temp:
    folder = Path(temp)
    style_test = folder / TARGET.name
    main_test = folder / MAIN.name
    style_test.write_text(styles, encoding='utf-8')
    main_test.write_text(new_main, encoding='utf-8')
    js = (
        "const fs=require('node:fs');"
        "Promise.all([import('postcss'),import('vite')]).then(async([p,v])=>{"
        "const root=p.default.parse(fs.readFileSync(process.argv[1],'utf8'));"
        "const items=root.nodes.filter(n=>n.type!=='comment');"
        "const media=items.map(n=>n.type==='atrule'&&n.name==='media'?"
        "n.params.replace(/\\s+/g,''):'invalid');"
        "if(media.join('|')!=='(max-width:800px)|(max-width:540px)')"
        "throw Error('Non-mobile CSS or unexpected media structure');"
        "let count=0;"
        "root.walkRules(rule=>{count++;"
        "if(rule.selector.split(',').some(s=>!s.includes('.jims-shell>.content>.topbar')))"
        "throw Error('Selector escaped JIMS topbar: '+rule.selector);"
        "});"
        "if(count<10)throw Error('Incomplete topbar stylesheet');"
        "await v.transformWithOxc(fs.readFileSync(process.argv[2],'utf8'),"
        "process.argv[2]);"
        "console.log('JIMS 57D6C3 CSS + JSX PARSER PASS ('+count+' rules)');"
        "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    checked = subprocess.run(
        ['node', '-e', js, str(style_test), str(main_test)],
        cwd=APPDIR, capture_output=True, text=True
    )
    if checked.returncode:
        stop('Parser preflight failed: ' + (checked.stderr or checked.stdout)[-1800:])
    print(checked.stdout.strip())

print('JIMS 57D6C3 MOBILE TOPBAR GUI-ONLY SAFETY CHECK PASS')
print('Mobile: hamburger + readable title + theme, then branch + logout.')
print('Desktop, sidebar, permissions, notifications and uploads unchanged.')
if DRY:
    print('JIMS 57D6C3 DRY RUN PASS — no app files changed.')
    sys.exit(0)

backup = APPDIR / 'gui-backups' / (
    '57D6C3_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
)
backup.mkdir(parents=True, exist_ok=False)
(backup / MAIN.name).write_text(old_main, encoding='utf-8')
try:
    TARGET.write_text(styles, encoding='utf-8')
    MAIN.write_text(new_main, encoding='utf-8')
    subprocess.run(['npm', 'run', 'build'], cwd=APPDIR, check=True)
    print('JIMS 57D6C3 BUILD PASS')
    print('Backup:', backup)
except Exception as error:
    MAIN.write_text(old_main, encoding='utf-8')
    TARGET.unlink(missing_ok=True)
    sys.exit('STOP: Build failed; main.jsx and CSS rolled back: ' + str(error))
