/* Gym Tracker ↔ Google Sheets (Google Identity Services token flow). Tokens are memory-only. */
(() => {
"use strict";
const CLIENT_ID="255537560032-4a6lqi2quocorn0jn0sl5tqlerjfl4br.apps.googleusercontent.com";
const SPREADSHEET_ID="1IrLRJVWarQJt-ALBO4GObIJrEopxfnBa4I9xRcQ2XRs";
const TAB="gym_tracker_app";
const SYNC_VERSION="2026-11-24.25";
window.gymSyncVersion=SYNC_VERSION;
const HEADERS=["id","date","exercise","weight_kg","reps","sets","note","created_at","updated_at","deleted_at","category"];
const SCOPE="https://www.googleapis.com/auth/spreadsheets";
const $=id=>document.getElementById(id);
let accessToken=null,expiresAt=0,client=null,busy=false,needsResync=false,writeQueue=Promise.resolve();
const status=msg=>{if($("sheetsStatus"))$("sheetsStatus").textContent=msg;};
function publishSync(state,message){
 window.gymSyncState={state,message:message+" · синхр. v25",at:Date.now()};
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
 const toNum=v=>v===null||v===undefined||v===""?null:Number(v);
 return {id:String(id),date:String(date||""),exercise:String(exercise||""),weight:toNum(weight),reps:toNum(reps),sets:toNum(sets),note:String(note||""),createdAt:Number(created)||0,updatedAt:Number(updated)||0,deletedAt:Number(deleted)||0,category:String(category||"Без группы"),row:index};
}
const serialize=e=>[e.id,e.date||"",e.exercise||"",e.weight==null?"":e.weight,e.reps==null?"":e.reps,e.sets==null?"":e.sets,e.note||"",e.createdAt||1,e.updatedAt||1,e.deletedAt||"",e.category||"Без группы"];
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
 if(!accessToken||Date.now()>expiresAt){publishSync("auth","Google не подключён. Записи сохранены локально и ждут синхронизации.");return false;} if(busy){needsResync=true;return false;}
 busy=true;$("syncSheets").disabled=true;publishSync("syncing","Отправляю записи в Google Sheets...");
 try{
  await ensureTab();
  const rr=(await rows()).map(remoteRecord),rmap=new Map(rr.map(x=>[x.id,x]));
  const local=await getLocal(),lmap=new Map(local.map(x=>[x.id,x]));
  // Migration fence prevents stale test entries on a second device from
  // being resurrected after the canonical journal was replaced.
  const migrationFence=Math.max(0,...rr.filter(e=>String(e.id).startsWith("legacy:")).map(e=>Number(e.createdAt)||0));
  const staleLocal=local.filter(e=>migrationFence>1000000000000&&!rmap.has(e.id)&&!String(e.id).startsWith("legacy:")&&Number(e.createdAt||0)<migrationFence);
  const staleIds=new Set(staleLocal.map(e=>e.id));
  const del=tombstones();
  for(const [id,at] of Object.entries(del))
   if(migrationFence>1000000000000&&!rmap.has(id)&&Number(at)<migrationFence)delete del[id];
  const merged=new Map();
  for(const x of rr)merged.set(x.id,x);
  for(const x of local){
   if(staleIds.has(x.id))continue;
   const old=merged.get(x.id);
   // A deletion is terminal for a record ID, even if another device has a stale edit.
   if(!old || (!Number(old.deletedAt||0)&&Number(x.deletedAt||0)) ||
      (Boolean(Number(old.deletedAt||0))===Boolean(Number(x.deletedAt||0))&&Number(x.updatedAt)>Number(old.updatedAt)))merged.set(x.id,x);
  }
  for(const [id,at] of Object.entries(del)){
   const old=merged.get(id);
   if(!old||!Number(old.deletedAt||0)||Number(at)>Number(old.deletedAt||0)){
    merged.set(id,{...(old||{id,date:"",exercise:"",weight:null,reps:null,sets:null,note:"",category:"Без группы",createdAt:Number(at)}),deletedAt:Number(at),updatedAt:Math.max(Number(at),Number(old?.updatedAt||0))});
   }
  }
  const toSave=[],toDelete=[...staleIds],updates=[],appends=[];
  for(const e of merged.values()){
   const isDeleted=Number(e.deletedAt)>0;
   const localOld=lmap.get(e.id);
   if(isDeleted){
    // Retain the complete tombstoned record locally until and after upload.
    if(!localOld||!Number(localOld.deletedAt||0)||Number(localOld.deletedAt)!==Number(e.deletedAt)||Number(localOld.updatedAt||0)<Number(e.updatedAt||0))toSave.push({...e,row:undefined});
    if(Number(del[e.id]||0)<Number(e.deletedAt||0))del[e.id]=Number(e.deletedAt);
   }
   else if(!localOld || Number(localOld.updatedAt)<Number(e.updatedAt))toSave.push({...e,deletedAt:undefined,row:undefined});
   const remoteOld=rmap.get(e.id);
   if(!remoteOld)appends.push(serialize(e));
   else if(Number(remoteOld.updatedAt)<Number(e.updatedAt)||Number(remoteOld.deletedAt||0)!==Number(e.deletedAt||0))updates.push({range:quote(TAB)+"!A"+remoteOld.row+":K"+remoteOld.row,values:[serialize(e)]});
  }
  if(updates.length)await api("/values:batchUpdate",{method:"POST",body:JSON.stringify({valueInputOption:"RAW",data:updates})});
  if(appends.length)await api("/values/"+encodeURIComponent(quote(TAB)+"!A:K")+":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",{method:"POST",body:JSON.stringify({values:appends})});
  if(toSave.length||toDelete.length)await saveLocal(toSave,toDelete);
  // gym_tracker_app is the sole source of truth. Old tabs are archives.
  localStorage.setItem(tombstoneKey,JSON.stringify(del));
  if(typeof window.gymRefresh==="function")await window.gymRefresh();
  publishSync("success","✓ gym_tracker_app синхронизирован: "+new Date().toLocaleTimeString("ru-RU"));
  window.dispatchEvent(new Event("gym-google-sync"));
  return true;
 }catch(e){publishSync("error","Ошибка Google Sheets: "+e.message);return false}finally{busy=false;$("syncSheets").disabled=false;if(needsResync){needsResync=false;void syncNow();}}
}


const connectedBeforeKey="gym_google_previously_connected_v1";
const AUTO_RETRY_MS=10*60*1000;
let authRequestInFlight=false,lastSilentAttempt=0;
const tokenValid=()=>Boolean(accessToken&&Date.now()<expiresAt);
function setupClient(){
 if(client)return true;
 if(!window.google?.accounts?.oauth2)return false;
 client=google.accounts.oauth2.initTokenClient({
  client_id:CLIENT_ID,scope:SCOPE,
  error_callback:error=>{
   authRequestInFlight=false;
   publishSync("auth","Google не разрешил автоматический вход ("+(error?.type||"окно заблокировано")+"). Нажми «Подключить Google» в настройках.");
  },
  callback:async response=>{
   authRequestInFlight=false;
   if(response.error||!response.access_token){
    publishSync("auth","Требуется повторное подключение Google: "+(response.error||"нет токена"));
    return;
   }
   accessToken=response.access_token;
   lastSilentAttempt=0;
   publishSync("syncing","Доступ к Google получен. Синхронизирую...");
   expiresAt=Date.now()+(Number(response.expires_in)||3500)*1000-60000;
   localStorage.setItem(connectedBeforeKey,"yes");
   $("connectSheets").textContent="↻ Обновить доступ Google";
   $("syncSheets").disabled=false;
   try{
    await syncNow();
    window.dispatchEvent(new Event("gym-google-connected"));
   }catch(err){status("Ошибка при загрузке данных: "+err.message)}
  }
 });
 return true;
}
function requestToken(automatic=false){
 if(authRequestInFlight||automatic&&tokenValid())return;
 if(!setupClient()){
  publishSync("auth","Не загрузилась авторизация Google. Проверь интернет или подключись в настройках.");
  return;
 }
 authRequestInFlight=true;
 if(automatic)publishSync("syncing","Восстанавливаю подключение Google автоматически...");
 try{client.requestAccessToken({prompt:automatic?"none":""});}
 catch(err){authRequestInFlight=false;publishSync("auth","Не удалось подключиться автоматически: "+err.message+". Открой настройки.");}
}
function connect(){requestToken(false);}
window.gymSheetConnect=connect;
window.gymSheetReady=tokenValid;
function autoConnect(force=false){
 if(tokenValid()||authRequestInFlight||!navigator.onLine||localStorage.getItem(connectedBeforeKey)!=="yes")return;
 if(!window.google?.accounts?.oauth2)return;
 if(!force&&Date.now()-lastSilentAttempt<AUTO_RETRY_MS)return;
 lastSilentAttempt=Date.now();
 requestToken(true);
}
// Silent reconnection is best-effort; a browser may require the user to click.
// Only the previous-consent flag persists; OAuth access tokens stay in memory.
if(localStorage.getItem(connectedBeforeKey)==="yes"){
 let tries=0;
 const ready=setInterval(()=>{
  if(++tries>60||tokenValid()){clearInterval(ready);return;}
  if(window.google?.accounts?.oauth2){clearInterval(ready);autoConnect(true);}
 },250);
}
window.gymLegacyApi={ready:tokenValid};
let lastAuto=0;
async function autoRefresh(){
 if(document.hidden||!navigator.onLine)return;
 if(!tokenValid()){autoConnect();return;}
 if(Date.now()-lastAuto<60000)return;
 lastAuto=Date.now();
 await syncNow();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void autoRefresh()});
window.addEventListener("online",()=>{void autoRefresh()});
window.addEventListener("focus",()=>{void autoRefresh()});
setInterval(()=>{void autoRefresh()},90000);

window.gymSheetDeleted=markDelete;
window.gymSheetChanged=()=>{
 if(!tokenValid()){publishSync("auth","Запись сохранена локально. Пытаюсь подключить Google...");autoConnect();return;}
 writeQueue=writeQueue.then(()=>syncNow()).catch(e=>publishSync("error","Ошибка синхронизации: "+e.message));
};
window.gymSheetSync=syncNow;
$("connectSheets").addEventListener("click",connect);
$("syncSheets").addEventListener("click",syncNow);
})();