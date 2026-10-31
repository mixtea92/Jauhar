#!/usr/bin/env python3
"""JIMS 57D6B — safe LIGHT/DARK theme toggle (additive UI ONLY).

Precondition: Step 57D6A already installed and BUILD PASS.
Installs:
    app/src/JIMS57D6ThemeController.jsx (new component)
    app/src/JIMS57D6Theme.css          (new stylesheet)
    app/src/main.jsx                   (one import and one root sibling mount)
Never writes App.jsx, PV, PC, Calendar, Login, Supabase or financial logic.
Exact guard, CSS/JSX parser, --dry-run, backup + rollback on build failure.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
MAIN=APP/'src/main.jsx'
COMP=APP/'src/JIMS57D6ThemeController.jsx'
CSS=APP/'src/JIMS57D6Theme.css'
DARK_CSS=APP/'src/JIMS57D6ADarkFinancePolish.css'
BRANCH='jsync-gui-revamp-20261029'
REMOTE='gui-patches/57D/'
DRY='--dry-run' in sys.argv
IMPORT="import JIMS57D6ThemeController from './JIMS57D6ThemeController'"
MOUNT='<JIMS57D6ThemeController />'
DARK_IMPORT="import './JIMS57D6ADarkFinancePolish.css'"
APP_RENDER='<App />'
MARKER='JIMS_STEP57D6B_LIGHT_DARK'

def stop(reason):
    sys.exit('STOP: '+str(reason)+' — local files were not changed.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)
def remote(name):
    return git('show','origin/'+BRANCH+':'+REMOTE+name)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Codespaces branch mismatch')
if not MAIN.is_file() or not DARK_CSS.is_file():
    stop('Step 57D6A must be installed before 57D6B')
old=MAIN.read_text(encoding='utf-8')
if DARK_IMPORT not in old or 'JIMS_STEP57D6A_DARK_FINANCE_POLISH' not in DARK_CSS.read_text(encoding='utf-8'):
    stop('57D6A dark-mode refinements not found')
if COMP.exists() or CSS.exists() or IMPORT in old or MOUNT in old:
    stop('57D6B assets or mount already present; avoid duplicate install')
if old.count(APP_RENDER)!=1:
    stop('React app root not standard; refuses to alter App.jsx')
if "import App from './App.jsx'" not in old or 'createRoot(' not in old or '<StrictMode>' not in old:
    stop('Vite root structure not recognized')
component=remote('JIMS57D6ThemeController.jsx')
style=remote('JIMS57D6Theme.css')

for marker in (
    'export default function JIMS57D6ThemeController',
    'createPortal(toggle, shell.topbar)',
    'MutationObserver(detect)',
    "PREFERENCE_KEY = 'jims-57d6-theme-v1'",
    "const [mode, setMode] = useState(readStoredTheme)",
    "window.localStorage.setItem(PREFERENCE_KEY, next)",
    "document.documentElement.classList.toggle(",
    'if (!shell.ready) return null',
    "mode === 'dark' ? 'light' : 'dark'",
):
    if marker not in component:stop('Theme controller missing: '+marker)
if component.count("document.documentElement.classList.toggle(")!=1:
    stop('Multiple global theme class mutations')
if style.count(MARKER)!=1 or style.count(':root.jims-57d6-light')<20:
    stop('Light CSS marker/scope missing')
if 'jims-57d6-theme-toggle--floating' not in style:
    stop('Missing safe no-topbar toggle fallback')
if 'JIMS_STEP57D55_UAT_PREVIEW' in style or 'UAT-DEMO-' in style:
    stop('Temporary Payment Calendar UAT must stay removed')
if any(t in component for t in ('supabase.', '.update(','.insert(','.delete(','.upload(')):
    stop('Theme controller must not perform financial/network operations')
if any(t in style for t in ('@import','url(javascript:', 'position:absolute!important')):
    stop('Unexpected CSS asset/override')
if '.sidebar' not in style or '.jims-cal-page' not in style or '.pv-home-card' not in style:
    stop('Essential light-mode panels absent')

# Only additive modifications, preserving every existing main.jsx statement.
new=IMPORT+'\n'+old.replace(APP_RENDER,APP_RENDER+'\n    '+MOUNT,1)
if new.replace(IMPORT+'\n','',1).replace(APP_RENDER+'\n    '+MOUNT,APP_RENDER,1)!=old:
    stop('Main.jsx modification is not additive')
if new.count(MOUNT)!=1 or new.count(IMPORT)!=1:
    stop('Theme mount/import duplicated')

# Validate JSX and CSS using the same installed Vite compiler before writing.
with tempfile.TemporaryDirectory(prefix='jims_57d6b_') as temp:
    folder=Path(temp)
    check_main=folder/'main.jsx'
    check_comp=folder/'JIMS57D6ThemeController.jsx'
    check_css=folder/'JIMS57D6Theme.css'
    check_main.write_text(new,encoding='utf-8')
    check_comp.write_text(component,encoding='utf-8')
    check_css.write_text(style,encoding='utf-8')
    node=(
        "const fs=require('node:fs');"
        "Promise.all([import('vite'),import('postcss')]).then(async([v,p])=>{"
        "for(const src of process.argv.slice(1,3))"
        "await v.transformWithOxc(fs.readFileSync(src,'utf8'),src);"
        "p.default.parse(fs.readFileSync(process.argv[3],'utf8'),{from:process.argv[3]});"
        "console.log('JIMS 57D6B JSX + CSS PARSER PASS');"
        "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    result=subprocess.run(['node','-e',node,str(check_main),str(check_comp),str(check_css)],
        cwd=APP,capture_output=True,text=True)
    if result.returncode:
        stop('Preflight failed: '+(result.stderr or result.stdout)[-1600:])
    print(result.stdout.strip())

print('JIMS 57D6B SAFE THEME ANCHORS PASS')
print('Dark default; opt-in cream/gold light; preference saved in browser.')
print('Theme control in topbar if available; no toggle on locked login.')
print('No changes to Finance business logic, authorization, payment or uploads.')
if DRY:
    print('JIMS 57D6B DRY RUN PASS — no project files changed.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D6B_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/MAIN.name).write_text(old,encoding='utf-8')
try:
    COMP.write_text(component,encoding='utf-8')
    CSS.write_text(style,encoding='utf-8')
    MAIN.write_text(new,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D6B BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    MAIN.write_text(old,encoding='utf-8')
    COMP.unlink(missing_ok=True)
    CSS.unlink(missing_ok=True)
    sys.exit('STOP: build failed; main.jsx restored, new theme files removed: '+str(exc))
