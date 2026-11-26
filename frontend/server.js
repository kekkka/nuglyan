/* nuglyan: browser-to-Supabase adapter. No secret/service role key. */
const BASE='https://ezycipkttvaoasftqpug.supabase.co';
const KEY='sb_publishable_9XR2EtcnLTfxUj4l8iLYOA_VVV0oGFn';
let session=null, admin=false, publicRows=[], privateRows=[], publicIndex={}, privateIndex={}, ready=false, refreshTask=null, busy=false, ratingsReviewById=new Map();
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
  const kpId=String(c.kinopoiskId||'').trim();
  const watchUrl=/^\d{1,12}$/.test(kpId)?'https://g1b-13ngdzu.troutcdn.site/'+kpId:null;
  return {id:row.entry_id,pub:true,name:str(c.title),kind:c.type==='film'||c.type==='Фильм'?'Фильм':'Сериал',year:c.year,genre:list(c.genres).join(', '),country:list(c.countries).join(', '),desc:str(c.synopsis),note:str(c.authorNotes),review:str(c.authorReview),score:c.authorRating,atmos:str(a.atmos),topic:str(a.topic),answers:a.answers||{},noMystic:a.noMystic===true,...Object.fromEntries(criteria.map(([k])=>[k,a[k]])),kinopoiskId:c.kinopoiskId,watchUrl,kinopoiskRating:c.kinopoiskRating,imdbRating:c.imdbRating,ratingsUpdatedAt:c.ratingsUpdatedAt,ratingsStatus:c.ratingsStatus||null,recommended:c.recommended===true,legacyFacts:a.facts||{}};
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
  for(const x of publicRows){const k=sourceFor(x.kinopoiskId,{fields:{...x.legacyFacts,watchUrl:x.watchUrl}});if(k)publicIndex[x.id]=k;}
}
async function hydratePrivate(){
  if(!admin)throw Error('Нет доступа');
  const [rows,meta]=await Promise.all([readAll('/rest/v1/kinoteka_entries?select=id,source_key,original_json,version&order=created_at.desc,id',true),readAll('/rest/v1/kinoteka_metadata?select=entry_id,metadata,provider_id,status&order=entry_id',true)]);
  const published=new Set(publicRows.map(x=>x.id));
  const metadataById=new Map(meta.map(m=>[m.entry_id,m]));
  ratingsReviewById=new Map(meta.filter(m=>m.status==='needs_review').map(m=>[m.entry_id,{reason:m.metadata?.reason||null,candidates:Array.isArray(m.metadata?.candidates)?m.metadata.candidates:[],checkedAt:m.metadata?.checkedAt||m.updated_at||null}]));
  privateIndex={};versions.clear();
  for(const m of meta){const k=sourceFor(m.provider_id,m.metadata?.legacy||{fields:m.metadata||{}});if(k)privateIndex[m.entry_id]=k;}
  privateRows=rows.filter(x=>uuid(x.id)).map(row=>{
    const original=JSON.parse(row.original_json),metadata=metadataById.get(row.id);
    versions.set(row.id,{version:row.version,source_key:row.source_key,legacyId:original.id});
    return {...original,id:row.id,pub:published.has(row.id),ratingsStatus:metadata?.status||original.ratingsStatus||null};
  });
  const publishedById=new Map(publicRows.map(x=>[x.id,x]));
  for(const record of privateRows){
    const pub=publishedById.get(record.id);if(!pub)continue;
    if(!record.kinopoiskId&&pub.kinopoiskId)record.kinopoiskId=pub.kinopoiskId;
    if(record.kinopoiskRating==null&&pub.kinopoiskRating!=null)record.kinopoiskRating=pub.kinopoiskRating;
    if(record.imdbRating==null&&pub.imdbRating!=null)record.imdbRating=pub.imdbRating;
    if((!Array.isArray(record.watchLinks)||!record.watchLinks.length)&&pub.watchLinks?.length)record.watchLinks=pub.watchLinks;
    if(!record.watchUrl&&pub.watchUrl)record.watchUrl=pub.watchUrl;
    if(!record.ratingsUpdatedAt&&pub.ratingsUpdatedAt)record.ratingsUpdatedAt=pub.ratingsUpdatedAt;
    if(!privateIndex[record.id]&&pub.kinopoiskId)privateIndex[record.id]=sourceFor(pub.kinopoiskId,{fields:{...pub.legacyFacts,watchUrl:pub.watchUrl}});
  }
}
function cleanRecord(record){
  const d=copy(record),v=versions.get(record.id);
  if(v?.legacyId!=null)d.id=v.legacyId;
  return d;
}
function snapshot(x){
  const k=privateIndex[x.id],a={atmos:str(x.atmos),topic:str(x.topic),noMystic:x.noMystic===true,answers:{},facts:{}};
  const watchId=String(k?.id||x.kinopoiskId||'').trim();
  const primaryWatchUrl=/^\d{1,12}$/.test(watchId)?'https://g1b-13ngdzu.troutcdn.site/'+watchId:null;
  for(const [i,g] of groups.entries())for(let j=0;j<g.length-1;j++){const key=i+'_'+j;if(typeof x.answers?.[key]==='string')a.answers[key]=x.answers[key];}
  for(const [key] of criteria){const n=score(x[key]);if(n!==null)a[key]=n;}
  for(const key of ['year','director','writer','camera','music','duration','age'])if(typeof k?.fields?.[key]==='string')a.facts[key]=k.fields[key];
  const card={title:str(x.name),type:x.kind==='Фильм'?'film':'series',year:x.year||null,genres:list(x.genre),countries:list(x.country),synopsis:str(x.desc),authorReview:str(x.review),authorNotes:str(x.note),authorRating:score(x.score),kinopoiskRating:score(x.kinopoiskRating),imdbRating:score(x.imdbRating),ratingsUpdatedAt:x.ratingsUpdatedAt||k?.fields?.fetchedAt||null,watchUrl:primaryWatchUrl,tags:[str(x.atmos),str(x.topic)].filter(Boolean),characteristics:a,recommended:x.recommended===true};
  if(k)card.kinopoiskId=k.id;
  else if(watchId)card.kinopoiskId=watchId;
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
    try{acceptSession(await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:form.elements.email.value,password:form.elements.password.value}}));admin=(await rpc('kinoteka_is_admin',{},true))===true;if(!admin)throw Error('Доступ не предоставлен');await loadPublic();await hydratePrivate();render();refreshPublishedRatings().catch(e=>console.warn('Rating refresh:',e));}catch(e){session=null;admin=false;privateRows=[];privateIndex={};versions.clear();s.textContent=e.message;}finally{b.disabled=false;form.elements.password.value='';}};
}
async function signout(){
  if(busy)return;
  try{await Promise.all([...pending.values()].map(p=>flush(p.record)));}catch(e){alert('Сначала сохраните или скачайте копию: '+e.message);return;}
  try{await request('/auth/v1/logout',{method:'POST',auth:true});}catch(e){/* local sign-out regardless */}
  session=null;admin=false;privateRows=[];privateIndex={};ratingsReviewById.clear();versions.clear();pending.clear();window.current=null;go('');render();
}
const originalLibrary=library,originalEdit=edit;
function ratingCandidateWarnings(record,candidate){
 const warnings=[];
 const expectedYear=Number(record.draft?.year||record.year),candidateYear=Number(candidate.year);
 if(Number.isInteger(expectedYear)&&expectedYear>=1880&&expectedYear<=2100&&Number.isInteger(candidateYear)&&candidateYear>0&&candidateYear!==expectedYear)warnings.push('Год отличается: '+candidateYear+' вместо '+expectedYear);
 const type=String(candidate.type||'').toLowerCase();
 const candidateSeries=['tv-series','animated-series'].includes(type)||candidate.isSeries===true;
 const candidateFilm=['movie','cartoon'].includes(type)||candidate.isSeries===false;
 if((record.kind==='Сериал'&&candidateFilm)||(record.kind==='Фильм'&&candidateSeries))warnings.push('Другой формат: '+(candidateSeries?'сериал':'фильм'));
 const norm=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^a-z0-9а-я]+/gi,' ').trim();
 const target=norm(record.draft?.name||record.name);
 if(target&&![candidate.title,candidate.originalTitle].some(v=>norm(v)===target))warnings.push('Название отличается');
 return warnings;
}
function ratingCandidateMarkup(record,candidate){
 const id=Number(candidate.kinopoiskId),title=str(candidate.title||candidate.originalTitle||'Без названия');
 if(!Number.isSafeInteger(id)||id<=0)return '';
 let poster='';try{const u=new URL(candidate.posterUrl);if(u.protocol==='https:')poster=u.href;}catch{}
 const type=String(candidate.type||'').toLowerCase();
 const format=['tv-series','animated-series'].includes(type)||candidate.isSeries===true?'Сериал':['movie','cartoon'].includes(type)||candidate.isSeries===false?'Фильм':'Формат не указан';
 const warnings=ratingCandidateWarnings(record,candidate);
 const kpScore=score(candidate.kinopoiskRating),imdbScore=score(candidate.imdbRating);
 return '<article class="rating-candidate">'+(poster?'<img loading="lazy" src="'+esc(poster)+'" alt="Постер '+esc(title)+'">':'<div class="rating-candidate-poster">Нет постера</div>')+
 '<div class="rating-candidate-info"><b>'+esc(title)+'</b><small>'+esc([candidate.year&&Number(candidate.year)>0?candidate.year:'Год не указан',format].join(' · '))+'</small><small>Кинопоиск: '+(kpScore===null?'—':kpScore.toFixed(1))+' · IMDb: '+(imdbScore===null?'—':imdbScore.toFixed(1))+'</small>'+
 (warnings.length?'<small class="rating-warning">'+warnings.map(esc).join(' · ')+'</small>':'<small class="rating-match">Название, год и формат совпадают</small>')+
 '<button id="rating-pick-'+record.id+'-'+id+'" onclick="selectRatingCandidate(\''+record.id+'\','+id+')">Подтвердить вариант</button></div></article>';
}
function ratingReviewMarkup(){
 const rows=privateRows.filter(x=>x.pub&&x.ratingsStatus==='needs_review');
 if(!rows.length)return '';
 const reasonText={provider_year_mismatch:'Год в исходной карточке не совпал с найденной записью.',provider_title_mismatch:'Название найденной записи отличается от названия в медиатеке.',provider_kind_mismatch:'Тип произведения не совпал.',provider_identity_mismatch:'Не удалось подтвердить совпадение по всем признакам.'};
 return '<section class="panel rating-review-panel"><div class="rating-review-heading"><div><h2>Проверка внешних оценок</h2><p class="muted">Нужно подтвердить, какое произведение соответствует твоей карточке. Авторские заметки и оценки не меняются.</p></div><span class="tag">'+rows.length+' на проверке</span></div>'+
 '<div class="rating-review-list">'+rows.map(record=>{
  const review=ratingsReviewById.get(record.id)||{},candidates=Array.isArray(review.candidates)?review.candidates:[];
  const visible=candidates.slice(0,3),rest=candidates.slice(3);
  const targetYear=record.draft?.year||record.year||'год не указан';
  const targetKind=record.draft?.kind||record.kind||'формат не указан';
  const candidateList=items=>items.map(c=>ratingCandidateMarkup(record,c)).join('');
  return '<article class="rating-review-item"><div class="rating-review-title"><div><h3>'+esc(record.draft?.name||record.name)+'</h3><small>В медиатеке: '+esc(targetKind)+' · '+esc(targetYear)+'</small></div><span class="tag">Нужно подтвердить</span></div>'+
   '<p class="muted">'+esc(reasonText[review.reason]||'Автоматическая проверка не смогла однозначно определить произведение.')+'</p>'+
   (visible.length?'<div class="rating-candidate-grid">'+candidateList(visible)+'</div>':'<p class="muted">Варианты не найдены. Совпадение пока не привязано.</p>')+
   (rest.length?'<details class="rating-more"><summary>Показать ещё '+rest.length+' вариантов</summary><div class="rating-candidate-grid">'+candidateList(rest)+'</div></details>':'')+
   '<p class="rating-review-status" id="rating-review-status-'+record.id+'" role="status"></p></article>';
 }).join('')+'</div></section>';
}
library=function(){
 originalLibrary();
 app.insertAdjacentHTML('afterbegin','<div class="row admin-tools"><button onclick="downloadBackup()">Экспорт JSON</button><button onclick="refreshPublishedRatings()">Обновить оценки Кинопоиска и IMDb</button><button onclick="signout()">Выйти</button><p id="ratingsSyncStatus" class="rating-sync-status" role="status"></p></div>');
 app.insertAdjacentHTML('beforeend',ratingReviewMarkup());
};
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
    if(pub){const published={...d,pub:true};delete published.draft;try{const meta=await resolveMetadata(published,{persist:false});if(meta?.status==='ready'){privateIndex[x.id]=sourceFor(meta.metadata.kinopoiskId,{fields:meta.metadata});published.kinopoiskId=String(meta.metadata.kinopoiskId);published.kinopoiskRating=meta.metadata.kinopoiskRating??null;published.imdbRating=meta.metadata.imdbRating??null;}}catch(e){console.warn('Kinopoisk matching skipped:',e.message);}const version=await rpc('nuglyan_commit_card',{p_id:x.id,p_version:versions.get(x.id).version,p_title:published.name.trim(),p_original_json:JSON.stringify(cleanRecord(published)),p_action:'publish',p_card:snapshot(published)},true);versions.get(x.id).version=version;Object.assign(x,published);delete x.draft;feedback.textContent='Карточка опубликована';try{await loadPublic();go('title/'+x.id);}catch(e){feedback.textContent='Карточка опубликована. Не удалось обновить каталог; обновите страницу.';}}
    else feedback.textContent='Черновик сохранён на сервере';
  }catch(e){feedback.textContent=e.message+'; скачайте резервную копию при необходимости.';}
  finally{busy=false;editor.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=false);}
};
unpublish=async function(){
  if(!admin||busy||!window.current)return;
  const x=window.current;if(!confirm('Снять карточку с публикации?'))return;busy=true;
  try{await flush(x);const next={...x,pub:false};const version=await rpc('nuglyan_commit_card',{p_id:x.id,p_version:versions.get(x.id).version,p_title:(next.draft?.name||next.name).trim(),p_original_json:JSON.stringify(cleanRecord(next)),p_action:'unpublish',p_card:null},true);versions.get(x.id).version=version;x.pub=false;try{await loadPublic();}catch(e){alert('Публикация снята, но каталог не обновился. Обновите страницу.');}go('library');}catch(e){alert(e.message);}finally{busy=false;}
};
async function resolveMetadata(record,options={}){
 if(!admin||!session||!record?.id)return null;
 const year=Number(record.draft?.year||record.year);
 const body={action:options.action||(options.providerId?'refresh':'search'),entryId:record.id,year:Number.isInteger(year)&&year>=1880&&year<=2100?year:null,isSeries:record.kind==='Сериал'};
 if(options.providerId)body.providerId=Number(options.providerId);
 if(options.confirmed===true)body.confirmed=true;
 const response=await fetch(BASE+'/functions/v1/nuglyan-metadata',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 const result=await response.json().catch(()=>({error:'invalid_response'}));
 if(!response.ok)throw Error(result.error||'Не удалось получить внешние оценки');
 if(result.status==='ready'&&result.metadata?.kinopoiskId){
   const meta=result.metadata;
   privateIndex[record.id]=sourceFor(meta.kinopoiskId,{fields:meta});
   record.kinopoiskId=String(meta.kinopoiskId);
   record.kinopoiskRating=meta.kinopoiskRating??null;
   record.imdbRating=meta.imdbRating??null;
   record.ratingsUpdatedAt=meta.fetchedAt||new Date().toISOString();
   if(options.persist!==false){await flush(record);await writeRecord(record);}
   if(window.current?.id===record.id)await loadExtras(record,true);
 }
 return result;
}

async function selectRatingCandidate(entryId,providerId){
 if(!admin||!session||busy)return;
 const record=privateRows.find(x=>x.id===entryId&&x.pub);
 const review=ratingsReviewById.get(entryId);
 const candidate=review?.candidates?.find(x=>Number(x.kinopoiskId)===Number(providerId));
 if(!record||!candidate){alert('Вариант устарел. Обнови страницу медиатеки и попробуй снова.');return;}
 const title=str(candidate.title||candidate.originalTitle||'Без названия');
 const format=String(candidate.type||'').toLowerCase();
 const kind=['tv-series','animated-series'].includes(format)||candidate.isSeries===true?'сериал':['movie','cartoon'].includes(format)||candidate.isSeries===false?'фильм':'формат не определён';
 const warnings=ratingCandidateWarnings(record,candidate);
 const warningText=warnings.length?'\n\nВнимание: '+warnings.join('; ')+'.':'';
 if(!confirm('Подтвердить привязку «'+title+'» ('+(candidate.year||'год не указан')+', '+kind+') к карточке «'+(record.draft?.name||record.name)+'»?'+warningText+'\n\nПосле подтверждения оценки Кинопоиска и IMDb появятся в карточке.'))return;
 const localStatus=document.getElementById('rating-review-status-'+entryId);
 const button=document.getElementById('rating-pick-'+entryId+'-'+providerId);
 if(button)button.disabled=true;
 if(localStatus)localStatus.textContent='Проверяем выбранную запись и сохраняем оценки…';
 busy=true;
 try{
  const result=await resolveMetadata(record,{providerId,action:'select',confirmed:true,persist:false});
  if(result?.status!=='ready'||!result.metadata?.kinopoiskId)throw Error(result?.error||'Не удалось подтвердить выбранный вариант');
  record.ratingsStatus='ready';
  const versionState=versions.get(record.id);
  if(!versionState)throw Error('Не найдена версия карточки. Обнови страницу и повтори попытку.');
  const nextVersion=await rpc('nuglyan_commit_card',{
   p_id:record.id,p_version:versionState.version,
   p_title:str(record.draft?.name||record.name).trim(),
   p_original_json:JSON.stringify(cleanRecord(record)),
   p_action:'publish',p_card:snapshot(record)
  },true);
  versionState.version=nextVersion;
  ratingsReviewById.delete(record.id);
  await loadPublic();
  await hydratePrivate();
  db=privateRows;kpIndex=privateIndex;
  render();
  const status=document.getElementById('ratingsSyncStatus');
  if(status)status.textContent='Совпадение подтверждено: '+(record.draft?.name||record.name)+'. Оценки сохранены.';
 }catch(e){
  if(localStatus)localStatus.textContent='Не удалось сохранить: '+e.message;
  const status=document.getElementById('ratingsSyncStatus');
  if(status)status.textContent='Ошибка проверки: '+e.message;
  if(button)button.disabled=false;
 }finally{busy=false;}
}
let ratingRefreshTask=null;
async function refreshPublishedRatings(force=false){
 if(!admin||!session){const el=document.getElementById('ratingsSyncStatus');if(el)el.textContent='Сначала войдите в личный кабинет администратора.';return {updated:0,failed:0};}
 if(ratingRefreshTask)return ratingRefreshTask;
 ratingRefreshTask=(async()=>{
  const cutoff=Date.now()-30*24*60*60*1000;
  const privateById=new Map(privateRows.map(x=>[x.id,x]));
  const jobs=publicRows.filter(pub=>{
   const metadataStatus=privateById.get(pub.id)?.ratingsStatus;
   if(!force&&(metadataStatus==='ready'||metadataStatus==='needs_review'))return false;
   const fetched=Date.parse(pub.ratingsUpdatedAt||'');
   const hasAnyRating=pub.kinopoiskRating!=null||pub.imdbRating!=null;
   const stale=Number.isFinite(fetched)&&fetched<cutoff;
   // Existing scores without a timestamp are kept; do not re-fetch populated cards.
   return force||(!hasAnyRating)||stale;
  });
  let updated=0,failed=0,skipped=0,needsReview=0;
  const status=()=>document.getElementById('ratingsSyncStatus');
  const report=message=>{if(status())status().textContent=message;};
  if(!jobs.length){const pendingReview=privateRows.filter(x=>x.ratingsStatus==='needs_review').length;report(publicRows.length?'Внешние оценки актуальны. На ручной проверке: '+pendingReview+'.':'В медиатеке пока нет опубликованных произведений.');return {updated,failed,skipped,needsReview:pendingReview};}
  report('Обновляем оценки: 0 из '+jobs.length+'…');
  for(let i=0;i<jobs.length;i++){
   const pub=jobs[i],record=privateById.get(pub.id);
   if(!record){skipped++;report('Обновляем оценки: '+(i+1)+' из '+jobs.length+' · успешно '+updated+' · на проверке '+needsReview+' · ошибок '+failed+' · пропущено '+skipped);continue;}
   try{
    if(!record.kinopoiskId&&pub.kinopoiskId)record.kinopoiskId=pub.kinopoiskId;
    const result=await resolveMetadata(record,{providerId:pub.kinopoiskId,persist:false});
    if(result?.status==='needs_review'){
     // Candidate list and review state are already persisted in kinoteka_metadata.
     // Do not republish a public card just to store an internal review flag.
     record.ratingsStatus='needs_review';
     ratingsReviewById.set(record.id,{reason:result.reason||null,candidates:Array.isArray(result.candidates)?result.candidates:[],checkedAt:new Date().toISOString()});
     needsReview++;
    }else{
     if(result?.status!=='ready')throw Error('metadata_not_ready');
     record.ratingsStatus='ready';
     ratingsReviewById.delete(record.id);
     const version=await rpc('nuglyan_commit_card',{p_id:record.id,p_version:versions.get(record.id).version,p_title:str(record.draft?.name||record.name).trim(),p_original_json:JSON.stringify(cleanRecord(record)),p_action:'publish',p_card:snapshot(record)},true);
     versions.get(record.id).version=version;
     updated++;
    }
   }catch(e){failed++;console.warn('Не удалось обновить оценки для '+pub.name+':',e);}
   report('Обновляем оценки: '+(i+1)+' из '+jobs.length+' · успешно '+updated+' · на проверке '+needsReview+' · ошибок '+failed+' · пропущено '+skipped);
   await new Promise(resolve=>setTimeout(resolve,180));
  }
  await loadPublic();
  const route=location.hash.slice(1).split('/')[0];
  if(route==='library'){render();report('Готово: обновлено '+updated+' из '+jobs.length+'. На ручной проверке: '+needsReview+'. Ошибок: '+failed+'.');}
  else if(route==='title'){db=publicRows;kpIndex=publicIndex;render();}
  else if(route!=='edit'){db=publicRows;kpIndex=publicIndex;}
  return {updated,failed,skipped,needsReview};
 })().finally(()=>{ratingRefreshTask=null;});
 return ratingRefreshTask;
}

startCard=function(){
  app.innerHTML='<h1>Новое произведение</h1><form class="panel createCard"><label>Название<input name="title" required autocomplete="off"></label><label>Формат<select name="kind"><option>Сериал</option><option>Фильм</option></select></label><button class="primary">Добавить в медиатеку</button><p role="status"></p></form>';
  const form=app.querySelector('form');form.onsubmit=async e=>{e.preventDefault();if(!admin||busy)return;
    const name=form.elements.title.value.trim(),kind=form.elements.kind.value;if(!name)return;
    const existing=privateRows.find(x=>str(x.draft?.name||x.name).trim().toLowerCase()===name.toLowerCase()&&x.kind===kind);if(existing){go('edit/'+existing.id);return;}
    const x={id:crypto.randomUUID(),name,kind,pub:false};busy=true;const b=form.querySelector('button');b.disabled=true;
    try{const rows=await request('/rest/v1/kinoteka_entries?select=id,version',{method:'POST',auth:true,prefer:'return=representation',body:{id:x.id,source_key:'user:'+x.id,title:name,original_json:JSON.stringify(x)}});if(rows?.length!==1)throw Error('Создание не подтверждено');versions.set(x.id,{version:rows[0].version,source_key:'user:'+x.id,legacyId:x.id});privateRows.unshift(x);go('edit/'+x.id);resolveMetadata(x).catch(()=>{});}catch(e){form.querySelector('[role=status]').textContent=e.message;}finally{busy=false;b.disabled=false;}
  };
};
loadExtras=async function(record,editing){
  const board=app.querySelector('.scoreboard'),status=app.querySelector('.sourceStatus');if(!board)return;
  for(const [k,v] of [['kp',record.kinopoiskRating],['imdb',record.imdbRating]])board.querySelector('[data-rating="'+k+'"]').textContent=v==null?'—':Number(v).toFixed(1);
  const date=record.ratingsUpdatedAt?new Date(record.ratingsUpdatedAt):null;
  const dateLabel=date&&!Number.isNaN(date.getTime())?'Обновлено '+date.toLocaleDateString('ru-RU'):'';
  const dateNode=board.querySelector('.ratingDate');if(dateNode)dateNode.textContent=dateLabel;
  if(status)status.textContent=record.ratingsStatus==='needs_review'?'Нужно проверить соответствие карточки Кинопоиска.':kp(record)?'Справка и внешние оценки загружены.':'Точное совпадение в Кинопоиске не найдено; внешние оценки не добавлены.';
};
reviewList=function(record){
  const review=str(record.review),note=str(record.note),content=review||note;
  if(!content)return '<p>Рецензия появится после публикации.</p>';
  return (review?'':'<small class="muted">Из таблицы · пересказ впечатлений</small>')+'<ul class="reviewPoints">'+content.split(/\r?\n/).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>';
};

/* Free, server-backed search over public cards only. */
let searchMode='recommend', searchResult={key:'',state:'idle',hits:new Map(),message:''}, searchRun=0;
function parseSearch(raw,kind,mode){
  const clean=String(raw).trim().slice(0,200), norm=clean.toLowerCase().replaceAll('ё','е');
  const selected=kind==='Фильм'?'film':kind==='Сериал'?'series':null;
  if(mode==='title')return {term:clean,type:selected,strict:false,excluded:'',unsupported:false};
  const film=/(^|\s)фильм(?:ы|а|ов)?(?=$|[\s,.!?])/.test(norm), series=/(^|\s)сериал(?:ы|а|ов)?(?=$|[\s,.!?])/.test(norm);
  let term=norm, strict=false, excluded='';
  term=term.replace(/(?:^|\s)без\s+мистик[аиу]?(?=$|[\s,.!?])/g,()=>{strict=true;return ' ';});
  term=term.replace(/(?:^|\s)без\s+([а-яa-z-]+(?:\s+[а-яa-z-]+)?)[.!?]*$/g,(_,v)=>{excluded=v;return ' ';});
  const unsupported=/(?:^|\s)(?:без|не|кроме)(?=$|\s)/.test(term);
  term=term.replace(/(?:^|\s)(?:хочу|посмотреть|смотреть|подбери|покажи|найди|пожалуйста|что-нибудь|что-то|мне|кино|фильмы?|сериалы?|вечером|вечер|посоветуй|на|для)(?=$|[\s,.!?])/g,' ').replace(/[,.!?;]+/g,' ').replace(/\s+/g,' ').trim();
  return {term,type:selected||(film&&!series?'film':series&&!film?'series':null),strict,excluded,unsupported};
}
const searchKey=()=>JSON.stringify([q,kind,searchMode]);
const isCatalogRoute=()=>!['library','new','edit','title'].includes(location.hash.slice(1).split('/')[0]);
async function runCatalogSearch(key){
  const run=++searchRun,mode=searchMode,p=parseSearch(q,kind,mode);
  searchResult={key,state:'loading',hits:new Map(),message:''};
  try{
    let rows=[],message='';
    const eligible=x=>(!p.type||(x.kind==='Фильм'?'film':'series')===p.type)&&(!p.strict||x.noMystic===true);
    if(p.unsupported){message='Уточни запрос: например «детектив без мистики». Другие отрицательные условия пока не поддерживаются полностью.';}
    else if(!p.term&&!p.strict&&!p.excluded){message='Добавь название, тему или настроение.';}
    else if(!p.term&&!p.strict){message='Добавь тему или жанр к исключению.';}
    else if(!p.term){rows=publicRows.filter(eligible).map(x=>({entry_id:x.id,score:1,reasons:['Отсутствие мистики подтверждено автором']}));}
    else if(mode==='title'){rows=await rpc('kinoteka_search',{p_query:p.term,p_type:p.type,p_limit:50,p_offset:0});}
    else{
      rows=await rpc('kinoteka_recommend',{p_query:p.term,p_type:p.type,p_exclude:p.excluded,p_limit:30});
      const exact=publicRows.filter(x=>eligible(x)&&!p.excluded&&x.name.toLowerCase().replaceAll('ё','е')===p.term);
      for(const x of exact){rows=rows.filter(r=>r.entry_id!==x.id);rows.unshift({entry_id:x.id,score:1000,reasons:['Точное совпадение названия']});}
    }
    const lookup=new Map(publicRows.map(x=>[x.id,x]));
    const hits=new Map(rows.filter(r=>lookup.has(r.entry_id)&&eligible(lookup.get(r.entry_id))).map(r=>[r.entry_id,{score:Math.max(0.01,Number(r.score??r.relevance)||0),reasons:list(r.reasons).length?list(r.reasons):['Совпадение в каталоге']}]));
    if(p.strict&&!p.unsupported)message='Показываем только карточки с подтверждённым автором отсутствием мистики.';
    if(p.excluded)message+=(message?' ':'')+'Исключение по упоминаниям: '+p.excluded+'. Отсутствие темы не гарантируется.';
    if(run!==searchRun||key!==searchKey())return;
    searchResult={key,state:'done',hits,message};
  }catch(e){if(run!==searchRun||key!==searchKey())return;searchResult={key,state:'error',hits:new Map(),message:'Поиск временно недоступен. Попробуй ещё раз.'};}
  if(isCatalogRoute()){
    const input=app.querySelector('input[name=query]'),draft=input?.value;
    render();
    if(draft!==undefined&&draft!==q){const next=app.querySelector('input[name=query]');if(next)next.value=draft;}
  }
}
search=function(value){q=String(value||'').trim().slice(0,200);searchRun++;searchResult={key:'',state:'idle',hits:new Map(),message:''};render();};
function setSearchMode(mode){searchMode=mode;search(q);}
rank=function(x){return !q?1:(searchResult.hits.get(x.id)?.score||0);};
const originalSearchCard=card, originalCatalog=catalog;
card=function(x){
  if(!q||!searchResult.hits.has(x.id))return originalSearchCard(x);
  const hit=searchResult.hits.get(x.id);
  return '<article>'+link('title/'+x.id,'<div class="poster">'+img(x)+'<div class="cap"><small>'+esc([x.year,x.genre].filter(Boolean).join(' · '))+'</small><strong>'+esc(x.name)+'</strong></div></div>')+'<p class="reason">'+hit.reasons.map(esc).join(' · ')+(x.atmos?' · '+esc(x.atmos):'')+'</p></article>';
};
catalog=function(){
  if(q&&searchResult.key!==searchKey())runCatalogSearch(searchKey());
  originalCatalog();
  const bar=app.querySelector('.bar');
  if(bar)bar.insertAdjacentHTML('beforebegin','<div class="row filters" aria-label="Режим поиска">'+btn('Подбор по настроению',"setSearchMode('recommend')",searchMode==='recommend'?'active':'')+btn('Поиск по каталогу',"setSearchMode('title')",searchMode==='title'?'active':'')+'</div>');
  const examples=app.querySelector('.examples');if(examples)examples.insertAdjacentHTML('beforeend',btn('Без мистики',"search('Без мистики')"));
  const input=app.querySelector('input[name=query]');if(input)input.maxLength=200;
  if(!q)return;
  const h=bar?.querySelector('h2');if(h&&searchMode==='recommend')h.firstChild.textContent='Подборка для тебя ';
  const empty=app.querySelector('.grid')?.nextElementSibling;
  if(searchResult.state==='loading'){if(h?.querySelector('small'))h.querySelector('small').textContent='…';if(empty)empty.textContent='Ищем в коллекции…';}
  if(searchResult.state==='error'&&empty){empty.textContent=searchResult.message;empty.insertAdjacentHTML('beforeend',' '+btn('Повторить',"search(q)"));}
  if(searchResult.message&&searchResult.state!=='error')app.querySelector('.grid')?.insertAdjacentHTML('beforebegin','<p class="server-status" role="status">'+esc(searchResult.message)+'</p>');
  if(searchResult.state==='done'&&searchResult.hits.size)app.insertAdjacentHTML('beforeend','<p class="muted">Поиск по опубликованным карточкам. '+(searchMode==='recommend'?'До 30 совпадений; подбор по словам и авторским оценкам, не гарантия всех пожеланий.':'До 50 совпадений.')+'</p>');
};

window.addEventListener('beforeunload',e=>{if(unsaved()||busy){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',()=>{render();scrollTo(0,0);});
(async()=>{try{await loadPublic();ready=true;render();}catch(e){app.innerHTML='<p class="panel">Не удалось загрузить каталог. <button onclick="location.reload()">Повторить</button></p>';}})();
