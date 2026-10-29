#!/usr/bin/env python3
"""JIMS Step 53T-D: safely install CLEAN PV Revision 1 workbook into Vite public/templates.
Usage: python3 /tmp/JIMS_53TD.py --dry-run /workspaces/Jauhar/JIMS_Official_PV_Revision1_Clean.xlsx
       python3 /tmp/JIMS_53TD.py /workspaces/Jauhar/JIMS_Official_PV_Revision1_Clean.xlsx
Accepts only valid XLSX with Revision1 form and PV Tier Matrix; protects existing file.
"""
from pathlib import Path
from datetime import datetime,timezone
import shutil,subprocess,sys,zipfile
from xml.etree import ElementTree as ET

ROOT=Path('/workspaces/Jauhar')
BRANCH='jsync-gui-revamp-20261029'
DEST=ROOT/'app/public/templates/JAUHAR_PV_Official_Template.xlsx'
DRY='--dry-run' in sys.argv
args=[s for s in sys.argv[1:] if s!='--dry-run']
if len(args)!=1:
    sys.exit('USAGE: python3 JIMS_53TD.py [--dry-run] /absolute/path/to/JIMS_Official_PV_Revision1_Clean.xlsx')
src=Path(args[0])
def stop(message):sys.exit('STOP: '+str(message))

if subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip()!=BRANCH:
    stop('Wrong branch: '+BRANCH)
if not src.is_file() or src.suffix.lower()!='.xlsx' or not (10000<=src.stat().st_size<=3000000):
    stop('Source workbook is missing, wrong type, empty, or >3 MB')
if src.resolve()==DEST.resolve(): stop('Source and target must be different.')
if not DEST.is_file(): stop('Existing JIMS official template missing; no overwrite.')
p=ROOT/'app/src/PaymentVoucher.jsx'
if not p.is_file() or 'parseRevisionOneWorkbook' not in p.read_text():
    stop('Step 53T-C Revision1 Excel importer not installed yet.')
try:
    with zipfile.ZipFile(src) as z:
        if z.testzip() is not None: stop('XLSX failed ZIP CRC test.')
        names=set(z.namelist())
        if not {'xl/workbook.xml','xl/worksheets/sheet1.xml'}.issubset(names):
            stop('Missing XLSX core files.')
        content=z.read('xl/workbook.xml')
        if b'PV (T-Digital)' not in content or b'PV Tier Matrix' not in content:
            stop('Workbook must contain PV (T-Digital) and PV Tier Matrix.')
        if b'#REF!' in b''.join(z.read(k) for k in names if k.startswith('xl/worksheets/') and k.endswith('.xml')):
            stop('Workbook still contains broken #REF! formula.')
except zipfile.BadZipFile: stop('Invalid XLSX archive.')
print('JIMS STEP 53T-D —', 'DRY RUN' if DRY else 'INSTALL')
print('Source:',src.name,src.stat().st_size,'bytes')
print('Target:',DEST)
print('Existing official XLSX will be backed up; no processing logic changed.')
if DRY:
    print('DRY RUN PASS — no template changed.')
    sys.exit(0)

backup=ROOT/('app/gui-backups/53T_template_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(parents=True,exist_ok=False)
snapshot=backup/DEST.name
shutil.copy2(DEST,snapshot)
try:
    shutil.copy2(src,DEST)
    subprocess.run(['npm','run','build'],cwd=ROOT/'app',check=True)
    print('JIMS OFFICIAL PV REVISION 1 TEMPLATE INSTALLED — BUILD PASS')
    print('Backup:',snapshot)
except Exception as exc:
    shutil.copy2(snapshot,DEST)
    stop('Build failed; original Excel template restored. '+str(exc))
