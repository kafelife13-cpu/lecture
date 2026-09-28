-- Private Drive catalog. No Google tokens, source content, or student records stored here.
begin;
create table if not exists public.odap_drive_runs (
 id uuid primary key default gen_random_uuid(), actor text not null, account text not null,
 status text not null default 'running' check(status in ('running','complete','failed')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 pages integer not null default 0, files integer not null default 0, error text
);
create table if not exists public.odap_drive_files (
 id text primary key, name text not null, mime_type text not null, bytes bigint not null default 0,
 modified_time text not null default '', parents jsonb not null default '[]', drive_id text,
 sha256 text, md5 text, can_download boolean not null default false,
 last_run uuid references public.odap_drive_runs(id), seen_at timestamptz not null default now(),
 source_id uuid references public.odap_sources(id), source_modified_time text,
 requested_at timestamptz
);
create index if not exists odap_drive_files_run_idx on public.odap_drive_files(last_run);
create index if not exists odap_drive_files_source_idx on public.odap_drive_files(source_id);
alter table public.odap_drive_files enable row level security;
alter table public.odap_drive_runs enable row level security;
revoke all on public.odap_drive_files,public.odap_drive_runs from public,anon,authenticated;

create or replace function public.odap_drive(p_id text,p_password text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor jsonb; run public.odap_drive_runs%rowtype; f jsonb; result jsonb; v_id uuid;
 n integer; v_q text:=left(coalesce(p_payload->>'q',''),200); v_kind text:=coalesce(p_payload->>'kind','');
 v_offset integer:=greatest(0,least(coalesce((p_payload->>'offset')::integer,0),1000000));
begin
 actor:=public.authenticate_user(p_id,p_password,'teacher');
 if actor is null or actor->>'status' is distinct from 'active' or actor->>'role' is distinct from 'teacher' then raise exception '교사 로그인이 필요합니다.';end if;
 if p_action='config' then
  return jsonb_build_object('client_id',coalesce((select value#>>'{}' from public.odap_settings where key='drive_client_id'),''));
 elsif p_action='configure' then
  if coalesce(p_payload->>'client_id','') !~ '^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$' then raise exception 'Google 웹 클라이언트 ID를 확인하세요.';end if;
  insert into public.odap_settings(key,value) values('drive_client_id',p_payload->'client_id') on conflict(key) do update set value=excluded.value;
  return '{"saved":true}';
 elsif p_action='begin' then
  if coalesce(p_payload->>'account','')='' then raise exception '연결한 Google 계정을 확인하세요.';end if;
  insert into public.odap_drive_runs(actor,account) values(p_id,left(p_payload->>'account',254)) returning id into v_id;
  return jsonb_build_object('id',v_id);
 elsif p_action in ('batch','finish','fail') then
  select r.* into run from public.odap_drive_runs r where r.id=(p_payload->>'run_id')::uuid and r.actor=p_id for update;
  if not found or run.status<>'running' then raise exception '진행 중인 연결 작업이 아닙니다.';end if;
  if p_action='batch' then
   if jsonb_typeof(p_payload->'files') is distinct from 'array' or jsonb_array_length(p_payload->'files')>1000 then raise exception '최대 1000개씩 저장하세요.';end if;
   for f in select value from jsonb_array_elements(p_payload->'files') loop
    if coalesce(f->>'id','') !~ '^[A-Za-z0-9_-]{5,200}$' or coalesce(f->>'name','')='' then raise exception '원본 파일 식별자가 올바르지 않습니다.';end if;
    if not (lower(f->>'name') ~ '\.(hwp|hwpx|pdf|zip|docx|doc)$' or f->>'mime_type' in ('application/pdf','application/vnd.google-apps.document')) then raise exception '지원하지 않는 자료 형식입니다.';end if;
    if coalesce((f->>'bytes')::bigint,0)<0 then raise exception '잘못된 파일 크기';end if;
    insert into public.odap_drive_files(id,name,mime_type,bytes,modified_time,parents,drive_id,sha256,md5,can_download,last_run)
    values(f->>'id',left(f->>'name',1000),left(coalesce(f->>'mime_type',''),150),coalesce((f->>'bytes')::bigint,0),left(coalesce(f->>'modified_time',''),80),
      case when jsonb_typeof(f->'parents')='array' then f->'parents' else '[]'::jsonb end,f->>'drive_id',f->>'sha256',f->>'md5',coalesce((f->>'can_download')::boolean,false),run.id)
    on conflict(id) do update set name=excluded.name,mime_type=excluded.mime_type,bytes=excluded.bytes,modified_time=excluded.modified_time,
      parents=excluded.parents,drive_id=excluded.drive_id,sha256=excluded.sha256,md5=excluded.md5,can_download=excluded.can_download,last_run=excluded.last_run,seen_at=now();
   end loop;
   -- Only byte-identical files may be connected automatically. Names are not identity.
   update public.odap_drive_files d set source_id=s.id,source_modified_time=d.modified_time
     from public.odap_sources s where d.last_run=run.id and d.source_id is null and d.sha256=s.sha256 and s.sha256 ~ '^[a-f0-9]{64}$';
   update public.odap_drive_runs set pages=pages+1 where id=run.id;
   return jsonb_build_object('accepted',jsonb_array_length(p_payload->'files'));
  elsif p_action='finish' then
   if (p_payload->>'exhausted')::boolean is distinct from true then raise exception '모든 페이지를 조회해야 전체 완료로 표시할 수 있습니다.';end if;
   select count(*) into n from public.odap_drive_files where last_run=run.id;
   if n is distinct from (p_payload->>'unique_files')::integer then raise exception '원본 목록 수량이 일치하지 않습니다.';end if;
   update public.odap_drive_runs set status='complete',finished_at=now(),files=n where id=run.id;
   return jsonb_build_object('files',n,'status','complete');
  else
   update public.odap_drive_runs set status='failed',finished_at=now(),error=left(p_payload->>'error',500) where id=run.id;
   return '{"status":"failed"}';
  end if;
 elsif p_action='list' then
  select jsonb_build_object('total',count(*),'linked',count(*) filter(where source_id is not null),'requested',count(*) filter(where requested_at is not null),
    'changed',count(*) filter(where source_id is not null and modified_time is distinct from source_modified_time)) into result from public.odap_drive_files;
  return result||jsonb_build_object('last_run',(select to_jsonb(r) from public.odap_drive_runs r order by started_at desc limit 1),
   'last_complete',(select to_jsonb(r) from public.odap_drive_runs r where status='complete' order by finished_at desc limit 1),
   'matched',(select count(*) from public.odap_drive_files d where (v_q='' or strpos(lower(d.name),lower(v_q))>0) and (v_kind='' or (v_kind='hwp' and lower(d.name) ~ '\.hwpx?$') or (v_kind='pdf' and d.mime_type='application/pdf') or (v_kind='zip' and lower(d.name) like '%.zip') or (v_kind='requested' and d.requested_at is not null))),
   'items',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
    select d.*,s.title source_title,(select count(*) from public.odap_questions q where q.source_id=d.source_id) questions,
     (select count(*) from public.odap_questions q where q.source_id=d.source_id and q.status='approved') approved
    from public.odap_drive_files d left join public.odap_sources s on s.id=d.source_id
    where (v_q='' or strpos(lower(d.name),lower(v_q))>0) and (v_kind='' or (v_kind='hwp' and lower(d.name) ~ '\.hwpx?$') or (v_kind='pdf' and d.mime_type='application/pdf') or (v_kind='zip' and lower(d.name) like '%.zip') or (v_kind='requested' and d.requested_at is not null))
    order by d.name,d.id limit 50 offset v_offset) x));
 elsif p_action='request' then
  update public.odap_drive_files set requested_at=now() where id=p_payload->>'id';
  if not found then raise exception '등록된 원본을 확인하세요.';end if;
  return '{"status":"requested"}';
 elsif p_action='link' then
  -- A downloaded file hash is compared with the existing stored source, never a title.
  if coalesce(p_payload->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception '원본 해시가 필요합니다.';end if;
  select id into v_id from public.odap_sources where sha256=p_payload->>'sha256' and object_path is not null;
  if v_id is null then raise exception '동일 원본의 비공개 보관을 먼저 완료하세요.';end if;
  update public.odap_drive_files set source_id=v_id,source_modified_time=modified_time where id=p_payload->>'id' and modified_time=p_payload->>'modified_time';
  if not found then raise exception '드라이브 원본이 변경됐습니다. 다시 동기화하세요.';end if;
  return jsonb_build_object('source_id',v_id);
 else raise exception '지원하지 않는 드라이브 작업';end if;
end $$;
revoke all on function public.odap_drive(text,text,text,jsonb) from public;
grant execute on function public.odap_drive(text,text,text,jsonb) to anon,authenticated;
commit;
