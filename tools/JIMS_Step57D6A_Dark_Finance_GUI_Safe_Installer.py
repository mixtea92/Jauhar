#!/usr/bin/env python3
"""JIMS Step 57D6A — SAFE additive dark-mode PV home/list refinement.

Changes ONLY:
  app/src/main.jsx: adds one CSS import without rewriting local custom code.
  app/src/JIMS57D6ADarkFinancePolish.css: independent dark-only stylesheet.
Leaves App.jsx, PaymentVoucher.jsx, Petty Cash, Payment Process, Calendar,
Supabase, authentication, roles and all approval/payment rules untouched.
--dry-run is read-only. Installer backups local main.jsx and restores on error.
"""
from pathlib import Path
from datetime import datetime,timezone
import subprocess,sys,tempfile

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app'
ENTRY=APP/'src/main.jsx'
TARGET=APP/'src/JIMS57D6ADarkFinancePolish.css'
BRANCH='jsync-gui-revamp-20261029'
PATCH_PATH='gui-patches/57D/JIMS57D6ADarkFinancePolish.css'
MARKER='JIMS_STEP57D6A_DARK_FINANCE_POLISH'
IMPORT="import './JIMS57D6ADarkFinancePolish.css'"
ANCHOR="import './index.css'"
DRY='--dry-run' in sys.argv

def stop(reason):
  sys.exit('STOP: '+str(reason)+' — JIMS files unchanged.')
def git(*args):
  return subprocess.check_output(['git',*args],cwd=ROOT,text=True)

if git('branch','--show-current').strip()!=BRANCH:
  stop('Wrong branch; expected '+BRANCH)
if not ENTRY.is_file():
  stop('Vite entrypoint missing')
if TARGET.exists():
  stop('57D6A stylesheet already exists; do not overwrite local customization')

old=ENTRY.read_text(encoding='utf-8')
if IMPORT in old:
  stop('57D6A import already present; avoid duplicate install')
if old.count(ANCHOR)!=1:
  stop('Expected unique index.css import; local main.jsx needs review')
if "import App from './App.jsx'" not in old or "<App />" not in old:
  stop('Unexpected React root structure; do not install blind')
new=old.replace(ANCHOR,ANCHOR+'\n'+IMPORT,1)
css=git('show','origin/'+BRANCH+':'+PATCH_PATH)
if css.count(MARKER)!=1:
  stop('Official stylesheet version marker is absent/duplicated')
if css.count(':root:not(.jims-57d6-light) #root')<10:
  stop('Dark-only CSS scope missing')
if any(word in css for word in ('!important','display:none','display: none','@import','url(')):
  stop('Unexpected high-risk CSS rule')
for forbidden in ('.sidebar {','.sidebar{','.topbar {','.topbar{','.jims-cal-','.jims-pc-'):
  if forbidden in css:
    stop('CSS touches locked layout or other finance modules: '+forbidden)

# Validate CSS using Vite's installed PostCSS and JSX via Vite parser.
with tempfile.TemporaryDirectory(prefix='jims_57d6a_preflight_') as td:
  css_temp=Path(td)/TARGET.name
  jsx_temp=Path(td)/ENTRY.name
  css_temp.write_text(css,encoding='utf-8')
  jsx_temp.write_text(new,encoding='utf-8')
  js=(
    "const fs=require('node:fs');"
    "Promise.all([import('postcss'),import('vite')]).then(async([p,v])=>{"
    "p.default.parse(fs.readFileSync(process.argv[1],'utf8'),{from:process.argv[1]});"
    "await v.transformWithOxc(fs.readFileSync(process.argv[2],'utf8'),process.argv[2]);"
    "console.log('JIMS 57D6A CSS + JSX PARSER PASS');"
    "}).catch(e=>{console.error(e.stack||e);process.exit(1)});"
  )
  result=subprocess.run(['node','-e',js,str(css_temp),str(jsx_temp)],
      cwd=APP,capture_output=True,text=True)
  if result.returncode!=0:
    stop('Preflight parser failed: '+(result.stderr or result.stdout)[-1800:])
  print(result.stdout.strip())

if new.replace(ANCHOR+'\n'+IMPORT,ANCHOR,1)!=old:
  stop('Import safety check failed; original main.jsx not preserved')
if new.count(IMPORT)!=1:
  stop('Import inserted multiple times')
print('JIMS 57D6A DARK GUI SAFE ANCHORS PASS')
print('Scope: Payment Voucher HOME/LIST styling only; locked dashboard unchanged.')
print('No database, approval, payment, mobile upload or app navigation edits.')
if DRY:
  print('JIMS 57D6A DRY RUN PASS — no files changed.')
  sys.exit(0)

backup=APP/'gui-backups'/('57D6A_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/ENTRY.name).write_text(old,encoding='utf-8')
try:
  TARGET.write_text(css,encoding='utf-8')
  ENTRY.write_text(new,encoding='utf-8')
  subprocess.run(['npm','run','build'],cwd=APP,check=True)
  print('JIMS 57D6A BUILD PASS')
  print('Backup:',backup)
except Exception as e:
  ENTRY.write_text(old,encoding='utf-8')
  TARGET.unlink(missing_ok=True)
  sys.exit('STOP: Build failed; original main.jsx restored; CSS removed: '+str(e))
