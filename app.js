/* Receipt Book: standalone expense tracker.
   Data lives in IndexedDB on the device and syncs to the owner's own Google Sheet when linked. */
{
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CATS=[['Groceries','#3f8a4e'],['Eating out','#c8371e'],['Transport','#2f6db5'],['Shopping','#8a4fb0'],['Home & utilities','#b07a14'],['Health','#1f8a8a'],['Fun & hobbies','#d1567f'],['Bills & subscriptions','#5c6670'],['Travel','#2b7f9f'],['Other','#8b8378']];
const PAYS=['Cash','Credit card','Debit card','IC card (Suica etc.)','QR pay (PayPay etc.)','Bank transfer','Other'];
const CURS=['JPY','USD','EUR','GBP','KRW','CNY','TWD','HKD','SGD','THB','AUD','CAD','NZD','CHF','INR','PHP','VND','IDR','MYR'];
const catColor=c=>(CATS.find(x=>x[0]===c)||CATS[9])[1];
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const pd=s=>{const[y,m,d]=String(s).split('-').map(Number);return new Date(y,(m||1)-1,d||1)};
const add=(s,n)=>{const d=pd(s);d.setDate(d.getDate()+n);return iso(d)};
const todayS=()=>iso(new Date());
const nowT=()=>{const d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes())};
const monday=s=>{const d=pd(s);d.setDate(d.getDate()-(d.getDay()+6)%7);return iso(d)};
const mStart=s=>s.slice(0,8)+'01';
const mEnd=s=>{const d=pd(s);return iso(new Date(d.getFullYear(),d.getMonth()+1,0))};
const fmtD=(s,o)=>pd(s).toLocaleDateString(undefined,o);
const num=v=>{const n=parseFloat(String(v??'').replace(/[^0-9.\-]/g,''));return isFinite(n)?n:0};
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const abs=p=>new URL(p,location.href).href;

const S={exps:[],notes:{},set:{currency:'JPY',budget:150000},view:'day',cur:todayS(),q:'',ready:false};
let E=null,lastDel=null;

/* ---------- local database (IndexedDB) ---------- */
const idb={db:null,
  open(){return new Promise((res,rej)=>{const r=indexedDB.open('receipt-book',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('recs',{keyPath:'id'});d.createObjectStore('photos',{keyPath:'id'});d.createObjectStore('meta')};r.onsuccess=()=>{this.db=r.result;res()};r.onerror=()=>rej(r.error)})},
  tx(store,mode,fn){return new Promise((res,rej)=>{const t=this.db.transaction(store,mode),st=t.objectStore(store);let out;const q=fn(st);if(q)q.onsuccess=()=>{out=q.result};t.oncomplete=()=>res(out);t.onerror=t.onabort=()=>rej(t.error)})},
  get(s,k){return this.tx(s,'readonly',st=>st.get(k))},
  all(s){return this.tx(s,'readonly',st=>st.getAll())},
  put(s,v,k){return this.tx(s,'readwrite',st=>k===undefined?st.put(v):st.put(v,k))},
  del(s,k){return this.tx(s,'readwrite',st=>st.delete(k))}
};
function applyRec(r){
  if(r.kind==='exp'){S.ever=true;S.exps=S.exps.filter(x=>x.id!==r.id);if(!r.deleted)S.exps.push({...r.data,id:r.id})}
  else if(r.kind==='note'){const d=r.id.slice(5);if(r.deleted||!r.data.text)delete S.notes[d];else S.notes[d]=String(r.data.text)}
  else if(r.kind==='settings'&&!r.deleted){if(r.data.currency)S.set.currency=String(r.data.currency);if('budget' in r.data)S.set.budget=num(r.data.budget)}
}
async function writeRec(id,kind,data,deleted=false){
  const r={id,kind,data,deleted,updated:Date.now(),dirty:true};
  applyRec(r);render();
  try{await idb.put('recs',r)}catch{toast('This device could not save that. Free up some storage and try again.')}
  scheduleSync();
}
const putExp=r=>{const{id,...data}=r;return writeRec(id,'exp',data)};
function delExp(id){
  const r=S.exps.find(x=>x.id===id);if(!r)return;lastDel=r;
  const{id:_i,...data}=r;writeRec(id,'exp',data,true);
  toast('Expense deleted',()=>{if(lastDel)putExp(lastDel);lastDel=null});
}
const nt={};
function saveNote(d,v){writeRec('note:'+d,'note',{text:v},!v.trim())}
function saveSet(){writeRec('settings','settings',{currency:S.set.currency,budget:S.set.budget})}

/* ---------- photos ---------- */
const purl=new Map();
function photoURL(pid){
  if(!purl.has(pid))purl.set(pid,(async()=>{
    let p=await idb.get('photos',pid).catch(()=>null);
    if(!p&&linked()&&navigator.onLine){try{const j=await call('photo_get',{id:pid});const blob=await (await fetch('data:image/jpeg;base64,'+j.b64)).blob();p={id:pid,blob,up:true,at:Date.now()};await idb.put('photos',p)}catch{}}
    if(!p){purl.delete(pid);return ''}
    return URL.createObjectURL(p.blob);
  })());
  return purl.get(pid);
}
function hydrate(root=document){root.querySelectorAll('img[data-pid]:not([src])').forEach(async im=>{const u=await photoURL(im.dataset.pid);if(u)im.src=u})}
function loadImg(blob){return new Promise((res,rej)=>{const u=URL.createObjectURL(blob),i=new Image();i.onload=()=>{res(i);setTimeout(()=>URL.revokeObjectURL(u),1000)};i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error('bad image'))};i.src=u})}
function canvasFrom(img,max){const k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*k);c.height=Math.round(img.naturalHeight*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c}
const toBlob=(c,q)=>new Promise((r,j)=>c.toBlob(b=>b?r(b):j(new Error('encode')),'image/jpeg',q));

/* ---------- sync (your Google Sheet, through its Apps Script web app) ---------- */
let syncing=false,again=false,sTimer=null,lastSync=0,syncErr='';
function cfg(){try{return JSON.parse(localStorage.getItem('rb-sheet')||'null')}catch{return null}}
function setCfg(c){try{c?localStorage.setItem('rb-sheet',JSON.stringify(c)):localStorage.removeItem('rb-sheet')}catch{}}
const linked=()=>{const c=cfg();return !!(c&&c.url&&c.key)};
function status(t){$('#status').textContent=t}
function baseStatus(){
  if(!linked())return status('Saved on this device');
  if(!navigator.onLine)return status('Offline. Changes will sync later');
  if(syncErr)return status(syncErr);
  status(lastSync?'Synced with Google Sheet '+new Date(lastSync).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'Linked to Google Sheet');
}
async function call(action,payload={},c=cfg()){
  let res;
  try{res=await fetch(c.url,{method:'POST',body:JSON.stringify({token:c.key,action,...payload})})}catch{throw new Error('network')}
  let j;try{j=await res.json()}catch{throw new Error('not_web_app')}
  if(!j||!j.ok)throw new Error(j&&j.error||'error');
  return j;
}
function errText(e){const m=String(e&&e.message||e);
  return m==='bad_key'?'Sync stopped: the app key doesn’t match. Check it in Settings.':m==='not_set_up'?'Sync stopped: run Receipt Book → Set up sync in the sheet.':m==='not_web_app'?'Sync stopped: check the web app URL and that access is set to Anyone.':m==='network'?'Sync paused. Will retry':'Sync paused: '+m}
function scheduleSync(ms=1500){clearTimeout(sTimer);if(linked())sTimer=setTimeout(sync,ms)}
const b64=b=>toData(b).then(d=>d.slice(d.indexOf(',')+1));
async function sync(){
  if(!linked()||!navigator.onLine)return baseStatus();
  if(syncing){again=true;return}
  syncing=true;status('Syncing…');
  const c=cfg();
  try{
    for(const p of (await idb.all('photos')).filter(p=>!p.up&&p.blob)){
      await call('photo_put',{id:p.id,b64:await b64(p.blob)},c);p.up=true;await idb.put('photos',p);
    }
    const dirty=(await idb.all('recs')).filter(r=>r.dirty);
    for(let i=0;i<dirty.length;i+=100){
      const chunk=dirty.slice(i,i+100);
      await call('push',{recs:chunk.map(r=>({id:r.id,kind:r.kind,data:r.data,deleted:!!r.deleted,updated:r.updated}))},c);
      for(const r of chunk){const cur=await idb.get('recs',r.id);if(cur&&cur.updated===r.updated){cur.dirty=false;await idb.put('recs',cur)}}
    }
    const key='gpull:'+c.url,since=(await idb.get('meta',key))||0;
    const{recs,cursor}=await call('pull',{since},c);let changed=false;
    for(const row of recs||[]){
      if(!row||typeof row.id!=='string'||!['exp','note','settings'].includes(row.kind))continue;
      const cur=await idb.get('recs',row.id);
      if(cur&&cur.dirty&&cur.updated>Number(row.updated))continue;
      if(!cur||Number(row.updated)>=cur.updated){
        const data=row.kind==='exp'&&cur&&!row.deleted?{...cur.data,...row.data}:(row.data||{});
        const r={id:row.id,kind:row.kind,data,deleted:!!row.deleted,updated:Number(row.updated)||0,dirty:false};
        await idb.put('recs',r);applyRec(r);changed=true;
      }
    }
    await idb.put('meta',Number(cursor)||since,key);
    await cleanPhotos(c);
    lastSync=Date.now();syncErr='';if(changed)render();
  }catch(e){syncErr=errText(e)}
  finally{syncing=false;baseStatus();if(again){again=false;scheduleSync(500)}}
}
async function cleanPhotos(c){
  const used=new Set();S.exps.forEach(e=>(e.photos||[]).forEach(p=>used.add(p)));
  if(E)E.photos.forEach(p=>used.add(p));
  const old=(await idb.all('photos')).filter(p=>!used.has(p.id)&&Date.now()-(p.at||0)>864e5);
  if(!old.length)return;
  if(c)await call('photo_del',{ids:old.filter(p=>p.up).map(p=>p.id)},c);
  for(const p of old)await idb.del('photos',p.id);
}
addEventListener('online',()=>scheduleSync(0));
addEventListener('offline',baseStatus);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleSync(0)});
setInterval(()=>{if(document.visibilityState==='visible')scheduleSync(0)},60000);

/* ---------- money and periods ---------- */
function money(n,cur,compact){cur=cur||S.set.currency;try{return new Intl.NumberFormat(undefined,compact?{style:'currency',currency:cur,notation:'compact',maximumFractionDigits:1}:{style:'currency',currency:cur}).format(n||0)}catch{return cur+' '+(Math.round((n||0)*100)/100)}}
const cnum=v=>{try{return new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(v)}catch{return String(Math.round(v))}};
const home=e=>((e.currency||S.set.currency).toUpperCase()===S.set.currency?num(e.total):num(e.conv));
const total=l=>l.reduce((s,e)=>s+home(e),0);
const sampleMode=()=>S.ready&&!S.ever&&!S.exps.length;
const all=()=>sampleMode()?SAMPLE():S.exps;
const notes=()=>sampleMode()?Object.assign({},SAMPLE_NOTES(),S.notes):S.notes;
const inRange=(a,b,l=all())=>l.filter(e=>e.date>=a&&e.date<=b);

function SAMPLE(){
  const t=todayS(),f=['JPY','KRW','VND','IDR'].includes(S.set.currency)?1:1/150,r=[];
  const mk=(off,time,m,cat,pay,items,note)=>{const tot=items.reduce((s,i)=>s+i[1],0)*f;r.push({id:'s'+r.length,sample:true,date:add(t,-off),time,merchant:m,category:cat,payment:pay,total:Math.round(tot*100)/100,currency:S.set.currency,items:items.map(([name,p])=>({name,qty:1,price:Math.round(p*f*100)/100})),note:note||'',photos:[]})};
  mk(0,'08:12','FamilyMart','Eating out','IC card (Suica etc.)',[['Onigiri, salmon',160],['Hot coffee M',150],['Yogurt',176]]);
  mk(0,'12:40','Ootoya','Eating out','Credit card',[['Chicken teishoku',1090]]);
  mk(0,'19:05','Life Supermarket','Groceries','Credit card',[['Vegetables',780],['Chicken thigh 600g',690],['Rice 2kg',1180],['Milk',268],['Eggs x10',342]],'Points used: 120');
  mk(1,'09:02','JR East','Transport','IC card (Suica etc.)',[['Suica top-up',3000]]);
  mk(1,'20:30','Uniqlo','Shopping','Credit card',[['Heattech crew neck',1990],['Socks 3-pack',990]],'Return by Dec 24 with receipt');
  mk(2,'13:15','Matsumoto Kiyoshi','Health','QR pay (PayPay etc.)',[['Cold medicine',1180],['Masks x30',348]]);
  mk(3,'18:45','Torikizoku','Eating out','Cash',[['Dinner with friends, my share',4200]]);
  mk(4,'10:00','Tokyo Gas','Home & utilities','Bank transfer',[['Gas bill',6840]]);
  mk(5,'15:20','Kinokuniya','Fun & hobbies','Credit card',[['Book',1760],['Magazine',550]]);
  mk(6,'19:10','Gyomu Super','Groceries','Cash',[['Frozen udon x5',398],['Tofu',58],['Pork 500g',612],['Cabbage',158]]);
  mk(8,'07:50','Starbucks','Eating out','QR pay (PayPay etc.)',[['Latte tall',590]]);
  mk(9,'00:00','Netflix','Bills & subscriptions','Credit card',[['Standard plan',1590]]);
  mk(11,'17:40','Seiyu','Groceries','Debit card',[['Weekly shop',4120]]);
  mk(13,'11:05','Muji','Shopping','Credit card',[['Storage box',1490],['Notebook',150]]);
  mk(16,'09:30','Clinic','Health','Cash',[['Consultation',1630]]);
  mk(19,'13:00','Bic Camera','Shopping','Credit card',[['USB-C cable',1980]]);
  return r;
}
const SAMPLE_NOTES=()=>({[todayS()]:'Lunch out again. Try bringing a bento tomorrow.',[add(todayS(),-1)]:'Bought winter clothes. Keep the Uniqlo receipt for a possible return.'});

function range(v=S.view,c=S.cur){if(v==='day')return[c,c];if(v==='week'){const a=monday(c);return[a,add(a,6)]}return[mStart(c),mEnd(c)]}
function moved(n,v=S.view,c=S.cur){if(v==='day')return add(c,n);if(v==='week')return add(c,7*n);const d=pd(c);return iso(new Date(d.getFullYear(),d.getMonth()+n,1))}
function label(){const[a,b]=range();if(S.view==='day')return fmtD(a,{weekday:'short',day:'numeric',month:'short',year:'numeric'});if(S.view==='week')return fmtD(a,{day:'numeric',month:'short'})+' – '+fmtD(b,{day:'numeric',month:'short'});return fmtD(a,{month:'long',year:'numeric'})}
function change(cur,prev,what){if(!prev)return cur?`<p class="chg mute">Nothing was spent ${what}.</p>`:'';const d=cur-prev,p=Math.round(Math.abs(d)/prev*100);if(!d)return `<p class="chg mute">Same as ${what}.</p>`;return `<p class="chg ${d>0?'up':''}">${d>0?'▲':'▼'} ${esc(money(Math.abs(d)))} (${p}%) ${d>0?'more':'less'} than ${what}</p>`}
function sumBy(list,key){const m={};list.forEach(e=>{const k=key(e);m[k]=(m[k]||0)+home(e)});return m}
function catBars(list){
  const rows=Object.entries(sumBy(list,e=>e.category||'Other')).filter(r=>r[1]>0).sort((a,b)=>b[1]-a[1]);
  if(!rows.length)return '<p class="mute">Nothing spent in this period.</p>';
  const max=rows[0][1],t=rows.reduce((s,r)=>s+r[1],0);
  return `<div class="bars">${rows.map(([k,v],i)=>`<div class="br"><span class="bl"><i class="dot" style="background:${catColor(k)}"></i>${esc(k)}</span><span class="bt"><i class="${i?'':'hot'}" style="width:${(v/max*100).toFixed(1)}%"></i></span><span class="bv">${esc(money(v))}</span><span class="bp">${Math.round(v/t*100)}%</span></div>`).join('')}</div>`;
}
function daySum(){
  const[a]=range(),list=inRange(a,a),t=total(list),prev=total(inRange(add(a,-1),add(a,-1)));
  let h=`<p class="lab">Spent on ${esc(fmtD(a,{weekday:'long',day:'numeric',month:'long'}))}</p><p class="big">${esc(money(t))}</p>${change(t,prev,'the day before')}`;
  const B=num(S.set.budget);
  if(B>0){const before=total(inRange(mStart(a),add(a,-1))),left=pd(mEnd(a)).getDate()-pd(a).getDate()+1,al=Math.max(0,(B-before)/left),rest=al-t;
    h+=`<div class="allow">Daily allowance to stay within ${esc(money(B))} this month: <b>${esc(money(al))}</b>.<br>${rest>=0?`<b>${esc(money(rest))}</b> left for this day.`:`Over by <b>${esc(money(-rest))}</b> on this day.`}</div>`}
  return h+`<h3>By category</h3>${catBars(list)}`+tools();
}
function weekSum(){
  const[a,b]=range(),list=inRange(a,b),t=total(list),[pa,pb]=range('week',moved(-1)),prev=total(inRange(pa,pb));
  const days=[...Array(7)].map((_,i)=>add(a,i)),vals=days.map(d=>total(inRange(d,d))),max=Math.max(...vals,1),mi=vals.indexOf(Math.max(...vals)),td=todayS();
  const elapsed=a<=td&&td<=b?days.filter(d=>d<=td).length:7;
  return `<p class="lab">Spent this week</p><p class="big">${esc(money(t))}</p>${change(t,prev,'the week before')}<p class="mline">Daily average <b>${esc(money(t/elapsed))}</b></p>
  <div class="week">${days.map((d,i)=>`<button type="button" class="wcol${d===td?' today':''}${vals[i]&&i===mi?' max':''}" data-go="${d}" aria-label="${esc(fmtD(d,{weekday:'long',day:'numeric',month:'long'}))}: ${esc(money(vals[i]))}"><span class="wv">${vals[i]?esc(money(vals[i],null,true)):''}</span><span class="wbar"><i style="height:${(vals[i]/max*100).toFixed(1)}%"></i></span><span class="wd">${esc(fmtD(d,{weekday:'short'}))}<br>${pd(d).getDate()}</span></button>`).join('')}</div>
  <h3>By category</h3>${catBars(list)}`+tools();
}
function insights(list,prevList,a,b){
  const out=[],td=todayS(),end=a<=td&&td<=b?td:b,n=pd(end).getDate();
  const daysWith=new Set(list.map(e=>e.date)).size,none=Math.max(0,n-daysWith);
  out.push(`${none} no-spend ${none===1?'day':'days'} so far out of ${n}.`);
  if(list.length)out.push(`${list.length} receipts, ${money(total(list)/list.length)} on average.`);
  const c=sumBy(list,e=>e.category||'Other'),p=sumBy(prevList,e=>e.category||'Other');
  const ch=Object.keys(c).map(k=>[k,c[k]-(p[k]||0)]).sort((x,y)=>y[1]-x[1])[0];
  if(ch&&ch[1]>0&&prevList.length)out.push(`${ch[0]} is up ${money(ch[1])} on last month.`);
  const dw=[0,0,0,0,0,0,0];list.forEach(e=>{dw[(pd(e.date).getDay()+6)%7]+=home(e)});
  const bi=dw.indexOf(Math.max(...dw));if(list.length>4)out.push(`You spend most on ${fmtD(add(monday(a),bi),{weekday:'long'})}s.`);
  const m=Object.entries(sumBy(list,e=>(e.merchant||'Untitled').trim())).length;
  const visits={};list.forEach(e=>{const k=(e.merchant||'').trim();if(k)visits[k]=(visits[k]||0)+1});
  const fav=Object.entries(visits).sort((x,y)=>y[1]-x[1])[0];
  if(fav&&fav[1]>2)out.push(`Most visited: ${fav[0]}, ${fav[1]} times across ${m} places.`);
  return `<ul class="ins">${out.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
}
function monthSum(){
  const[a,b]=range(),list=inRange(a,b),t=total(list),[pa,pb]=range('month',moved(-1)),prevList=inRange(pa,pb),prev=total(prevList),B=num(S.set.budget),td=todayS();
  let h=`<p class="lab">Spent in ${esc(fmtD(a,{month:'long'}))}</p><p class="big">${esc(money(t))}</p>${change(t,prev,'last month')}`;
  if(B>0){const n=pd(b).getDate(),isCur=a<=td&&td<=b,el=isCur?pd(td).getDate():n,proj=isCur?t/el*n:t,p=t/B*100;
    h+=`<div class="meter" role="img" aria-label="${Math.round(p)}% of budget used"><i class="${p>100?'over':''}" style="width:${Math.min(100,p).toFixed(1)}%"></i>${isCur?`<em style="left:${(el/n*100).toFixed(1)}%" title="Where an even pace would be today"></em>`:''}</div>
    <p class="mline"><b>${esc(money(t))}</b> of <b>${esc(money(B))}</b> · ${t<=B?`<b>${esc(money(B-t))}</b> left`:`over by <b>${esc(money(t-B))}</b>`}${isCur?` · on pace for <b>${esc(money(proj))}</b>`:''}</p>`}
  const lead=(pd(a).getDay()+6)%7,n=pd(b).getDate(),vals=[...Array(n)].map((_,i)=>total(inRange(add(a,i),add(a,i)))),max=Math.max(...vals,1);
  const hd=[...Array(7)].map((_,i)=>`<span class="ch">${esc(fmtD(add(monday(a),i),{weekday:'narrow'}))}</span>`).join('');
  const cells=[...Array(lead)].map(()=>'<span class="cell blank"></span>').join('')+vals.map((v,i)=>{const d=add(a,i),al=v?Math.round(14+76*v/max):0;return `<button type="button" class="cell${al>52?' dk':''}${d===td?' today':''}" data-go="${d}" style="background:color-mix(in srgb,var(--brick) ${al}%,var(--paper))" aria-label="${i+1}: ${esc(money(v))}"><span class="cn">${i+1}</span><span class="cv">${v?esc(cnum(v)):''}</span></button>`}).join('');
  h+=`<h3>Day by day</h3><div class="cal">${hd}${cells}</div><h3>By category</h3>${catBars(list)}`;
  const top=Object.entries(sumBy(list,e=>(e.merchant||'Untitled').trim())).sort((x,y)=>y[1]-x[1]).slice(0,5);
  if(top.length)h+=`<h3>Where it went</h3><ul class="places">${top.map(([k,v])=>`<li><span>${esc(k)}</span><span class="mono">${esc(money(v))}</span></li>`).join('')}</ul>`;
  if(list.length)h+=`<h3>Notes on this month</h3>${insights(list,prevList,a,b)}`;
  return h+tools();
}
function tools(){return `<div class="row"><button type="button" class="ghost sm" id="csvBtn">Export CSV</button></div>`}
function ent(e){
  return `<li><button type="button" class="ent" data-id="${esc(e.id)}"><span class="t">${esc(e.time||'')}</span><span class="m"><b>${esc(e.merchant||'Untitled')}</b><small><i class="dot" style="background:${catColor(e.category)}"></i>${esc(e.category||'Other')}${e.payment?' · '+esc(e.payment):''}${e.items&&e.items.length?' · '+e.items.length+(e.items.length>1?' items':' item'):''}</small>${e.note?`<small class="nt">${esc(e.note)}</small>`:''}</span><span class="a">${esc(money(num(e.total),(e.currency||S.set.currency).toUpperCase()))}</span></button>${e.photos&&e.photos.length?`<div class="ths">${e.photos.map((p,i)=>`<button type="button" class="th" data-ph="${esc(p)}" aria-label="Open photo ${i+1}"><img data-pid="${esc(p)}" alt=""></button>`).join('')}</div>`:''}</li>`;
}
function slip(d,list){
  list=[...list].sort((x,y)=>(x.time||'').localeCompare(y.time||''));
  return `<article class="slip"><header class="sh"><button type="button" class="dlink" data-go="${d}">${esc(fmtD(d,{weekday:'long',day:'numeric',month:'long'}))}</button><span class="mute">${list.length} ${list.length===1?'receipt':'receipts'}</span></header>
  ${list.length?`<ul class="ents">${list.map(ent).join('')}</ul>`:'<p class="none">No receipts yet. Scan one or add it by hand.</p>'}
  <div class="tot"><span>Total</span><b>${esc(money(total(list)))}</b></div>
  <label class="memo"><span>Memo</span><textarea data-d="${d}" rows="2" placeholder="Anything to remember about this day">${esc(notes()[d]||'')}</textarea></label>
  <button type="button" class="ghost sm" data-add="${d}">Add expense to this day</button></article>`;
}
function group(list){const g={};list.forEach(e=>(g[e.date]=g[e.date]||[]).push(e));return g}
function slips(list,dates){
  if(!S.ready)return '<div class="empty"><p>Opening your receipts…</p></div>';
  let h=sampleMode()?'<div class="banner">These are sample receipts so you can see how it works. They disappear when you save your first expense.</div>':'';
  if(!dates.length)return h+`<div class="empty"><p>${S.q?'No matches.':'No receipts in this period.'}</p>${S.q?'':'<label class="btn primary" for="file">Scan receipt</label>'}</div>`;
  const g=group(list);return h+dates.map(d=>slip(d,g[d]||[])).join('');
}
function match(e,q){return [e.merchant,e.category,e.payment,e.note,e.date,...(e.items||[]).map(i=>i.name)].join(' ').toLowerCase().includes(q)}
function searchList(){const q=S.q.toLowerCase();return all().filter(e=>match(e,q)).sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time))}
function render(){
  const ae=document.activeElement,keep=ae&&ae.matches&&ae.matches('textarea[data-d]')?{d:ae.dataset.d,v:ae.value,s:ae.selectionStart}:null;
  $$('.seg button').forEach(b=>b.setAttribute('aria-pressed',String(!S.q&&b.dataset.v===S.view)));
  $('#range').textContent=S.q?'Search':label();
  if(S.q){
    const l=searchList(),qq=S.q.toLowerCase(),nd=Object.entries(notes()).filter(([,v])=>v.toLowerCase().includes(qq)).map(x=>x[0]);
    const dates=[...new Set([...l.map(e=>e.date),...nd])].sort().reverse().slice(0,60);
    $('#sum').innerHTML=`<p class="lab">${l.length} ${l.length===1?'expense':'expenses'} match “${esc(S.q)}”</p><p class="big">${esc(money(total(l)))}</p><h3>By category</h3>${catBars(l)}`+tools();
    $('#slips').innerHTML=slips(l,dates);
  }else{
    const[a,b]=range(),l=inRange(a,b),n=notes();
    const dates=S.view==='day'?[a]:[...new Set([...l.map(e=>e.date),...Object.keys(n).filter(d=>d>=a&&d<=b&&n[d])])].sort().reverse();
    $('#sum').innerHTML=S.view==='day'?daySum():S.view==='week'?weekSum():monthSum();
    $('#slips').innerHTML=slips(l,dates);
  }
  hydrate($('#slips'));
  if(keep){const t=$(`textarea[data-d="${keep.d}"]`);if(t){t.value=keep.v;t.focus();try{t.setSelectionRange(keep.s,keep.s)}catch{}}}
}

/* ---------- on-device receipt reading ---------- */
let ocrW=null;
function ocrWorker(){
  if(!ocrW){
    ocrW=Tesseract.createWorker(['jpn','eng'],1,{workerPath:abs('vendor/worker.min.js'),corePath:abs('vendor/core/'),langPath:abs('vendor/lang'),gzip:true,
      logger:m=>{if(E&&m&&typeof m.progress==='number'){const w=m.status==='recognizing text'?40+m.progress*60:m.progress*40;$('#ocrBar i').style.width=w.toFixed(0)+'%'}}})
      .then(async w=>{await w.setParameters({tessedit_pageseg_mode:'4',preserve_interword_spaces:'1'});return w});
    ocrW.catch(()=>{ocrW=null});
  }
  return ocrW;
}
function prepForOcr(img){
  const long=Math.max(img.naturalWidth,img.naturalHeight),k=Math.min(2.5,Math.max(1,1800/long)),c=document.createElement('canvas');
  const scale=Math.min(k,2400/long);c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);
  const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0,c.width,c.height);
  const d=x.getImageData(0,0,c.width,c.height),p=d.data,hist=new Uint32Array(256);
  for(let i=0;i<p.length;i+=4){const g=(p[i]*299+p[i+1]*587+p[i+2]*114)/1000|0;p[i]=g;hist[g]++}
  let lo=0,hi=255,cut=c.width*c.height*0.01,acc=0;for(;lo<255;lo++){acc+=hist[lo];if(acc>cut)break}acc=0;for(;hi>0;hi--){acc+=hist[hi];if(acc>cut)break}
  const span=Math.max(1,hi-lo);
  for(let i=0;i<p.length;i+=4){const v=Math.max(0,Math.min(255,(p[i]-lo)*255/span));p[i]=p[i+1]=p[i+2]=v}
  x.putImageData(d,0,0);return c;
}
function msg(t,busy){const m=$('#edMsg');m.hidden=!t;m.textContent=t||'';m.classList.toggle('busy',!!busy)}
async function extract(img){
  const my=E;$('#reread').hidden=true;$('#ocrBar').hidden=false;$('#ocrBar i').style.width='2%';
  msg(navigator.onLine||ocrW?'Reading the receipt on your phone…':'Reading the receipt…',true);
  try{
    const w=await ocrWorker();
    const{data}=await w.recognize(prepForOcr(img));
    if(E!==my)return;
    const r=ReceiptParser.parseReceipt(data.text||'',{currency:S.set.currency,today:todayS()});
    $('#ocrText').textContent=r.text||'(no text found)';$('#ocrBox').hidden=false;
    readForm();
    if(r.merchant&&!E.merchant)E.merchant=r.merchant;
    if(r.date)E.date=r.date;
    if(r.time)E.time=r.time;
    if(r.currency)E.currency=r.currency;
    if(r.total)E.total=r.total;
    if(r.tax)E.tax=r.tax;
    if(r.payment)E.payment=r.payment;
    if(r.category)E.category=r.category;
    if(r.items.length&&!E.items.length)E.items=r.items;
    E.source='scan';fillForm();
    const names={merchant:'shop',date:'date',time:'time',total:'total',tax:'tax',payment:'payment',category:'category',items:'items'};
    const got=r.found.map(k=>names[k]).filter(Boolean);
    msg(got.includes('total')?`Found the ${got.join(', ')}. Check every field before saving; phone text reading makes mistakes.`:'Couldn’t find the total. Try a flatter, brighter photo, or type it in.');
  }catch(e){if(E===my)msg('Reading failed on this device. Fill in the details by hand, or try again.')}
  finally{if(E===my){$('#ocrBar').hidden=true;$('#reread').hidden=!E.img}}
}

/* ---------- editor ---------- */
function opts(sel,list,v){sel.innerHTML=list.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');sel.value=v}
function openEd(exp,date){
  E=exp?JSON.parse(JSON.stringify(exp)):{id:null,date:date||(S.view==='day'?S.cur:todayS()),time:nowT(),merchant:'',category:'Other',payment:'',total:'',currency:S.set.currency,tax:'',conv:'',items:[],note:'',photos:[]};
  E.isNew=!exp;E.dupOk=false;E.photos=E.photos||[];E.items=E.items||[];E.img=null;
  $('#edTitle').textContent=exp?'Edit expense':'New expense';$('#edDel').hidden=!exp;$('#reread').hidden=true;$('#dup').hidden=true;$('#ocrBox').hidden=true;$('#ocrBox').open=false;$('#ocrBar').hidden=true;
  $('#edSave').disabled=false;$('#edSave').textContent=exp?'Save changes':'Save to memo';
  msg('');fillForm();renderPhotos();
  if(!$('#ed').open)$('#ed').showModal();
}
function fillForm(){
  $('#fMerchant').value=E.merchant||'';opts($('#fCat'),CATS.map(c=>c[0]),E.category||'Other');
  opts($('#fPay'),['',...PAYS],E.payment||'');$('#fPay').options[0].textContent='Not set';
  $('#fDate').value=E.date;$('#fTime').value=E.time||'';$('#fTotal').value=E.total===''?'':E.total;
  $('#fCur').value=E.currency||S.set.currency;$('#fTax').value=E.tax==null?'':E.tax;$('#fConv').value=E.conv||'';$('#fNote').value=E.note||'';
  convVis();renderItems();
}
function convVis(){const c=($('#fCur').value||S.set.currency).toUpperCase();$('#convWrap').hidden=c===S.set.currency;$('#homeCur').textContent=S.set.currency}
function readForm(){
  if(!E)return;E.merchant=$('#fMerchant').value.trim();E.category=$('#fCat').value;E.payment=$('#fPay').value;E.date=$('#fDate').value||todayS();E.time=$('#fTime').value;
  E.total=$('#fTotal').value===''?'':num($('#fTotal').value);E.currency=($('#fCur').value||S.set.currency).toUpperCase().slice(0,3);
  E.tax=$('#fTax').value===''?null:num($('#fTax').value);E.conv=$('#fConv').value===''?'':num($('#fConv').value);E.note=$('#fNote').value.trim();
}
function renderItems(){
  $('#items').innerHTML=E.items.map((it,i)=>`<div class="it"><input aria-label="Item name" data-i="${i}" data-k="name" value="${esc(it.name)}"><input aria-label="Quantity" inputmode="decimal" data-i="${i}" data-k="qty" value="${esc(it.qty)}"><input aria-label="Price" inputmode="decimal" data-i="${i}" data-k="price" value="${esc(it.price)}"><button type="button" data-rm="${i}" aria-label="Remove item">×</button></div>`).join('');
  itemSum();
}
function readItems(){if(!E)return;$$('#items input').forEach(x=>{const it=E.items[+x.dataset.i];if(it)it[x.dataset.k]=x.value})}
function itemSum(){
  const s=E.items.reduce((a,i)=>a+num(i.price),0),t=num($('#fTotal').value),c=($('#fCur').value||S.set.currency).toUpperCase();
  $('#isum').textContent=!E.items.length?'Optional. Scanned receipts fill this in when they can.':Math.abs(s-t)<0.01?`Items add up to the total (${money(s,c)}).`:`Items add up to ${money(s,c)}; the total is ${money(t,c)}. The difference is usually tax, discounts or a misread line.`;
}
function renderPhotos(){
  $('#edPhotos').innerHTML=E.photos.map((p,i)=>`<div class="ph"><img data-pid="${esc(p)}" alt="Receipt photo ${i+1}"><button type="button" data-rp="${i}" aria-label="Remove photo">×</button></div>`).join('')+`<label class="ph add" for="more">Add photo</label>`;
  hydrate($('#edPhotos'));
}
async function addPhotos(files,read){
  if(!E)return;let first=true;
  for(const f of files){
    let img;try{img=await loadImg(f)}catch{msg('That file could not be opened as an image. Try a JPEG or PNG.');continue}
    try{
      const blob=await toBlob(canvasFrom(img,1600),.82),id=newId();
      await idb.put('photos',{id,blob,up:false,at:Date.now()});
      purl.set(id,Promise.resolve(URL.createObjectURL(blob)));
      if(!E)return;E.photos.push(id);renderPhotos();
      if(read&&first){E.img=img;extract(img)}
    }catch{msg('This device could not store the photo. Free up some storage and try again.')}
    first=false;
  }
}
async function saveEd(ev){
  ev.preventDefault();readItems();readForm();
  if(E.total===''||!(E.total>0)){msg('Enter the total you paid.');$('#fTotal').focus();return}
  if(E.currency!==S.set.currency&&!(num(E.conv)>0)){msg(`This was paid in ${E.currency}. Enter what it counts as in ${S.set.currency} so it adds into your totals.`);$('#fConv').focus();return}
  if(E.isNew&&!E.dupOk){const d=S.exps.find(x=>x.date===E.date&&Math.abs(num(x.total)-E.total)<0.005);
    if(d){E.dupOk=true;const w=$('#dup');w.hidden=false;w.textContent=`You already have ${d.merchant||'an expense'} for ${money(num(d.total),d.currency)} on this day. Press Save again to keep both.`;return}}
  const rec={id:E.id||newId(),date:E.date,time:E.time,merchant:E.merchant,category:E.category,payment:E.payment,total:E.total,currency:E.currency,tax:E.tax,conv:E.currency===S.set.currency?'':E.conv,
    items:E.items.filter(i=>String(i.name).trim()||num(i.price)).map(i=>({name:String(i.name).trim(),qty:num(i.qty)||1,price:num(i.price)})),note:E.note,photos:[...E.photos],
    source:E.source||'manual',created:E.created||Date.now()};
  const wasNew=E.isNew;E=null;$('#ed').close();
  S.cur=rec.date;if(S.q){S.q='';$('#q').value=''}
  await putExp(rec);toast(wasNew?`Added to the ${fmtD(rec.date,{day:'numeric',month:'short'})} memo`:'Changes saved');
}
function closeEd(){E=null;$('#ed').close()}

/* ---------- files: CSV and backup ---------- */
async function saveFile(name,blob){
  try{const f=new File([blob],name,{type:blob.type});
    if(matchMedia('(pointer:coarse)').matches&&navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return}}catch(e){if(e&&e.name==='AbortError')return}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);
}
function csv(list){
  const q=v=>{let s=String(v??'');if(/^[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
  const head=['Date','Time','Shop','Category','Paid with','Total','Currency',`Amount (${S.set.currency})`,'Tax','Items','Note','Day memo'],n=notes();
  return [head,...[...list].sort((x,y)=>(x.date+x.time).localeCompare(y.date+y.time)).map(e=>[e.date,e.time,e.merchant,e.category,e.payment,e.total,e.currency,home(e),e.tax??'',(e.items||[]).map(i=>`${i.name}${i.qty>1?' x'+i.qty:''} ${i.price}`).join('; '),e.note,n[e.date]||''])].map(r=>r.map(q).join(',')).join('\r\n');
}
function exportCsv(){
  const[a,b]=range(),list=S.q?searchList():inRange(a,b);if(!list.length){toast('Nothing to export in this period.');return}
  saveFile(S.q?'receipt-book-search.csv':`receipt-book-${a}${a===b?'':'-to-'+b}.csv`,new Blob(['﻿'+csv(list)],{type:'text/csv'}));
}
const toData=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(String(f.result));f.readAsDataURL(b)});
async function backup(){
  toast('Preparing backup…');
  const recs=(await idb.all('recs')).map(({dirty,...r})=>r),photos=[];
  for(const p of await idb.all('photos'))photos.push({id:p.id,data:await toData(p.blob)});
  saveFile(`receipt-book-backup-${todayS()}.json`,new Blob([JSON.stringify({app:'receipt-book',version:1,exported:new Date().toISOString(),recs,photos})],{type:'application/json'}));
}
async function restore(file){
  try{
    const j=JSON.parse(await file.text());if(!j||j.app!=='receipt-book'||!Array.isArray(j.recs))throw 0;
    let n=0;
    for(const r of j.recs){if(!r||typeof r.id!=='string'||!['exp','note','settings'].includes(r.kind))continue;const cur=await idb.get('recs',r.id);
      if(!cur||num(r.updated)>cur.updated){const x={id:r.id,kind:r.kind,data:r.data||{},deleted:!!r.deleted,updated:num(r.updated)||Date.now(),dirty:true};await idb.put('recs',x);applyRec(x);n++}}
    for(const p of j.photos||[]){if(typeof p.id!=='string'||!/^data:image\//.test(p.data||''))continue;if(await idb.get('photos',p.id))continue;const blob=await (await fetch(p.data)).blob();await idb.put('photos',{id:p.id,blob,up:false,at:Date.now()})}
    render();scheduleSync(0);toast(`Restored ${n} ${n===1?'entry':'entries'}`);
  }catch{toast('That file is not a Receipt Book backup.')}
}

/* ---------- settings: link a Google Sheet ---------- */
function sMsg(t,err){const m=$('#sMsg');m.textContent=t||'';m.classList.toggle('err',!!err)}
function syncUI(){const on=linked();$('#cfgBox').hidden=on;$('#inBox').hidden=!on;const c=cfg();if(c){$('#sUrl').value=c.url;$('#sKey').value=c.key}}
async function connect(){
  const url=$('#sUrl').value.trim(),key=$('#sKey').value.trim();
  if(!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(url)){sMsg('Paste the web app URL from Apps Script. It starts with https://script.google.com/ and ends with /exec.',true);return}
  if(key.length<16){sMsg('Paste the app key shown by Receipt Book → Show app key in your sheet.',true);return}
  sMsg('Checking…');
  try{const j=await call('ping',{},{url,key});setCfg({url,key});syncErr='';syncUI();sMsg(`Linked to “${j.title||'your sheet'}”. Syncing…`);
    const all=await idb.all('recs');for(const r of all){if(!r.dirty){r.dirty=true;await idb.put('recs',r)}}
    for(const p of await idb.all('photos')){if(p.up){p.up=false;await idb.put('photos',p)}}
    await sync();sMsg($('#status').textContent)}
  catch(e){sMsg(errText(e).replace(/^Sync (stopped|paused): /,''),true)}
}
/* ---------- small UI ---------- */
let tTimer=null,tUndo=null;
function toast(t,undo){$('#tMsg').textContent=t;tUndo=undo||null;$('#tBtn').hidden=!undo;$('#toast').hidden=false;clearTimeout(tTimer);tTimer=setTimeout(()=>{$('#toast').hidden=true;tUndo=null},undo?7000:3200)}
async function openLb(pid){const u=await photoURL(pid);if(!u)return toast('That photo isn’t on this device yet. It will download when sync can reach your sheet.');$('#lbImg').src=u;$('#lb').showModal()}
function go(n){S.cur=moved(n);render()}

document.addEventListener('click',ev=>{
  const t=ev.target.closest('button');if(!t)return;
  if(t.dataset.v){S.view=t.dataset.v;S.q='';$('#q').value='';render();return}
  if(t.dataset.go){S.cur=t.dataset.go;S.view='day';S.q='';$('#q').value='';render();scrollTo({top:0,behavior:'smooth'});return}
  if(t.dataset.ph){openLb(t.dataset.ph);return}
  if(t.classList.contains('ent')){const e=all().find(x=>x.id===t.dataset.id);if(!e)return;if(e.sample){toast('This is a sample. Scan or add your first expense to start your own book.');return}openEd(e);return}
  if(t.dataset.add){openEd(null,t.dataset.add);return}
  if(t.dataset.rm!=null){readItems();E.items.splice(+t.dataset.rm,1);renderItems();return}
  if(t.dataset.rp!=null){E.photos.splice(+t.dataset.rp,1);renderPhotos();if(!E.photos.length){E.img=null;$('#reread').hidden=true}return}
  switch(t.id){
    case 'prev':go(-1);break;case 'next':go(1);break;
    case 'todayBtn':S.cur=todayS();S.q='';$('#q').value='';render();break;
    case 'addBtn':case 'addBtn2':openEd(null);break;
    case 'setBtn':opts($('#sCur'),CURS.includes(S.set.currency)?CURS:[S.set.currency,...CURS],S.set.currency);$('#sBud').value=num(S.set.budget)||'';sMsg('');syncUI();$('#st').showModal();break;
    case 'stClose':$('#st').close();break;
    case 'edClose':case 'edCancel':closeEd();break;
    case 'edDel':{const id=E&&E.id;closeEd();if(id)delExp(id);break}
    case 'addItem':readItems();E.items.push({name:'',qty:1,price:''});renderItems();$('#items .it:last-child input').focus();break;
    case 'reread':if(E&&E.img)extract(E.img);break;
    case 'csvBtn':exportCsv();break;
    case 'tBtn':if(tUndo){tUndo();tUndo=null}$('#toast').hidden=true;break;
    case 'lbClose':$('#lb').close();break;
    case 'sConnect':connect();break;
    case 'sForget':setCfg(null);syncErr='';syncUI();baseStatus();sMsg('Unlinked. Your data stays on this device and in the sheet.');break;
    case 'sSync':sync().then(()=>sMsg($('#status').textContent));break;
    case 'bkDown':backup();break;
  }
});
$('#items').addEventListener('input',()=>{readItems();itemSum()});
$('#fTotal').addEventListener('input',itemSum);
$('#fCur').addEventListener('input',()=>{convVis();itemSum()});
$('#edf').addEventListener('submit',saveEd);
$('#ed').addEventListener('cancel',ev=>{ev.preventDefault();closeEd()});
$('#lb').addEventListener('click',ev=>{if(ev.target.id==='lb')$('#lb').close()});
$('#file').addEventListener('change',ev=>{const f=[...ev.target.files];ev.target.value='';if(!f.length)return;openEd(null,todayS());addPhotos(f.slice(0,1),true)});
$('#more').addEventListener('change',ev=>{const f=[...ev.target.files];ev.target.value='';if(f.length&&E)addPhotos(f,!E.photos.length&&E.isNew&&!E.total)});
$('#bkFile').addEventListener('change',ev=>{const f=ev.target.files[0];ev.target.value='';if(f)restore(f)});
$('#stf').addEventListener('submit',ev=>{ev.preventDefault();S.set.currency=$('#sCur').value;S.set.budget=num($('#sBud').value);saveSet();render();toast('Settings saved')});
let qT=null;$('#q').addEventListener('input',ev=>{clearTimeout(qT);qT=setTimeout(()=>{S.q=ev.target.value.trim();render()},160)});
document.addEventListener('input',ev=>{const t=ev.target;if(!t.matches('textarea[data-d]'))return;const d=t.dataset.d;clearTimeout(nt[d]);nt[d]=setTimeout(()=>saveNote(d,t.value),700)});
document.addEventListener('keydown',ev=>{if(ev.target.closest('input,textarea,select,dialog'))return;if(ev.key==='ArrowLeft')go(-1);if(ev.key==='ArrowRight')go(1)});

/* ---------- start ---------- */
async function start(){
  render();
  try{await idb.open();for(const r of await idb.all('recs'))applyRec(r)}catch{status('This browser blocks storage. Entries will not be kept.')}
  S.ready=true;render();
  if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
  baseStatus();scheduleSync(0);
  if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});
}
start();
}
