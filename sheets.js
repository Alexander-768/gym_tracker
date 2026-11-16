/* Gym Tracker ↔ Google Sheets (Google Identity Services token flow). Tokens are memory-only. */
(() => {
"use strict";
const CLIENT_ID="255537560032-4a6lqi2quocorn0jn0sl5tqlerjfl4br.apps.googleusercontent.com";
const SPREADSHEET_ID="1IrLRJVWarQJt-ALBO4GObIJrEopxfnBa4I9xRcQ2XRs";
const TAB="gym_tracker_app";
const HEADERS=["id","date","exercise","weight_kg","reps","sets","note","created_at","updated_at","deleted_at","category"];
const SCOPE="https://www.googleapis.com/auth/spreadsheets";
const $=id=>document.getElementById(id);
let accessToken=null,expiresAt=0,client=null,busy=false,needsResync=false,writeQueue=Promise.resolve();
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
 const all=await sheets();if(all.some(x=>x.title===TAB)){const h=await api("/values/"+encodeURIComponent(quote(TAB)+"!A1:K1"));const header=h.values?.[0]||[];if(header.length>=10&&HEADERS.slice(0,10).every((v,i)=>header[i]===v)&&!header[10])await api("/values/"+encodeURIComponent(quote(TAB)+"!K1")+"?valueInputOption=RAW",{method:"PUT",body:JSON.stringify({values:[["category"]]})});return;}
 try{await api(":batchUpdate",{method:"POST",body:JSON.stringify({requests:[{addSheet:{properties:{title:TAB}}}]})});}catch(e){if(!(await sheets()).some(x=>x.title===TAB))throw e;}
 await api("/values/"+encodeURIComponent(quote(TAB)+"!A1:K1")+"?valueInputOption=RAW",{method:"PUT",body:JSON.stringify({values:[HEADERS]})});
}
async function rows(){
 const d=await api("/values/"+encodeURIComponent(quote(TAB)+"!A1:K")+"?valueRenderOption=UNFORMATTED_VALUE");
 const values=d.values||[];if(values.length && HEADERS.some((v,i)=>String(values[0]?.[i]||"")!==v))throw Error("Заголовки вкладки gym_tracker_app отличаются. Синхронизация остановлена, чтобы не перезаписать данные.");
 return values.slice(1).map((r,i)=>({r:r,index:i+2})).filter(x=>x.r[0]);
}
function remoteRecord({r,index}){
 const [id,date,exercise,weight,reps,sets,note,created,updated,deleted,category]=r;
 return {id:String(id),date:String(date||""),exercise:String(exercise||""),weight:Number(weight),reps:Number(reps),sets:Number(sets),note:String(note||""),createdAt:Number(created)||0,updatedAt:Number(updated)||0,deletedAt:Number(deleted)||0,category:String(category||"Без группы"),row:index};
}
const serialize=e=>[e.id,e.date,e.exercise,e.weight,e.reps,e.sets,e.note||"",e.createdAt||Date.now(),e.updatedAt||Date.now(),e.deletedAt||"",e.category||"Без группы"];
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

const MIRROR_TABS=["Мои данные","Руки","Спина и плечи","Грудь","Ноги"];
// A protected record ID in D for body weight or F for workout sheets
// allows retries and repairs without blindly appending duplicates.
async function mirrorRecords(records){
 const names=MIRROR_TABS;
 const ranges=names.map(n=>"ranges="+encodeURIComponent(quote(n)+"!A1:F")).join("&");
 const payload=await api("/values:batchGet?"+ranges+"&valueRenderOption=UNFORMATTED_VALUE");
 const originals={};
 for(let i=0;i<names.length;i++)originals[names[i]]=payload.valueRanges?.[i]?.values||[];
 const updates=[],appends={};
 for(const name of names){
  const rows=originals[name],markerCol=name==="Мои данные"?3:5;
  const existingHeader=rows[0]?.[markerCol];
  if(existingHeader && existingHeader!=="gym_tracker_id")
   throw Error("В листе «"+name+"» служебный столбец уже занят. Запись остановлена во избежание потери данных.");
  if(!existingHeader)updates.push({range:quote(name)+"!"+(markerCol===3?"D1":"F1"),values:[["gym_tracker_id"]]});
  appends[name]=[];
 }
 const known={};
 for(const name of names){
  const markerCol=name==="Мои данные"?3:5;
  const map=new Map();
  (originals[name]||[]).slice(1).forEach((r,i)=>{const id=String(r[markerCol]||"").trim();if(id)map.set(id,i+2);});
  known[name]=map;
 }
 for(const e of records){
  // Legacy records without a category aren't moved or guessed.
  const name=e.category==="Общий вес"?"Мои данные":MIRROR_TABS.includes(e.category)?e.category:null;
  if(!name||!e.id)continue;
  const dead=Number(e.deletedAt||0)>0;
  const body=name==="Мои данные";
  const fields=body
    ? [e.date?e.date.split("-").reverse().join("."):"",Number(e.weight),e.note||"",e.id]
    : [e.date?e.date.split("-").reverse().join("."):"",e.exercise||"",Number(e.weight),e.reps==null?"":Number(e.reps),e.note||"",e.id];
  for(const oldName of names){
   const row=known[oldName].get(e.id);
   if(!row)continue;
   // Tombstones keep their ID so a retry doesn't append the same record.
   const shouldClear=dead||oldName!==name;
   const newValues=shouldClear?(oldName==="Мои данные"?["","","",e.id]:["","","","","",e.id]):fields;
   const oldRows=originals[oldName]||[];
   const oldValue=oldRows[row-1]||[];
   if(JSON.stringify(oldValue.slice(0,newValues.length).map(x=>String(x??"")))!==JSON.stringify(newValues.map(x=>String(x??""))))
    updates.push({range:quote(oldName)+"!A"+row+":"+(oldName==="Мои данные"?"D":"F")+row,values:[newValues]});
  }
  if(!dead && !known[name].has(e.id))appends[name].push(fields);
 }
 if(updates.length)await api("/values:batchUpdate",{method:"POST",body:JSON.stringify({valueInputOption:"USER_ENTERED",data:updates})});
 for(const name of names){
  if(!appends[name].length)continue;
  await api("/values/"+encodeURIComponent(quote(name)+(name==="Мои данные"?"!A:D":"!A:F"))+":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
   {method:"POST",body:JSON.stringify({values:appends[name]})});
 }
}

async function syncNow(){
 if(!accessToken)return; if(busy){needsResync=true;return;}
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
   else if(Number(remoteOld.updatedAt)<Number(e.updatedAt)||Number(remoteOld.deletedAt||0)!==Number(e.deletedAt||0))updates.push({range:quote(TAB)+"!A"+remoteOld.row+":K"+remoteOld.row,values:[serialize(e)]});
  }
  if(updates.length)await api("/values:batchUpdate",{method:"POST",body:JSON.stringify({valueInputOption:"RAW",data:updates})});
  if(appends.length)await api("/values/"+encodeURIComponent(quote(TAB)+"!A:K")+":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",{method:"POST",body:JSON.stringify({values:appends})});
  if(toSave.length||toDelete.length)await saveLocal(toSave,toDelete);
  // After the canonical app tab is written, mirror the same records to familiar sheets.
  await mirrorRecords([...merged.values()]);
  localStorage.setItem(tombstoneKey,JSON.stringify(del));
  if(typeof window.gymRefresh==="function")await window.gymRefresh();
  status("✓ Автоматически синхронизировано: "+new Date().toLocaleTimeString("ru-RU")+". Записей в облаке: "+merged.size);window.dispatchEvent(new Event("gym-google-sync"));
 }catch(e){status("Ошибка: "+e.message)}finally{busy=false;$("syncSheets").disabled=false;if(needsResync){needsResync=false;void syncNow();}}
}

let legacyCopy="";
function cellCol(index){let s="",n=index+1;while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}
async function previewLegacy(){
 try{
  const title=$("legacyTab").value;
  if(!title||title===TAB)throw Error("Выбери исходную вкладку");
  status("Читаю первые 15 строк...");
  const d=await api("/values/"+encodeURIComponent(quote(title)+"!A1:AZ15")+"?valueRenderOption=FORMATTED_VALUE");
  const values=d.values||[];
  legacyCopy="Вкладка: "+title+"\n"+values.map((r,i)=>"Строка "+(i+1)+": "+r.map((v,j)=>cellCol(j)+"="+String(v)).join(" | ")).join("\n");
  $("legacyPreview").innerHTML=values.length?'<div class="muted">Предварительный просмотр первых 15 строк</div><table style="border-collapse:collapse;font-size:12px;min-width:100%">'+values.map(row=>'<tr>'+row.slice(0,30).map(v=>'<td style="padding:7px;border:1px solid #364359;white-space:nowrap">'+escapeHtml(String(v).slice(0,120))+'</td>').join("")+'</tr>').join("")+'</table>':'<div class="empty">Вкладка пуста</div>';
  $("copyLegacy").disabled=!values.length;
  status("✓ Просмотр готов. Исходная таблица не изменялась.");
 }catch(e){status("Ошибка просмотра: "+e.message)}
}
async function inspect(){
 try{status("Загружаю вкладки...");const all=await sheets();const sourceTabs=all.filter(x=>x.title!==TAB);$("legacyInspector").classList.toggle("hidden",!sourceTabs.length);$("legacyTab").innerHTML=sourceTabs.map(x=>"<option value=\""+escapeHtml(x.title)+"\">"+escapeHtml(x.title)+"</option>").join("");$("sheetTabs").innerHTML=all.map(x=>"<div>"+escapeHtml(x.title)+(x.title===TAB?" — вкладка приложения":" — без изменений")+"</div>").join("");status("Подключено. Вкладки показаны ниже.");}
 catch(e){status("Ошибка: "+e.message)}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
const connectedBeforeKey="gym_google_previously_connected_v1";
let authRequestInFlight=false,autoAuthAttempted=false;
function setupClient(){
 if(client)return true;
 if(!window.google?.accounts?.oauth2)return false;
 client=google.accounts.oauth2.initTokenClient({
  client_id:CLIENT_ID,scope:SCOPE,
  error_callback:error=>{
   authRequestInFlight=false;
   status("Google не разрешил автоматический вход ("+(error?.type||"окно заблокировано")+"). Нажми «Подключить Google».");
  },
  callback:async response=>{
   authRequestInFlight=false;
   if(response.error||!response.access_token){
    status("Требуется повторное подключение Google: "+(response.error||"нет токена"));
    return;
   }
   accessToken=response.access_token;
   expiresAt=Date.now()+(Number(response.expires_in)||3500)*1000-60000;
   localStorage.setItem(connectedBeforeKey,"yes");
   $("connectSheets").textContent="↻ Обновить доступ Google";
   $("syncSheets").disabled=false;$("inspectSheets").disabled=false;
   try{
    await Promise.all([inspect(),syncNow()]);
    window.dispatchEvent(new Event("gym-google-connected"));
   }catch(err){status("Ошибка при загрузке данных: "+err.message)}
  }
 });
 return true;
}
function requestToken(automatic=false){
 if(authRequestInFlight)return;
 if(!setupClient()){
  status("Не загрузилась авторизация Google. Проверь подключение к интернету.");
  return;
 }
 authRequestInFlight=true;
 if(automatic)status("Пробую автоматически подключить Google...");
 try{client.requestAccessToken({prompt:automatic?"none":""});}
 catch(err){authRequestInFlight=false;status("Для подключения Google нажми кнопку: "+err.message);}
}
function connect(){requestToken(false);}
function autoConnect(){
 if(autoAuthAttempted||!navigator.onLine||localStorage.getItem(connectedBeforeKey)!=="yes")return;
 if(!window.google?.accounts?.oauth2)return;
 autoAuthAttempted=true;
 requestToken(true);
}
if(localStorage.getItem(connectedBeforeKey)==="yes"){
 // GIS is loaded asynchronously; retry initialization briefly without launching repeated popups.
 let tries=0;
 const ready=setInterval(()=>{
  if(++tries>30||autoAuthAttempted){clearInterval(ready);return;}
  if(window.google?.accounts?.oauth2){clearInterval(ready);autoConnect();}
 },300);
 window.addEventListener("online",()=>{if(!accessToken)autoConnect();});
}

async function readLegacy(names){
 if(!accessToken||Date.now()>expiresAt)throw Error("Для обновления истории требуется войти через Google");
 const ranges=names.map(n=>"ranges="+encodeURIComponent(quote(n)+"!A1:E1000")).join("&");
 const data=await api("/values:batchGet?"+ranges+"&valueRenderOption=FORMATTED_VALUE");
 const out={};names.forEach((name,i)=>out[name]=data.valueRanges?.[i]?.values||[]);
 return out;
}
async function appendBody(date,weight,note){
 const range=encodeURIComponent(quote("Мои данные")+"!A:C");
 return api("/values/"+range+":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",{method:"POST",body:JSON.stringify({values:[[date,weight,note||""]]})});
}
window.gymLegacyApi={ready:()=>Boolean(accessToken&&Date.now()<expiresAt),read:readLegacy,appendBody};
let lastAuto=0;
async function autoRefresh(){
 if(!accessToken||Date.now()>expiresAt||document.hidden||Date.now()-lastAuto<60000)return;
 lastAuto=Date.now();await syncNow();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void autoRefresh()});
window.addEventListener("online",()=>{void autoRefresh()});
setInterval(()=>{void autoRefresh()},90000);

window.gymSheetDeleted=markDelete;
window.gymSheetChanged=()=>{if(accessToken)writeQueue=writeQueue.then(()=>syncNow()).catch(()=>{});};
window.gymSheetSync=syncNow;
$("connectSheets").addEventListener("click",connect);
$("syncSheets").addEventListener("click",syncNow);
$("inspectSheets").addEventListener("click",inspect);
$("previewLegacy").addEventListener("click",previewLegacy);
$("copyLegacy").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(legacyCopy);status("✓ Структура скопирована. Вставь её в чат.");}catch(e){status("Ошибка копирования: "+e.message)}});
})();