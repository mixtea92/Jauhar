#!/usr/bin/env python3
"""JIMS 57D6C5 — remove redundant button/card copy (Dashboard Home only).

Safe, exact-anchor text-only JSX adjustment. Removes visible explanatory
captions from action cards and dashboard shortcut rows, leaving titles,
icons, onClick, role guards, routes, admin restrictions, statuses and
all Finance modules EXACTLY unchanged.

Edits only app/src/JIMSDashboardHome.jsx, app/src/main.jsx;
creates app/src/JIMS57D6C5MinimalButtonCopy.css.
Dry-run: zero project writes. Local backup, parser, build, rollback.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess
import sys
import tempfile
import re

ROOT=Path('/workspaces/Jauhar')
APPDIR=ROOT/'app'
SRC=APPDIR/'src'
HOME=SRC/'JIMSDashboardHome.jsx'
MAIN=SRC/'main.jsx'
C4=SRC/'JIMS57D6C4MobileDashboardActions.css'
STYLE=SRC/'JIMS57D6C5MinimalButtonCopy.css'
BRANCH='jsync-gui-revamp-20261029'
REMOTE='gui-patches/57D/JIMS57D6C5MinimalButtonCopy.css'
IMPORT="import './JIMS57D6C5MinimalButtonCopy.css'"
ANCHOR="import './JIMS57D6C4MobileDashboardActions.css'"
MARKER='JIMS_STEP57D6C5_MINIMAL_BUTTON_COPY'
DRY='--dry-run' in sys.argv

def stop(msg):
    sys.exit('STOP: '+str(msg)+' — no application files changed.')

def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT,text=True)

if git('branch','--show-current').strip()!=BRANCH:
    stop('Expected branch '+BRANCH)
for f in (HOME,MAIN,C4):
    if not f.is_file():
        stop('Prerequisite missing: '+str(f))
if STYLE.exists():
    stop('57D6C5 CSS already exists; refusing to overwrite')

old_home=HOME.read_text(encoding='utf-8')
old_main=MAIN.read_text(encoding='utf-8')
if 'JIMS_STEP57D6C4_MOBILE_DASHBOARD_ACTIONS' not in C4.read_text(encoding='utf-8'):
    stop('57D6C4 prerequisite marker missing')
if old_main.count(ANCHOR)!=1 or IMPORT in old_main:
    stop('57D6C4 import missing/duplicated or 57D6C5 already installed')
for label in (
    'const ActionCard=', 'const LinkRow=', 'jims-dashboard',
    'jims-action-card', 'jims-link-row', 'jims-section-note',
    'isAdmin', 'onNavigate', 'canManageDelegation'
):
    if label not in old_home:
        stop('Dashboard structure changed: '+label)

# Exact removable PRESENTATION fragments. Never edit function props,
# actions array, notification data, route targets or callbacks.
removals=[
    ('    <span className="jims-action-desc">{subtitle}</span>\n',
     'Action-card explanatory sentence'),
    ('    <span className="jims-action-tag">{tag}</span>\n',
     'OPEN/VIEW WORKSPACE repeating button label'),
    ('<strong>{title}</strong><small>{desc}</small>',
     'Extra line beneath navigation shortcut'),
    ('<p>Everything you need, without the clutter.</p>',
     'Marketing copy below Overview'),
    ('<p>Shortcuts to live queues within each module</p>',
     'Repeated description below Action Required'),
    ('<span className="jims-section-note">QUEUES OPEN IN THEIR OWN MODULES</span>',
     'Redundant queue instruction'),
]
new_home=old_home
for source,label in removals:
    if new_home.count(source)!=1:
        stop(label+' must match exactly once (found '+str(new_home.count(source))+')')
    if source.startswith('<strong>'):
        new_home=new_home.replace(source,'<strong>{title}</strong>',1)
    else:
        new_home=new_home.replace(source,'',1)

# Reconstruct old source from exclusively the permitted text removals.
reconstructed=new_home
for source,label in reversed(removals):
    if source.startswith('<strong>'):
        small='<strong>{title}</strong>'
        if reconstructed.count(small)!=1:
            stop('Shortcut title uniqueness guard failed')
        reconstructed=reconstructed.replace(small,source,1)
    elif source.startswith('    <span className="jims-action-tag"'):
        anchor='    </button>' # intentionally NOT a matching anchor; handled below
        # Card's closing button is unique inside the ActionCard definition.
        close='  </button>\n)\nconst LinkRow='
        if reconstructed.count(close)!=1:
            stop('ActionCard reconstruction anchor missing')
        reconstructed=reconstructed.replace(close,source+close,1)
    elif source.startswith('    <span className="jims-action-desc"'):
        tag='    <span className="jims-action-tag">{tag}</span>\n'
        if reconstructed.count(tag)!=1:
            stop('Action tag reconstruction anchor missing')
        reconstructed=reconstructed.replace(tag,source+tag,1)
    elif source.startswith('<span className="jims-section-note"'):
        anchor='    </div>\n    <div className="jims-actions-grid">'
        if reconstructed.count(anchor)!=1:
            stop('Section note reconstruction anchor missing')
        reconstructed=reconstructed.replace(anchor,'      '+source+'\n'+anchor,1)
    elif source.startswith('<p>Shortcuts'):
        anchor='<h3>Action Required</h3>'
        if reconstructed.count(anchor)!=1:
            stop('Action Required heading reconstruction anchor missing')
        reconstructed=reconstructed.replace(anchor,anchor+source,1)
    elif source.startswith('<p>Everything'):
        anchor='<h2>Overview</h2>'
        if reconstructed.count(anchor)!=1:
            stop('Overview heading reconstruction anchor missing')
        reconstructed=reconstructed.replace(anchor,anchor+source,1)

# Prove there were no modifications other than the exact six visible fragments.
if reconstructed != old_home:
    stop('Text-only round-trip guard failed; protected dashboard content differs')

# We verify unchanged invariants directly; one final exact whitelist diff
# makes this safe even when local 51UI cards/labels were customized.
for token in (
    'onClick={onClick}', 'onClick={()=>onNavigate(a.page)}',
    "onClick={()=>onNavigate('payment_process')}",
    "onClick={()=>onNavigate('payment_voucher')}",
    "onClick={()=>onNavigate('cash_voucher')}",
    "onClick={()=>onNavigate('delegation_workspace')}",
    "profile.role==='system_admin'", 'canManageDelegation',
    'className="jims-action-title"',
    'className="jims-home-panel"'
):
    if new_home.count(token)!=old_home.count(token):
        stop('Protected route, access or title altered: '+token)
if [line for line in new_home.splitlines() if 'page:' in line] != [
    line for line in old_home.splitlines() if 'page:' in line
]:
    stop('Navigation targets changed unexpectedly')
if [line for line in new_home.splitlines() if 'onNavigate(' in line] != [
    line for line in old_home.splitlines() if 'onNavigate(' in line
]:
    stop('Navigation click handlers changed unexpectedly')
if [line for line in new_home.splitlines() if 'supabase' in line.lower()] != [
    line for line in old_home.splitlines() if 'supabase' in line.lower()
]:
    stop('Supabase references changed unexpectedly')
if new_home==old_home:
    stop('No visible copy removed')
if new_home.count('<button')!=old_home.count('<button'):
    stop('Button count changed')

# Render-only trim may not affect the original LinkRow callers.
# The original function arguments stay intact for compatibility.

new_main=old_main.replace(ANCHOR,ANCHOR+'\n'+IMPORT,1)
if new_main.replace(ANCHOR+'\n'+IMPORT,ANCHOR,1)!=old_main:
    stop('main.jsx edit not additive')
try:
    styles=git('show','origin/'+BRANCH+':'+REMOTE)
except subprocess.CalledProcessError:
    stop('Remote 57D6C5 CSS unavailable; run git fetch origin '+BRANCH)
if styles.count(MARKER)!=1 or '.jims-shell .jims-dashboard' not in styles:
    stop('Expected scoped CSS missing/duplicated')
if any(s in styles for s in (
    '@import','supabase','.sidebar','.topbar','.pv-','.cv-','.login-page',
    'pointer-events:none','visibility:hidden','display:none'
)):
    stop('CSS alters protected elements')

with tempfile.TemporaryDirectory(prefix='jims_57d6c5_preflight_') as d:
    folder=Path(d)
    h=folder/'JIMSDashboardHome.jsx'
    m=folder/'main.jsx'
    s=folder/'JIMS57D6C5MinimalButtonCopy.css'
    h.write_text(new_home,encoding='utf-8')
    m.write_text(new_main,encoding='utf-8')
    s.write_text(styles,encoding='utf-8')
    js=(
        "const fs=require('node:fs');"
        "Promise.all([import('vite'),import('postcss')]).then(async([v,p])=>{"
        "for(const f of process.argv.slice(1,3))"
        "await v.transformWithOxc(fs.readFileSync(f,'utf8'),f);"
        "const css=p.default.parse(fs.readFileSync(process.argv[3],'utf8'));"
        "let rules=0;"
        "css.walkRules(rule=>{rules++;"
        "if(rule.selector.split(',').some(s=>!s.trim().startsWith("
        "'.jims-shell .jims-dashboard ')))"
        "throw Error('Unscoped CSS rule: '+rule.selector);"
        "});"
        "if(rules<5)throw Error('Incomplete CSS');"
        "console.log('JIMS 57D6C5 JSX + CSS PARSER PASS');"
        "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
    )
    result=subprocess.run(['node','-e',js,str(h),str(m),str(s)],
        cwd=APPDIR,capture_output=True,text=True)
    if result.returncode:
        stop('Parser preflight failed: '+(result.stderr or result.stdout)[-2000:])
    print(result.stdout.strip())

print('JIMS 57D6C5 GUI TEXT-ONLY SAFETY CHECK PASS')
print('Removed dashboard action descriptions/tags and redundant section copy.')
print('Button titles, card links, permissions, data/status, navigation unchanged.')
if DRY:
    print('JIMS 57D6C5 DRY RUN PASS — no application files changed.')
    sys.exit(0)

backup=APPDIR/'gui-backups'/('57D6C5_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/HOME.name).write_text(old_home,encoding='utf-8')
(backup/MAIN.name).write_text(old_main,encoding='utf-8')
try:
    HOME.write_text(new_home,encoding='utf-8')
    MAIN.write_text(new_main,encoding='utf-8')
    STYLE.write_text(styles,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=APPDIR,check=True)
    print('JIMS 57D6C5 BUILD PASS')
    print('Backup:',backup)
except Exception as error:
    HOME.write_text(old_home,encoding='utf-8')
    MAIN.write_text(old_main,encoding='utf-8')
    STYLE.unlink(missing_ok=True)
    sys.exit('STOP: Build failed; original files restored: '+str(error))
