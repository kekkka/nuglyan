create or replace function kinoteka_private.sync_public_ratings() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status <> 'ready' or new.provider_id is null or new.fetched_at is null then return new; end if;
 update public.kinoteka_publications p
 set card = (p.card - 'kinopoiskRating' - 'imdbRating') || jsonb_strip_nulls(jsonb_build_object(
 'kinopoiskId',new.provider_id::text,
 'kinopoiskRating',case when jsonb_typeof(new.metadata->'kinopoiskRating')='number' then case when (new.metadata->>'kinopoiskRating')::numeric between 0.1 and 10 then new.metadata->'kinopoiskRating' end end,
 'imdbRating',case when jsonb_typeof(new.metadata->'imdbRating')='number' then case when (new.metadata->>'imdbRating')::numeric between 0.1 and 10 then new.metadata->'imdbRating' end end))
 where p.entry_id=new.entry_id and (p.card->>'kinopoiskId' is null or p.card->>'kinopoiskId'=new.provider_id::text);
 return new;
end;$$;
revoke all on function kinoteka_private.sync_public_ratings() from public,anon,authenticated;
create trigger nuglyan_sync_public_ratings after insert or update on public.kinoteka_metadata for each row execute function kinoteka_private.sync_public_ratings();