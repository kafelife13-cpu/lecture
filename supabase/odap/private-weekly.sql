-- Apply after the existing users/authenticate_user schema. No question bodies in DB.
begin;
create table if not exists public.odap_private_weekly (
 id uuid primary key default gen_random_uuid(), student_id text not null,
 week_start date not null check(extract(isodow from week_start)=1),
 title text not null check(length(title) between 1 and 100), school text not null,
 drive_file_id text not null, content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'draft' check(status in ('draft','approved','published')),
 created_by text not null, approved_by text, created_at timestamptz not null default now(),
 approved_at timestamptz, published_at timestamptz,
 unique(student_id,week_start)
);
create table if not exists public.odap_private_weekly_attempts (
 assignment_id uuid primary key references public.odap_private_weekly(id),
 student_id text not null, answers jsonb not null check(jsonb_typeof(answers)='object'),
 correct integer not null check(correct between 0 and 40),
 submitted_at timestamptz not null default now()
);
alter table public.odap_private_weekly enable row level security;
alter table public.odap_private_weekly_attempts enable row level security;
revoke all on public.odap_private_weekly,public.odap_private_weekly_attempts from public,anon,authenticated;

-- Service-role only: the Edge function owns validated hashes and grading values.
-- Account authentication is repeated here; browser RPC access is deliberately revoked.
create or replace function public.odap_private_weekly_rpc(p_id text,p_password text,p_role text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor jsonb; item public.odap_private_weekly%rowtype; attempt public.odap_private_weekly_attempts%rowtype; result jsonb;
begin
 actor:=public.authenticate_user(p_id,p_password,p_role);
 if actor is null or actor->>'status' is distinct from 'active' or p_role not in ('teacher','student') then raise exception '로그인을 확인하세요.'; end if;
 if p_action='profile' then return jsonb_build_object('id',p_id,'role',p_role); end if;
 if p_action='create' then
  if p_role<>'teacher' then raise exception '교사만 등록할 수 있습니다.'; end if;
  if not exists(select 1 from public.users where id=p_payload->>'student_id' and role='student' and status='active') then raise exception '학생을 확인하세요.'; end if;
  if coalesce(length(trim(p_payload->>'school')),0) not between 1 and 100 or coalesce(p_payload->>'drive_file_id','') !~ '^[A-Za-z0-9_-]{1,200}$' then raise exception '학교와 비공개 파일을 확인하세요.'; end if;
  insert into public.odap_private_weekly(student_id,week_start,title,school,drive_file_id,content_hash,created_by)
  values(p_payload->>'student_id',(p_payload->>'week_start')::date,p_payload->>'title',p_payload->>'school',p_payload->>'drive_file_id',p_payload->>'content_hash',p_id) returning * into item;
  return to_jsonb(item);
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'week_start',w.week_start,'title',w.title,'status',w.status,'submitted_at',a.submitted_at,'correct',a.correct,'total',40) order by w.week_start desc),'[]') into result
  from public.odap_private_weekly w left join public.odap_private_weekly_attempts a on a.assignment_id=w.id
  where (p_role='teacher' or (w.student_id=p_id and w.status='published'))
   and (nullif(p_payload->>'student_id','') is null or w.student_id=p_payload->>'student_id');
  return result;
 end if;
 select * into item from public.odap_private_weekly where id=(p_payload->>'id')::uuid for update;
 if not found or (p_role='student' and (item.student_id<>p_id or item.status<>'published')) then raise exception '배정된 시험을 찾을 수 없습니다.'; end if;
 if p_action='get' then
  select * into attempt from public.odap_private_weekly_attempts where assignment_id=item.id;
  return to_jsonb(item)||jsonb_build_object('attempt',case when attempt.assignment_id is null then null else to_jsonb(attempt) end);
 end if;
 if p_action='revise' then
  if p_role<>'teacher' or item.status<>'draft' then raise exception '검수 대기 자료만 수정할 수 있습니다.'; end if;
  if p_payload->>'previous_hash' is distinct from item.content_hash or coalesce(p_payload->>'drive_file_id','') !~ '^[A-Za-z0-9_-]{1,200}$' then raise exception '파일 버전을 확인하세요.'; end if;
  update public.odap_private_weekly set title=p_payload->>'title',drive_file_id=p_payload->>'drive_file_id',content_hash=p_payload->>'content_hash' where id=item.id returning * into item;
  return jsonb_build_object('id',item.id,'status',item.status,'week_start',item.week_start,'title',item.title);
 end if;
 if p_payload->>'content_hash' is distinct from item.content_hash then raise exception '파일 버전이 다릅니다.'; end if;
 if p_action in ('approve','publish') then
  if p_role<>'teacher' or p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception '교사 검수가 필요합니다.'; end if;
  if p_action='approve' and item.status='draft' then
   update public.odap_private_weekly set status='approved',approved_by=p_id,approved_at=now() where id=item.id returning * into item;
  elsif p_action='publish' and item.status='approved' then
   update public.odap_private_weekly set status='published',published_at=now() where id=item.id returning * into item;
  else raise exception '현재 상태에서는 변경할 수 없습니다.'; end if;
  return jsonb_build_object('id',item.id,'status',item.status);
 end if;
 if p_action='submit' then
  if p_role<>'student' then raise exception '본인 학생 계정으로 응시하세요.'; end if;
  if jsonb_typeof(p_payload->'answers') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_payload->'answers'))<>40 then raise exception '40문항 답안이 필요합니다.'; end if;
  -- Row lock + PK makes parallel/replayed requests a single durable submission.
  if exists(select 1 from public.odap_private_weekly_attempts where assignment_id=item.id) then raise exception '이번 주 시험은 이미 제출했습니다.'; end if;
  insert into public.odap_private_weekly_attempts(assignment_id,student_id,answers,correct)
   values(item.id,p_id,p_payload->'answers',(p_payload->>'correct')::integer) returning * into attempt;
  return jsonb_build_object('submitted_at',attempt.submitted_at,'correct',attempt.correct,'total',40,'score',attempt.correct*2.5);
 end if;
 raise exception '지원하지 않는 작업입니다.';
end;
$$;
revoke all on function public.odap_private_weekly_rpc(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.odap_private_weekly_rpc(text,text,text,text,jsonb) to service_role;
commit;
