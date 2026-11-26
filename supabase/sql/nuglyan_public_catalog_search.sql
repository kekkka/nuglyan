create function kinoteka_private.search_document(c jsonb) returns tsvector language sql immutable parallel safe set search_path='' as $$
 select setweight(to_tsvector('pg_catalog.russian',replace(lower(coalesce(c->>'title','')||' '||coalesce(c->>'originalTitle','')),'ё','е')),'A')
 || setweight(to_tsvector('pg_catalog.russian',replace(lower(coalesce(c->>'genres','')||' '||coalesce(c->>'tags','')||' '||coalesce(c->>'characteristics','')),'ё','е')),'B')
 || setweight(to_tsvector('pg_catalog.russian',replace(lower(coalesce(c->>'synopsis','')||' '||coalesce(c->>'authorReview','')||' '||coalesce(c->>'authorNotes','')||' '||coalesce(c->>'countries','')),'ё','е')),'C');
$$;
revoke all on function kinoteka_private.search_document(jsonb) from public, anon, authenticated;
grant usage on schema kinoteka_private to anon;
grant execute on function kinoteka_private.search_document(jsonb) to anon, authenticated;
create index kinoteka_publications_search_idx on public.kinoteka_publications using gin(kinoteka_private.search_document(card));
create function public.kinoteka_search(p_query text default '',p_type text default null,p_limit integer default 20,p_offset integer default 0)
returns table(entry_id uuid, card jsonb, relevance real, published_at timestamptz)
language sql stable security invoker set search_path='' as $$
 with q as (
 select replace(lower(btrim(left(coalesce(p_query,''),200))),'ё','е') as term
 ), params as (
 select term, websearch_to_tsquery('pg_catalog.russian',term) as tsq from q
 ), matches as (
 select p.entry_id,p.card,p.published_at,
 (case when params.term='' then 0::real else
 ts_rank_cd(kinoteka_private.search_document(p.card),params.tsq)
 + case when replace(lower(coalesce(p.card->>'title','')),'ё','е')=params.term then 2::real
 when strpos(replace(lower(coalesce(p.card->>'title','')),'ё','е'),params.term)>0 then 0.5::real else 0::real end end) as relevance
 from public.kinoteka_publications p cross join params
 where (p_type is null or p.card->>'type'=p_type)
 and (params.term='' or kinoteka_private.search_document(p.card) @@ params.tsq or strpos(replace(lower(coalesce(p.card->>'title','')),'ё','е'),params.term)>0)
 )
 select m.entry_id,m.card,m.relevance,m.published_at from matches m
 order by m.relevance desc,m.published_at desc,m.entry_id
 limit greatest(1,least(coalesce(p_limit,20),50)) offset greatest(0,least(coalesce(p_offset,0),10000));
$$;
revoke all on function public.kinoteka_search(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.kinoteka_search(text,text,integer,integer) to anon,authenticated;