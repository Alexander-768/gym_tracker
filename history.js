/* Read-only historical Sheets viewer + body weight log. User data is never committed to GitHub. */
(() => {
"use strict";
const $=id=>document.getElementById(id);
const GROUPS=["Руки","Спина и плечи","Грудь","Ноги"];
const ALL="Все";
let activeGroup=ALL,legacy={},ready=false;
const escapeHtml=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=n=>Number(n).toLocaleString("ru-RU",{maximumFractionDigits:2});
const cacheKey="gym_legacy_cache_v1";
function parseNum(v){if(v===null||v===undefined||String(v).trim()==="")return null;const n=Number(String(v).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:null}
function dateISO(v){
 if(v===null||v===undefined||v==="")return "";
 const t=String(v).trim();
 if(/^\d{4}-\d{2}-\d{2}/.test(t))return t.slice(0,10);
 const d=t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
 if(d)return d[3]+"-"+d[2].padStart(2,"0")+"-"+d[1].padStart(2,"0");
 const n=parseNum(t);
 if(n!==null&&n>=30000&&n<90000)return new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000).toISOString().slice(0,10);
 return "";
}
function prettyDate(d){if(!d)return "Без даты";const p=d.split("-");return p[2]+"."+p[1]+"."+p[0]}
function parseTab(name,values){
 if(name==="Другое")return (values||[]).slice(1).map((r,i)=>({id:"misc:"+(i+2),category:"Другое",row:i+2,date:dateISO(r[0]),exercise:"Калории и заметки",weight:null,reps:null,note:[r[1],r[2]].filter(x=>x!==null&&x!==undefined&&String(x).trim()).join(" · "),source:"sheets"})).filter(x=>x.note);
 if(name==="Мои данные")return (values||[]).slice(1).map((r,i)=>({
  id:"body:"+name+":"+(i+2),row:i+2,date:dateISO(r[0]),weight:parseNum(r[1]),note:String(r[2]??"")
 })).filter(x=>x.weight!==null&&x.weight>=20&&x.weight<=350);
 return (values||[]).slice(1).map((r,i)=>({
  id:"legacy:"+name+":"+(i+2),category:name,row:i+2,date:dateISO(r[0]),
  exercise:String(r[1]??"").trim()||"Без названия",weight:parseNum(r[2]),reps:parseNum(r[3]),
  note:String(r[4]??"").trim(),source:"sheets"
 })).filter(x=>x.exercise!=="Без названия"||x.weight!==null||x.reps!==null||x.note);
}
function localWorkouts(){
 const raw=window.gymEntries?.()||[];
 return raw.filter(e=>e&&e.exercise).map(e=>({...e,category:e.category||"Без группы",weight:parseNum(e.weight),reps:parseNum(e.reps),source:"app"}));
}
function workouts(){return [...[...GROUPS,"Другое"].flatMap(g=>parseTab(g,legacy[g]||[])),...localWorkouts()]}
function loadCache(){try{const d=JSON.parse(localStorage.getItem(cacheKey)||"{}");if(d?.tabs&&typeof d.tabs==="object")legacy=d.tabs;}catch{}}
function saveCache(){try{localStorage.setItem(cacheKey,JSON.stringify({savedAt:Date.now(),tabs:legacy}))}catch{}}
function chart(points,unit="кг"){
 const sorted=points.filter(x=>x.date&&Number.isFinite(x.weight)).sort((a,b)=>a.date.localeCompare(b.date));
 if(!sorted.length)return '<div class="empty">Нет датированных записей для графика</div>';
 const daily=new Map();for(const x of sorted)daily.set(x.date,x.weight);
 const data=[...daily].map(([date,weight])=>({date,weight}));
 const min=Math.min(...data.map(x=>x.weight)),max=Math.max(...data.map(x=>x.weight));
 const padding=Math.max((max-min)*.12,unit==="кг"?1:.5);
 const low=Math.max(0,min-padding),high=max+padding;
 const width=335,left=13,right=322,top=10,bottom=132;
 const xx=i=>data.length===1?(left+right)/2:left+i*(right-left)/(data.length-1);
 const yy=v=>bottom-(v-low)/(high-low)*(bottom-top);
 const coords=data.map((p,i)=>xx(i)+","+yy(p.weight)).join(" ");
 return '<svg class="chart-svg" viewBox="0 0 335 145" role="img" aria-label="График прогресса"><line x1="13" y1="132" x2="322" y2="132" stroke="#354357"/><polyline points="'+coords+'" fill="none" stroke="#6ee4b0" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'+data.map((p,i)=>'<circle cx="'+xx(i)+'" cy="'+yy(p.weight)+'" r="'+(i===data.length-1?4.3:2.3)+'" fill="#6ee4b0"/>').join("")+'</svg><div class="legend"><span>'+prettyDate(data[0].date)+'</span><span>'+fmt(data[data.length-1].weight)+' '+unit+'</span><span>'+prettyDate(data[data.length-1].date)+'</span></div>';
}
function groupedList(items){
 return items.map(e=>{
  const weight=e.category==="Другое"?"":(e.weight!==null&&e.weight!==undefined?fmt(e.weight)+" кг":"вес не указан");
  const reps=e.reps!==null&&e.reps!==undefined?fmt(e.reps)+" повт.":"повт. не указаны";
  const text=(e.note?" · "+escapeHtml(e.note):"");
  return '<div class="history-record"><div class="row"><b>'+escapeHtml(e.exercise)+'</b><strong style="margin-left:auto;white-space:nowrap">'+weight+'</strong></div><small>'+prettyDate(e.date)+(e.category==="Другое"?"":' · '+reps+(e.sets?" · "+fmt(e.sets)+" подх.":""))+text+'</small>'+(e.source==="app"?'<small>Запись приложения</small>':'')+'</div>';
 }).join("")||'<div class="empty">Нет записей в этой группе</div>';
}
function renderGroups(){
 const all=workouts();
 $("legacyCount").textContent=all.length+" записей";
 const categories=[ALL,...GROUPS,"Другое","Без группы"];
 $("categoryChips").innerHTML=categories.map(g=>'<button data-group="'+escapeHtml(g)+'" class="'+(g===activeGroup?"active":"")+'">'+escapeHtml(g)+(g===ALL?" · "+all.length:"")+'</button>').join("");
 const subset=activeGroup===ALL?all:all.filter(x=>x.category===activeGroup);
 const names=[...new Set(subset.map(x=>x.exercise))].sort((a,b)=>a.localeCompare(b,"ru"));
 const selected=$("libraryExercise").value;
 $("libraryExercise").innerHTML='<option value="">Все упражнения</option>'+names.map(n=>'<option value="'+escapeHtml(n)+'">'+escapeHtml(n)+'</option>').join("");
 if(names.includes(selected))$("libraryExercise").value=selected;
 const q=$("libraryExercise").value;
 const filtered=subset.filter(x=>!q||x.exercise===q).sort((a,b)=>b.date.localeCompare(a.date)||Number(b.row||0)-Number(a.row||0));
 const graphical=filtered.filter(x=>x.weight!==null&&x.weight>=0&&x.weight<=500);
 $("libraryChart").innerHTML=chart(graphical);
 $("libraryRows").innerHTML='<div class="muted" style="margin-bottom:8px">Записей: '+filtered.length+'. Пустые поля исходной таблицы сохранены без догадок.</div><div class="scroll-card">'+groupedList(filtered)+'</div>';
}
function renderBody(){
 const a=parseTab("Мои данные",legacy["Мои данные"]||[]).sort((x,y)=>x.date.localeCompare(y.date));
 const first=a[0],last=a[a.length-1];
 $("bodyLatest").textContent=last?fmt(last.weight):"—";
 $("bodyFirst").textContent=first?fmt(first.weight):"—";
 $("bodyDiff").textContent=first&&last?(last.weight-first.weight>0?"+":"")+fmt(last.weight-first.weight):"—";
 $("bodyChart").innerHTML=chart(a);
 $("bodyRows").innerHTML=a.length?[...a].reverse().map(e=>'<div class="history-record"><div class="row"><span>'+prettyDate(e.date)+'</span><strong style="margin-left:auto">'+fmt(e.weight)+' кг</strong></div>'+(e.note?'<small>'+escapeHtml(e.note)+'</small>':"")+'</div>').join(""):'<div class="empty">История веса тела появится после подключения Google Sheets</div>';
}
function render(){renderGroups();renderBody();window.dispatchEvent(new Event("gym-history-updated"))}
function setSummary(text){const el=$("legacyCount");if(el)el.title=text}
async function fetchLive(){
 if(!window.gymLegacyApi?.ready?.())return;
 const names=["Мои данные",...GROUPS,"Другое"];
 try{
  const data=await window.gymLegacyApi.read(names);
  for(const name of names)if(Array.isArray(data[name]))legacy[name]=data[name];
  saveCache();render();setSummary("История обновлена из Google Sheets");
 }catch(err){setSummary("Показан локальный кеш. "+err.message);}
}
async function onBodySave(event){
 event.preventDefault();
 const weight=parseNum($("bodyWeight").value),date=$("bodyDate").value,note=$("bodyNote").value.trim();
 if(!date||weight===null||weight<20||weight>350){$("bodyStatus").textContent="Проверь дату и вес";return;}
 if(!window.gymLegacyApi?.ready?.()){$("bodyStatus").textContent="Нужно подключить Google в настройках. Запись не сохранена.";return;}
 const button=$("bodyForm").querySelector('button[type="submit"]');button.disabled=true;
 $("bodyStatus").textContent="Записываю в Google Sheets...";
 try{
  const [year,month,day]=date.split("-");
  await window.gymLegacyApi.appendBody(day+"."+month+"."+year,weight,note);
  $("bodyWeight").value="";$("bodyNote").value="";
  await fetchLive();
  $("bodyStatus").textContent="✓ Вес записан в Google Sheets и появился в истории";
 }catch(err){$("bodyStatus").textContent="Ошибка: "+err.message+"; повторную отправку делай только после проверки таблицы."}
 finally{button.disabled=false;}
}
$("categoryChips").addEventListener("click",e=>{const b=e.target.closest("[data-group]");if(!b)return;activeGroup=b.dataset.group;$("libraryExercise").value="";renderGroups()});
$("libraryExercise").addEventListener("change",renderGroups);
$("bodyForm").addEventListener("submit",onBodySave);
const dt=new Date();$("bodyDate").value=[dt.getFullYear(),String(dt.getMonth()+1).padStart(2,"0"),String(dt.getDate()).padStart(2,"0")].join("-");
window.gymHistoryData=()=>({workouts:workouts(),body:parseTab("Мои данные",legacy["Мои данные"]||[]),notes:parseTab("Другое",legacy["Другое"]||[])});
loadCache();render();
window.addEventListener("gym-data-changed",render);
window.addEventListener("gym-google-connected",fetchLive);
window.addEventListener("gym-google-sync",fetchLive);
window.addEventListener("focus",()=>{if(window.gymLegacyApi?.ready?.())void fetchLive();});
window.addEventListener("online",()=>{if(window.gymLegacyApi?.ready?.())void fetchLive();});
setInterval(()=>{if(window.gymLegacyApi?.ready?.()&&!document.hidden)void fetchLive()},120000);
})();