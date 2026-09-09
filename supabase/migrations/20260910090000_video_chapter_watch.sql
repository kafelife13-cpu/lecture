-- Per-question history is private, even if legacy aggregate progress is public.
create table if not exists public.video_chapter_watch (
  student_id text not null references public.users(id) on delete cascade,
  video_id text not null references public.videos(id) on delete cascade,
  source_id text not null check(source_id ~ '^[A-Za-z0-9_-]{11}$'),
  seconds integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key(student_id,video_id,source_id)
);
alter table public.video_chapter_watch enable row level security;
revoke all on public.video_chapter_watch from public,anon,authenticated;

create or replace function public.video_chapter_watch_rpc(
  p_id text,p_password text,p_role text,p_action text,p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  account jsonb;
  vid text:=p_payload->>'video_id';
  source text:=p_payload->>'source_id';
  actual_source text;
  incoming integer[];
  output jsonb;
begin
  account:=public.authenticate_user(p_id,p_password,p_role);
  if account is null or p_role not in ('student','teacher') then raise exception 'Authentication required'; end if;
  if p_role='student' and account->>'status' is distinct from 'active' then raise exception 'Active student required'; end if;
  select substring(url from '(?:youtu[.]be/|[?&]v=|embed/)([A-Za-z0-9_-]{11})')
    into actual_source from public.videos where id=vid;
  if source is null or source is distinct from actual_source then raise exception 'Video source mismatch'; end if;
  if p_action='read' then
    select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) into output
      from public.video_chapter_watch w
      where w.video_id=vid and w.source_id=source and (p_role='teacher' or w.student_id=p_id);
    return output;
  elsif p_action='save' and p_role='student' then
    if jsonb_typeof(p_payload->'seconds') is distinct from 'array' then raise exception 'Invalid watched seconds'; end if;
    if jsonb_array_length(p_payload->'seconds')>86400 or exists(
      select 1 from jsonb_array_elements(p_payload->'seconds') as item(value)
      where jsonb_typeof(value)<>'number' or (value#>>'{}') !~ '^[0-9]{1,5}$'
    ) then raise exception 'Invalid watched seconds'; end if;
    select coalesce(array_agg(distinct value::integer order by value::integer),'{}'::integer[]) into incoming
      from jsonb_array_elements_text(p_payload->'seconds') where value::integer between 0 and 86399;
    insert into public.video_chapter_watch as saved(student_id,video_id,source_id,seconds)
      values(p_id,vid,source,incoming)
      on conflict(student_id,video_id,source_id) do update
      set seconds=(select array_agg(distinct s order by s) from unnest(saved.seconds||excluded.seconds) as s),updated_at=now()
      returning to_jsonb(saved) into output;
    return output;
  end if;
  raise exception 'Action not permitted';
end;
$$;
revoke all on function public.video_chapter_watch_rpc(text,text,text,text,jsonb) from public;
grant execute on function public.video_chapter_watch_rpc(text,text,text,text,jsonb) to anon,authenticated;
