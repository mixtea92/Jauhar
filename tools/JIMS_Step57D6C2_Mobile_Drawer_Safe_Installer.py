#!/usr/bin/env python3
"""JIMS STEP 57D6C2 — SAFE mobile navigation drawer, GUI-only.

Requires: 57D6C1 sidebar polish, 57D6B theme toggle, JIMS shell.
Writes ONLY: app/src/main.jsx (additive import+component),
             app/src/JIMS57D6C2MobileNav.jsx (new),
             app/src/JIMS57D6C2MobileNav.css (new).
Does NOT edit App.jsx, permissions, roles, routes, notification calculations,
Supabase, Payment Voucher, Petty Cash, approvals, uploads or the desktop layout.
Dry-run is read-only. Local backup, JSX/CSS preflight, build and rollback.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
APPDIR=ROOT/'app'
SRC=APPDIR/'src'
MAIN=SRC/'main.jsx'
APP=SRC/'App.jsx'
PREVIOUS=SRC/'JIMS57D6C1SidebarPolish.css'
THEME=SRC/'JIMS57D6ThemeController.jsx'
TARGET=SRC/'JIMS57D6C2MobileNav.jsx'
STYLES=SRC/'JIMS57D6C2MobileNav.css'
BRANCH='jsync-gui-revamp-20261029'
REMOTE='gui-patches/57D/'
DRY='--dry-run' in sys.argv
IMPORT="import JIMS57D6C2MobileNav from './JIMS57D6C2MobileNav'"
MOUNT='<JIMS57D6C2MobileNav />'
ANCHOR='    <JIMS57D6ThemeController />'
MARKER='JIMS_STEP57D6C2_MOBILE_DRAWER'

def stop(msg):
    sys.exit('STOP: '+str(msg)+' — no application files changed.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def source(name):
    return git('show','origin/'+BRANCH+':'+REMOTE+name)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Expected branch '+BRANCH)
for path in (MAIN,APP,PREVIOUS,THEME):
    if not path.is_file(): stop('Missing prerequisite: '+str(path))
if TARGET.exists() or STYLES.exists():
    stop('57D6C2 source already present, refuse overwrite')

old=MAIN.read_text(encoding='utf-8')
if old.count(ANCHOR)!=1 or old.count("import JIMS57D6ThemeController from './JIMS57D6ThemeController'")!=1:
    stop('Light/dark controller mount not uniquely identified')
if IMPORT in old or MOUNT in old:
    stop('Mobile drawer already mounted')
if old.count('<App />')!=1 or '<StrictMode>' not in old:
    stop('Unexpected app bootstrap, refuse blind integration')
if 'JIMS_STEP57D6C1_SIDEBAR_ONLY' not in PREVIOUS.read_text(encoding='utf-8'):
    stop('57D6C1 sidebar polish checkpoint missing')
old_app=APP.read_text(encoding='utf-8')
if '.jims-shell' not in old_app and 'jims-shell' not in old_app:
    stop('Current app has no known JIMS shell class')
if 'className="sidebar"' not in old_app or 'className="topbar"' not in old_app:
    stop('Current app sidebar/topbar identity not recognized')
old_theme=THEME.read_text(encoding='utf-8')
if "jims-57d6-light" not in old_theme:
    stop('Existing theme controller not recognized')

component=source('JIMS57D6C2MobileNav.jsx')
css=source('JIMS57D6C2MobileNav.css')
for marker in (
    'const BREAKPOINT =',
    "const READY_CLASS = 'jims-57d6c2-ready'",
    "const OPEN_CLASS = 'jims-57d6c2-mobile-open'",
    "root.querySelector('.jims-shell .sidebar')",
    "root.querySelector('.jims-shell > .content > .topbar')",
    "createPortal(toggle, nodes.topbar)",
    "createPortal(close, nodes.sidebar)",
    "document.body",
    "event.key === 'Escape'",
    "button.hasAttribute('aria-expanded')",
    "if (!mobile || !nodes.sidebar || !nodes.topbar) return null",
):
    if marker not in component:stop('Missing mobile drawer safety feature: '+marker)
if css.count(MARKER)!=1 or 'html.jims-57d6c2-ready .jims-shell .sidebar' not in css:
    stop('Mobile CSS not scoped to active controller')
if '@media (max-width:800px)' not in css or 'html.jims-57d6-light' not in css:
    stop('Mobile breakpoint or theme support missing')
if 'position:fixed!important' not in css or 'z-index:2202!important' not in css:
    stop('Drawer stacking not defined')
if any(token in component for token in ('supabase.', 'fetch(', 'localStorage.', '.rpc(', '.upload(')):
    stop('Mobile component may not perform financial/network calls')
if any(token in css for token in ('@import ', 'body > #root {', '.jims-dashboard .jims-action-card')):
    stop('Unexpected global/dashboard CSS rule')
if '.jims-shell .sidebar' not in css:
    stop('Mobile component stylesheet lacks scoped sidebar target')

# Preserve every original line in local main.jsx, adding only 1 import and mount.
updated=IMPORT+'\n'+old.replace(ANCHOR,ANCHOR+'\n    '+MOUNT,1)
if updated.replace(IMPORT+'\n','',1).replace(ANCHOR+'\n    '+MOUNT,ANCHOR,1)!=old:
    stop('Only additive main.jsx integration is allowed')
if updated.count(MOUNT)!=1 or updated.count(IMPORT)!=1:
    stop('Duplicate mount/import')

# No writes to project in dry-run or preflight.
with tempfile.TemporaryDirectory(prefix='jims_57d6c2_') as temp:
    folder=Path(temp)
    test_main=folder/'main.jsx'
    test_comp=folder/'JIMS57D6C2MobileNav.jsx'
    test_css=folder/'JIMS57D6C2MobileNav.css'
    test_main.write_text(updated,encoding='utf-8')
    test_comp.write_text(component,encoding='utf-8')
    test_css.write_text(css,encoding='utf-8')
    script=(
      "const fs=require('node:fs');"
      "Promise.all([import('vite'),import('postcss')]).then(async([v,p])=>{"
      "for(const f of process.argv.slice(1,3))"
      "await v.transformWithOxc(fs.readFileSync(f,'utf8'),f);"
      "p.default.parse(fs.readFileSync(process.argv[3],'utf8'),"
      "{from:process.argv[3]});"
      "console.log('JIMS 57D6C2 JSX + CSS PARSER PASS');"
      "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    result=subprocess.run(['node','-e',script,str(test_main),str(test_comp),str(test_css)],
        cwd=APPDIR,capture_output=True,text=True)
    if result.returncode!=0:
        stop('Preflight failed: '+(result.stderr or result.stdout)[-1800:])
    print(result.stdout.strip())

print('JIMS 57D6C2 GUI-ONLY SAFETY CHECK PASS')
print('Mobile (<=800px): Hamburger > existing sidebar drawer; tap outside/Escape/route to close.')
print('Desktop, dark/light, nav routes, role visibility, badges and upload controls unchanged.')
if DRY:
    print('JIMS 57D6C2 DRY RUN PASS — no project files changed.')
    sys.exit(0)

backup=APPDIR/'gui-backups'/('57D6C2_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/MAIN.name).write_text(old,encoding='utf-8')
try:
    TARGET.write_text(component,encoding='utf-8')
    STYLES.write_text(css,encoding='utf-8')
    MAIN.write_text(updated,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APPDIR,check=True)
    print('JIMS 57D6C2 BUILD PASS')
    print('Backup:',backup)
except Exception as error:
    MAIN.write_text(old,encoding='utf-8')
    TARGET.unlink(missing_ok=True)
    STYLES.unlink(missing_ok=True)
    sys.exit('STOP: Build failed; original main.jsx restored and new mobile files removed: '+str(error))
