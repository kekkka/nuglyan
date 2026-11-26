create or replace function public.nuglyan_commit_card(p_id uuid,p_version bigint,p_title text,p_original_json text,p_action text,p_card jsonb default null)
returns bigint language plpgsql security invoker set search_path='' as $$
declare v bigint;
begin
 if not kinoteka_private.is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_action not in ('publish','unpublish') or p_action is null then raise exception 'Invalid action' using errcode='22023'; end if;
 update public.kinoteka_entries set title=p_title,original_json=p_original_json where id=p_id and version=p_version returning version into v;
 if v is null then raise exception 'Version conflict' using errcode='40001'; end if;
 if p_action='publish' then perform public.kinoteka_publish(p_id,v,p_card); else perform public.kinoteka_unpublish(p_id,v); end if;
 return v;
end;$$;
revoke all on function public.nuglyan_commit_card(uuid,bigint,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.nuglyan_commit_card(uuid,bigint,text,text,text,jsonb) to authenticated;