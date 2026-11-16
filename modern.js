/* Gym Tracker redesigned mobile UI. Reads existing indexed DB and authenticated Google Sheets data. */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const TABS=["Общий вес","Грудь","Ноги","Руки","Спина и плечи","Другое"];
const CACHE="gym_ui_active_tab_v2";
const icons={"Грудь":"◈","Ноги":"♧","Руки":"◉","Спина и плечи":"✦","Другое":"☷"};
let active=TABS.includes(localStorage.getItem(CACHE))?localStorage.getItem(CACHE):"Общий вес";
let detail=null,showAll=false,modal=null,lastStatus="",writing=false,settingsMode=false;
let root=$("modernApp");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nfmt=(v,d=1)=>Number(v).toLocaleString("ru-RU",{maximumFractionDigits:d});
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")};
const formatDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||"")?d.split("-").reverse().join("."):"Без даты";
const dnum=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const data=()=>window.gymHistoryData?.()||{workouts:[],body:[],notes:[]};
const isConnected=()=>Boolean(window.gymLegacyApi?.ready?.());
function ordered(records){return [...records].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||Number(b.updatedAt||0)-Number(a.updatedAt||0)||Number(b.row||0)-Number(a.row||0))}
function points(records){return [...records].filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date||"")&&dnum(x.weight)!==null&&Number(x.weight)>=0).sort((a,b)=>a.date.localeCompare(b.date))}
function chart(records,large=false,mode="last"){
 const ps=points(records);
 if(!ps.length)return '<div class="m-empty">Пока недостаточно данных для графика</div>';
 const daily=new Map();for(const e of ps)daily.set(e.date,mode==="max"?Math.max(Number(e.weight),daily.get(e.date)??-Infinity):Number(e.weight));
 const vals=[...daily].map(([date,weight])=>({date,weight}));
 const min=Math.min(...vals.map(v=>v.weight)),max=Math.max(...vals.map(v=>v.weight));
 const span=Math.max(max-min,0.8),lower=Math.max(0,min-span*.28),upper=max+span*.28;
 const left=36,right=321,top=15,bottom=158,w=340,h=180;
 const X=i=>vals.length===1?(left+right)/2:left+(right-left)*i/(vals.length-1);
 const Y=v=>bottom-(v-lower)/(upper-lower)*(bottom-top);
 const path=vals.map((v,i)=>(i?"L":"M")+X(i).toFixed(1)+" "+Y(v.weight).toFixed(1)).join(" ");
 const area=path+" L"+X(vals.length-1).toFixed(1)+" "+bottom+" L"+X(0).toFixed(1)+" "+bottom+" Z";
 const ticks=[0,1,2,3,4].map(i=>{const y=top+(bottom-top)*i/4,val=upper-(upper-lower)*i/4;return '<line x1="'+left+'" x2="'+right+'" y1="'+y+'" y2="'+y+'" class="m-grid"/>'+(large?'<text class="m-chart-label" x="2" y="'+(y+4)+'">'+nfmt(val,1)+'</text>':"")}).join("");
 return '<svg viewBox="0 0 '+w+' '+h+'" class="m-chart" style="height:'+(large?218:155)+'px" role="img" aria-label="Динамика показателя по датам"><defs><linearGradient id="mshade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#61ecaa" stop-opacity=".27"/><stop offset="100%" stop-color="#61ecaa" stop-opacity=".015"/></linearGradient></defs>'+ticks+'<path d="'+area+'" fill="url(#mshade)"/><path class="m-line" d="'+path+'"/>'+vals.map((v,i)=>'<circle cx="'+X(i)+'" cy="'+Y(v.weight)+'" r="'+(i===vals.length-1?4:2.4)+'" fill="#6cf0b4" stroke="#172b28" stroke-width="1.5"/>').join("")+'</svg><div class="m-chart-dates"><span>'+formatDate(vals[0].date)+'</span><span>'+formatDate(vals[vals.length-1].date)+'</span></div>';
}
function spark(records){
 const p=points(records),last=[...new Map(p.map(e=>[e.date,Number(e.weight)]))].slice(-12);
 if(!last.length)return '<span class="m-dim">Нет графика</span>';
 const weights=last.map(x=>x[1]),low=Math.min(...weights),high=Math.max(...weights),span=Math.max(high-low,1),coords=weights.map((w,i)=>[(i?i/(weights.length-1):0)*86,37-(w-low)/span*31]);
 const d=coords.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
 return '<svg viewBox="0 0 90 42" class="m-spark" aria-hidden="true"><path d="'+d+'" stroke="#67eeb1" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>';
}
function weightView(){
 const arr=ordered(data().body.filter(x=>Number.isFinite(x.weight))),latest=arr[0],first=arr[arr.length-1];
 const past=arr.find(x=>x.date && latest?.date && x.date<=new Date(new Date(latest.date+"T12:00:00").getTime()-7*86400000).toISOString().slice(0,10));
 const week=latest&&past?latest.weight-past.weight:null;
 const cls=week!==null&&week<0?"negative":"";
 return '<div class="m-hero"><div class="m-hero-kicker">Общий вес</div><div class="m-dim" style="margin-top:10px">Текущий показатель</div><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><div class="m-value">'+(latest?nfmt(latest.weight,2)+" кг":"—")+'</div>'+(week===null?"":'<div class="m-change '+cls+'">'+(week>0?"↑ +":week<0?"↓ ":"")+nfmt(week,2)+' кг<br>за 7 дней</div>')+'</div>'+chart(arr,true)+'</div>'+
 '<div class="m-section-head"><h2>Последние записи</h2><button class="m-link" data-action="toggle-history">'+(showAll?"Скрыть":"Все записи →")+'</button></div>'+
 (arr.length?arr.slice(0,showAll?arr.length:7).map((e,i)=>{const older=arr[i+1],diff=older?e.weight-older.weight:null;return '<div class="m-history-row"><span class="m-date-icon">▣</span><span class="m-history-date">'+formatDate(e.date)+'</span><span class="m-history-weight">'+nfmt(e.weight,2)+' кг</span><span class="m-history-delta '+(diff===null?"neutral":diff<0?"negative":"")+'">'+(diff===null?"—":(diff>0?"+":"")+nfmt(diff,2))+'</span></div>'}).join(""):'<div class="m-empty">Подключи Google в настройках, чтобы увидеть историю веса тела</div>')+
 '<button class="m-fab" data-action="add" aria-label="Добавить взвешивание">+</button>';
}
function groupRecords(group){return data().workouts.filter(e=>e.category===group&&e.exercise&&e.exercise!=="Без названия")}
function exerciseRecords(group,name){return groupRecords(group).filter(e=>e.exercise===name)}
function exerciseView(group){
 const records=groupRecords(group),names=[...new Set(records.map(e=>e.exercise))];
 names.sort((a,b)=>{const aa=ordered(exerciseRecords(group,a))[0],bb=ordered(exerciseRecords(group,b))[0];return (bb?.date||"").localeCompare(aa?.date||"")||a.localeCompare(b,"ru")});
 const valid=records.filter(e=>e.date),last=ordered(valid)[0];
 const icons=group==="Грудь"?"◈":group==="Ноги"?"♧":group==="Руки"?"◉":"✦";
 let cards=names.map(name=>{
  const hist=exerciseRecords(group,name),recent=ordered(hist)[0],current=hist.filter(e=>dnum(e.weight)!==null&&dnum(e.reps)!==null).sort((a,b)=>(b.date||"").localeCompare(a.date||""))[0]||recent;
  return '<button class="m-exercise" data-exercise="'+esc(name)+'"><div class="m-ex-top"><div class="m-ex-icon">'+icons+'</div><div class="m-ex-content"><div class="m-ex-title">'+esc(name)+'</div><div class="m-ex-sub">Последний результат'+(current?.date?": "+formatDate(current.date):"")+'</div><div class="m-ex-metric">'+(current&&dnum(current.weight)!==null?nfmt(current.weight,2)+" кг":"—")+' <span class="m-dim">× '+(current&&dnum(current.reps)!==null?nfmt(current.reps,0):"—")+' повт.</span></div></div><div class="m-ex-side">'+spark(hist)+'<span class="m-ex-next">История ›</span></div></div></button>';
 }).join("");
 return '<div class="m-group-head"><div><h2>'+esc(group)+'</h2><div class="m-group-sub">'+names.length+' упражнений'+(last?.date?" · последнее: "+formatDate(last.date):"")+'</div></div><button class="m-add-sm" data-action="add">+ Добавить</button></div>'+(cards||'<div class="m-empty">Пока нет упражнений в этой группе</div>')+'<button class="m-fab" data-action="add" aria-label="Добавить результат">+</button>';
}
function otherView(){
 const notes=ordered(data().notes);return '<div class="m-group-head"><div><h2>Другое</h2><div class="m-group-sub">Заметки из исходной таблицы</div></div></div>'+(notes.length?notes.map(e=>'<div class="m-history-row"><div><b>'+formatDate(e.date)+'</b><div class="m-dim" style="margin-top:7px">'+esc(e.note)+'</div></div></div>').join(""):'<div class="m-empty">Нет записей</div>');
}
function detailView(){
 const h=exerciseRecords(active,detail),arr=ordered(h),recent=arr.find(x=>dnum(x.weight)!==null)||arr[0];
 return '<button class="m-detail-back" data-action="back">‹ Назад к упражнениям</button><div class="m-detail-title">'+esc(detail)+'</div><div class="m-panel"><div class="m-dim">Последний результат</div><div class="m-value">'+(recent&&dnum(recent.weight)!==null?nfmt(recent.weight,2)+" кг":"—")+'</div><div class="m-dim">'+(recent&&dnum(recent.reps)!==null?nfmt(recent.reps,0)+" повторений":"Повторения не указаны")+'</div>'+chart(h,true,"max")+'</div><div class="m-section-head"><h2>История</h2><button class="m-link" data-action="add">+ Новый результат</button></div>'+arr.map(e=>'<div class="m-history-row"><span class="m-date-icon">▣</span><span class="m-history-date">'+formatDate(e.date)+'</span><span class="m-history-weight">'+(dnum(e.weight)===null?"—":nfmt(e.weight,2)+" кг")+'</span><span class="m-dim">'+(dnum(e.reps)===null?"—":nfmt(e.reps,0)+" повт.")+'</span></div>').join("")+'<button class="m-fab" data-action="add" aria-label="Записать новый результат">+</button>';
}
function settingsView(){
 return '<div class="m-group-head"><h2>Настройки</h2></div><div class="m-panel m-settings"><h3 style="margin:0">Google Sheets</h3><div class="m-dim">Все данные из твоей Google-таблицы. После подключения история обновляется автоматически.</div><div class="m-dim">'+(isConnected()?"● Google подключён":"● Google не подключён")+'</div><button class="m-add-sm" data-action="connect">Подключить Google</button><button class="m-muted-action" data-action="sync">↻ Синхронизировать</button><div class="m-dim" id="modernStatus">'+esc(lastStatus)+'</div><button class="m-muted-action" data-action="open-sheet">Открыть Google Sheets ↗</button></div><div class="m-panel m-settings"><h3 style="margin:0">Резервная копия</h3><div class="m-dim">Данные, созданные в приложении, можно сохранить в JSON.</div><button class="m-muted-action" data-action="export">Скачать копию JSON</button><button class="m-muted-action" data-action="import">Импортировать JSON</button></div>';
}
function overlayView(){
 if(!modal||settingsMode)return "";
 const body=modal.type==="body",options=active==="Другое"?"Грудь":active;
 const names=[...new Set(groupRecords(options).map(e=>e.exercise))].sort((a,b)=>a.localeCompare(b,"ru"));
 const initial=modal.exercise||names[0]||"";
 return '<div class="m-sheet-overlay" id="m-overlay"><div class="m-sheet" role="dialog" aria-modal="true"><div class="m-sheet-top"><h2>'+(body?"Новое взвешивание":"Записать максимум")+'</h2><button class="m-icon-btn" data-action="close">×</button></div><form id="m-add-form"><label class="m-form-label" for="m-date">Дата</label><input class="m-input" id="m-date" name="date" type="date" required value="'+today()+'">'+(body?'<label class="m-form-label" for="m-weight">Вес тела, кг</label><input class="m-input" id="m-weight" name="weight" type="number" min="20" max="350" step="0.1" inputmode="decimal" required placeholder="63,2"><label class="m-form-label" for="m-note">Заметка (необязательно)</label><input class="m-input" id="m-note" name="note" placeholder="Например, после завтрака">': '<label class="m-form-label" for="m-exercise">Упражнение</label><select class="m-input" id="m-exercise" name="exercise">'+names.map(n=>'<option value="'+esc(n)+'" '+(n===initial?"selected":"")+'>'+esc(n)+'</option>').join("")+'<option value="__new" '+(!names.length?"selected":"")+'>+ Новое упражнение</option></select><input class="m-input" id="m-newexercise" name="newexercise" style="margin-top:10px;'+(names.length?"display:none;":"")+'" placeholder="Название упражнения" maxlength="100"><div class="m-form-cols"><div><label class="m-form-label" for="m-weight">Макс. вес, кг</label><input class="m-input" id="m-weight" name="weight" type="number" min="0" max="2000" step="0.25" inputmode="decimal" required placeholder="70"></div><div><label class="m-form-label" for="m-reps">Повторения</label><input class="m-input" id="m-reps" name="reps" type="number" min="1" max="1000" step="1" inputmode="numeric" required placeholder="8"></div></div><p class="m-dim" style="margin-top:14px">Один лучший результат за тренировку. Подходы записывать не нужно.</p>')+'<button class="m-save" type="submit" '+(writing?"disabled":"")+'>Сохранить</button><div class="m-form-msg" id="m-form-msg"></div></form></div></div>';
}
function render(){
 root.innerHTML='<div class="m-wrap"><header class="m-header"><div class="m-brand"><span class="m-brand-icon">♢</span><div><h1>Gym Tracker</h1><p class="m-sub">Личный трекер тренировок</p></div></div><div class="m-top-actions"><button class="m-icon-btn" data-action="settings" aria-label="Настройки">⚙</button></div></header><div class="m-sync '+(isConnected()?"":"off")+'"><span class="m-dot"></span>'+(isConnected()?"Синхронизировано с Google Sheets":"Локальные данные · Google при подключении")+'</div><nav class="m-filters" aria-label="Разделы">'+TABS.map(t=>'<button class="m-chip '+(t===active?"active":"")+'" data-tab="'+esc(t)+'">'+esc(t)+'</button>').join("")+'</nav>'+(settingsMode?settingsView():active==="Общий вес"?weightView():active==="Другое"?otherView():detail?detailView():exerciseView(active))+'</div>'+overlayView();
 const sel=root.querySelector(".m-chip.active");if(sel&&root.dataset.lastTab!==active){root.dataset.lastTab=active;sel.scrollIntoView({block:"nearest",inline:"center"});}
}
function selectTab(t){if(!TABS.includes(t))return;active=t;detail=null;showAll=false;modal=null;settingsMode=false;localStorage.setItem(CACHE,t);render();scrollTo({top:0,behavior:"instant"})}
function showModal(exercise=null){modal={type:active==="Общий вес"?"body":"workout",exercise};render();setTimeout(()=>{const input=$("m-exercise")||$("m-weight");input?.focus()},40)}
function store(e){return new Promise((resolve,reject)=>{const req=indexedDB.open("gym-tracker-v1");req.onsuccess=()=>{const db=req.result;try{const t=db.transaction("entries","readwrite");t.objectStore("entries").put(e);t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)}}catch(err){db.close();reject(err)}};req.onerror=()=>reject(req.error)})}
async function save(event){
 event.preventDefault();if(writing)return;const form=event.currentTarget,fd=new FormData(form),date=String(fd.get("date")||""),weight=Number(fd.get("weight"));const msg=$("m-form-msg");
 if(!date||!Number.isFinite(weight)||weight<0){msg.textContent="Проверь дату и вес";return;}
 writing=true;form.querySelector(".m-save").disabled=true;
 try{
 if(active==="Общий вес"){
  if(!isConnected())throw Error("Для записи веса тела нужно подключить Google в настройках.");
  const old=data().body.find(x=>x.date===date);if(old && !confirm("За этот день уже есть взвешивание. Добавить ещё одно?")){writing=false;form.querySelector(".m-save").disabled=false;return;}
  const [y,m,d]=date.split("-");
  await window.gymLegacyApi.appendBody(d+"."+m+"."+y,weight,String(fd.get("note")||"").trim());
  window.dispatchEvent(new Event("gym-google-sync"));
 }else{
  const selected=String(fd.get("exercise")||""),exercise=(selected==="__new"?String(fd.get("newexercise")||"").trim():selected).trim(),reps=Number(fd.get("reps"));
  if(!exercise||!Number.isInteger(reps)||reps<1)throw Error("Выбери упражнение и укажи повторения.");
  const matches=exerciseRecords(active,exercise).filter(x=>x.date===date);
  const existingLocal=matches.find(x=>x.source==="app"),existingLegacy=matches.find(x=>x.source==="sheets");
  if(existingLegacy&&!existingLocal)throw Error("За эту дату результат уже есть в исходном Google Sheets. Измени его в таблице, чтобы не создать дубль.");
  if(existingLocal&&!confirm("За эту дату уже записан максимум. Заменить его новым результатом?")){writing=false;form.querySelector(".m-save").disabled=false;return;}
  const now=Date.now();
  await store({id:existingLocal?.id||crypto.randomUUID(),date,exercise,weight,reps,sets:1,note:"",category:active,createdAt:existingLocal?.createdAt||now,updatedAt:now});
  await window.gymRefresh?.();window.gymSheetChanged?.();window.dispatchEvent(new Event("gym-data-changed"));
 }
 modal=null;render();lastStatus="✓ Результат сохранён";
 }catch(err){const current=$("m-form-msg");if(current)current.textContent=err.message||"Ошибка сохранения";}
 finally{writing=false;const btn=$("m-add-form")?.querySelector(".m-save");if(btn)btn.disabled=false;}
}
root.addEventListener("click",e=>{
 const filter=e.target.closest("[data-tab]");if(filter){selectTab(filter.dataset.tab);return;}
 const exercise=e.target.closest("[data-exercise]");if(exercise){detail=exercise.dataset.exercise;render();scrollTo({top:0,behavior:"instant"});return;}
 const button=e.target.closest("[data-action]");if(!button)return;
 const action=button.dataset.action;
 if(action==="close"){modal=null;render();}
 if(action==="add")showModal(detail);
 if(action==="back"){detail=null;render();}
 if(action==="toggle-history"){showAll=!showAll;render();}
 if(action==="settings"){settingsMode=!settingsMode;modal=null;render();}
 if(action==="connect")$("connectSheets").click();
 if(action==="sync")$("syncSheets").click();
 if(action==="export")$("export").click();
 if(action==="import")$("importBtn").click();
 if(action==="open-sheet")window.open("https://docs.google.com/spreadsheets/d/1IrLRJVWarQJt-ALBO4GObIJrEopxfnBa4I9xRcQ2XRs/edit","_blank","noopener");
});
root.addEventListener("change",e=>{if(e.target.id==="m-exercise"){$("m-newexercise").style.display=e.target.value==="__new"?"":"none";}});
root.addEventListener("submit",e=>{if(e.target.id==="m-add-form")void save(e)});
root.addEventListener("click",e=>{if(e.target.id==="m-overlay"){modal=null;render()}});
window.addEventListener("gym-history-updated",()=>{if(!modal)render()});
window.addEventListener("gym-data-changed",()=>{if(!modal)render()});
window.addEventListener("gym-google-connected",render);
const statusNode=$("sheetsStatus");if(statusNode){new MutationObserver(()=>{lastStatus=statusNode.textContent||"";if(settingsMode){const el=$("modernStatus");if(el)el.textContent=lastStatus;}else{const dot=root.querySelector(".m-sync");if(dot){dot.classList.toggle("off",!isConnected());dot.innerHTML='<span class="m-dot"></span>'+(isConnected()?"Синхронизировано с Google Sheets":"Локальные данные · Google при подключении");}}}).observe(statusNode,{childList:true,characterData:true,subtree:true})}
render();
})();