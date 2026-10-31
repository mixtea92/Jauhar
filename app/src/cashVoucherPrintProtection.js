// JSYNC CV Step 48Q: protect downloaded CLOSED Signed Excel for view/print.
// This is Excel worksheet/workbook editing protection, NOT file encryption or
// DRM. It cannot prevent external copying, Save As or protection removal.
// IMPORTANT: Apply only AFTER all CV data and HOD signatures have been embedded.
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const serializer=new XMLSerializer()
const unique=(doc,tag)=>Array.from(doc.getElementsByTagNameNS(NS,tag))
function parse(raw,label){
  const doc=new DOMParser().parseFromString(raw,'application/xml')
  if(doc.getElementsByTagName('parsererror').length)throw Error('Cannot protect invalid '+label+' XML')
  return doc
}
function passwordVerifier(password){
  // Legacy Excel password verifier accepted by desktop Excel for sheet and
  // workbook protection. NOT cryptographically secure (Excel protection is
  // an edit barrier, not a confidentiality guarantee).
  let hash=0
  for(let i=password.length-1;i>=0;i--){
    hash=(((hash<<1)&0x7fff)|((hash>>14)&1))^password.charCodeAt(i)
  }
  hash=(hash^password.length^0xCE4B)&0xffff
  return hash.toString(16).toUpperCase().padStart(4,'0')
}
function randomVerifier(){
  if(!globalThis.crypto?.getRandomValues)throw Error('Secure browser required for signed workbook locking')
  const seed=new Uint8Array(24)
  globalThis.crypto.getRandomValues(seed)
  const pass=Array.from(seed,b=>b.toString(16).padStart(2,'0')).join('')
  return passwordVerifier(pass)
}
export async function lockSignedCVWorkbook(zip,work,workRels,resolveSheetPath){
  // Never use or expose a global/shared protection password; independent
  // per-download verifier is intentionally not recoverable in the browser.
  const verifier=randomVerifier()
  const sheets=unique(work,'sheet')
  if(!sheets.length)throw Error('Signed workbook has no worksheets to protect')
  const relNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const relationships=Array.from(workRels.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/package/2006/relationships','Relationship'
  ))
  const targets=[]
  for(const sheet of sheets){
    const relId=sheet.getAttributeNS(relNS,'id')
    const target=relationships.find(item=>item.getAttribute('Id')===relId)?.getAttribute('Target')
    if(!target)throw Error('Signed workbook missing worksheet relationship '+relId)
    const part=resolveSheetPath('xl',target)
    if(!zip.file(part))throw Error('Signed workbook missing worksheet part '+part)
    targets.push(part)
  }
  if(new Set(targets).size!==targets.length)throw Error('Workbook worksheet mappings are ambiguous')
  // Some input cells in the original official form may have been pre-unlocked.
  // Lock EVERY style in the exported copy so none of them remains editable.
  const stylePart=zip.file('xl/styles.xml')
  if(!stylePart)throw Error('Signed workbook has no styles part; cannot lock all input cells')
  const styles=parse(await stylePart.async('string'),'cell styles')
  const cellXfs=unique(styles,'cellXfs')[0]
  if(!cellXfs)throw Error('Cannot locate cell formatting records for protection')
  for(const xf of Array.from(cellXfs.children).filter(x=>x.localName==='xf')){
    const p=Array.from(xf.children).find(x=>x.localName==='protection')
    // No <protection> means locked by default. Explicitly override unlocked.
    if(p){
      p.setAttribute('locked','1')
      xf.setAttribute('applyProtection','1')
    }
  }
  zip.file('xl/styles.xml',serializer.serializeToString(styles))
  for(const part of targets){
    const sheetDoc=parse(await zip.file(part).async('string'),part)
    for(const old of unique(sheetDoc,'sheetProtection'))old.remove()
    const protect=sheetDoc.createElementNS(NS,'sheetProtection')
    const disabled=[
      'sheet','objects','scenarios','formatCells','formatColumns','formatRows',
      'insertColumns','insertRows','insertHyperlinks','deleteColumns','deleteRows',
      'selectLockedCells','selectUnlockedCells','sort','autoFilter','pivotTables'
    ]
    for(const opt of disabled)protect.setAttribute(opt,'1')
    protect.setAttribute('password',verifier)
    // SpreadsheetML requires sheetProtection just after sheetData/sheetCalcPr.
    const calc=unique(sheetDoc,'sheetCalcPr')[0]
    const sheetData=unique(sheetDoc,'sheetData')[0]
    const anchor=calc||sheetData
    if(!anchor||anchor.parentNode!==sheetDoc.documentElement)
      throw Error('Unexpected sheet XML structure; protection not applied')
    sheetDoc.documentElement.insertBefore(protect,anchor.nextSibling)
    zip.file(part,serializer.serializeToString(sheetDoc))
  }
  for(const old of unique(work,'workbookProtection'))old.remove()
  const protect=work.createElementNS(NS,'workbookProtection')
  protect.setAttribute('lockStructure','1')
  protect.setAttribute('workbookPassword',verifier)
  // ECMA SpreadsheetML: workbookProtection after workbookPr, before bookViews/sheets.
  const views=unique(work,'bookViews')[0]
  const main=unique(work,'sheets')[0]
  if(!main)throw Error('Workbook sheet list missing')
  work.documentElement.insertBefore(protect,views||main)
  zip.file('xl/workbook.xml',serializer.serializeToString(work))
  return {protectedSheets:targets.length}
}
