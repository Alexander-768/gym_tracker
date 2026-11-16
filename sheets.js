/* Gym Tracker ↔ Google Sheets (Google Identity Services token flow). Tokens are memory-only. */
(() => {
"use strict";
const CLIENT_ID="255537560032-4a6lqi2quocorn0jn0sl5tqlerjfl4br.apps.googleusercontent.com";
const SPREADSHEET_ID="1IrLRJVWarQJt-ALBO4GObIJrEopxfnBa4I9xRcQ2XRs";
const TAB="gym_tracker_app";
const SYNC_VERSION="2026-11-16.11";
window.gymSyncVersion=SYNC_VERSION;
const HEADERS=["id","date","exercise","weight_kg","reps","sets","note","created_at","updated_at","deleted_at","category"];
const SCOPE="https://www.googleapis.com/auth/spreadsheets";
const $=id=>document.getElementById(id);
let accessToken=null,expiresAt=0,client=null,busy=false,needsResync=false,writeQueue=Promise.resolve();
const status=msg=>{if($("sheetsStatus"))$("sheetsStatus").textContent=msg;};
function publishSync(state,message){
 window.gymSyncState={state,message:message+" · синхр. v11",at:Date.now()};
 window.dispatchEvent(new CustomEvent("gym-sync-status",{detail:window.gymSyncState}));
 status(window.gymSyncState.message);
}
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
const serialize=e=>[e.id,e.date,e.exercise,e.weight,e.reps==null?"":e.reps,e.sets,e.note||"",e.createdAt||Date.now(),e.updatedAt||Date.now(),e.deletedAt||"",e.category||"Без группы"];
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
 // Explicit cell coordinates instead of values.append: Sheets may detect a
 // table starting at column C and append records to C:H.
 const names=MIRROR_TABS;
 const ranges=names.map(name=>"ranges="+encodeURIComponent(quote(name)+"!A1:Z")).join("&");
 const response=await api("/values:batchGet?"+ranges+"&valueRenderOption=UNFORMATTED_VALUE");
 const tabs={};
 names.forEach((name,i)=>tabs[name]=response.valueRanges?.[i]?.values||[]);
 const writes=[],warnings=[],verifiedWrites=[];
 for(const name of names){
  const grid=tabs[name],markerCol=name==="Мои данные"?3:5;
  const endCol=name==="Мои данные"?"D":"F";
  const header=String(grid[0]?.[markerCol]??"").trim();
  if(header && header!=="gym_tracker_id")throw Error("В листе «"+name+"» столбец "+endCol+" уже занят. Сохраняем существующие данные, зеркало остановлено.");
  if(!header)writes.push({range:quote(name)+"!"+endCol+"1",values:[["gym_tracker_id"]]});
  const existing=new Map();
  for(let i=1;i<grid.length;i++){
   const row=grid[i]||[];
   for(let col=0;col<row.length;col++){
    const value=String(row[col]??"").trim();
    if(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)){
     if(!existing.has(value))existing.set(value,[]);
     existing.get(value).push({row:i+1,col,cells:row});
    }
   }
  }
  // Include every occupied column so notes or previously shifted rows
  // never get overwritten. This may intentionally leave blank gaps.
  let lastUsed=1;
  for(let i=0;i<grid.length;i++)
   if((grid[i]||[]).some(v=>v!==""&&v!==null&&v!==undefined))lastUsed=i+1;
  let nextRow=Math.max(2,lastUsed+1);
  for(const e of records){
   if(!e?.id)continue;
   const target=e.category==="Общий вес"?"Мои данные":MIRROR_TABS.includes(e.category)?e.category:null;
   const matching=existing.get(e.id)||[];
   const appropriate=matching.find(m=>m.col===markerCol);
   const iso=String(e.date||"");
   const d=/^\d{4}-\d{2}-\d{2}$/.test(iso)?iso.slice(8,10)+"."+iso.slice(5,7)+"."+iso.slice(0,4):iso;
   const active=target===name&&!Number(e.deletedAt||0);
   const newValues=active?(name==="Мои данные"
       ?[d,Number(e.weight),e.note||"",e.id]
       :[d,e.exercise||"",Number(e.weight),e.reps==null?"":Number(e.reps),e.note||"",e.id])
       :(name==="Мои данные"?["","","",e.id]:["","","","","",e.id]);
   if(appropriate){
    const row=appropriate.row;
    const old=appropriate.cells;
    const same=newValues.every((v,i)=>{
      const oldValue=old[i];
      if((v===""||v==null)&&(oldValue===""||oldValue==null))return true;
      if(i===0&&typeof oldValue==="number"&&oldValue>30000&&oldValue<90000){
       const stored=new Date(Date.UTC(1899,11,30)+Math.floor(oldValue)*86400000).toISOString().slice(0,10);
       if(stored===iso)return true;
      }
      return String(v)===String(oldValue??"");
    });
    if(!same)writes.push({range:quote(name)+"!A"+row+":"+endCol+row,values:[newValues]});
   }else if(matching.length){
    // Already mirrored by an earlier buggy append in a shifted column.
    // Do not append a sixth duplicate and do not overwrite malformed rows.
    if(target===name)warnings.push(name+": обнаружены ранее сдвинутые строки ("+e.id+"). Автоматически не исправлены.");
   }else if(active){
    writes.push({range:quote(name)+"!A"+nextRow+":"+endCol+nextRow,values:[newValues]});
    verifiedWrites.push({name,row:nextRow,id:e.id,markerCol});
    existing.set(e.id,[{row:nextRow,col:markerCol,cells:newValues}]);
    nextRow++;
   }
  }
 }
 if(writes.length){
  // Ensure each sheet has enough allocated rows before addressing exact cells.
  const properties=await sheets(),resize=[];
  for(const name of names){
   const meta=properties.find(x=>x.title===name);
   if(!meta)throw Error("Не найден лист: "+name);
   const maxRow=Math.max(0,...writes.filter(w=>w.range.startsWith(quote(name)+"!")).map(w=>Number(w.range.match(/\d+$/)?.[0]||0)));
   const oldCount=Number(meta.gridProperties?.rowCount||0);
   if(maxRow>oldCount)resize.push({updateSheetProperties:{properties:{sheetId:meta.sheetId,gridProperties:{rowCount:Math.max(maxRow,oldCount+100)}},fields:"gridProperties.rowCount"}});
  }
  if(resize.length)await api(":batchUpdate",{method:"POST",body:JSON.stringify({requests:resize})});
  await api("/values:batchUpdate",{method:"POST",body:JSON.stringify({valueInputOption:"USER_ENTERED",data:writes})});
  // Confirm new records landed in A:F (or A:D for body).
  if(verifiedWrites.length){
   const request=verifiedWrites.map(w=>"ranges="+encodeURIComponent(quote(w.name)+"!A"+w.row+":"+(w.markerCol===3?"D":"F")+w.row)).join("&");
   const check=await api("/values:batchGet?"+request+"&valueRenderOption=UNFORMATTED_VALUE");
   verifiedWrites.forEach((w,i)=>{
    const cells=check.valueRanges?.[i]?.values?.[0]||[];
    if(String(cells[w.markerCol]||"")!==String(w.id))
     throw Error("Контроль записи не пройден: "+w.name+", строка "+w.row+". Вкладка не подтверждена.");
   });
  }
 }
 return warnings;
}
async function syncNow(){
 if(!accessToken||Date.now()>expiresAt){publishSync("auth","Google не подключён. Записи сохранены локально и ждут синхронизации.");return false;} if(busy){needsResync=true;return false;}
 busy=true;$("syncSheets").disabled=true;publishSync("syncing","Отправляю записи в Google Sheets...");
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
  // Canonical writes must succeed independently of legacy mirroring.
  publishSync("main-ok","Главный журнал Google Sheets обновлён. Проверяю привычные листы...");
  let mirrorError=null;
  let mirrorWarnings=[];
  try{mirrorWarnings=await mirrorRecords([...merged.values()]);}
  catch(e){mirrorError=e;}
  localStorage.setItem(tombstoneKey,JSON.stringify(del));
  if(typeof window.gymRefresh==="function")await window.gymRefresh();
  if(mirrorError){
   publishSync("partial","✓ gym_tracker_app обновлён, но ошибка в привычных листах: "+mirrorError.message);
  }else{
   publishSync(mirrorWarnings.length?"partial":"success",mirrorWarnings.length?"✓ Новые записи синхронизированы. Внимание: "+mirrorWarnings[0]:"✓ Google Sheets синхронизирован: "+new Date().toLocaleTimeString("ru-RU"));
  }
  window.dispatchEvent(new Event("gym-google-sync"));
  return !mirrorError;
 }catch(e){publishSync("error","Ошибка Google Sheets: "+e.message);return false}finally{busy=false;$("syncSheets").disabled=false;if(needsResync){needsResync=false;void syncNow();}}
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
   publishSync("syncing","Доступ к Google получен. Синхронизирую...");
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
window.gymSheetConnect=connect;
window.gymSheetReady=()=>Boolean(accessToken&&Date.now()<expiresAt);
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
 const ranges=names.map(n=>"ranges="+encodeURIComponent(quote(n)+"!A1:F5000")).join("&");
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
window.gymSheetChanged=()=>{
 if(!accessToken||Date.now()>expiresAt){publishSync("auth","Запись сохранена локально — подключи Google для отправки.");return;}
 writeQueue=writeQueue.then(()=>syncNow()).catch(e=>publishSync("error","Ошибка синхронизации: "+e.message));
};
window.gymSheetSync=syncNow;
$("connectSheets").addEventListener("click",connect);
$("syncSheets").addEventListener("click",syncNow);
$("inspectSheets").addEventListener("click",inspect);
$("previewLegacy").addEventListener("click",previewLegacy);
$("copyLegacy").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(legacyCopy);status("✓ Структура скопирована. Вставь её в чат.");}catch(e){status("Ошибка копирования: "+e.message)}});
})();