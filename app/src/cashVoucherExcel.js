// JSYNC Cash Voucher: literal options and cell mapping from FIN_FM_PC_Petty Cash.xlsx.
// Preserve original source workbook; do not regenerate or restyle its print sheets.
export const CV_TEMPLATE_URL = '/templates/FIN_FM_PC_Petty Cash.xlsx'
export const CV_BRANCHES = ['JMC_GP','JMC_KM','JMC_PM','JMC_TD']
export const CV_DEPARTMENTS = ['Finance','Operation','Sales & Marketing','Medical','System, Project & Infrastructure']
export const CV_CLAIM_CATEGORIES = ['Cash Advance','Reimbursement Claim']
export const CV_EXTRA_C18 = ['Petrol / Mileage','Courier / Postage','Parking / Toll','Stationery','Urgent Office Purchase','Medical Supplies','Refreshments','Others']
export const CV_EXPENSE_CATEGORIES_DIGITAL = [
  'General & Administrative Expenses',
  'Cleaning & Housekeeping',
  'Courier & Postage',
  'Fuel Expenses ',
  'Toll & Parking',
  'Transportation & Mileage',
  'Vehicle Maintenance',
  'Meals & Refreshments',
  'Staff Welfare & Benefits',
  'Gifts & CSR',
  'Event Expenses',
  'Marketing & Promotion',
  'Medical Supplies & Consumables',
  'Medicines & Pharmaceuticals',
  'Medical Equipment & Tools',
  'Facility Maintenance & Repairs',
  'Landscaping & Plants',
  'Utilities',
  'IT & System Expenses',
  'Staff Accommodation'
]
export const CV_EXPENSE_CATEGORIES_MANUAL = [
  'Petrol','Courier','Parking / Toll','Stationery',
  'Office Supplies','Medical Supplies','Refreshments','Others'
]
export const CV_SHEETS = ['PC (Digital)','PC (Manual)']
export const blankCVLine = () => ({
  receipt_date:'',receipt_no:'',description:'',expense_category:'',
  expenses_branch:'',amount:'',receipt_attached:''
})
export const blankCVForm = () => ({
  source_sheet:'PC (Digital)',
  date_of_request:'',
  date_disbursed:'',
  claimant_name:'',staff_id:'',position:'',department:'',branch:'',
  claim_category:'',remarks:'',payment_method:'Cash (Petty Cash)',
  legacy_category:'',lines:[]
})
export const hasCVLineData = row => ['receipt_date','receipt_no','description','expense_category','expenses_branch','amount','receipt_attached'].some(k=>String(row?.[k]??'').trim()!=='')
export const CV_FORM_DATE = value => {
  if(value == null || value === '') return ''
  if(value instanceof Date && !Number.isNaN(value.getTime())) return [
    value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')
  ].join('-')
  if(typeof value==='number' && value>10000 && value<90000){
    // Excel 1900 date serial (ExcelJS may return numeric for a General-formatted date).
    const d=new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000)
    return d.toISOString().slice(0,10)
  }
  const str=String(value).trim()
  if(/^\d{4}-\d{2}-\d{2}$/.test(str))return str
  const m=str.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
  if(m){
    const day=+m[1],month=+m[2]
    if(day>=1&&day<=31&&month>=1&&month<=12)return m[3]+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0')
  }
  return str
}
function cellText(sheet,address){
  let v=sheet.getCell(address).value
  if(v==null)return ''
  if(typeof v==='object'&&!(v instanceof Date)){
    if(v.text!=null)return String(v.text).trim()
    if(v.result!=null)return String(v.result).trim()
    if(v.richText)return v.richText.map(x=>x.text).join('').trim()
    return ''
  }
  if(v instanceof Date)return CV_FORM_DATE(v)
  return String(v).trim()
}
export async function parseCVWorkbook(file,sheetName='PC (Digital)'){
  if(!file||!(/\.xlsx$/i).test(file.name))throw Error('Upload the original .xlsx petty cash claim template only.')
  if(file.size>5*1024*1024)throw Error('Excel upload exceeds the 5 MB size limit.')
  const ExcelJS=(await import('exceljs')).default
  const wb=new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const sheet=wb.getWorksheet(sheetName)
  if(!sheet)throw Error('The selected PC (Digital) / PC (Manual) sheet was not found.')
  if(cellText(sheet,'B5')!=='TITLE: PETTY CASH CLAIM FORM' ||
     cellText(sheet,'B19')!=='B. EXPENSE DETAILS | ORIGINAL RECEIPTS REQUIRED'){
    throw Error('Uploaded file does not match the official FIN_FM_PC_Petty Cash template.')
  }
  const rows=[]
  for(let i=21;i<=30;i++){
    const row={
      receipt_date:CV_FORM_DATE(sheet.getCell('C'+i).value),
      receipt_no:cellText(sheet,'D'+i),
      description:cellText(sheet,'E'+i),
      expense_category:cellText(sheet,'F'+i),
      expenses_branch:cellText(sheet,'G'+i),
      amount:cellText(sheet,'H'+i),
      receipt_attached:cellText(sheet,'I'+i)
    }
    if(hasCVLineData(row))rows.push(row)
  }
  const possibleCategory=cellText(sheet,'G13')
  return {
    source_sheet:sheetName,
    date_of_request:CV_FORM_DATE(sheet.getCell('H10').value),
    date_disbursed:'',
    claimant_name:cellText(sheet,'D13'),staff_id:cellText(sheet,'D14'),
    position:cellText(sheet,'D15'),department:cellText(sheet,'D16'),
    branch:cellText(sheet,'D17'),
    claim_category:CV_CLAIM_CATEGORIES.includes(possibleCategory.trim()) ? possibleCategory.trim() : '',
    remarks:cellText(sheet,'G14'),
    payment_method:'Cash (Petty Cash)',
    legacy_category:cellText(sheet,'C18'),
    lines:rows
  }
}
