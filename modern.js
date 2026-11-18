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
let chartRange="all";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nfmt=(v,d=1)=>Number(v).toLocaleString("ru-RU",{maximumFractionDigits:d});
const today=(offset=0)=>{const d=new Date();d.setDate(d.getDate()+offset);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")};
const formatDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||"")?d.split("-").reverse().join("."):"Без даты";
const dnum=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const data=()=>window.gymHistoryData?.()||{workouts:[],body:[],notes:[]};
const isConnected=()=>Boolean(window.gymLegacyApi?.ready?.());
function ordered(records){return [...records].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||Number(b.updatedAt||0)-Number(a.updatedAt||0)||Number(b.row||0)-Number(a.row||0))}
function points(records){return [...records].filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date||"")&&dnum(x.weight)!==null&&Number(x.weight)>=0).sort((a,b)=>a.date.localeCompare(b.date))}
function monthsBefore(date,months){
 const d=new Date(date+"T00:00:00Z"),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);
}
function chartPeriods(vals){
 const end=vals[vals.length-1].date,first=vals[0].date;
 return [{id:"1",label:"1М",months:1},{id:"3",label:"3М",months:3},{id:"6",label:"6М",months:6},{id:"12",label:"1Г",months:12}].map(p=>({...p,cutoff:monthsBefore(end,p.months)})).filter(p=>first<=p.cutoff);
}
function chart(records,large=false,mode="last"){
 const ps=points(records);
 if(!ps.length)return '<div class="m-empty">Пока недостаточно данных для графика</div>';
 const daily=new Map();for(const e of ps)daily.set(e.date,mode==="max"?Math.max(Number(e.weight),daily.get(e.date)??-Infinity):Number(e.weight));
 const all=[...daily].map(([date,weight])=>({date,weight})),periods=chartPeriods(all);
 const selected=periods.find(p=>p.id===chartRange);
 const vals=selected?all.filter(v=>v.date>=selected.cutoff):all;
 const controls=periods.length?'<div class="m-chart-periods" aria-label="Период графика">'+[...periods,{id:"all",label:"Всё"}].map(p=>'<button type="button" class="m-chart-period '+((selected?.id||"all")===p.id?"active":"")+'" data-action="chart-range" data-range="'+p.id+'" aria-pressed="'+((selected?.id||"all")===p.id)+'">'+p.label+'</button>').join("")+'</div>':"";
 const min=Math.min(...vals.map(v=>v.weight)),max=Math.max(...vals.map(v=>v.weight));
 const span=Math.max(max-min,0.8),lower=Math.max(0,min-span*.28),upper=max+span*.28;
 const left=36,right=321,top=15,bottom=158,w=340,h=180;
 const start=Date.parse(selected?.cutoff||vals[0].date),end=Date.parse(vals[vals.length-1].date);
 const X=i=>start===end?(left+right)/2:left+(right-left)*(Date.parse(vals[i].date)-start)/(end-start);
 const Y=v=>bottom-(v-lower)/(upper-lower)*(bottom-top);
 const path=vals.map((v,i)=>(i?"L":"M")+X(i).toFixed(1)+" "+Y(v.weight).toFixed(1)).join(" ");
 const area=path+" L"+X(vals.length-1).toFixed(1)+" "+bottom+" L"+X(0).toFixed(1)+" "+bottom+" Z";
 const ticks=[0,1,2,3,4].map(i=>{const y=top+(bottom-top)*i/4,val=upper-(upper-lower)*i/4;return '<line x1="'+left+'" x2="'+right+'" y1="'+y+'" y2="'+y+'" class="m-grid"/>'+(large?'<text class="m-chart-label" x="2" y="'+(y+4)+'">'+nfmt(val,1)+'</text>':"")}).join("");
 return '<div class="m-chart-wrap">'+controls+'<div class="m-chart-readout" aria-live="polite">Коснись графика, чтобы увидеть дату и вес</div><svg viewBox="0 0 '+w+' '+h+'" class="m-chart m-interactive-chart" tabindex="0" data-start="'+start+'" data-end="'+end+'" data-left="'+left+'" data-right="'+right+'" style="height:'+(large?218:155)+'px" role="img" aria-label="Динамика показателя по датам"><defs><linearGradient id="mshade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#61ecaa" stop-opacity=".27"/><stop offset="100%" stop-color="#61ecaa" stop-opacity=".015"/></linearGradient></defs>'+ticks+'<path d="'+area+'" fill="url(#mshade)"/><path class="m-line" d="'+path+'"/>'+vals.map((v,i)=>'<circle data-chart-point="'+i+'" data-date="'+esc(v.date)+'" data-weight="'+v.weight+'" cx="'+X(i)+'" cy="'+Y(v.weight)+'" r="'+(i===vals.length-1?4:2.4)+'" fill="#6cf0b4" stroke="#172b28" stroke-width="1.5"/>').join("")+'<g class="m-chart-cursor" visibility="hidden" pointer-events="none"><line data-cross="x" y2="'+bottom+'" stroke="#9caec0" stroke-dasharray="4 4"/><line data-cross="y" x1="'+left+'" stroke="#9caec0" stroke-dasharray="4 4"/><circle data-cross="dot" r="5" fill="#6cf0b4" stroke="#fff" stroke-width="1.5"/></g></svg><div class="m-chart-dates"><span>'+formatDate(selected?.cutoff||vals[0].date)+'</span><span>'+formatDate(vals[vals.length-1].date)+'</span></div></div>';
}
function drawChartCursor(svg,x,y,date,weight,estimated){
 const g=svg.querySelector(".m-chart-cursor"),vertical=g.querySelector('[data-cross="x"]'),horizontal=g.querySelector('[data-cross="y"]');
 vertical.setAttribute("x1",x);vertical.setAttribute("x2",x);vertical.setAttribute("y1",y);
 horizontal.setAttribute("y1",y);horizontal.setAttribute("y2",y);horizontal.setAttribute("x2",x);
 const dot=g.querySelector('[data-cross="dot"]');dot.setAttribute("cx",x);dot.setAttribute("cy",y);g.setAttribute("visibility","visible");
 const readout=svg.closest(".m-chart-wrap").querySelector(".m-chart-readout");
 readout.textContent=formatDate(date)+" · "+(estimated?"≈ ":"")+nfmt(weight,2)+" кг"+(estimated?" (между записями)":"");
}
function selectChartPoint(svg,index){
 const ps=[...svg.querySelectorAll("[data-chart-point]")],p=ps[Math.max(0,Math.min(ps.length-1,index))];if(!p)return;
 svg.dataset.selected=p.dataset.chartPoint;
 drawChartCursor(svg,Number(p.getAttribute("cx")),Number(p.getAttribute("cy")),p.dataset.date,Number(p.dataset.weight),false);
}
function chartPointer(svg,event){
 const matrix=svg.getScreenCTM();if(!matrix)return;
 const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const pos=p.matrixTransform(matrix.inverse()).x;
 const ps=[...svg.querySelectorAll("[data-chart-point]")].map(el=>({x:Number(el.getAttribute("cx")),y:Number(el.getAttribute("cy")),date:el.dataset.date,weight:Number(el.dataset.weight)}));
 if(!ps.length)return;
 const x=Math.max(ps[0].x,Math.min(ps[ps.length-1].x,pos));
 let j=ps.findIndex(p=>p.x>=x);if(j<0)j=ps.length-1;
 if(j===0||Math.abs(ps[j].x-x)<0.000001){selectChartPoint(svg,j);return;}
 const a=ps[j-1],b=ps[j],t=(x-a.x)/(b.x-a.x);
 const date=new Date(Date.parse(a.date)+t*(Date.parse(b.date)-Date.parse(a.date)));
 date.setTime(Math.round(date.getTime()/86400000)*86400000);
 svg.dataset.selected=String(t<.5?j-1:j);
 drawChartCursor(svg,x,a.y+(b.y-a.y)*t,date.toISOString().slice(0,10),a.weight+(b.weight-a.weight)*t,true);
}
root.addEventListener("pointerdown",e=>{const svg=e.target.closest(".m-interactive-chart");if(!svg)return;chartPointer(svg,e);if(e.pointerType!=="mouse")try{svg.setPointerCapture(e.pointerId)}catch{}});
root.addEventListener("pointermove",e=>{const svg=e.target.closest(".m-interactive-chart");if(svg&&(e.pointerType==="mouse"||svg.hasPointerCapture(e.pointerId)))chartPointer(svg,e)});
root.addEventListener("keydown",e=>{const svg=e.target.closest(".m-interactive-chart");if(!svg||!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const n=svg.querySelectorAll("[data-chart-point]").length,i=Number(svg.dataset.selected??0);selectChartPoint(svg,e.key==="Home"?0:e.key==="End"?n-1:i+(e.key==="ArrowLeft"?-1:1));});
function spark(records){
 const p=points(records),last=[...new Map(p.map(e=>[e.date,Number(e.weight)]))].slice(-12);
 if(!last.length)return '<span class="m-dim">Нет графика</span>';
 const weights=last.map(x=>x[1]),low=Math.min(...weights),high=Math.max(...weights),span=Math.max(high-low,1),coords=weights.map((w,i)=>[(i?i/(weights.length-1):0)*86,37-(w-low)/span*31]);
 const d=coords.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
 return '<svg viewBox="0 0 90 42" class="m-spark" aria-hidden="true"><path d="'+d+'" stroke="#67eeb1" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>';
}
function deleteButton(e){return '<button type="button" class="m-delete-record" data-action="delete-record" data-record-id="'+esc(e.id)+'" aria-label="Удалить запись" title="Удалить запись"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>'}
let deleting=false;
async function deleteRecord(id){
 if(deleting||writing)return;
 const d=data(),record=[...d.body,...d.workouts,...d.notes].find(e=>e.id===id);
 if(!record)return;
 const name=record.category==="Общий вес"?"Вес тела":record.exercise;
 if(!confirm("Удалить запись «"+name+"» за "+formatDate(record.date)+(dnum(record.weight)!==null?" ("+nfmt(record.weight,2)+" кг)":"")+"?\nОна исчезнет из истории и графиков, но останется в Google Sheets с отметкой удаления."))return;
 deleting=true;
 try{
  const now=Math.max(Date.now(),Number(record.updatedAt||0)+1);
  const {source,row,...entry}=record;
  await store({...entry,deletedAt:now,updatedAt:now});
  await window.gymRefresh?.();
  window.gymSheetChanged?.();
  lastStatus="Запись удалена локально. Синхронизация с Google Sheets при подключении.";
  render();
 }catch(e){alert("Не удалось удалить запись: "+e.message)}
 finally{deleting=false;}
}
async function deleteExercise(){
 if(deleting||writing||!detail)return;
 const group=active,name=detail,records=exerciseRecords(group,name);
 if(!records.length)return;
 if(!confirm("Удалить упражнение «"+name+"» и всю его историю ("+records.length+" записей)?\n\nЗаписи исчезнут из приложения, но сохранятся в Google Sheets с отметкой удаления."))return;
 deleting=true;
 try{
  const ids=new Set(records.map(e=>e.id));
  await new Promise((resolve,reject)=>{
   const req=indexedDB.open("gym-tracker-v1");
   req.onerror=()=>reject(req.error);
   req.onsuccess=()=>{
    const db=req.result;
    try{
     const tx=db.transaction("entries","readwrite"),st=tx.objectStore("entries");
     tx.oncomplete=()=>{db.close();resolve()};
     tx.onabort=()=>{db.close();reject(tx.error||Error("Удаление отменено"))};
     const q=st.openCursor();
     q.onsuccess=()=>{
      const c=q.result;if(!c)return;
      const e=c.value;
      if(ids.has(e.id)&&e.category===group&&e.exercise===name&&!Number(e.deletedAt||0)){
       const now=Math.max(Date.now(),Number(e.updatedAt||0)+1);
       c.update({...e,deletedAt:now,updatedAt:now});
      }
      c.continue();
     };
    }catch(e){db.close();reject(e)}
   };
  });
  if(active===group&&detail===name)detail=null;
  await window.gymRefresh?.();window.gymSheetChanged?.();
  lastStatus="Упражнение удалено локально. Синхронизация при подключении.";render();
 }catch(e){alert("Не удалось удалить упражнение: "+e.message)}
 finally{deleting=false;}
}
function recordNote(e){const note=String(e.note??"").trim();return note?'<div class="m-history-note"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 11a8 8 0 0 1-8 8H4l2-4a8 8 0 1 1 14-4Z"/></svg><span>'+esc(note)+'</span></div>':""}
function weightView(){
 const arr=ordered(data().body.filter(x=>Number.isFinite(x.weight))),latest=arr[0],first=arr[arr.length-1];
 const past=arr.find(x=>x.date && latest?.date && x.date<=new Date(new Date(latest.date+"T12:00:00").getTime()-7*86400000).toISOString().slice(0,10));
 const week=latest&&past?latest.weight-past.weight:null;
 const cls=week!==null&&week<0?"negative":"";
 return '<div class="m-hero"><div class="m-hero-kicker">Общий вес</div><div class="m-dim" style="margin-top:10px">Текущий показатель</div><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><div class="m-value">'+(latest?nfmt(latest.weight,2)+" кг":"—")+'</div>'+(week===null?"":'<div class="m-change '+cls+'">'+(week>0?"↑ +":week<0?"↓ ":"")+nfmt(week,2)+' кг<br>за 7 дней</div>')+'</div>'+chart(arr,true)+'</div>'+
 '<div class="m-section-head"><h2>Последние записи</h2><button class="m-link" data-action="toggle-history">'+(showAll?"Скрыть":"Все записи →")+'</button></div>'+
 (arr.length?arr.slice(0,showAll?arr.length:7).map((e,i)=>{const older=arr[i+1],diff=older?e.weight-older.weight:null;return '<div class="m-history-row m-editable-row" data-action="edit-record" data-record-id="'+esc(e.id)+'" tabindex="0" aria-label="Редактировать запись"><span class="m-date-icon">▣</span><span class="m-history-date">'+formatDate(e.date)+'</span><span class="m-history-weight">'+nfmt(e.weight,2)+' кг</span><span class="m-history-delta '+(diff===null?"neutral":diff<0?"negative":"")+'">'+(diff===null?"—":(diff>0?"+":"")+nfmt(diff,2))+'</span>'+deleteButton(e)+recordNote(e)+'</div>'}).join(""):'<div class="m-empty">Подключи Google в настройках, чтобы увидеть историю веса тела</div>')+
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
 return '<div class="m-group-head"><div><h2>'+esc(group)+'</h2><div class="m-group-sub">'+names.length+' упражнений'+(last?.date?" · последнее: "+formatDate(last.date):"")+'</div></div><button class="m-add-sm" data-action="add">+ Упражнение</button></div>'+(cards||'<div class="m-empty">Пока нет упражнений в этой группе</div>')+'<button class="m-fab" data-action="add" aria-label="Добавить упражнение">+</button>';
}
function otherView(){
 const notes=ordered(data().notes);return '<div class="m-group-head"><div><h2>Другое</h2><div class="m-group-sub">Заметки из исходной таблицы</div></div></div>'+(notes.length?notes.map(e=>'<div class="m-history-row m-editable-row" data-action="edit-record" data-record-id="'+esc(e.id)+'" tabindex="0" aria-label="Редактировать запись"><div><b>'+formatDate(e.date)+'</b><div class="m-dim" style="margin-top:7px">'+esc(e.note)+'</div></div>'+deleteButton(e)+'</div>').join(""):'<div class="m-empty">Нет записей</div>');
}
function detailView(){
 const h=exerciseRecords(active,detail),arr=ordered(h),recent=arr.find(x=>dnum(x.weight)!==null)||arr[0];
 return '<button class="m-detail-back" data-action="back">‹ Назад к упражнениям</button><div class="m-detail-heading"><div class="m-detail-title">'+esc(detail)+'</div><button type="button" class="m-delete-exercise" data-action="delete-exercise" title="Удалить упражнение и всю историю" aria-label="Удалить упражнение"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg><span>Удалить</span></button></div><div class="m-panel"><div class="m-dim">Последний результат</div><div class="m-value">'+(recent&&dnum(recent.weight)!==null?nfmt(recent.weight,2)+" кг":"—")+'</div><div class="m-dim">'+(recent&&dnum(recent.reps)!==null?nfmt(recent.reps,0)+" повторений":"Повторения не указаны")+'</div>'+chart(h,true,"max")+'</div><div class="m-section-head"><h2>История</h2><button class="m-link" data-action="add">+ Новый результат</button></div>'+arr.map(e=>'<div class="m-history-row m-editable-row" data-action="edit-record" data-record-id="'+esc(e.id)+'" tabindex="0" aria-label="Редактировать запись"><span class="m-date-icon">▣</span><span class="m-history-date">'+formatDate(e.date)+'</span><span class="m-history-weight">'+(dnum(e.weight)===null?"—":nfmt(e.weight,2)+" кг")+'</span><span class="m-dim">'+(dnum(e.reps)===null?"—":nfmt(e.reps,0)+" повт.")+'</span>'+deleteButton(e)+recordNote(e)+'</div>').join("")+'<button class="m-fab" data-action="add" aria-label="Записать новый результат">+</button>';
}
function settingsView(){
 return '<div class="m-group-head"><h2>Настройки</h2></div><div class="m-panel m-settings"><h3>Google Sheets</h3><div class="m-dim">Единый журнал: gym_tracker_app</div><button class="m-add-sm" data-action="connect">Подключить Google</button><button class="m-muted-action" data-action="sync">↻ Синхронизировать</button><div class="m-dim" id="modernStatus">'+esc(lastStatus)+'</div><button class="m-muted-action" data-action="open-sheet">Открыть Google Sheets ↗</button></div><div class="m-panel m-settings"><h3>Резервная копия</h3><div class="m-dim">Сначала синхронизируй данные, затем скачай независимую копию JSON. Автоматические копии на Google Drive настраиваются отдельно.</div><button class="m-muted-action" data-action="export">Скачать текущие записи JSON</button></div>';
}
function editRecord(id){
 if(writing||deleting)return;
 const d=data(),entry=[...d.body,...d.workouts,...d.notes].find(e=>e.id===id);
 if(!entry)return;
 modal={type:entry.category==="Общий вес"?"body":entry.category==="Другое"?"note":"workout",exercise:entry.exercise,edit:entry};render();
}
function editOverlay(entry){
 const body=modal.type==="body",noteOnly=modal.type==="note";
 return '<div class="m-sheet-overlay" id="m-overlay"><div class="m-sheet" role="dialog" aria-modal="true"><div class="m-sheet-top"><h2>Редактировать запись</h2><button class="m-icon-btn" data-action="close">×</button></div><form id="m-add-form"><label class="m-form-label" for="m-date">Дата</label><div style="display:flex;gap:8px;margin-bottom:8px"><button type="button" class="m-muted-action" style="flex:1" data-action="date-today">Сегодня</button><button type="button" class="m-muted-action" style="flex:1" data-action="date-yesterday">Вчера</button></div><input class="m-input" id="m-date" name="date" type="date" max="'+today()+'" value="'+esc(entry.date||"")+'">'+(body||noteOnly?"":'<label class="m-form-label" for="m-edit-exercise">Упражнение</label><input class="m-input" id="m-edit-exercise" name="exercise" required maxlength="100" value="'+esc(entry.exercise||"")+'">')+(noteOnly?"":'<label class="m-form-label" for="m-weight">'+(body?"Вес тела, кг":"Макс. вес, кг")+'</label><input class="m-input" id="m-weight" name="weight" type="number" min="'+(body?20:0)+'" max="'+(body?350:2000)+'" step="any" inputmode="decimal" '+(body?"required":"")+' value="'+esc(entry.weight??"")+'">')+(body||noteOnly?"":'<label class="m-form-label" for="m-reps">Повторения</label><input class="m-input" id="m-reps" name="reps" type="number" min="1" max="1000" step="1" inputmode="numeric" value="'+esc(entry.reps??"")+'">')+'<label class="m-form-label" for="m-note">Комментарий</label><textarea class="m-input" id="m-note" name="note" rows="3">'+esc(entry.note??"")+'</textarea><button class="m-save" type="submit" '+(writing?"disabled":"")+'>Сохранить изменения</button><div class="m-form-msg" id="m-form-msg"></div></form></div></div>';
}
async function saveEdit(form,fd,msg){
 const original=modal.edit;
 const d=data(),current=[...d.body,...d.workouts,...d.notes].find(e=>e.id===original.id);
 if(!current)throw Error("Запись уже удалена или недоступна.");
 if(Number(current.updatedAt||0)!==Number(original.updatedAt||0))throw Error("Запись изменилась при синхронизации. Закрой форму и открой её заново.");
 const body=modal.type==="body",noteOnly=modal.type==="note",date=String(fd.get("date")||"");
 const rawWeight=String(fd.get("weight")??""),rawReps=String(fd.get("reps")??"");
 const weight=noteOnly?current.weight:rawWeight===""?null:Number(rawWeight),reps=body||noteOnly?current.reps:rawReps===""?null:Number(rawReps);
 const exercise=body||noteOnly?current.exercise:String(fd.get("exercise")||"").trim();
 if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today()))throw Error("Проверь дату.");
 if(!noteOnly&&(!exercise||weight!==null&&(!Number.isFinite(weight)||weight<0)||body&&(weight===null||weight<20||weight>350)||reps!==null&&(!Number.isInteger(reps)||reps<1)))throw Error("Проверь значения.");
 if(date&&(date!==current.date||exercise!==current.exercise)){
  const matches=(body?d.body:noteOnly?[]:d.workouts).filter(e=>e.id!==current.id&&e.date===date&&e.category===current.category&&(body||e.exercise===exercise));
  if(matches.length)throw Error("За эту дату уже есть другая запись. Выбери другую дату или отдельно исправь дубликат.");
 }
 const {source,row,...entry}=current;
 await store({...entry,date,exercise,weight,reps,note:String(fd.get("note")||"").trim(),updatedAt:Math.max(Date.now(),Number(current.updatedAt||0)+1)});
 modal=null;
 if(!body&&!noteOnly&&detail===original.exercise)detail=exercise;
 await window.gymRefresh?.();window.gymSheetChanged?.();
 lastStatus="Изменения сохранены локально; синхронизация при подключении.";render();
}
function overlayView(){
 if(!modal||settingsMode)return "";
 if(modal.edit)return editOverlay(modal.edit);
 const body=modal.type==="body",fixed=modal.exercise;
 const exerciseField=fixed?'<label class="m-form-label">Упражнение</label><div class="m-input m-fixed-exercise">'+esc(fixed)+'</div>':'<label class="m-form-label" for="m-newexercise">Название упражнения</label><input class="m-input" id="m-newexercise" name="newexercise" placeholder="Введите название" maxlength="100" required>';
 return '<div class="m-sheet-overlay" id="m-overlay"><div class="m-sheet" role="dialog" aria-modal="true"><div class="m-sheet-top"><h2>'+(body?"Новое взвешивание":fixed?"Записать максимум":"Новое упражнение")+'</h2><button class="m-icon-btn" data-action="close">×</button></div><form id="m-add-form"><label class="m-form-label" for="m-date">'+(body?"Дата взвешивания":"Дата тренировки")+'</label><div style="display:flex;gap:8px;margin-bottom:8px"><button type="button" class="m-muted-action" style="flex:1" data-action="date-today">Сегодня</button><button type="button" class="m-muted-action" style="flex:1" data-action="date-yesterday">Вчера</button></div><input class="m-input" id="m-date" name="date" type="date" required max="'+today()+'" value="'+today()+'"><div class="m-dim" style="font-size:12px;margin-top:6px">Нажми на дату, чтобы выбрать любой прошлый день.</div>'+(body?'<label class="m-form-label" for="m-weight">Вес тела, кг</label><input class="m-input" id="m-weight" name="weight" type="number" min="20" max="350" step="0.1" inputmode="decimal" required placeholder="63,2"><label class="m-form-label" for="m-note">Заметка (необязательно)</label><input class="m-input" id="m-note" name="note" placeholder="Например, после завтрака">': exerciseField+'<div class="m-form-cols"><div><label class="m-form-label" for="m-weight">Макс. вес, кг</label><input class="m-input" id="m-weight" name="weight" type="number" min="0" max="2000" step="0.25" inputmode="decimal" required placeholder="70"></div><div><label class="m-form-label" for="m-reps">Повторения</label><input class="m-input" id="m-reps" name="reps" type="number" min="1" max="1000" step="1" inputmode="numeric" required placeholder="8"></div></div><label class="m-form-label" for="m-note">Комментарий (необязательно)</label><textarea class="m-input" id="m-note" name="note" rows="2" placeholder="Например, другой тренажёр или техника"></textarea><p class="m-dim" style="margin-top:14px">Один лучший результат за тренировку. Подходы записывать не нужно.</p>')+'<button class="m-save" type="submit" '+(writing?"disabled":"")+'>Сохранить</button><div class="m-form-msg" id="m-form-msg"></div></form></div></div>';
}
function render(){
 root.innerHTML='<div class="m-wrap"><header class="m-header"><div class="m-brand"><span class="m-brand-icon">♢</span><div><h1>Gym Tracker</h1><p class="m-sub">Личный трекер тренировок</p></div></div><div class="m-top-actions"><button class="m-icon-btn" data-action="settings" aria-label="Настройки">⚙</button></div></header><div id="m-sync-detail" role="status" style="font-size:12px;color:#9eabc0;margin:8px 0 2px">'+esc(window.gymSyncState?.message||lastStatus)+'</div><div class="m-sync '+(isConnected()?"":"off")+'"><span class="m-dot"></span>'+(isConnected()?"Синхронизировано с Google Sheets":"Локальные данные · Google при подключении")+'</div><nav class="m-filters" aria-label="Разделы">'+TABS.map(t=>'<button class="m-chip '+(t===active?"active":"")+'" data-tab="'+esc(t)+'">'+esc(t)+'</button>').join("")+'</nav>'+(settingsMode?settingsView():active==="Общий вес"?weightView():active==="Другое"?otherView():detail?detailView():exerciseView(active))+'</div>'+overlayView();
 const sel=root.querySelector(".m-chip.active");if(sel&&root.dataset.lastTab!==active){root.dataset.lastTab=active;sel.scrollIntoView({block:"nearest",inline:"center"});}
}
function selectTab(t){if(!TABS.includes(t))return;active=t;detail=null;chartRange="all";showAll=false;modal=null;settingsMode=false;localStorage.setItem(CACHE,t);render();scrollTo({top:0,behavior:"instant"})}
function showModal(exercise=null){modal={type:active==="Общий вес"?"body":"workout",exercise};render();setTimeout(()=>{const input=$("m-newexercise")||$("m-weight");input?.focus()},40)}
function store(e){return new Promise((resolve,reject)=>{const req=indexedDB.open("gym-tracker-v1");req.onsuccess=()=>{const db=req.result;try{const t=db.transaction("entries","readwrite");t.objectStore("entries").put(e);t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)}}catch(err){db.close();reject(err)}};req.onerror=()=>reject(req.error)})}
async function save(event){
 event.preventDefault();if(writing)return;const form=event.target;if(!(form instanceof HTMLFormElement))return;const fd=new FormData(form),date=String(fd.get("date")||""),weight=Number(fd.get("weight"));const msg=$("m-form-msg");
 if(modal?.edit){
  writing=true;form.querySelector(".m-save").disabled=true;
  try{await saveEdit(form,fd,msg)}catch(e){msg.textContent=e.message||"Ошибка сохранения"}finally{writing=false;const btn=$("m-add-form")?.querySelector(".m-save");if(btn)btn.disabled=false;}
  return;
 }
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today()||!Number.isFinite(weight)||weight<0){msg.textContent="Укажи корректную дату (не позднее сегодня) и вес";return;}
 if(!isConnected())window.gymSheetConnect?.();

 writing=true;form.querySelector(".m-save").disabled=true;
 try{
 if(active==="Общий вес"){
  const records=data().body.filter(x=>x.date===date);
  const existingLocal=records.find(x=>x.source==="app");
  if(records.length && !confirm("За эту дату уже есть взвешивание. "+(existingLocal?"Обновить его?":"Добавить ещё одно?"))){
   writing=false;form.querySelector(".m-save").disabled=false;return;
  }
  const now=Date.now();
  await store({id:existingLocal?.id||crypto.randomUUID(),date,exercise:"Вес тела",weight,reps:null,sets:1,note:String(fd.get("note")||"").trim(),category:"Общий вес",createdAt:existingLocal?.createdAt||now,updatedAt:now});
  await window.gymRefresh?.();window.gymSheetChanged?.();
  window.dispatchEvent(new Event("gym-data-changed"));
 }else{
  const exercise=modal?.exercise||String(fd.get("newexercise")||"").trim(),reps=Number(fd.get("reps"));
  if(!exercise||!Number.isInteger(reps)||reps<1)throw Error("Укажи название упражнения и количество повторений.");
  if(!modal?.exercise&&groupRecords(active).some(e=>e.exercise.trim().toLocaleLowerCase("ru")===exercise.toLocaleLowerCase("ru")))throw Error("Такое упражнение уже есть в этой группе. Открой его карточку, чтобы добавить результат.");
  const matches=exerciseRecords(active,exercise).filter(x=>x.date===date);
  const existingLocal=matches.find(x=>x.source==="app"),existingLegacy=matches.find(x=>x.source==="sheets");
  if(existingLegacy&&!existingLocal)throw Error("За эту дату результат уже есть в исходном Google Sheets. Измени его в таблице, чтобы не создать дубль.");
  if(existingLocal&&!confirm("За эту дату уже записан максимум. Заменить его новым результатом?")){writing=false;form.querySelector(".m-save").disabled=false;return;}
  const now=Date.now();
  await store({id:existingLocal?.id||crypto.randomUUID(),date,exercise,weight,reps,sets:1,note:String(fd.get("note")||"").trim()||existingLocal?.note||"",category:active,createdAt:existingLocal?.createdAt||now,updatedAt:now});
  await window.gymRefresh?.();window.gymSheetChanged?.();window.dispatchEvent(new Event("gym-data-changed"));
 }
 modal=null;lastStatus=isConnected()?"Запись сохранена локально; отправка в Google запущена":"Запись сохранена локально; ожидает Google";render();
 }catch(err){const current=$("m-form-msg");if(current)current.textContent=err.message||"Ошибка сохранения";}
 finally{writing=false;const btn=$("m-add-form")?.querySelector(".m-save");if(btn)btn.disabled=false;}
}
root.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches(".m-editable-row")){e.preventDefault();editRecord(e.target.dataset.recordId);}});
root.addEventListener("click",e=>{
 const filter=e.target.closest("[data-tab]");if(filter){selectTab(filter.dataset.tab);return;}
 const exercise=e.target.closest("[data-exercise]");if(exercise){detail=exercise.dataset.exercise;chartRange="all";render();scrollTo({top:0,behavior:"instant"});return;}
 const button=e.target.closest("[data-action]");if(!button)return;
 const action=button.dataset.action;
 if(action==="date-today"||action==="date-yesterday"){const input=$("m-date");if(input)input.value=today(action==="date-yesterday"?-1:0);return;}
 if(action==="edit-record"){editRecord(button.dataset.recordId);return;}
 if(action==="delete-exercise"){void deleteExercise();return;}
 if(action==="delete-record"){void deleteRecord(button.dataset.recordId);return;}
 if(action==="close"){modal=null;render();}
 if(action==="add")showModal(detail);
 if(action==="back"){detail=null;chartRange="all";render();}
 if(action==="chart-range"){chartRange=button.dataset.range;render();return;}
 if(action==="toggle-history"){showAll=!showAll;render();}
 if(action==="settings"){settingsMode=!settingsMode;modal=null;render();}
 if(action==="connect")$("connectSheets").click();
 if(action==="sync")$("syncSheets").click();
 if(action==="export")$("export").click();

 if(action==="open-sheet")window.open("https://docs.google.com/spreadsheets/d/1IrLRJVWarQJt-ALBO4GObIJrEopxfnBa4I9xRcQ2XRs/edit","_blank","noopener");
});

root.addEventListener("submit",e=>{if(e.target.id==="m-add-form")void save(e).catch(err=>{const el=$("m-form-msg");if(el)el.textContent="Ошибка: "+(err?.message||"не удалось сохранить");console.error("Save failed",err)})});
root.addEventListener("click",e=>{if(e.target.id==="m-overlay"){modal=null;render()}});
window.addEventListener("gym-history-updated",()=>{if(!modal)render()});
window.addEventListener("gym-data-changed",()=>{if(!modal)render()});
window.addEventListener("gym-sync-status",e=>{const el=$("m-sync-detail");if(el){el.textContent=e.detail.message;el.style.color=e.detail.state==="error"?"#fb8390":e.detail.state==="success"?"#6cf0b4":"#9eabc0"}});
window.addEventListener("gym-google-connected",()=>{if(modal){const msg=$("m-form-msg");if(msg)msg.textContent="✓ Google подключён. Нажми «Сохранить» ещё раз.";return;}render()});
const statusNode=$("sheetsStatus");if(statusNode){new MutationObserver(()=>{lastStatus=statusNode.textContent||"";if(settingsMode){const el=$("modernStatus");if(el)el.textContent=lastStatus;}else{const dot=root.querySelector(".m-sync");if(dot){dot.classList.toggle("off",!isConnected());dot.innerHTML='<span class="m-dot"></span>'+(isConnected()?"Синхронизировано с Google Sheets":"Локальные данные · Google при подключении");}}}).observe(statusNode,{childList:true,characterData:true,subtree:true})}
render();
})();