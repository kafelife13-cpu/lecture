-- Additive archive: PDF/text lives in private Drive; only metadata is stored here.
begin;
create table if not exists public.odap_review_archive(
 id uuid primary key default gen_random_uuid(),student_id text not null,
 week_start date not null check(extract(isodow from week_start)=1),
 week_label text not null check(length(week_label) between 1 and 100),
 title text not null check(length(title) between 1 and 100),school text not null,
 drive_file_id text not null check(drive_file_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 original_count integer not null check(original_count between 1 and 200),
 practice_count integer not null check(practice_count between 1 and 100),
 status text not null default 'draft' check(status in ('draft','published')),
 created_by text not null,created_at timestamptz not null default now(),published_at timestamptz,
 unique(student_id,week_start,title)
);
alter table public.odap_review_archive enable row level security;
revoke all on public.odap_review_archive from public,anon,authenticated;
create or replace function public.odap_review_archive_rpc(p_id text,p_password text,p_role text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor jsonb; item public.odap_review_archive%rowtype; result jsonb;
begin
 actor:=public.authenticate_user(p_id,p_password,p_role);
 if actor is null or actor->>'status' is distinct from 'active' or p_role not in ('teacher','student') then raise exception '본인 계정으로 로그인하세요.';end if;
 if p_action='profile' then return jsonb_build_object('id',p_id,'role',p_role);end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'week_start',a.week_start,'week_label',a.week_label,'title',a.title,'original_count',a.original_count,'practice_count',a.practice_count,'status',a.status,'published_at',a.published_at)||case when p_role='teacher' then jsonb_build_object('student_id',a.student_id,'student_name',u.name) else '{}'::jsonb end order by a.week_start desc,a.created_at desc),'[]') into result
  from public.odap_review_archive a join public.users u on u.id::text=a.student_id
  where (p_role='teacher' or (a.student_id=p_id and a.status='published'))
   and (p_role<>'teacher' or nullif(p_payload->>'student_id','') is null or a.student_id=p_payload->>'student_id');
  return result;
 end if;
 if p_action='create' then
  if p_role<>'teacher' then raise exception '교사만 자료를 등록할 수 있습니다.';end if;
  if not exists(select 1 from public.users where id::text=p_payload->>'student_id' and role='student' and status='active') then raise exception '재원 학생을 확인하세요.';end if;
  insert into public.odap_review_archive(student_id,week_start,week_label,title,school,drive_file_id,content_hash,original_count,practice_count,created_by)
  values(p_payload->>'student_id',(p_payload->>'week_start')::date,p_payload->>'week_label',p_payload->>'title',p_payload->>'school',p_payload->>'drive_file_id',p_payload->>'content_hash',(p_payload->>'original_count')::integer,(p_payload->>'practice_count')::integer,p_id)
  on conflict(student_id,week_start,title) do nothing returning * into item;
  if item.id is null then
   select * into item from public.odap_review_archive where student_id=p_payload->>'student_id' and week_start=(p_payload->>'week_start')::date and title=p_payload->>'title';
   if item.content_hash is distinct from p_payload->>'content_hash' then raise exception '같은 주차·제목의 다른 자료가 있습니다. 기존 자료를 보존하려면 제목을 구분하세요.';end if;
  end if;
  return to_jsonb(item);
 end if;
 select * into item from public.odap_review_archive where id=(p_payload->>'id')::uuid for update;
 if not found or (p_role='student' and (item.student_id<>p_id or item.status<>'published')) then raise exception '본인에게 공개된 자료를 찾을 수 없습니다.';end if;
 if p_action='get' then return to_jsonb(item);end if;
 if p_action='publish' then
  if p_role<>'teacher' or p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception '학생·주차·PDF를 확인한 뒤 공개하세요.';end if;
  if item.content_hash is distinct from p_payload->>'content_hash' then raise exception '자료 버전이 다릅니다.';end if;
  update public.odap_review_archive set status='published',published_at=coalesce(published_at,now()) where id=item.id returning * into item;
  return jsonb_build_object('id',item.id,'status',item.status,'week_start',item.week_start);
 end if;
 raise exception '지원하지 않는 자료 작업입니다.';
end;$$;
revoke all on function public.odap_review_archive_rpc(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.odap_review_archive_rpc(text,text,text,text,jsonb) to service_role;
commit;
