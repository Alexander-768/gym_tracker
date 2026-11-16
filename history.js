/* Unified workout and body history: IndexedDB mirror of gym_tracker_app only. */
(() => {
"use strict";
const $=id=>document.getElementById(id);
const rawEntries=()=>typeof window.gymEntries==="function"?(window.gymEntries()||[]):[];
function current(){
 const all=rawEntries().filter(e=>e&&e.id&&!Number(e.deletedAt||0));
 const parseNumber=v=>v===null||v===undefined||v===""?null:(Number.isFinite(Number(v))?Number(v):null);
 const cleaned=all.map(e=>({...e,weight:parseNumber(e.weight),reps:parseNumber(e.reps),source:"app"}));
 return {
   workouts:cleaned.filter(e=>e.category!=="Общий вес"&&e.category!=="Другое"&&e.exercise),
   body:cleaned.filter(e=>e.category==="Общий вес"&&e.weight!==null),
   notes:cleaned.filter(e=>e.category==="Другое").map(e=>({...e,note:e.note||e.exercise||""}))
 };
}
window.gymHistoryData=current;
function refresh(){
 const d=current(),badge=$("legacyCount");
 if(badge)badge.textContent=d.workouts.length+" записей";
 window.dispatchEvent(new Event("gym-history-updated"));
}
window.addEventListener("gym-data-changed",refresh);
window.addEventListener("gym-google-sync",refresh);
window.addEventListener("gym-google-connected",refresh);
})();