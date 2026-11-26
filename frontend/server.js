/* nuglyan: browser-to-Supabase adapter. No secret/service role key. */
const BASE='https://ezycipkttvaoasftqpug.supabase.co';
const KEY='sb_publishable_9XR2EtcnLTfxUj4l8iLYOA_VVV0oGFn';
let session=null, admin=false, publicRows=[], privateRows=[], publicIndex={}, privateIndex={}, ready=false, refreshTask=null, busy=false;
const pending=new Map(), versions=new Map();
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const copy=v=>JSON.parse(JSON.stringify(v));
const str=v=>typeof v==='string'?v:'';
const list=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'):str(v)?[v]:[];
const score=v=>v!==''&&v!=null&&Number.isFinite(Number(v))&&Number(v)>=1&&Number(v)<=10?Number(v):null;
const rpc=(name,body={},auth=false)=>request('/rest/v1/rpc/'+name,{method:'POST',body,auth});
async function request(path,{method='GET',body,auth=false,prefer}={}){
  if(auth&&!session)throw Error('Войдите в личный кабинет');
  if(auth&&session.expires_at<Date.now()/1000+45)await refreshSession();
  const headers={apikey:KEY,'Content-Type':'application/json'};
  if(auth)headers.Authorization='Bearer '+session.access_token;
  if(prefer)headers.Prefer=prefer;
  const res=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  if(!res.ok){const e=Error('Запрос не выполнен ('+res.status+')');e.status=res.status;throw e;}
  return res.status===204?null:res.json();
}
function acceptSession(s){if(!s?.access_token||!s.refresh_token)throw Error('Сессия не получена');session={access_token:s.access_token,refresh_token:s.refresh_token,expires_at:s.expires_at||Date.now()/1000+(s.expires_in||3600)};}
async function refreshSession(){
  if(!session)throw Error('Сессия завершена');
  if(!refreshTask)refreshTask=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}}).then(acceptSession).finally(()=>{refreshTask=null;});
  return refreshTask;
}
function publicRecord(row){
  const c=row.card||{},a=c.characteristics||{};
  return {id:row.entry_id,pub:true,name:str(c.title),kind:c.type==='film'||c.type==='Фильм'?'Фильм':'Сериал',year:c.year,genre:list(c.genres).join(', '),country:list(c.countries).join(', '),desc:str(c.synopsis),note:str(c.authorNotes),review:str(c.authorReview),score:c.authorRating,atmos:str(a.atmos),topic:str(a.topic),answers:a.answers||{},noMystic:a.noMystic===true,...Object.fromEntries(criteria.map(([k])=>[k,a[k]])),kinopoiskId:c.kinopoiskId,kinopoiskRating:c.kinopoiskRating,imdbRating:c.imdbRating,watchLinks:list(c.watchLinks),recommended:c.recommended===true,legacyFacts:a.facts||{}};
}
function sourceFor(id,legacy){
  const k=String(id||legacy?.id||'');
  if(!/^\d+$/.test(k))return null;
  const url=legacy?.url;
  return {id:k,url:typeof url==='string'&&/^https:\/\/www\.kinopoisk\.ru\/(?:film|series)\/\d+\/?$/.test(url)?url:'https://www.kinopoisk.ru/film/'+k+'/',fields:legacy?.fields||{}};
}
async function readAll(path,auth=false){
  let out=[];
  for(let offset=0;;offset+=200){
    const rows=await request(path+'&limit=200&offset='+offset,{auth});
    if(!Array.isArray(rows))throw Error('Некорректный ответ базы');
    out.push(...rows);if(rows.length<200)return out;
  }
}
async function loadPublic(){
  const rows=await readAll('/rest/v1/kinoteka_publications?select=entry_id,card&order=entry_id');
  publicRows=rows.filter(x=>uuid(x.entry_id)).map(publicRecord);
  publicIndex={};
  for(const x of publicRows){const k=sourceFor(x.kinopoiskId,{fields:x.legacyFacts});if(k)publicIndex[x.id]=k;}
}
async function hydratePrivate(){
  if(!admin)throw Error('Нет доступа');
  const [rows,meta]=await Promise.all([readAll('/rest/v1/kinoteka_entries?select=id,source_key,original_json,version&order=created_at.desc,id',true),readAll('/rest/v1/kinoteka_metadata?select=entry_id,metadata,provider_id,status&order=entry_id',true)]);
  const published=new Set(publicRows.map(x=>x.id));
  privateIndex={};versions.clear();
  for(const m of meta){const k=sourceFor(m.metadata?.legacy?.id||m.provider_id,m.metadata?.legacy);if(k)privateIndex[m.entry_id]=k;}
  privateRows=rows.filter(x=>uuid(x.id)).map(row=>{
    const original=JSON.parse(row.original_json);versions.set(row.id,{version:row.version,source_key:row.source_key,legacyId:original.id});
    return {...original,id:row.id,pub:published.has(row.id)};
  });
}
function cleanRecord(record){
  const d=copy(record),v=versions.get(record.id);
  if(v?.legacyId!=null)d.id=v.legacyId;
  return d;
}
function snapshot(x){
  const k=privateIndex[x.id],a={atmos:str(x.atmos),topic:str(x.topic),noMystic:x.noMystic===true,answers:{},facts:{}};
  for(const [i,g] of groups.entries())for(let j=0;j<g.length-1;j++){const key=i+'_'+j;if(typeof x.answers?.[key]==='string')a.answers[key]=x.answers[key];}
  for(const [key] of criteria){const n=score(x[key]);if(n!==null)a[key]=n;}
  for(const key of ['year','director','writer','camera','music','duration','age'])if(typeof k?.fields?.[key]==='string')a.facts[key]=k.fields[key];
  const card={title:str(x.name),type:x.kind==='Фильм'?'film':'series',year:x.year||null,genres:list(x.genre),countries:list(x.country),synopsis:str(x.desc),authorReview:str(x.review),authorNotes:str(x.note),authorRating:score(x.score),tags:[str(x.atmos),str(x.topic)].filter(Boolean),characteristics:a,recommended:x.recommended===true};
  if(k)card.kinopoiskId=k.id;
  return card;
}
async function writeRecord(record){
  if(!admin)throw Error('Нет доступа');
  const v=versions.get(record.id);
  if(!v)throw Error('Карточка не зарегистрирована');
  const title=str(record.draft?.name||record.name).trim()||str(record.name).trim()||'Без названия';
  const result=await request('/rest/v1/kinoteka_entries?id=eq.'+record.id+'&version=eq.'+v.version+'&select=id,version',{method:'PATCH',auth:true,prefer:'return=representation',body:{title,original_json:JSON.stringify(cleanRecord(record))}});
  if(!Array.isArray(result)||result.length!==1)throw Error('Конфликт версий: данные на сервере изменились. Скачайте копию и войдите заново.');
  v.version=result[0].version;return v.version;
}
function getPending(record){if(!pending.has(record.id))pending.set(record.id,{timer:null,tail:Promise.resolve(),dirty:false,record,error:null});return pending.get(record.id);}
function flush(record){
  const p=getPending(record);clearTimeout(p.timer);p.timer=null;
  const task=p.tail.catch(()=>{}).then(async()=>{
    if(!p.dirty)return versions.get(record.id)?.version;
    p.dirty=false;p.saving=true;try{const v=await writeRecord(copy(record));p.error=null;return v;}catch(e){p.dirty=true;p.error=e;throw e;}finally{p.saving=false;}
  });
  p.tail=task;return task;
}
function queueDraft(record,status){
  const p=getPending(record);p.dirty=true;clearTimeout(p.timer);
  status.textContent='Есть несохранённые изменения…';
  p.timer=setTimeout(()=>{flush(record).then(()=>{if(!p.dirty)status.textContent='Черновик сохранён на сервере';}).catch(e=>{status.textContent=e.message+' Текст остался на странице; скачайте резервную копию.';});},650);
}
function unsaved(){return [...pending.values()].some(p=>p.dirty||p.saving);}
function downloadBackup(){
  if(!admin)return;
  const blob=new Blob([JSON.stringify(privateRows.map(cleanRecord),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='nuglyan-private-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function loginScreen(message=''){
  app.innerHTML='<h1>Личный кабинет</h1><p class="muted">Редактировать медиатеку может только администратор.</p><form id="signin" class="panel createCard"><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Пароль<input type="password" name="password" autocomplete="current-password" required></label><button class="primary">Войти</button><p role="status">'+esc(message)+'</p></form>';
  const form=app.querySelector('#signin');
  form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button'),s=form.querySelector('[role=status]');b.disabled=true;s.textContent='Вход…';
    try{acceptSession(await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:form.elements.email.value,password:form.elements.password.value}}));admin=(await rpc('kinoteka_is_admin',{},true))===true;if(!admin)throw Error('Доступ не предоставлен');await loadPublic();await hydratePrivate();render();}catch(e){session=null;admin=false;privateRows=[];privateIndex={};versions.clear();s.textContent=e.message;}finally{b.disabled=false;form.elements.password.value='';}};
}
async function signout(){
  if(busy)return;
  try{await Promise.all([...pending.values()].map(p=>flush(p.record)));}catch(e){alert('Сначала сохраните или скачайте копию: '+e.message);return;}
  try{await request('/auth/v1/logout',{method:'POST',auth:true});}catch(e){/* local sign-out regardless */}
  session=null;admin=false;privateRows=[];privateIndex={};versions.clear();pending.clear();window.current=null;go('');render();
}
const originalLibrary=library,originalEdit=edit;
library=function(){originalLibrary();app.insertAdjacentHTML('afterbegin','<div class="row admin-tools"><button onclick="downloadBackup()">Экспорт JSON</button><button onclick="signout()">Выйти</button></div>');};
edit=function(x){originalEdit(x);app.querySelector('#editor').insertAdjacentHTML('beforeend','<button onclick="downloadBackup()">Скачать резервную копию</button>');};
render=function(){
  if(!ready)return;
  const [p,id]=location.hash.slice(1).split('/');
  const privateRoute=['library','new','edit'].includes(p);
  document.body.classList.toggle('light',privateRoute);
  if(privateRoute&&!admin){db=[];kpIndex={};loginScreen();return;}
  db=privateRoute?privateRows:publicRows;kpIndex=privateRoute?privateIndex:publicIndex;
  const x=db.find(v=>v.id===id);
  if(p==='library')library();else if(p==='new')startCard();else if(p==='edit'&&x)edit(x);else if(p==='title'&&x)detail(x);else catalog();
};
commit=async function(pub){
  if(!admin||busy||!window.current)return;
  const x=window.current,feedback=document.querySelector('#feedback'),editor=document.querySelector('#editor');
  if(!editor||!feedback)return;
  const d={...x,...x.draft,answers:{...(x.draft||x).answers},states:{...(x.draft||x).states}};
  delete d.draft;
  editor.querySelectorAll('[name]').forEach(el=>{const k=el.name;if(k.startsWith('state-'))d.states[k.slice(6)]=el.value;else if(/^a[0-9]+_/.test(k))d.answers[k.slice(1)]=el.value;else d[k]=el.type==='checkbox'?el.checked:el.value;});
  if(!str(d.name).trim()||editor.querySelector('input:invalid')){feedback.textContent='Проверь название и оценки';return;}
  if(pub&&!confirm('Опубликовать рецензию и ответы анкеты? Личные заметки и черновики останутся закрытыми.'))return;
  busy=true;editor.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=true);
  try{
    x.draft=d;getPending(x).dirty=true;await flush(x);
    if(pub){const published={...d,pub:true};await rpc('kinoteka_publish',{p_id:x.id,p_version:versions.get(x.id).version,p_card:snapshot(published)},true);Object.assign(x,published);delete x.draft;getPending(x).dirty=true;await flush(x);await loadPublic();go('title/'+x.id);}
    else feedback.textContent='Черновик сохранён на сервере';
  }catch(e){feedback.textContent=e.message+'; скачайте резервную копию при необходимости.';}
  finally{busy=false;editor.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=false);}
};
unpublish=async function(){
  if(!admin||busy||!window.current)return;
  const x=window.current;if(!confirm('Снять карточку с публикации?'))return;busy=true;
  try{await flush(x);await rpc('kinoteka_unpublish',{p_id:x.id,p_version:versions.get(x.id).version},true);x.pub=false;getPending(x).dirty=true;await flush(x);await loadPublic();go('library');}catch(e){alert(e.message);}finally{busy=false;}
};
startCard=function(){
  app.innerHTML='<h1>Новое произведение</h1><form class="panel createCard"><label>Название<input name="title" required autocomplete="off"></label><label>Формат<select name="kind"><option>Сериал</option><option>Фильм</option></select></label><button class="primary">Добавить в медиатеку</button><p role="status"></p></form>';
  const form=app.querySelector('form');form.onsubmit=async e=>{e.preventDefault();if(!admin||busy)return;
    const name=form.elements.title.value.trim(),kind=form.elements.kind.value;if(!name)return;
    const existing=privateRows.find(x=>str(x.draft?.name||x.name).trim().toLowerCase()===name.toLowerCase()&&x.kind===kind);if(existing){go('edit/'+existing.id);return;}
    const x={id:crypto.randomUUID(),name,kind,pub:false};busy=true;const b=form.querySelector('button');b.disabled=true;
    try{const rows=await request('/rest/v1/kinoteka_entries?select=id,version',{method:'POST',auth:true,prefer:'return=representation',body:{id:x.id,source_key:'user:'+x.id,title:name,original_json:JSON.stringify(x)}});if(rows?.length!==1)throw Error('Создание не подтверждено');versions.set(x.id,{version:rows[0].version,source_key:'user:'+x.id,legacyId:x.id});privateRows.unshift(x);go('edit/'+x.id);}catch(e){form.querySelector('[role=status]').textContent=e.message;}finally{busy=false;b.disabled=false;}
  };
};
loadExtras=async function(record,editing){
  const board=app.querySelector('.scoreboard'),status=app.querySelector('.sourceStatus');if(!board)return;
  for(const [k,v] of [['kp',record.kinopoiskRating],['imdb',record.imdbRating]])board.querySelector('[data-rating="'+k+'"]').textContent=v??'—';
  if(status)status.textContent=kp(record)?'Справка сохранена. Внешние рейтинги пока не обновлены.':'Источник пока не подтверждён.';
};
reviewList=function(record){
  const review=str(record.review),note=str(record.note),content=review||note;
  if(!content)return '<p>Рецензия появится после публикации.</p>';
  return (review?'':'<small class="muted">Из таблицы · пересказ впечатлений</small>')+'<ul class="reviewPoints">'+content.split(/\r?\n/).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>';
};
window.addEventListener('beforeunload',e=>{if(unsaved()||busy){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',()=>{render();scrollTo(0,0);});
(async()=>{try{await loadPublic();ready=true;render();}catch(e){app.innerHTML='<p class="panel">Не удалось загрузить каталог. <button onclick="location.reload()">Повторить</button></p>';}})();
