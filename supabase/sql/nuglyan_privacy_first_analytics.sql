
create table kinoteka_private.analytics_daily (
 day date not null,
 event text not null check(event in ('visit','search','search_zero','recommendation_shown','recommendation_click','card_open','watch_click')),
 dimension text not null default '',
 total integer not null check(total between 1 and 5000),
 primary key(day,event,dimension)
);
alter table kinoteka_private.analytics_daily enable row level security;
revoke all on kinoteka_private.analytics_daily from public,anon,authenticated;

create function kinoteka_private.track_event(p_event text,p_entry_id uuid,p_topic text)
returns boolean language plpgsql security definer set search_path='' as $$
declare d date := (clock_timestamp() at time zone 'UTC')::date; dim text := ''; n bigint;
begin
 if p_event is null or p_event not in ('visit','search','search_zero','recommendation_shown','recommendation_click','card_open','watch_click') then return false; end if;
 if p_event in ('recommendation_click','card_open','watch_click') then
   if p_entry_id is null or not exists(select 1 from public.kinoteka_publications where entry_id=p_entry_id) then return false; end if;
   dim := p_entry_id::text;
 elsif p_event in ('search','search_zero') then
   dim := case when p_topic in ('detective','thriller','comedy','drama','romance','fantasy','horror','documentary','adventure','crime','family','other') then p_topic else 'other' end;
 end if;
 perform pg_advisory_xact_lock(781130522);
 select coalesce(sum(total),0) into n from kinoteka_private.analytics_daily where day=d;
 if n>=5000 then return false; end if;
 insert into kinoteka_private.analytics_daily(day,event,dimension,total) values(d,p_event,dim,1)
 on conflict(day,event,dimension) do update set total=kinoteka_private.analytics_daily.total+1;
 return true;
end $$;
revoke all on function kinoteka_private.track_event(text,uuid,text) from public,anon,authenticated;
grant execute on function kinoteka_private.track_event(text,uuid,text) to anon,authenticated;

create function public.nuglyan_track_event(p_event text,p_entry_id uuid default null,p_topic text default null)
returns boolean language sql security invoker set search_path='' as $$ select kinoteka_private.track_event(p_event,p_entry_id,p_topic); $$;
revoke all on function public.nuglyan_track_event(text,uuid,text) from public,anon,authenticated;
grant execute on function public.nuglyan_track_event(text,uuid,text) to anon,authenticated;

create function kinoteka_private.analytics_report(p_days integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d date := (now() at time zone 'UTC')::date; start_day date; result jsonb;
begin
 if not kinoteka_private.is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 start_day:=d-(greatest(1,least(coalesce(p_days,30),90))-1);
 with filtered as (select * from kinoteka_private.analytics_daily where day between start_day and d),
 counts as (select event,sum(total) as n from filtered group by event),
 daily as (select day,jsonb_object_agg(event,n) as events from (select day,event,sum(total) n from filtered group by day,event) a group by day),
 topics as (select dimension as topic,sum(total) as searches from filtered where event='search' group by dimension order by searches desc,topic),
 cards as (select f.dimension,p.card->>'title' title,coalesce(sum(f.total) filter(where f.event='card_open'),0) opens,coalesce(sum(f.total) filter(where f.event='watch_click'),0) watch_clicks,coalesce(sum(f.total) filter(where f.event='recommendation_click'),0) recommendation_clicks from filtered f join public.kinoteka_publications p on p.entry_id::text=f.dimension where f.event in ('card_open','watch_click','recommendation_click') group by f.dimension,p.card->>'title' order by opens desc,watch_clicks desc,f.dimension limit 20)
 select jsonb_build_object('from',start_day,'through',d,'timezone','UTC','counts',coalesce((select jsonb_object_agg(event,n) from counts),'{}'::jsonb),'daily',coalesce((select jsonb_agg(to_jsonb(daily) order by day) from daily),'[]'::jsonb),'topics',coalesce((select jsonb_agg(to_jsonb(topics) order by searches desc,topic) from topics),'[]'::jsonb),'top_cards',coalesce((select jsonb_agg(to_jsonb(cards) order by opens desc,watch_clicks desc,dimension) from cards),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function kinoteka_private.analytics_report(integer) from public,anon,authenticated;
grant execute on function kinoteka_private.analytics_report(integer) to authenticated;

create function public.nuglyan_analytics_report(p_days integer default 30)
returns jsonb language sql stable security invoker set search_path='' as $$ select kinoteka_private.analytics_report(p_days); $$;
revoke all on function public.nuglyan_analytics_report(integer) from public,anon,authenticated;
grant execute on function public.nuglyan_analytics_report(integer) to authenticated;
