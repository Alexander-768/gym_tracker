/**
 * Gym Tracker Apps Script backend.
 * Deploy as: Execute as Me; Who has access: Only myself.
 * Never publish as "Anyone" or "Anyone with link".
 * This backend is a separate alternative to GitHub Pages, not its API.
 */
const GYM_SHEET_ID = '1IrLRJVWarQJt-ALBO4GObIJrEopxfnBa4I9xRcQ2XRs';
const GYM_TAB = 'gym_tracker_app';
const GYM_HEAD = ['id','date','exercise','weight_kg','reps','sets','note','created_at','updated_at','deleted_at','category'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Gym Tracker');
}
function gymRead_() {
  const sheet=SpreadsheetApp.openById(GYM_SHEET_ID).getSheetByName(GYM_TAB);
  if (!sheet) throw Error('Не найден лист gym_tracker_app. Синхронизация остановлена.');
  const n=sheet.getLastRow();
  if(n<1)throw Error('Пустой лист. Синхронизация остановлена.');
  const header=sheet.getRange(1,1,1,11).getValues()[0];
  if(GYM_HEAD.some((h,i)=>h!==header[i]))throw Error('Заголовки журнала изменились. Синхронизация остановлена.');
  const values=n>1?sheet.getRange(2,1,n-1,11).getValues():[];
  const records=values.map((v,i)=>({row:i+2,id:String(v[0]||''),date:dateString_(v[1]),exercise:String(v[2]||''),
   weight:number_(v[3]),reps:number_(v[4]),sets:number_(v[5]),note:String(v[6]||''),
   createdAt:Number(v[7])||0,updatedAt:Number(v[8])||0,deletedAt:Number(v[9])||0,category:String(v[10]||'Без группы')
  })).filter(x=>x.id);
  if(new Set(records.map(r=>r.id)).size!==records.length)throw Error('Повторяющиеся ID в журнале; запись заблокирована.');
  return {sheet,records};
}
function dateString_(v){
 if(v instanceof Date)return Utilities.formatDate(v,Session.getScriptTimeZone(),'yyyy-MM-dd');
 return String(v||'').slice(0,10);
}
function number_(v){return v===''||v===null||v===undefined?null:Number(v);}
function row_(e){return [e.id,e.date||'',e.exercise||'',e.weight??'',e.reps??'',e.sets??'',e.note||'',e.createdAt||1,e.updatedAt||1,e.deletedAt||'',e.category||'Без группы'];}
function gymSnapshot(){
 // This function can only be called from a signed-in owner-only deployment.
 return gymRead_().records;
}
function gymApplyChanges(changes) {
 if(!Array.isArray(changes)||changes.length>500)throw Error('Недопустимое количество изменений.');
 const lock=LockService.getScriptLock();
 lock.waitLock(15000);
 try {
  const {sheet,records}=gymRead_(),map=new Map(records.map(r=>[r.id,r]));
  const conflicts=[];
  let applied=0;
  for(const c of changes){
   if(!c||typeof c.id!=='string'||!c.id||!/^\d{4}-\d{2}-\d{2}$/.test(String(c.date||''))||!Number.isFinite(Number(c.updatedAt))||!c.category)throw Error('Некорректная запись в пакете.');
   const old=map.get(c.id);
   const isDeleted=Number(c.deletedAt||0)>0;
   if(old){
    if(Number(old.updatedAt)!==Number(c.expectedUpdatedAt||0)||Number(old.deletedAt||0)!==Number(c.expectedDeletedAt||0)||Number(old.deletedAt||0)>0&&!isDeleted){
     conflicts.push(c.id);continue;
    }
    if(Number(c.updatedAt)<Number(old.updatedAt)){conflicts.push(c.id);continue;}
    sheet.getRange(old.row,1,1,11).setValues([row_(c)]);
   }else {
    if(c.expectedUpdatedAt!==null&&c.expectedUpdatedAt!==undefined){conflicts.push(c.id);continue;}
    const row=sheet.getLastRow()+1;
    sheet.getRange(row,1,1,11).setValues([row_(c)]);
   }
   // Prevent duplicate inserts if the batch contains the same ID twice.
   map.set(c.id,{...c,row:old?.row||sheet.getLastRow()});
   applied++;
  }
  return {applied,conflicts};
 }finally{lock.releaseLock();}
}
