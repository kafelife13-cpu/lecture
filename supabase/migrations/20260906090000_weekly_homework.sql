-- Weekly homework. Run after supabase_security_phase1.sql.
-- New records are accessible only through the authenticated legacy-account RPC.
begin;
create table if not exists public.weekly_homework (
 id uuid primary key default gen_random_uuid(), week_start date not null,
 group_id text not null, title text not null, targets text[] not null,
 config jsonb not null, created_at timestamptz not null default now(),
 unique(week_start,group_id)
);
create table if not exists public.weekly_homework_work (
 plan_id uuid not null references public.weekly_homework(id), student_id text not null,
 kind text not null check(kind in ('notebook','concept')), data jsonb not null,
 status text not null check(status in ('pending','approved','rejected','retry')),
 submitted_at timestamptz not null default now(),
 primary key(plan_id,student_id,kind)
);
alter table public.weekly_homework enable row level security;
alter table public.weekly_homework_work enable row level security;
revoke all on public.weekly_homework,public.weekly_homework_work from anon,authenticated;

create or replace function public.weekly_homework_rpc(p_id text,p_password text,p_role text,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
 actor jsonb; plan public.weekly_homework%rowtype; student public.users%rowtype;
 cfg jsonb; item jsonb; work jsonb; result jsonb:='[]'; rows jsonb; state jsonb; public_cfg jsonb;
 start_at timestamptz; end_at timestamptz; n integer; total integer; score integer;
 ids text[]; passed boolean; target_week date; note_status text; chosen_video text; saved jsonb;
begin
 actor:=public.authenticate_user(p_id,p_password,p_role);
 if actor is null or actor->>'status' is distinct from 'active' then raise exception '로그인을 다시 확인해주세요.'; end if;
 if p_action in ('create','update') then
  if p_role<>'teacher' then raise exception '교사만 과제를 등록할 수 있습니다.'; end if;
  if p_action='update' then
   select * into plan from public.weekly_homework where id=(p_payload->>'plan_id')::uuid for update;
   if not found then raise exception '과제를 찾을 수 없습니다.'; end if;
   if plan.config->'questions' is distinct from p_payload->'config'->'questions' and exists(select 1 from public.weekly_homework_work where plan_id=plan.id and kind='concept') then raise exception '이미 응시한 개념 OX 문항은 변경할 수 없습니다. 다음 주 과제로 등록해주세요.'; end if;
  end if;
  target_week:=case when p_action='update' then plan.week_start else (p_payload->>'week_start')::date end;
  if extract(isodow from target_week)<>1 then raise exception '주 시작일은 월요일이어야 합니다.'; end if;
  cfg:=p_payload->'config';
  if cfg is null or jsonb_typeof(cfg)<>'object' or coalesce(length(trim(p_payload->>'title')),0) not between 1 and 100 then raise exception '과제 제목과 설정을 확인해주세요.'; end if;
  if jsonb_typeof(cfg->'exam_ids') is distinct from 'array' or jsonb_typeof(cfg->'vocab_units') is distinct from 'array' or jsonb_typeof(cfg->'questions') is distinct from 'array' then raise exception '과제 목록 형식이 잘못되었습니다.'; end if;
  if jsonb_array_length(cfg->'exam_ids')>50 or jsonb_array_length(cfg->'vocab_units')>50 or jsonb_array_length(cfg->'questions')>100 then raise exception '과제 항목이 너무 많습니다.'; end if;
  if coalesce((cfg->>'question_target')::int,0) not between 1 and 50 or coalesce((cfg->>'study_count')::int,0) not between 1 and 14 or coalesce((cfg->>'study_minutes')::int,0) not between 1 and 600 then raise exception '완료 기준을 확인해주세요.'; end if;
  for item in select value from jsonb_array_elements(cfg->'questions') loop
   if coalesce(length(trim(item->>'prompt')),0) not between 1 and 2000 or coalesce(item->>'answer','') not in ('O','X') then raise exception 'OX 문항과 정답을 확인해주세요.'; end if;
  end loop;
  for item in select value from jsonb_array_elements(cfg->'exam_ids') loop
   if not exists(select 1 from public.exams where id::text=item#>>'{}' and category='homework') then raise exception '필수 과제 시험을 확인해주세요.'; end if;
  end loop;
  for item in select value from jsonb_array_elements(cfg->'vocab_units') loop
   if (item#>>'{}')::int<1 then raise exception '어휘 강 번호를 확인해주세요.'; end if;
  end loop;
  if not exists(select 1 from public.qa_weeks where id::text=cfg->>'qa_week_id') then raise exception '질문할 과제 주차를 선택해주세요.'; end if;
  if nullif(cfg->>'video_id','') is not null and not exists(select 1 from public.videos where id::text=cfg->>'video_id') then raise exception '클리닉 해설 강의를 확인해주세요.'; end if;
  select array_agg(id::text) into ids from public.users where role='student' and status='active' and group_id=p_payload->>'group_id';
  if coalesce(cardinality(ids),0)=0 then raise exception '선택한 반에 학생이 없습니다.'; end if;
  if p_action='update' then
   update public.weekly_homework set title=trim(p_payload->>'title'),config=cfg where id=plan.id returning * into plan;
  else
   insert into public.weekly_homework(week_start,group_id,title,targets,config)
    values(target_week,p_payload->>'group_id',trim(p_payload->>'title'),ids,cfg) returning * into plan;
  end if;
  return jsonb_build_object('id',plan.id);
 end if;
 if p_action in ('notebook','concept','review') then
  select * into plan from public.weekly_homework where id=(p_payload->>'plan_id')::uuid for update;
  if not found then raise exception '과제를 찾을 수 없습니다.'; end if;
  if p_action='review' then
   if p_role<>'teacher' or coalesce(p_payload->>'status','') not in ('approved','rejected') then raise exception '교사 확인이 필요합니다.'; end if;
   update public.weekly_homework_work set status=p_payload->>'status',data=data||jsonb_build_object('feedback',left(coalesce(p_payload->>'feedback',''),1000))
    where plan_id=plan.id and student_id=p_payload->>'student_id' and kind='notebook';
   if not found then raise exception '제출 기록이 없습니다.'; end if;
   return jsonb_build_object('ok',true);
  end if;
  if p_role<>'student' or not(p_id=any(plan.targets)) then raise exception '이 과제의 대상 학생이 아닙니다.'; end if;
  cfg:=plan.config;
  if p_action='notebook' then
   if coalesce(p_payload->>'mode','') not in ('clinic','home') or jsonb_typeof(p_payload->'photos') is distinct from 'array' then raise exception '인증 방법과 사진을 확인해주세요.'; end if;
   if jsonb_array_length(p_payload->'photos') not between 1 and 10 then raise exception '사진은 1~10장 제출해주세요.'; end if;
   for item in select value from jsonb_array_elements(p_payload->'photos') loop
    if not exists(select 1 from storage.objects where bucket_id='exam-photos' and name=item#>>'{}' and starts_with(name,'weekly-notes/'||p_id||'/'||plan.id::text||'/')) then raise exception '업로드한 사진을 확인해주세요.'; end if;
   end loop;
   if p_payload->>'mode'='home' then
    chosen_video:=cfg->>'video_id';
    if nullif(chosen_video,'') is null then raise exception '선생님이 클리닉 해설 강의를 지정한 뒤 제출해주세요.'; end if;
    if not exists(select 1 from public.progress where student_id=p_id and video_id::text=cfg->>'video_id' and percent>=100) then raise exception '클리닉 해설 강의를 끝까지 시청한 뒤 제출해주세요.'; end if;
   end if;
   saved:=jsonb_build_object('mode',p_payload->>'mode','photos',p_payload->'photos');note_status:='pending';
  else
   total:=jsonb_array_length(cfg->'questions');
   if total=0 then raise exception '아직 개념 OX가 등록되지 않았습니다.'; end if;
   if jsonb_typeof(p_payload->'answers') is distinct from 'array' or jsonb_array_length(p_payload->'answers')<>total then raise exception '모든 문항에 답해주세요.'; end if;
   score:=0;n:=0;
   for item in select value from jsonb_array_elements(cfg->'questions') loop
    if coalesce(p_payload->'answers'->>n,'') not in ('O','X') then raise exception 'O 또는 X를 선택해주세요.'; end if;
    if p_payload->'answers'->>n=item->>'answer' then score:=score+1; end if;n:=n+1;
   end loop;
   saved:=jsonb_build_object('answers',p_payload->'answers','score',score,'total',total);
   note_status:=case when score=total then 'approved' else 'retry' end;
  end if;
  insert into public.weekly_homework_work(plan_id,student_id,kind,data,status)
   values(plan.id,p_id,case p_action when 'concept' then 'concept' else 'notebook' end,saved,note_status)
   on conflict(plan_id,student_id,kind) do update set data=excluded.data,status=excluded.status,submitted_at=now()
   where weekly_homework_work.status<>'approved';
  if p_action='concept' then return saved||jsonb_build_object('questions',cfg->'questions'); end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action<>'list' then raise exception '지원하지 않는 요청입니다.'; end if;
 target_week:=(p_payload->>'week_start')::date;
 for plan in select * from public.weekly_homework where week_start=target_week and (p_role='teacher' or p_id=any(targets)) order by group_id loop
  cfg:=plan.config;rows:='[]';
  start_at:=plan.week_start::timestamp at time zone 'Asia/Seoul';end_at:=(plan.week_start+7)::timestamp at time zone 'Asia/Seoul';
  for student in select * from public.users where id=any(plan.targets) and (p_role='teacher' or id=p_id) order by name loop
   state:='{}';
   -- Name-only historical records count only when the name uniquely identifies this student.
   passed:=(select count(*)=1 from public.users where name=student.name and role='student');
   total:=jsonb_array_length(cfg->'vocab_units');
   select count(distinct unit_week) into n from public.vocab_responses v where
    (to_jsonb(v)->>'student_id'=student.id or (nullif(to_jsonb(v)->>'student_id','') is null and passed and student_name=student.name))
    and unit_week in(select value::int from jsonb_array_elements_text(cfg->'vocab_units'));
   state:=state||jsonb_build_object('vocab',jsonb_build_object('done',n,'total',total,'status',case when total=0 then 'unassigned' when n>=total then 'done' else 'todo' end));
   total:=jsonb_array_length(cfg->'exam_ids');
   select count(distinct exam_id) into n from public.exam_responses e where
    (to_jsonb(e)->>'student_id'=student.id or (nullif(to_jsonb(e)->>'student_id','') is null and passed and student_name=student.name))
    and exam_id::text in(select jsonb_array_elements_text(cfg->'exam_ids'));
   state:=state||jsonb_build_object('omr',jsonb_build_object('done',n,'total',total,'status',case when total=0 then 'unassigned' when n>=total then 'done' else 'todo' end));
   select count(distinct prob_num) into n from public.qa_questions q where student_id=student.id and week_id::text=cfg->>'qa_week_id' and coalesce(prob_num::text,'')<>'' and coalesce(to_jsonb(q)->>'category','')<>'free' and length(trim(question))>0;
   total:=(cfg->>'question_target')::int;
   state:=state||jsonb_build_object('qa',jsonb_build_object('done',n,'total',total,'status',case when n>=total then 'done' else 'todo' end));
   select count(*) into n from public.study_sessions where student_id=student.id and start_time::timestamptz>=start_at and start_time::timestamptz<end_at and end_time is not null and nullif(start_photo_url,'') is not null and nullif(end_photo_url,'') is not null and extract(epoch from(end_time::timestamptz-start_time::timestamptz))>=(cfg->>'study_minutes')::int*60;
   total:=(cfg->>'study_count')::int;
   state:=state||jsonb_build_object('study',jsonb_build_object('done',n,'total',total,'status',case when n>=total then 'done' else 'todo' end));
   select coalesce(jsonb_object_agg(kind,to_jsonb(w)-'student_id'-'plan_id'),'{}') into work from public.weekly_homework_work w where plan_id=plan.id and student_id=student.id;
   state:=state||jsonb_build_object('notebook',jsonb_build_object('status',coalesce(work->'notebook'->>'status','todo')),'concept',jsonb_build_object('status',case when jsonb_array_length(cfg->'questions')=0 then 'unassigned' else coalesce(work->'concept'->>'status','todo') end));
   rows:=rows||jsonb_build_array(jsonb_build_object('id',student.id,'name',student.name,'states',state,'work',work));
  end loop;
  public_cfg:=cfg;
  if p_role='student' then
   select cfg||jsonb_build_object('questions',coalesce(jsonb_agg(jsonb_build_object('prompt',value->>'prompt')),'[]')) into public_cfg from jsonb_array_elements(cfg->'questions');
  end if;
  result:=result||jsonb_build_array((to_jsonb(plan)-'config'-'targets')||jsonb_build_object('config',public_cfg,'students',rows));
 end loop;
 return result;
end;
$$;
revoke all on function public.weekly_homework_rpc(text,text,text,text,jsonb) from public;
grant execute on function public.weekly_homework_rpc(text,text,text,text,jsonb) to anon,authenticated;
commit;
