const criteria=[['direction','Режиссура'],['acting','Актёрская игра'],['script','Сценарий'],['camera','Операторская работа'],['sound','Звук'],['ending','Финал']];
const app=document.querySelector('#app'), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db=[],q='',kind='',sort='',genre='',filters=false;
const groups=[
['Атмосфера и эмоции','Как ощущаются первые двадцать минут?','Как меняется настроение?','Что определяет эмоциональную нагрузку?','Откуда возникает напряжение?','Как работают теплота и юмор?','Какое осталось послевкусие?'],
['Динамика и внимание','Когда история впервые затянула?','Как меняется темп?','Насколько плотны события?','Что теряется, если отвлечься?','Что нужно удерживать в памяти?','Какими порциями удобно смотреть?'],
['Сюжет и темы','Какой вопрос ведёт через историю?','Как устроено повествование?','Как работают повороты?','В чём реалистичность и условность?','Какие темы раскрыты поступками?','Что даёт финал?'],
['Герои и актёрская работа','Чего хочет главный герой?','Как раскрывается характер?','На чём держатся отношения?','Какая сцена объясняет твою оценку игры?'],
['Режиссура и киноязык','Как режиссёр располагает зрителя к герою?','Что дают композиция и ракурсы?','Как движется камера?','Как работают цвет и свет?','Что раскрывают пространство и костюмы?','Что создаёт монтаж?','Как работают музыка и тишина?','Какие визуальные мотивы повторяются?'],
['Ситуация просмотра','Для какого настроения подойдёт?','С кем хочется посмотреть?','Сколько времени стоит выделить?','О каких чувствительных темах предупредить?'],
['Авторский вердикт','Что получилось сильнее всего?','Кому ты советуешь произведение?','Зачем его пересматривать?','С чем оно перекликается и почему?','Как устроены серии и сезоны?','Как меняется качество по сезонам?']];
const go=h=>location.hash=h,link=(h,t)=>'<a href="#'+h+'">'+t+'</a>', save=()=>{throw new Error('Use server persistence')},btn=(t,fn,cls='')=>'<button class="'+cls+'" onclick="'+fn+'">'+t+'</button>';
let kpIndex={};
function kp(x){return kpIndex[x.sourceKey||x.id]}
function img(x){const source=kp(x);return source?'<img loading="lazy" referrerpolicy="no-referrer" src="https://st.kp.yandex.net/images/film_iphone/iphone360_'+source.id+'.jpg" alt="Постер · '+esc(x.name)+'" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="fallback" hidden>'+esc(x.name.slice(0,2))+'</div>':'<div class="fallback">'+esc(x.name.slice(0,2))+'</div>'}
function kpFacts(x){const k=kp(x);if(!k)return '';const labels={year:'Год производства',director:'Режиссёр',writer:'Сценарий',camera:'Оператор',music:'Композитор',duration:x.kind==='Сериал'?'Длительность серии':'Длительность',age:'Возраст'};return '<section class="panel"><h2>Справка Кинопоиска</h2><dl class="facts">'+Object.entries(labels).filter(([key])=>k.fields[key]).map(([key,label])=>'<dt>'+label+'</dt><dd>'+esc(k.fields[key])+'</dd>').join('')+'</dl><a class="source" href="'+esc(k.url)+'" target="_blank" rel="noopener noreferrer">Карточка на Кинопоиске ↗</a></section>'}
function search(v){q=v.trim();render()}
function words(x){return [x.name,x.genre,x.country,x.atmos,x.topic,x.note,x.desc,x.review,...Object.values(x.answers||{})].filter(Boolean).join(' ').toLowerCase().replaceAll('ё','е')}
function rank(x){if(!q)return 1;let s=words(x),v=q.toLowerCase().replaceAll('ё','е');if(v.includes('без мистики')&&!x.noMystic)return 0;if(s.includes(v))return 50;let terms=v.match(/[а-яa-z]{3,}/g)||[];return terms.filter(t=>!['хочу','чтобы','сериал','посмотреть','фильм','без','мистики'].includes(t)).reduce((a,t)=>a+(s.includes(t.slice(0,t.length>5?-2:undefined))?1:0),0)||(+v.includes('без мистики')&&x.noMystic?1:0)}
function card(x){return '<article>'+link('title/'+x.id,'<div class="poster">'+img(x)+'<div class="cap"><small>'+esc([x.year,x.genre].filter(Boolean).join(' · '))+'</small><strong>'+esc(x.name)+'</strong></div></div>')+(q?'<p class="reason">'+esc(x.note||x.atmos||x.genre)+'</p>':'')+'</article>'}
function catalog(){let rows=db.filter(x=>x.pub&&(!kind||x.kind===kind)&&(!genre||x.genre===genre)&&rank(x));rows.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'ru'):sort==='year'?(b.year||0)-(a.year||0):rank(b)-rank(a));app.innerHTML='<section class="hero"><span class="eyebrow">вероничка советует!</span><h1>Что хочется<br>посмотреть?</h1><form onsubmit="event.preventDefault();search(this.query.value)"><input name="query" aria-label="Запрос" placeholder="Название, настроение или тема" value="'+esc(q)+'"><button>Найти</button></form><div class="examples">'+['Психологический','Лёгкий','Детектив'].map(t=>btn(t,"search(\'"+t+"\')")).join('')+'</div></section><div class="bar"><h2>'+(q?'Результаты поиска':'Вся коллекция')+' <small class="muted">'+rows.length+'</small></h2>'+btn('Фильтры','filters=!filters;render()')+'</div><div class="row filters">'+['','Сериал','Фильм'].map((t,i)=>btn(['Все','Сериалы','Фильмы'][i],"kind=\'"+t+"\';render()",kind===t?'active':'')).join('')+(q?btn('Сбросить поиск',"search(\'\')"):'')+'</div>'+(filters?'<div class="row panel"><select aria-label="Жанр" onchange="genre=this.value;render()"><option value="">Все жанры</option>'+[...new Set(db.map(x=>x.genre))].filter(Boolean).map(g=>'<option '+(genre===g?'selected':'')+'>'+esc(g)+'</option>').join('')+'</select><select aria-label="Сортировка" onchange="sort=this.value;render()">'+[['','По соответствию'],['name','По названию'],['year','Сначала новые']].map(([v,t])=>'<option value="'+v+'" '+(sort===v?'selected':'')+'>'+t+'</option>').join('')+'</select></div>':'')+'<section class="grid">'+rows.map(card).join('')+'</section>'+(!rows.length?'<p>Подтверждённых совпадений нет. Попробуй изменить запрос или фильтры.</p>':'')}
function library(){app.innerHTML='<h1>Моя медиатека</h1><div class="row">'+btn('Добавить произведение',"go(\'new\')",'primary')+'</div><section class="panel">'+db.map(x=>'<div class="list"><div><b>'+esc(x.draft?.name||x.name||'Без названия')+'</b><br><small>'+esc(x.draft?.kind||x.kind)+' · '+(x.pub?'В каталоге':'Личная карточка')+'</small></div>'+link('edit/'+x.id,x.draft?'Продолжить разбор':'Разобрать')+'</div>').join('')+'</section>'}
function field(t,k,v,area=false){return '<label>'+esc(t)+(area?'<textarea name="'+k+'">'+esc(v)+'</textarea>':'<input name="'+k+'" value="'+esc(v)+'">')+'</label>'}
function edit(x){let d=x.draft||x;app.innerHTML=link('library','‹ Моя медиатека')+'<h1>'+esc(x.name||'Новое произведение')+'</h1><section class="panel" id="editor">'+field('Название','name',d.name)+'<label>Формат <select name="kind"><option>Сериал</option><option '+(d.kind==='Фильм'?'selected':'')+'>Фильм</option></select></label>'+'<details class="reference"><summary>Справка о произведении</summary><p class="sourceStatus" role="status"></p>'+ field('Год','year',d.year)+field('Страна','country',d.country)+field('Жанр','genre',d.genre)+field('Атмосфера','atmos',d.atmos)+field('Темы','topic',d.topic)+field('Сюжет без спойлеров','desc',d.desc,true)+'</details>'+field('Заметки для себя','privateNote',d.privateNote,true)+field('Публичная рецензия','review',d.review,true)+ratingBlock(d,true)+criteria.map(([key,title])=>'<label>'+title+' <input type="number" min="1" max="10" name="'+key+'" value="'+esc(d[key])+'"></label>').join('')+'<h2>Полный разбор</h2>'+renderChapters(d)+'<label><input style="width:auto" name="noMystic" type="checkbox" '+(d.noMystic?'checked':'')+'> Подтверждаю отсутствие мистики</label><div class="row">'+btn('Сохранить черновик','commit(false)')+btn('Опубликовать в каталоге','commit(true)','primary')+(x.pub?btn('Снять с публикации','unpublish()'):'')+'</div><p id="feedback" role="status"></p></section>';window.current=x;bindEditor(x);loadExtras(x,true)}
function commit(pub){let x=window.current,d={...x,...x.draft,answers:{...(x.draft||x).answers}};delete d.draft;document.querySelectorAll('#editor [name]').forEach(el=>{let k=el.name;if(k.startsWith('state-'))return;if(/^a[0-9]+_/.test(k))d.answers[k.slice(1)]=el.value;else d[k]=el.type==='checkbox'?el.checked:el.value});if(!d.name||document.querySelector('#editor input:invalid')){feedback.textContent='Проверь название и оценку от 1 до 10';return}if(!db.includes(x))db.unshift(x);if(pub){Object.assign(x,d,{pub:true});delete x.draft}else{x.draft=d;if(!x.name)x.name=d.name}save();if(pub)go('title/'+x.id);else{history.replaceState(null,'','#edit/'+x.id);feedback.textContent='Черновик сохранён в этом браузере'}}
function unpublish(){current.pub=false;save();go('library')}
function watchUrl(x){
 const id=String(x.kinopoiskId||kp(x)?.id||'').trim();
 if(!/^\d{1,12}$/.test(id))return null;
 return 'https://g1b-13ngdzu.troutcdn.site/'+id;
}
function watchAction(x){
 const url=watchUrl(x);
 if(!url)return '<div class="watch-action"><small class="muted">Ссылка на просмотр появится после привязки карточки Кинопоиска.</small></div>';
 return '<div class="watch-action"><a class="watch-button" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Смотреть ↗</a><small class="muted">Основной сайт просмотра · откроется в новой вкладке.</small></div>';
}
function detail(x){app.innerHTML=link('','‹ В каталог')+'<section class="panel detail">'+('<div class="detailPoster">'+img(x)+'</div>')+'<div><span class="eyebrow">'+esc(x.kind)+'</span><h1>'+esc(x.name)+'</h1><p>'+esc([x.year,x.country,x.genre].filter(Boolean).join(' · '))+'</p>'+watchAction(x)+'</div></section>'+ratingBlock(x,false)+'<div class="row">'+[x.atmos,x.topic,...criteria.filter(([k])=>x[k]).map(([k,t])=>t+' '+x[k]+'/10')].filter(Boolean).map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div><section class="panel"><h2>О произведении</h2><p>'+esc(x.desc||'Описание пока не добавлено.')+'</p></section>'+kpFacts(x)+'<section class="panel"><h2>Авторский разбор</h2>'+reviewList(x)+groups.map(([g,...qs],i)=>{let a=qs.map((t,j)=>x.answers?.[i+'_'+j]?'<p><b>'+esc(t)+'</b><br>'+esc(x.answers[i+'_'+j])+'</p>':'').join('');return a?'<details><summary>'+g+'</summary>'+a+'</details>':''}).join('')+'</section>';loadExtras(x,false)}

function render(){let [p,id]=location.hash.slice(1).split('/');document.body.classList.toggle('light',['library','new','edit'].includes(p));let x=db.find(v=>v.id===id);if(p==='library')library();else if(p==='new')startCard();else if(p==='edit'&&x)edit(x);else if(p==='title'&&x?.pub)detail(x);else catalog()}
// Initialization is managed by server.js.

const workStates = [
  ['todo', 'Ещё не разбирала'],
  ['started', 'В работе'],
  ['done', 'Готово'],
  ['skip', 'Рассмотрела, добавить нечего']
];

function renderChapters(draft) {
  return groups.map(([title, ...questions], chapter) => {
    const fields = questions.map((question, index) => {
      const key = chapter + '_' + index;
      const state = draft.states?.[key] || (draft.answers?.[key] ? 'started' : 'todo');
      const options = workStates.map(([value, label]) =>
        '<option value="'+value+'" '+(state===value?'selected':'')+'>'+label+'</option>').join('');
      return '<div class="question" data-key="'+key+'">'+field(question,'a'+key,draft.answers?.[key],true)+
        '<label>Статус вопроса <select name="state-'+key+'">'+options+'</select></label></div>';
    }).join('');
    return '<details data-chapter="'+chapter+'"><summary>'+title+' <small class="progress"></small></summary>'+fields+'</details>';
  }).join('');
}

function updateProgress(editor) {
  const film = editor.querySelector('[name="kind"]').value === 'Фильм';
  editor.querySelectorAll('[data-chapter]').forEach(chapter => {
    let done = 0, total = 0;
    chapter.querySelectorAll('.question').forEach(question => {
      question.hidden = film && ['6_4','6_5'].includes(question.dataset.key);
      if (question.hidden) return;
      total++;
      if (['done','skip'].includes(question.querySelector('select').value)) done++;
    });
    chapter.querySelector('.progress').textContent = done+' из '+total;
  });
}

function bindEditor(record) {
  const editor = document.getElementById('editor');
  const status = document.createElement('p');
  status.className = 'saveStatus';
  status.setAttribute('role','status');
  status.textContent = 'Черновик сохраняется на сервере';
  editor.prepend(status);
  updateProgress(editor);
  const last = record.draft?.lastQuestion;
  if (last) {
    const target = editor.querySelector('[data-key="'+CSS.escape(last)+'"]');
    if (target && !target.hidden) {
      target.closest('details').open = true;
      requestAnimationFrame(()=>target.scrollIntoView({block:'center'}));
    }
  }
  function persist(event) {
    const input = event.target;
    if (!input.name) return;
    let draft = record.draft;
    if (!draft) {
      draft = {...record, answers:{...record.answers}, states:{...record.states}};
      record.draft = draft;
    }
    draft.states ||= {};
    draft.answers ||= {};
    const question = input.closest('.question');
    if (question) {
      const key = question.dataset.key;
      draft.lastQuestion = key;
      if (input.tagName === 'TEXTAREA') {
        draft.answers[key] = input.value;
        const select = question.querySelector('select');
        if (select.value === 'todo' && input.value.trim()) select.value = 'started';
        draft.states[key] = select.value;
      } else draft.states[key] = input.value;
    } else draft[input.name] = input.type === 'checkbox' ? input.checked : input.value;
    if (['year','country','genre','topic','atmos','desc'].includes(input.name)) { draft.manualFields ||= {}; draft.manualFields[input.name] = true; }
    if (!db.includes(record)) db.unshift(record);
    if (!record.pub) record.name = draft.name;
    history.replaceState(null,'','#edit/'+record.id);
    updateProgress(editor);
    try {
      queueDraft(record,status);
    } catch {
      status.textContent = 'Не удалось сохранить в браузере. Оставь страницу открытой и скопируй текст.';
    }
  }
  editor.addEventListener('input',persist);
}

function startCard() {
  app.innerHTML = '<h1>Новое произведение</h1><form class="panel createCard"><label>Название или ссылка на Кинопоиск<input name="title" required autocomplete="off"></label><label>Формат <select name="kind"><option>Сериал</option><option>Фильм</option></select></label><button class="primary">Добавить в медиатеку</button><p role="status"></p></form>';
  const form = app.querySelector('form');
  form.onsubmit = event => {
    event.preventDefault();
    const input = form.elements.title.value.trim();
    if (!input) return;
    const id = input.match(/^https?:\/\/(?:www\.)?kinopoisk\.ru\/(?:film|series)\/(\d+)(?:[/?#]|$)/i)?.[1];
    const type = form.elements.kind.value;
    const match = db.find(x => id ? kp(x)?.id === id : x.kind === type && x.name.trim().toLowerCase() === input.toLowerCase());
    if (match) return go('edit/'+match.id);
    if (id) { form.querySelector('[role=status]').textContent='Ссылки пока нет в справочнике. Введи название, чтобы сохранить личную карточку.'; return; }
    const record = {id:crypto.randomUUID(),name:input,kind:type,pub:false};
    db.unshift(record);
    save();
    go('edit/'+record.id);
  };
}

function ratingBlock(record, editing) {
  const mine = editing ? '<input aria-label="Моя оценка" name="score" type="number" min="1" max="10" placeholder="—" value="'+esc(record.score)+'">' : '<strong>'+esc(record.score||'—')+'</strong>';
  return '<section class="scoreboard"><div class="mine"><small>Оценка Вероники</small><div>'+mine+'<span> / 10</span></div></div><div class="externalScores"><div>Кинопоиск <b data-rating="kp">—</b></div><div>IMDb <b data-rating="imdb">—</b></div><small class="ratingDate"></small></div></section>';
}

const extraCache = new Map();
async function loadExtras(record, editing) {
  const board = app.querySelector('.scoreboard');
  const status = app.querySelector('.sourceStatus');
  const key = record.sourceKey || record.id;
  if (!kp(record)) {
    if (status) status.textContent='Источника пока нет. Поля можно заполнить вручную.';
    return;
  }
  if (status) status.textContent='Загружаем справку…';
  try {
    if (!extraCache.has(key)) extraCache.set(key, fetch('facts/'+encodeURIComponent(key)+'.json').then(r=>{
      if (!r.ok) throw Error();
      return r.json();
    }));
    const source = await extraCache.get(key);
    if (!board.isConnected) return;
    for (const type of ['kp','imdb']) board.querySelector('[data-rating="'+type+'"]').textContent=source.ratings[type]||'—';
    if (Object.values(source.ratings).some(Boolean)) board.querySelector('.ratingDate').textContent='По данным Кинопоиска · 26.11.2026';
    if (!editing) return;
    const draft = record.draft || record;
    const values = {...source.editor, year:source.fields.year?.match(/\d{4}/)?.[0]||source.editor.year};
    for (const [name,value] of Object.entries(values)) {
      const field = document.querySelector('#editor [name="'+name+'"]');
      if (field && value && !draft.manualFields?.[name] && !record.draft?.manualFields?.[name] && (!field.value || (!record.draft && name==='year'))) field.value=value;
    }
    status.textContent='Справка загружена. Атмосфера, темы и краткий сюжет взяты из коллекции, если заполнены.';
  } catch {
    extraCache.delete(key);
    if (status) status.textContent='Справка временно недоступна. Можно продолжить разбор.';
  }
}

function reviewList(record) {
  const review = record.review?.trim();
  const content = review || record.note?.trim();
  if (!content) return '<p>Рецензия появится после публикации.</p>';
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ru', {granularity:'sentence'}) : null;
  const points = lines.flatMap(line => {
    const marker = /^(?:[-*•]|\d+[.)])\s+/;
    if (marker.test(line)) return [line.replace(marker,'')];
    return segmenter ? Array.from(segmenter.segment(line), part => part.segment.trim()) : line.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z])/);
  });
  const source = review ? '' : '<small class="muted">Из таблицы · пересказ впечатлений</small>';
  return source+'<ul class="reviewPoints">'+points.map(point=>'<li>'+esc(point)+'</li>').join('')+'</ul>';
}