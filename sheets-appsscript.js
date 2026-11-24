/* Gym Tracker Apps Script hosting adapter. Requires owner-only Web App deployment.
   No browser OAuth popups, public API, or persisted credentials. */
(() => {
"use strict";
const $=id=>document.getElementById(id);
const HAS_BRIDGE=Boolean(window.google?.script?.run);
let busy=false,resync=false,ready=false;
const tombstoneKey="gym_tracker_tombstones_v1";
const quoteStatus=(state,message)=>{
 window.gymSyncState={state,message,at:Date.now()};
 if($("sheetsStatus"))$("sheetsStatus").textContent=message;
 window.dispatchEvent(new CustomEvent("gym-sync-status",{detail:window.gymSyncState}));
};
const call=(method,...args)=>new Promise((resolve,reject)=>{
 if(!HAS_BRIDGE){reject(Error("Открой приложение через приватную ссылку Apps Script."));return}
 window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args);
});
async function localEntries(){
 const db=await new Promise((ok,no)=>{const q=indexedDB.open("gym-tracker-v1",1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});
 try{return await new Promise((ok,no)=>{const tx=db.transaction("entries","readonly");const q=tx.objectStore("entries").getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)})}finally{db.close()}
}
async function localSave(entries){
 if(!entries.length)return;
 const db=await new Promise((ok,no)=>{const q=indexedDB.open("gym-tracker-v1",1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});
 try{await new Promise((ok,no)=>{const tx=db.transaction("entries","readwrite"),store=tx.objectStore("entries");entries.forEach(e=>store.put(e));tx.oncomplete=ok;tx.onerror=()=>no(tx.error)})}finally{db.close()}
}
function tombstones(){try{return JSON.parse(localStorage.getItem(tombstoneKey)||"{}")}catch{return {}}}
function winner(a,b) {
 if(!a)return b;if(!b)return a;
 const ad=Number(a.deletedAt||0)>0,bd=Number(b.deletedAt||0)>0;
 if(ad!==bd)return ad?a:b; // deletion is terminal, never resurrected
 return Number(a.updatedAt||0)>=Number(b.updatedAt||0)?a:b;
}
async function syncNow(){
 if(busy){resync=true;return false}
 if(!HAS_BRIDGE){quoteStatus("error","Apps Script недоступен. Используй приватную ссылку.");return false}
 busy=true;quoteStatus("syncing","Загружаю историю из Google Sheets...");
 try{
  const remote=await call("gymSnapshot"),local=await localEntries();
  const remoteMap=new Map(remote.map(e=>[e.id,e])),localMap=new Map(local.map(e=>[e.id,e]));
  if(remoteMap.size!==remote.length)throw Error("Дублирующиеся ID в Google Sheets");
  const merged=new Map(remote.map(e=>[e.id,e]));
  for(const l of local)merged.set(l.id,winner(merged.get(l.id),l));
  for(const [id,at] of Object.entries(tombstones())){
   const old=merged.get(id);
   if(old&&(!Number(old.deletedAt||0)||Number(at)>Number(old.deletedAt||0)))
    merged.set(id,{...old,deletedAt:Number(at),updatedAt:Math.max(Number(at),Number(old.updatedAt)||0)});
  }
  const changes=[],toLocal=[];
  for(const e of merged.values()){
   const r=remoteMap.get(e.id),l=localMap.get(e.id);
   if(!l||Number(l.updatedAt||0)<Number(e.updatedAt||0)||!Number(l.deletedAt||0)&&Number(e.deletedAt||0))
    toLocal.push({...e,row:undefined});
   if(!r||Number(r.updatedAt||0)<Number(e.updatedAt||0)||!Number(r.deletedAt||0)&&Number(e.deletedAt||0))
    changes.push({...e,expectedUpdatedAt:r?Number(r.updatedAt||0):null,expectedDeletedAt:r?Number(r.deletedAt||0):null});
  }
  // Cloud first, then local. On error, local edits are retained for retry.
  if(changes.length){
   for(let i=0;i<changes.length;i+=300){
    const result=await call("gymApplyChanges",changes.slice(i,i+300));
    if(result.conflicts?.length)throw Error("Некоторые записи изменились на другом устройстве. Повтори синхронизацию.");
   }
  }
  await localSave(toLocal);
  ready=true;
  await window.gymRefresh?.();
  quoteStatus("success","✓ Google Sheets синхронизирован: "+new Date().toLocaleTimeString("ru-RU"));
  window.dispatchEvent(new Event("gym-google-sync"));
  return true;
 }catch(e){quoteStatus("error","Ошибка синхронизации: "+(e.message||e));return false}
 finally{busy=false;if(resync){resync=false;void syncNow()}}
}
window.gymSheetConnect=syncNow;
window.gymSheetSync=syncNow;
window.gymSheetReady=()=>ready;
window.gymLegacyApi={ready:()=>ready};
window.gymSheetChanged=()=>{void syncNow()};
window.gymSheetDeleted=id=>{const t=tombstones();t[id]=Date.now();localStorage.setItem(tombstoneKey,JSON.stringify(t))};
$("connectSheets")?.addEventListener("click",()=>void syncNow());
$("syncSheets")?.addEventListener("click",()=>void syncNow());
$("inspectSheets")?.addEventListener("click",()=>{});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void syncNow()});
window.addEventListener("online",()=>void syncNow());
setInterval(()=>{if(!document.hidden&&navigator.onLine)void syncNow()},90000);
// Older index.html loads IndexedDB asynchronously. Wait for its first successful init.
let attempts=0;
const initial=setInterval(()=>{
 if(typeof window.gymEntries==="function"&&window.gymEntries()&&(!HAS_BRIDGE||indexedDB)&&++attempts>=2){
  clearInterval(initial);void syncNow();
 }else if(++attempts>=40){clearInterval(initial);quoteStatus("error","Локальная база пока не готова. Обнови страницу.")}
},250);
})();