#!/usr/bin/env python3
"""JIMS Step57C8C: Move Report Generation to the bottom of Financial Approval
sidebar, immediately after Delegation / Manage Delegation.
Does not change permissions, page routes, RPCs, modules, or data.
"""
from pathlib import Path
from datetime import datetime, timezone
import subprocess, sys

ROOT=Path('/workspaces/Jauhar')
APP=ROOT/'app/src/App.jsx'
BRANCH='jsync-gui-revamp-20261029'
DRY='--dry-run' in sys.argv

def stop(msg):
    sys.exit('STOP: '+msg)

if subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip()!=BRANCH:
    stop('Wrong branch. Expected '+BRANCH)
if not APP.exists():
    stop('App.jsx missing')

old=APP.read_text(encoding='utf-8')
if 'JIMS_STEP57C8B_REPORT_GENERATION' not in old:
    stop('Report Generation Step57C8B not installed')
if 'JIMS_STEP57C8C_REPORT_MENU_LAST' in old:
    stop('Report Generation already moved; no duplicate')

menu="""              {(jimsAPExcelAccess(profile) || jimsOwnerExportAllowed) && (
                <button type="button"
                  className={'nav-item nav-subitem '+(activePage === 'history_exports' ? 'nav-active' : '')}
                  onClick={() => {
                    setActivePage('history_exports')
                    setEditingUser(null)
                    setResetUser(null)
                  }}>
                  Report Generation
                </button>
              )}
"""
anchor='              {/* Step 46G: one financial-only Delegation section, reusable when Budgeting launches. */}'
tail='              </div>}\n            </div>\n          )}'

if old.count(menu)!=1:
    stop('Expected one Report Generation menu block, found '+str(old.count(menu)))
if old.count(anchor)!=1:
    stop('Delegation anchor missing or ambiguous')
if old.count(tail)!=1:
    stop('Delegation submenu closing anchor missing or ambiguous')
if old.index(menu)>old.index(anchor):
    stop('Menu already located after Delegation, no change needed')

# The menu block is currently directly ABOVE Delegation. Remove only that block.
new=old.replace(menu,'',1)
tail_new="""              </div>}
              {/* JIMS_STEP57C8C_REPORT_MENU_LAST: final Financial Approval item */}
"""+menu+"""            </div>
          )}"""
new=new.replace(tail,tail_new,1)

# Verify exact order and preserve all authorization and route references.
for term in (
    'JIMS_STEP_57C5S_MY_APPROVALS',
    'JIMS_STEP_57C5SN_APPROVAL_BADGE',
    'JIMS_STEP57C7B_AP_AR_EXPORTS',
    'JIMS_STEP57C8B_REPORT_GENERATION',
    'jimsAPExcelAccess(profile)',
    'jimsOwnerExportAllowed',
    'JIMSHistoryExports profile={profile}',
    'setActivePage(\\'history_exports\\')',
    '<PaymentVoucher', '<CashVoucher',
):
    if old.count(term)!=new.count(term):
        stop('Protected authorization/module marker changed: '+term)
if old.count('Report Generation')!=new.count('Report Generation'):
    stop('Report Generation label count changed')
if new.count('JIMS_STEP57C8C_REPORT_MENU_LAST')!=1:
    stop('Patch marker missing/duplicated')
if not (new.index('Manage Delegation') < new.index('JIMS_STEP57C8C_REPORT_MENU_LAST') < new.index('Report Generation',new.index('JIMS_STEP57C8C_REPORT_MENU_LAST'))):
    stop('Report Generation is not after Manage Delegation')
if not (new.index('JIMS_STEP57C8C_REPORT_MENU_LAST') < new.index('{/* FUTURE FINANCE DASHBOARD')):
    stop('Report Generation is not final item inside Financial Approval')

def rpclines(source):
    return sorted(line.strip() for line in source.splitlines() if 'supabase.rpc(' in line)
if rpclines(old)!=rpclines(new):
    stop('Unexpected RPC changes')

print('JIMS STEP57C8C SIDEBAR ORDER — '+('DRY RUN' if DRY else 'INSTALL'))
print('Financial Approval > Payment Voucher / Petty Cash > Delegation > Report Generation (last).')
print('Export permissions and approval/payment logic unchanged.')
if DRY:
    print('DRY RUN PASS — no project files modified.')
    sys.exit(0)

backup=ROOT/'app/gui-backups'/('57C8C_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
(backup/'App.jsx').write_text(old,encoding='utf-8')
try:
    APP.write_text(new,encoding='utf-8')
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS STEP57C8C SIDEBAR ORDER — BUILD PASS')
    print('Backup:',backup)
except Exception as e:
    APP.write_text(old,encoding='utf-8')
    stop('Build error; original App.jsx restored: '+str(e))
