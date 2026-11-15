/* Gym Tracker ↔ Google Sheets (Google Identity Services token flow). Tokens are memory-only. */
(() => {
"use strict";
const CLIENT_ID="255537560032-4a6lqi2quocorn0jn0sl5tqlerjfl4br.apps.googleusercontent.com";
const SPREADSHEET_ID="1IrLRJVWarQJt-ALBO4GObIJrEopxfnBa4I9xRcQ2XRs";
const TAB="gym_tracker_app";
const HEADERS=["id","date","exercise","weight_kg","reps","sets","note","created_at","updated_at","deleted_at"];
const SCOPE="https://www.googleapis.com/auth/spreadsheets";
const $=id=>document.getElementById(id);
let accessToken=null,expiresAt=0,client=null,busy=false,writeQueue=Promise.resolve();
const status=msg=>{if($("sheetsStatus"))$("sheetsStatus").textContent=msg;};
const quote=tab=>"'"+tab.replace(/'/g,"''")+"'";
async function api(path,options={}) {
 if(!accessToken || Date.now()>expiresAt)throw Error("Время доступа Google истекло. Нажми «Подключить Google» ещё раз.");
 const res=await fetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(SPREADSHEET_ID)+path,{
 ...options,headers:{"Authorization":"Bearer "+accessToken,"Content-Type":"application/json",...(options.headers||{})}});
 if(!res.ok){let msg="HTTP "+res.status;try{const obj=await res.json();msg=obj.error?.message||msg;}catch{}if(res.status===401){accessToken=null;expiresAt=0;}throw Error(msg)}
 return res.status===204?null:res.json();
}
const meta=()=>api("?fields=sheets(properties(sheetId,title,gridProperties))");
async function sheets(){const m=await meta();return m.sheets?.map(x=>x.properties)||[];}
async function ensureTab(){
 const all=await sheets();if(all.some(x=>x.title===TAB))return;
 try{await api(":batchUpdate",{method:"POST",body:JSON.stringify({requests:[{addSheet:{properties:{title:TAB}}}]})});}catch(e){if(!(await sheets()).some(x=>x.title===TAB))throw e;}
 await api("/values/"+encodeURIComponent(quote(TAB)+"!A1:J1")+"?valueInputOption=RAW",{method:"PUT",body:JSON.stringify({values:[HEADERS]})});
}
async function rows(){
 const d=await api("/values/"+encodeURIComponent(quote(TAB)+"!A1:J")+"?valueRenderOption=UNFORMATTED_VALUE");
 const values=d.values||[];if(values.length && HEADERS.some((v,i)=>String(values[0]?.[i]||"")!==v))throw Error("Заголовки вкладки gym_tracker_app отличаются. Синхронизация остановлена, чтобы не перезаписать данные.");
 return values.slice(1).map((r,i)=>({r:r,index:i+2})).filter(x=>x.r[0]);
}
function remoteRecord({r,index}){
 const [id,date,exercise,weight,reps,sets,note,created,updated,deleted]=r;
 return {id:String(id),date:String(date||""),exercise:String(exercise||""),weight:Number(weight),reps:Number(reps),sets:Number(sets),note:String(note||""),createdAt:Number(created)||0,updatedAt:Number(updated)||0,deletedAt:Number(deleted)||0,row:index};
}
const serialize=e=>[e.id,e.date,e.exercise,e.weight,e.reps,e.sets,e.note||"",e.createdAt||Date.now(),e.updatedAt||Date.now(),e.deletedAt||""];
async function getLocal(){
 // Existing app has private IndexedDB module variables. Read same store independently.
 const d=await new Promise((resolve,reject)=>{const q=indexedDB.open("gym-tracker-v1");q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
 try{return await new Promise((resolve,reject)=>{const t=d.transaction("entries","readonly"),q=t.objectStore("entries").getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}finally{d.close();}
}
async function saveLocal(changes,deletedIds){
 const d=await new Promise((resolve,reject)=>{const q=indexedDB.open("gym-tracker-v1");q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
 try{await new Promise((resolve,reject)=>{const t=d.transaction("entries","readwrite"),s=t.objectStore("entries");changes.forEach(x=>s.put(x));deletedIds.forEach(id=>s.delete(id));t.oncomplete=resolve;t.onerror=()=>reject(t.error)})}finally{d.close();}
}
const tombstoneKey="gym_tracker_tombstones_v1";
const tombstones=()=>{try{return JSON.parse(localStorage.getItem(tombstoneKey)||"{}")}catch{return {}}};
const markDelete=id=>{const t=tombstones();t[id]=Date.now();localStorage.setItem(tombstoneKey,JSON.stringify(t));};
async function syncNow(){
 if(busy||!accessToken)return;
 busy=true;$("syncSheets").disabled=true;status("Синхронизация...");
 try{
  await ensureTab();
  const rr=(await rows()).map(remoteRecord),rmap=new Map(rr.map(x=>[x.id,x]));
  const local=await getLocal(),lmap=new Map(local.map(x=>[x.id,x]));
  const del=tombstones();const merged=new Map();
  for(const x of rr)merged.set(x.id,x);
  for(const x of local){const old=merged.get(x.id);if(!old || Number(x.updatedAt)>=Number(old.updatedAt))merged.set(x.id,x);}
  for(const [id,at] of Object.entries(del)){const old=merged.get(id);if(!old||Number(at)>Number(old.updatedAt))merged.set(id,{id,deletedAt:Number(at),updatedAt:Number(at),createdAt:old?.createdAt||Number(at),date:old?.date||"",exercise:old?.exercise||"",weight:old?.weight||0,reps:old?.reps||0,sets:old?.sets||0,note:old?.note||""});}
  const toSave=[],toDelete=[],updates=[],appends=[];
  for(const e of merged.values()){
   const isDeleted=Number(e.deletedAt)>0;
   const localOld=lmap.get(e.id);
   if(isDeleted){if(localOld)toDelete.push(e.id);if(Number(del[e.id]||0)<Number(e.deletedAt||0))del[e.id]=Number(e.deletedAt);}
   else if(!localOld || Number(localOld.updatedAt)<Number(e.updatedAt))toSave.push({...e,deletedAt:undefined,row:undefined});
   const remoteOld=rmap.get(e.id);
   if(!remoteOld)appends.push(serialize(e));
   else if(Number(remoteOld.updatedAt)<Number(e.updatedAt)||Number(remoteOld.deletedAt||0)!==Number(e.deletedAt||0))updates.push({range:quote(TAB)+"!A"+remoteOld.row+":J"+remoteOld.row,values:[serialize(e)]});
  }
  if(updates.length)await api("/values:batchUpdate",{method:"POST",body:JSON.stringify({valueInputOption:"RAW",data:updates})});
  if(appends.length)await api("/values/"+encodeURIComponent(quote(TAB)+"!A:J")+":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",{method:"POST",body:JSON.stringify({values:appends})});
  if(toSave.length||toDelete.length)await saveLocal(toSave,toDelete);
  localStorage.setItem(tombstoneKey,JSON.stringify(del));
  if(typeof window.gymRefresh==="function")await window.gymRefresh();
  status("✓ Синхронизировано: "+new Date().toLocaleTimeString("ru-RU")+". Записей в облаке: "+merged.size);
 }catch(e){status("Ошибка: "+e.message)}finally{busy=false;$("syncSheets").disabled=false;}
}
async function inspect(){
 try{status("Загружаю вкладки...");const all=await sheets();$("sheetTabs").innerHTML=all.map(x=>"<div>"+escapeHtml(x.title)+(x.title===TAB?" — вкладка приложения":" — без изменений")+"</div>").join("");status("Подключено. Вкладки показаны ниже.");}
 catch(e){status("Ошибка: "+e.message)}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function connect(){
 if(!window.google?.accounts?.oauth2){status("Не удалось загрузить Google Identity Services. Обнови страницу и проверь блокировщики.");return;}
 if(!client)client=google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPE,callback:async response=>{
   if(response.error||!response.access_token){status("Авторизация не удалась: "+(response.error||"нет токена"));return;}
   accessToken=response.access_token;expiresAt=Date.now()+(Number(response.expires_in)||3500)*1000-60000;
   $("connectSheets").textContent="↻ Обновить доступ Google";
   $("syncSheets").disabled=false;$("inspectSheets").disabled=false;
   await inspect();await syncNow();
 }});
 client.requestAccessToken({prompt:accessToken?"":"select_account"});
}
window.gymSheetDeleted=markDelete;
window.gymSheetChanged=()=>{if(accessToken && !busy)writeQueue=writeQueue.then(()=>syncNow()).catch(()=>{});};
window.gymSheetSync=syncNow;
$("connectSheets").addEventListener("click",connect);
$("syncSheets").addEventListener("click",syncNow);
$("inspectSheets").addEventListener("click",inspect);
})();