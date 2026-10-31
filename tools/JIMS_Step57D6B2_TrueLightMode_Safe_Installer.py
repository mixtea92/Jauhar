#!/usr/bin/env python3
"""JIMS Step 57D6B2 — TRUE LIGHT MODE safe CSS-only patch.
Fixes source 50C/50D/50E dark !important cascade exposed by Light Mode UAT.
Requires 57D6A + 57D6B installed. Appends scoped CSS to current theme file,
retaining EVERY existing local CSS rule and user's customizations.
Never touches App.jsx, main.jsx, JS, auth, PV/PC logic, Calendar data or Supabase.
--dry-run preflights without modifying files. Full backup + rollback on failed build.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
THEME=APP/'src/JIMS57D6Theme.css'
CTRL=APP/'src/JIMS57D6ThemeController.jsx'
MAIN=APP/'src/main.jsx'
DARK=APP/'src/JIMS57D6ADarkFinancePolish.css'
BRANCH='jsync-gui-revamp-20261029'
PATCH='gui-patches/57D/JIMS57D6B2TrueLightMode.css'
MARKER='JIMS_STEP57D6B2_TRUE_LIGHT_MODE'
DRY='--dry-run' in sys.argv

def stop(msg):
    sys.exit('STOP: '+str(msg)+' — no project files modified.')
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Wrong branch; expected '+BRANCH)
for path in (THEME,CTRL,MAIN,DARK):
    if not path.is_file():stop('57D6A/B prerequisite missing: '+str(path))
old=THEME.read_text(encoding='utf-8')
controller=CTRL.read_text(encoding='utf-8')
main=MAIN.read_text(encoding='utf-8')
dark=DARK.read_text(encoding='utf-8')
if MARKER in old:
    print('JIMS 57D6B2 ALREADY INSTALLED — no changes required.')
    sys.exit(0)
if old.count('JIMS_STEP57D6B_LIGHT_DARK')!=1:
    stop('Existing light theme marker absent/duplicated')
if 'document.documentElement.classList.toggle(' not in controller or 'jims-57d6-light' not in controller:
    stop('Theme controller not recognized')
if "JIMS57D6ThemeController" not in main or '<JIMS57D6ThemeController />' not in main:
    stop('Step 57D6B theme toggle not mounted')
if 'JIMS_STEP57D6A_DARK_FINANCE_POLISH' not in dark:
    stop('57D6A approved dark-mode CSS missing')
patch=git('show','origin/'+BRANCH+':'+PATCH)
if patch.count(MARKER)!=1:
    stop('Expected True Light Mode patch marker missing/duplicate')
if patch.count('html.jims-57d6-light')<90:
    stop('Source-specific hardcoded dark overrides missing')
for required in (
    'html.jims-57d6-light:has(.jims-shell)',
    'html.jims-57d6-light #root:has(.jims-shell)',
    'html.jims-57d6-light .jims-shell>.content',
    'html.jims-57d6-light .jims-shell .sidebar',
    'html.jims-57d6-light .jims-dashboard .jims-action-card',
    'html.jims-57d6-light .jims-dashboard .jims-home-panel',
    'html.jims-57d6-light .jims-shell>.content.jims-finance-theme',
    'html.jims-57d6-light .jims-shell>.content .table-wrap',
    'html.jims-57d6-light .jims-shell>.content canvas',
    '--jf-bg:#f6f4ef',
):
    if required not in patch:stop('Required 50C/50D/50E light override missing: '+required)
# All non-comment CSS rules must be gated on html.jims-57d6-light.
# A CSS parser inspects their actual selector AST; this is not naive text matching.
with tempfile.TemporaryDirectory(prefix='jims_57d6b2_preflight_') as tmp:
    check=Path(tmp)/'combined.css'
    check.write_text(old.rstrip()+'\n\n'+patch,encoding='utf-8')
    source=Path(tmp)/'patch.css'
    source.write_text(patch,encoding='utf-8')
    validator=(
        "const fs=require('node:fs');"
        "import('postcss').then(({default:p})=>{"
        "const src=p.parse(fs.readFileSync(process.argv[1],'utf8'));"
        "const all=p.parse(fs.readFileSync(process.argv[2],'utf8'));"
        "let rules=0;"
        "src.walkRules(rule=>{"
        "rules++;"
        "let depth=0,part='',groups=[];"
        "for(const ch of rule.selector){"
        "if(ch==='(')depth++;"
        "if(ch===')')depth--;"
        "if(ch===','&&depth===0){groups.push(part);part='';}"
        "else{part+=ch;}"
        "}"
        "groups.push(part);"
        "if(!groups.every(x=>x.trim().startsWith('html.jims-57d6-light')))"
        "throw Error('UNSCOPED selector: '+rule.selector);"
        "});"
        "if(rules<60)throw Error('Not enough light-mode overrides');"
        "console.log('JIMS 57D6B2 SCOPED CSS PARSER PASS: '+rules+' rules');"
        "console.log('JIMS 57D6B2 COMBINED THEME CSS PARSER PASS');"
        "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    tested=subprocess.run(['node','-e',validator,str(source),str(check)],
        cwd=APP,capture_output=True,text=True)
    if tested.returncode:
        stop('Light-mode CSS preflight failed: '+(tested.stderr or tested.stdout)[-1600:])
    print(tested.stdout.strip())
new=old.rstrip()+'\n\n'+patch
if not new.startswith(old.rstrip()+'\n\n'):
    stop('Existing theme not preserved byte-for-byte')
if new.count(MARKER)!=1:
    stop('Duplicate light mode marker')
print('JIMS 57D6B2 GUARDED TRUE LIGHT MODE PASS')
print('Only app/src/JIMS57D6Theme.css will change.')
print('Existing dark mode and all Finance business logic untouched.')
if DRY:
    print('JIMS 57D6B2 DRY RUN PASS — no files changed.')
    sys.exit(0)

backup=APP/'gui-backups'/('57D6B2_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/THEME.name).write_text(old,encoding='utf-8')
try:
    THEME.write_text(new,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APP,check=True)
    print('JIMS 57D6B2 BUILD PASS')
    print('Backup:',backup)
except Exception as exc:
    THEME.write_text(old,encoding='utf-8')
    sys.exit('STOP: Build failed; original 57D6B theme restored: '+str(exc))
