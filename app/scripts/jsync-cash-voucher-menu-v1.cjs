#!/usr/bin/env node
// JSYNC 48A: add Cash Voucher nav + inactive module landing page only.
// Does NOT modify PV, Delegation, approvals, permissions, RPCs, or database.
const fs=require('node:fs')
const path=require('node:path')
const cp=require('node:child_process')
const root=process.cwd()
const file=path.join(root,'src/App.jsx')
if(!fs.existsSync(path.join(root,'package.json'))||!fs.existsSync(file)){
  throw Error('Run this installer from /workspaces/Jauhar/app')
}
const original=fs.readFileSync(file,'utf8')
const marker='JSYNC_STEP_48A_CASH_VOUCHER_MENU'
if(original.includes(marker)){
  console.log('JSYNC 48A already installed. No files changed.')
  process.exit(0)
}
if(original.includes("activePage === 'cash_voucher'")||original.includes("setActivePage('cash_voucher')")){
  throw Error('Existing Cash Voucher navigation detected. No files changed.')
}
let code=original
function one(needle,replacement,label){
  const count=code.split(needle).length-1
  if(count!==1)throw Error(label+': expected 1 exact anchor, found '+count+'. No files changed.')
  code=code.replace(needle,replacement)
}
const newline=original.includes('\r\n')?'\r\n':'\n'
const buttonEnd=['                Payment Voucher','              </button>'].join(newline)
const newButton=[
  '              {/* '+marker+' */}',
  '              <button',
  '                type="button"',
  "                className={`nav-item nav-subitem ${activePage === 'cash_voucher' ? 'nav-active' : ''}`}",
  '                onClick={() => {',
  "                  setActivePage('cash_voucher')",
  '                  setEditingUser(null)',
  '                  setResetUser(null)',
  '                }}',
  '              >',
  '                Cash Voucher',
  '              </button>'
].join(newline)
one(buttonEnd,buttonEnd+newline+newButton,'Cash Voucher sidebar location')
// Keep Finance Approval parent highlighted when Cash Voucher is selected.
const financePages="['payment_voucher', 'delegation_workspace', 'delegation_review', 'manage_delegation']"
one(financePages,"['payment_voucher', 'cash_voucher', 'delegation_workspace', 'delegation_review', 'manage_delegation']", 'Finance group active pages')
const topbar=": activePage === 'payment_voucher' ? 'Payment Voucher'"
one(topbar,topbar+newline+"                  : activePage === 'cash_voucher' ? 'Cash Voucher'",'Cash Voucher page title')
const route="          ) : activePage === 'manage_delegation' ? ("
const placeholder=[
  "          ) : activePage === 'cash_voucher' ? (",
  '            <section className="panel">',
  '              <h2>Cash Voucher</h2>',
  '              <p>Cash Voucher module has been added under Financial Approval.</p>',
  '              <p>Voucher forms, numbering, payment flow and approvals have not yet been configured. No transactions can be created from this page.</p>',
  '              <p>Existing Payment Voucher and Delegation workflows remain unchanged.</p>',
  '            </section>',
  route
].join(newline)
one(route,placeholder,'Cash Voucher content route')
if(process.argv.includes('--dry-run')){
  console.log('JSYNC 48A DRY-RUN PASSED. No files changed.')
  console.log('Cash Voucher menu and inactive landing page patch anchors verified.')
  console.log('Existing Payment Voucher/Delegation logic unchanged.')
  process.exit(0)
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-')
const backup=file+'.backup_before_cash_voucher_menu_'+stamp
fs.writeFileSync(backup,original)
try{
  fs.writeFileSync(file,code)
  const b=cp.spawnSync('npm',['run','build'],{cwd:root,stdio:'pipe',encoding:'utf8'})
  console.log((b.stdout||'').slice(-3600))
  if(b.error||b.status!==0)throw Error((b.stderr||'').slice(-3800)||b.error?.message||'Build failed')
  console.log('JSYNC 48A CASH VOUCHER MENU AND BUILD PASSED')
  console.log('Only src/App.jsx modified. No backend or PV workflow changes.')
  console.log('Backup: '+backup)
}catch(err){
  fs.writeFileSync(file,original)
  console.error('PATCH FAILED; App.jsx rolled back: '+err.message)
  process.exitCode=1
}
