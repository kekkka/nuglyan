create function public.kinoteka_recommend(p_query text default '',p_type text default null,p_exclude text default '',p_limit integer default 10)
returns table(entry_id uuid,card jsonb,score numeric,reasons text[],published_at timestamptz)
language sql stable security invoker set search_path='' as $$
with input as (
 select replace(lower(left(coalesce(p_query,''),300)),'ё','е') as raw,
 replace(lower(left(coalesce(p_exclude,''),200)),'ё','е') as excluded,
 nullif(lower(btrim(p_type)),'') as wanted_type
), parsed as (
 select regexp_replace(raw,'\m(хочу|посмотреть|смотреть|подбери|покажи|найди|пожалуйста|что-нибудь|что|нибудь|мне|кино|фильм|сериал|вечером|вечер|посоветуйте|посоветуй)\M',' ','g') as term, excluded,wanted_type from input
), tokens as (
 select distinct unnest(tsvector_to_array(to_tsvector('pg_catalog.russian',term))) as token from parsed
), features as (
 select p.entry_id,p.card,p.published_at,kinoteka_private.search_document(p.card) as doc,
 case when jsonb_typeof(p.card->'authorRating') in ('number','string') and p.card->>'authorRating' ~ '^[0-9]{1,2}(\.[0-9]{1,2})?$' then
 case when (p.card->>'authorRating')::numeric between 0 and 10 then (p.card->>'authorRating')::numeric end end as rating,
 coalesce(p.card->'recommended'='true'::jsonb,false) as rec
 from public.kinoteka_publications p cross join parsed t
 where (t.wanted_type is null or lower(p.card->>'type')=t.wanted_type)
 and (numnode(plainto_tsquery('pg_catalog.russian',t.excluded))=0 or not (kinoteka_private.search_document(p.card) @@ plainto_tsquery('pg_catalog.russian',t.excluded)))
), matched as (
 select f.*,(select count(*) from tokens t where t.token=any(tsvector_to_array(f.doc))) as hits,
 (select count(*) from tokens) as total from features f
), ranked as (
 select m.*, round(case when total=0 then 0 else 70.0*hits/total end + coalesce(rating/10*20,0) + case when rec then 10 else 0 end,2) as rank_score
 from matched m where total=0 or hits>0
)
select r.entry_id,r.card,r.rank_score,array_remove(array[
 case when r.total>0 then 'Совпадение с запросом: '||r.hits||' из '||r.total||' поисковых слов' end,
 case when r.rating is not null then 'Авторская оценка: '||r.rating||'/10' end,
 case when r.rec then 'Вероничка советует!' end
],null),r.published_at
from ranked r order by r.rank_score desc,r.rating desc nulls last,r.published_at desc,r.entry_id
limit greatest(1,least(coalesce(p_limit,10),30));
$$;
revoke all on function public.kinoteka_recommend(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.kinoteka_recommend(text,text,text,integer) to anon,authenticated;