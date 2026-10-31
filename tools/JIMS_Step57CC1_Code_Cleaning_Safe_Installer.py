#!/usr/bin/env python3
"""JIMS 57CC1: conservative cleaning of the INSTALLED application.

Only exact reviewed dead-code/import edits. No DB calls, dependency upgrades,
UI copy, CSS, routes, permissions, state/effect changes, or business rule changes.
Builds isolated before/after copies and requires identical production artifacts.
Dry-run validates the same candidate as install. Backups include full src snapshot.
"""
OPERATIONS = [{'file': 'cashVoucherPrint.js', 'old': '// JSYNC Cash Voucher Signed Excel Export (2026-10-28)\n// Uses the *unmodified original XLSX binary* as the one-page print master.\n// Prints original sheet + HOD signature, signer username and signed date.\n// Never mutates the official file stored in /public/templates.\nimport { CV_TEMPLATE_URL } from \'./cashVoucherExcel\'\nimport { downloadSignedCVExcel as downloadSignedCVExcelOOXML } from \'./cashVoucherPrintOOXML\'\n// JSYNC_CV_LOSSLESS_OOXML_EXPORT_48M\n\nfunction dateMY(iso) {\n  if (!iso) return \'\'\n  const d = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(iso))\n    ? new Date(String(iso)+\'T12:00:00+08:00\') : new Date(iso)\n  if (Number.isNaN(d.getTime())) return String(iso)\n  return new Intl.DateTimeFormat(\'en-GB\',{\n    timeZone:\'Asia/Kuala_Lumpur\',day:\'2-digit\',month:\'2-digit\',year:\'numeric\'\n  }).format(d)\n}\nfunction text(v) { return String(v??\'\').trim() }\nfunction set(sheet,addr,val) {\n  if (val!==undefined && val!==null && val!==\'\') sheet.getCell(addr).value=val\n}\nfunction putReceiptRows(sheet,lines=[]) {\n  lines.slice(0,10).forEach((l,i)=>{\n    const row=i+21\n    set(sheet,\'C\'+row,dateMY(l.receipt_date))\n    set(sheet,\'D\'+row,text(l.receipt_no))\n    set(sheet,\'E\'+row,text(l.description))\n    set(sheet,\'F\'+row,text(l.expense_category))\n    set(sheet,\'G\'+row,text(l.expenses_branch))\n    if (text(l.amount)!==\'\') {\n      const amount=Number(l.amount)\n      if (!Number.isFinite(amount) || amount<0) throw Error(\'Invalid stored CV amount\')\n      sheet.getCell(\'H\'+row).value=amount\n    }\n    set(sheet,\'I\'+row,text(l.receipt_attached))\n  })\n}\n// This embeds a rasterized name/date and actual drawn signature in the\n// Excel signature box so PDF export does not depend on a cursive font installed\n// on the computer which opens the XLSX.\nasync function imageFromDataURL(url) {\n  return new Promise((resolve,reject)=>{\n    const im=new Image()\n    im.onload=()=>resolve(im)\n    im.onerror=()=>reject(Error(\'Stored HOD signature image could not be decoded\'))\n    im.src=url\n  })\n}\nasync function makeSignatureStamp(approval,stage) {\n  if (!approval?.signature_png || !approval?.approved_username || !approval?.approved_at)\n    return null\n  const username=text(approval.approved_username)\n  if (!username) return null\n  const canvas=document.createElement(\'canvas\')\n  canvas.width=720; canvas.height=400\n  const ctx=canvas.getContext(\'2d\')\n  ctx.fillStyle=\'#ffffff\';ctx.fillRect(0,0,canvas.width,canvas.height)\n  ctx.fillStyle=\'#344054\'\n  ctx.font=\'500 22px Arial, sans-serif\'\n  ctx.fillText(stage===\'applicable_hod\'?\'HOD VERIFIED & SIGNED\':\'FINANCE MANAGER VERIFIED\',20,33)\n  const signature=await imageFromDataURL(approval.signature_png)\n  // Scale drawing within the top half of the existing 5-row signature panel.\n  const maxWidth=590, maxHeight=143\n  const ratio=Math.min(maxWidth/signature.width,maxHeight/signature.height)\n  const iw=signature.width*ratio,ih=signature.height*ratio\n  ctx.drawImage(signature,20,45,iw,ih)\n  // Prefer Monotype Corsiva when available; raster ensures stable PDF output.\n  const fonts=[\'"Monotype Corsiva"\',\'"Apple Chancery"\',\'"Brush Script MT"\',\'cursive\'].join(\', \')\n  let size=58\n  while(size>26){\n    ctx.font=\'italic \'+size+\'px \'+fonts\n    if(ctx.measureText(username).width<665)break\n    size-=2\n  }\n  ctx.fillStyle=\'#132c47\'\n  ctx.fillText(username,20,273)\n  ctx.strokeStyle=\'#d0d5dd\';ctx.lineWidth=1\n  ctx.beginPath();ctx.moveTo(18,290);ctx.lineTo(684,290);ctx.stroke()\n  ctx.fillStyle=\'#344054\'\n  ctx.font=\'400 28px Arial, sans-serif\'\n  ctx.fillText(\'Date: \'+dateMY(approval.approved_at),20,342)\n  return canvas.toDataURL(\'image/png\')\n}\n\nexport async function downloadSignedCVExcel(voucher,approvalRecords,capturedImages) {\n  // Keep ExcelJS import used elsewhere; bypass its parser for exporting original master.\n  return downloadSignedCVExcelOOXML(voucher,approvalRecords,capturedImages)\n  if (!voucher?.id) throw Error(\'Open a saved Cash Voucher first.\')\n  const response=await fetch(CV_TEMPLATE_URL,{cache:\'no-cache\'})\n  if (!response.ok || (response.headers.get(\'content-type\')||\'\').includes(\'text/html\'))\n    throw Error(\'Original Cash Voucher template was not found in /public/templates.\')\n  const bytes=await response.arrayBuffer()\n  if(bytes.byteLength<10000)throw Error(\'Original Cash Voucher template is missing or corrupted.\')\n  const ExcelJS=(await import(\'exceljs\')).default\n  const book=new ExcelJS.Workbook()\n  await book.xlsx.load(bytes)\n  const form=voucher.form_data||{}\n  const sheetName=form.source_sheet===\'PC (Manual)\'?\'PC (Manual)\':\'PC (Digital)\'\n  const sheet=book.getWorksheet(sheetName)\n  if(!sheet || text(sheet.getCell(\'B5\').value)!==\'TITLE: PETTY CASH CLAIM FORM\')\n    throw Error(\'Unexpected original XLSX template version; cannot safely print.\')\n  // Populate only the original mapped form cells, no merge or print-area edits.\n  set(sheet,\'H10\',dateMY(form.date_of_request))\n  set(sheet,\'D13\',text(form.claimant_name))\n  set(sheet,\'D14\',text(form.staff_id))\n  set(sheet,\'D15\',text(form.position))\n  set(sheet,\'D16\',text(form.department))\n  set(sheet,\'D17\',text(form.branch))\n  set(sheet,\'G13\',text(form.claim_category))\n  set(sheet,\'G14\',text(form.remarks))\n  set(sheet,\'C18\',text(form.legacy_category))\n  putReceiptRows(sheet,form.lines||[])\n\n  const signed=Array.isArray(approvalRecords)?approvalRecords.filter(a=>a.voucher_id===voucher.id):[]\n  for (const stage of [\'applicable_hod\',\'finance_hod\']) {\n    const approval=signed.find(a=>a.authority===stage)\n    if (!approval)continue\n    const png=await makeSignatureStamp(approval,stage)\n    if (!png)throw Error(\'Missing signer username/date or drawing for \'+stage)\n    // Endorsed HOD: E39:E43. Finance Manager: H39:I43.\n    const isHOD=stage===\'applicable_hod\'\n    const anchor=isHOD?\'E39\':\'H39\'\n    const left=isHOD?4.04:7.04\n    const width=isHOD?182:186\n    // Cover original blank placeholder within the existing merged signature box.\n    // No layout dimensions, page setup or original print area are modified.\n    const c=sheet.getCell(anchor)\n    c.value=\'\'\n    const imageId=book.addImage({base64:png,extension:\'png\'})\n    sheet.addImage(imageId,{\n      tl:{col:left,row:38.08},\n      ext:{width,height:112},\n      editAs:\'oneCell\'\n    })\n  }\n\n  // Explicitly preserve original one-page A4 portrait print setup.\n  // The original Excel workbook has its own print area and paper-scale settings.\n  const blob=new Blob([await book.xlsx.writeBuffer()],{\n    type:\'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\'\n  })\n  const link=document.createElement(\'a\')\n  const href=URL.createObjectURL(blob)\n  link.href=href\n  link.download=(text(voucher.cv_number)||\'CV\')+\'_Signed.xlsx\'\n  document.body.appendChild(link)\n  link.click()\n  link.remove()\n  setTimeout(()=>URL.revokeObjectURL(href),60000)\n  return {filename:link.download,hasBothSignatures:signed.some(x=>x.authority===\'applicable_hod\')&&signed.some(x=>x.authority===\'finance_hod\')}\n}\n', 'new': "// Signed Petty Cash export uses the existing lossless OOXML implementation.\n// Preserve module evaluation and the public async wrapper used by callers.\nimport './cashVoucherExcel'\nimport { downloadSignedCVExcel as downloadSignedCVExcelOOXML } from './cashVoucherPrintOOXML'\n// JSYNC_CV_LOSSLESS_OOXML_EXPORT_48M\n\nexport async function downloadSignedCVExcel(voucher,approvalRecords,capturedImages) {\n  return downloadSignedCVExcelOOXML(voucher,approvalRecords,capturedImages)\n}\n", 'label': 'Remove superseded unreachable ExcelJS export; retain OOXML wrapper', 'unused': []}, {'file': 'cashVoucherPrintOOXML.js', 'old': 'async function imageFromDataURL(url){\n  return new Promise((resolve,reject)=>{\n    const im=new Image()\n    im.onload=()=>resolve(im)\n    im.onerror=()=>reject(Error(\'Stored HOD signature image cannot be decoded\'))\n    im.src=url\n  })\n}\nasync function signerStamp(approval,stage){\n  if(!approval?.signature_png||!approval?.approved_at||!approval?.approved_username)\n    throw Error(\'Missing original digital signature, username or approval date for \'+stage)\n  const username=String(approval.approved_username).trim()\n  const canvas=document.createElement(\'canvas\')\n  canvas.width=720;canvas.height=400\n  const ctx=canvas.getContext(\'2d\')\n  if(!ctx)throw Error(\'Unable to draw CV signature stamp in this browser\')\n  ctx.fillStyle=\'#ffffff\'\n  ctx.fillRect(0,0,canvas.width,canvas.height)\n  const sig=await imageFromDataURL(approval.signature_png)\n  const ratio=Math.min(620/sig.width,190/sig.height)\n  ctx.drawImage(sig,30,4,Math.round(sig.width*ratio),Math.round(sig.height*ratio))\n  let size=66\n  const fonts=\'"Monotype Corsiva","Apple Chancery","Brush Script MT",cursive\'\n  while(size>24){\n    ctx.font=\'italic \'+size+\'px \'+fonts\n    if(ctx.measureText(username).width<670)break\n    size-=2\n  }\n  ctx.fillStyle=\'#13334e\';ctx.fillText(username,30,286)\n  ctx.fillStyle=\'#333b45\';ctx.font=\'30px Arial, sans-serif\'\n  ctx.fillText(\'Date: \'+dateMY(approval.approved_at),30,348)\n  return canvas.toDataURL(\'image/png\').split(\',\')[1]\n}\n', 'new': '', 'label': 'Remove unused legacy signature renderer', 'unused': ['signerStamp']}, {'file': 'cashVoucherPrintProtection.js', 'old': "function before(element,tag,protection){\n  const anchor=unique(element,tag)[0]\n  if(!anchor)throw Error('Workbook is missing '+tag+'; cannot apply protection safely')\n  anchor.parentNode.insertBefore(protection,anchor)\n}\n", 'new': '', 'label': 'Remove unused XML insertion helper', 'unused': ['before']}, {'file': 'DelegationWorkspace.jsx', 'old': "const stamp = value => value ? new Date(value).toLocaleString('en-MY', {timeZone:'Asia/Kuala_Lumpur'}) : '—'\n", 'new': '', 'label': 'Remove unused display formatter', 'unused': ['stamp']}, {'file': 'App.jsx', 'old': "import AddUser from './AddUser'", 'new': "import './AddUser'", 'label': 'Remove unused AddUser binding; preserve module evaluation', 'unused': ['AddUser']}, {'file': 'App.jsx', 'old': "import EditUser from './EditUser'", 'new': "import './EditUser'", 'label': 'Remove unused EditUser binding; preserve module evaluation', 'unused': ['EditUser']}, {'file': 'App.jsx', 'old': "import UserOrganizationAssignment from './UserOrganizationAssignment'", 'new': "import './UserOrganizationAssignment'", 'label': 'Remove unused UserOrganizationAssignment binding; preserve module evaluation', 'unused': ['UserOrganizationAssignment']}, {'file': 'DelegationHub.jsx', 'old': "import { useEffect, useMemo, useState } from 'react'", 'new': "import { useEffect, useState } from 'react'", 'label': 'Remove unused React useMemo import', 'unused': ['useMemo']}]
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

BRANCH = 'jsync-gui-revamp-20261029'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dry-run', action='store_true', help='Validate candidates without changing installed source')
parser.add_argument('--root', type=Path, default=Path('/workspaces/Jauhar'))
args = parser.parse_args()
ROOT = args.root.resolve()
APP = ROOT / 'app'
SRC = APP / 'src'

def stop(message):
    raise RuntimeError(message)

def run(command, cwd, timeout=240):
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, timeout=timeout)
    return result

def digest(content):
    return hashlib.sha256(content).hexdigest()

def snapshot(directory):
    return {p.relative_to(directory).as_posix(): p.read_bytes()
            for p in directory.rglob('*') if p.is_file()}

def lint(app):
    result = run([str(app/'node_modules/.bin/oxlint'), '--format', 'json', 'src'], app)
    try:
        report = json.loads(result.stdout)
    except ValueError:
        stop('Cannot read lint JSON; no cleaning applied.')
    if result.returncode not in (0, 1) or not isinstance(report.get('diagnostics'), list):
        stop('Linter failed to inspect source; no cleaning applied.')
    return report

def lint_counts(report):
    # Ignore source offsets/order: deleting dead code shifts later line numbers.
    return Counter((d.get('filename'), d.get('code'), d.get('severity'), d.get('message'))
                   for d in report['diagnostics'])

def build(app):
    result = run(['npm', 'run', 'build'], app)
    if result.returncode:
        stop('Build failed in isolated copy; installed source unchanged. Resolve existing build errors first.')
    return result.stdout + result.stderr

def main():
    if not (SRC/'App.jsx').is_file() or not (APP/'package-lock.json').is_file():
        stop('JIMS app not found. Run with --root /workspaces/Jauhar.')
    branch = run(['git','branch','--show-current'],ROOT)
    if branch.returncode or branch.stdout.strip() != BRANCH:
        stop('Expected branch '+BRANCH+'; source unchanged.')
    if not (APP/'node_modules/.bin/oxlint').is_file():
        stop('Dependencies missing. Run cd '+str(APP)+' && npm ci first.')
    if any(p.is_symlink() for p in SRC.rglob('*')):
        stop('Source symlinks require review; source unchanged.')
    before = snapshot(SRC)
    baseline_lint = lint(APP)
    if any(d.get('severity') == 'error' for d in baseline_lint['diagnostics']):
        stop('Existing lint errors require review before cleaning; source unchanged.')
    after = dict(before)
    edits, skipped = [], []
    for op in OPERATIONS:
        key = op['file']
        if key not in after:
            skipped.append(op['label']+': file absent')
            continue
        original = after[key].decode('utf-8')
        if original.count(op['old']) != 1:
            skipped.append(op['label']+': current code differs or already cleaned')
            continue
        proven = all(any(d.get('code') == 'eslint(no-unused-vars)'
                         and Path(d.get('filename','')).as_posix() == 'src/'+key
                         and ("'"+name+"'") in d.get('message','')
                         for d in baseline_lint['diagnostics']) for name in op['unused'])
        if not proven:
            skipped.append(op['label']+': binding is used or lint cannot prove unused')
            continue
        after[key] = original.replace(op['old'], op['new'], 1).encode('utf-8')
        edits.append({'file':key,'change':op['label']})
    changed = {key for key in before if before[key] != after[key]}
    print('JIMS 57CC1: inspected installed source; planned edits:',len(edits))
    for edit in edits:
        print('CLEAN:',edit['file'],'—',edit['change'])
    for reason in skipped:
        print('KEEP:',reason)
    if not changed:
        print('NO CHANGE: reviewed cleanup is already applied or current code needs separate review.')
        print('No application files modified. This is not a UAT or readiness result.')
        return
    # These copies include actual local Vite env files, but never print values.
    # node_modules is reused read-only through a symlink, without installations.
    with tempfile.TemporaryDirectory(prefix='jims_57cc1_') as temp:
        candidate = Path(temp)/'app'
        shutil.copytree(APP,candidate,ignore=shutil.ignore_patterns(
            'node_modules','dist','gui-backups','code-cleaning-backups','.git'))
        (candidate/'node_modules').symlink_to(APP/'node_modules',target_is_directory=True)
        before_build = build(candidate)
        before_artifacts = snapshot(candidate/'dist')
        if not before_artifacts or not any(p.endswith('.js') for p in before_artifacts):
            stop('No production JS artifacts found; installed source unchanged.')
        shutil.rmtree(candidate/'dist')
        for key in changed:
            (candidate/'src'/key).write_bytes(after[key])
        candidate_lint = lint(candidate)
        if lint_counts(candidate_lint) - lint_counts(baseline_lint):
            stop('Candidate adds lint findings; installed source unchanged.')
        after_build = build(candidate)
        after_artifacts = snapshot(candidate/'dist')
        if before_artifacts != after_artifacts:
            stop('Production artifact bytes differ; candidate rejected, installed source unchanged.')
        print('PASS: before/after builds; all',len(before_artifacts),'production files byte-identical.')
        print('Lint findings:',len(baseline_lint['diagnostics']),'→',len(candidate_lint['diagnostics']),'; no new findings.')
        print('PASS: no CSS, copy, workflow, permissions, database or dependency edits.')
        if args.dry_run:
            print('JIMS 57CC1 DRY RUN PASS — installed application source unchanged.')
            return
        if snapshot(SRC) != before:
            stop('Source changed during validation. Rerun against current state; no cleaning applied.')
        # Backup is OUTSIDE the app/repo so lint/Vite cannot accidentally load it.
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = ROOT.parent/'JIMS-code-cleaning-backups'/('57CC1_'+stamp)
        backup.mkdir(parents=True,exist_ok=False)
        shutil.copytree(SRC,backup/'src')
        report = {
            'step':'57CC1', 'branch':BRANCH,
            'commit':run(['git','rev-parse','HEAD'],ROOT).stdout.strip(),
            'edits':edits,'skipped':skipped,
            'lint_before':len(baseline_lint['diagnostics']),
            'lint_after':len(candidate_lint['diagnostics']),
            'artifact_hashes':{k:digest(v) for k,v in before_artifacts.items()},
            'before_hashes':{k:digest(v) for k,v in before.items()},
            'changed_files':sorted(changed),
            'verification':'Isolated production artifacts byte-identical; no new lint findings',
            'uat':'Not run; final UAT remains next, then readiness',
        }
        (backup/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        (backup/'lint-before.json').write_text(json.dumps(baseline_lint,indent=2)+'\n')
        (backup/'lint-after.json').write_text(json.dumps(candidate_lint,indent=2)+'\n')
        (backup/'build-before.log').write_text(before_build)
        (backup/'build-after.log').write_text(after_build)
        touched = []
        try:
            for key in sorted(changed):
                touched.append(key)
                (SRC/key).write_bytes(after[key])
            if snapshot(SRC) != after:
                stop('Installed source differs from validated candidate.')
            live_build = run(['npm','run','build'],APP)
            (backup/'build-installed.log').write_text(live_build.stdout+live_build.stderr)
            if live_build.returncode or snapshot(APP/'dist') != before_artifacts:
                stop('Installed build failed or output differs from validated artifacts.')
        except BaseException:
            for key in touched:
                (SRC/key).write_bytes(before[key])
            # Restore build output from validated original artifacts as well.
            if (APP/'dist').is_dir():
                shutil.rmtree(APP/'dist')
            for key,content in before_artifacts.items():
                target=APP/'dist'/key
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(content)
            print('ROLLBACK: changed source and original build artifacts restored.')
            raise
        print('JIMS 57CC1 INSTALLED BUILD PASS —',len(changed),'source files cleaned.')
        print('Backup + verification report:',backup)
        print('Final UAT still required. Go-live readiness follows UAT.')

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print('STOP:',str(exc))
        sys.exit(1)
