-- Automatic weekly work. Metadata only; bodies and review reports stay in private Drive.
-- Apply after migration.sql and private-weekly.sql. No retroactive response enqueue.
begin;
alter table public.odap_sources add column if not exists exam_year integer check(exam_year between 1900 and 2200);
create table if not exists public.odap_private_weekly_auto_jobs(
 id uuid primary key default gen_random_uuid(), student_id text not null,
 week_start date not null check(extract(isodow from week_start)=1),
 status text not null default 'pending' check(status in ('pending','processing','blocked','published')),
 phase text not null default 'generate' check(phase in ('generate','review')),
 revision integer not null default 1, attempts integer not null default 0,
 available_at timestamptz not null default now(), lease uuid, leased_until timestamptz,
 draft_drive_file_id text, draft_content_hash text, assignment_id uuid references public.odap_private_weekly(id),
 error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(student_id,week_start)
);
alter table public.odap_private_weekly_auto_jobs enable row level security;
revoke all on public.odap_private_weekly_auto_jobs from public,anon,authenticated;
create or replace function public.odap_private_weekly_auto_enqueue() returns trigger
language plpgsql security definer set search_path=public as $$
declare wk date:=date_trunc('week',now() at time zone 'Asia/Seoul')::date;
begin
 if new.student_id is null or new.submitted_at is null or new.submitted_at < (wk::timestamp at time zone 'Asia/Seoul') or new.submitted_at>now()+interval '5 minutes' then return new; end if;
 if tg_op='UPDATE' and new.answers is not distinct from old.answers and new.student_id is not distinct from old.student_id then return new; end if;
 if not exists(select 1 from public.exams e where e.id::text=new.exam_id::text and (e.category='clinic' or e.name like '%클리닉%')) then return new; end if;
 if not exists(select 1 from public.users where id::text=new.student_id and role='student' and status='active') then return new; end if;
 if exists(select 1 from public.odap_private_weekly where student_id=new.student_id and week_start=wk) then return new; end if;
 insert into public.odap_private_weekly_auto_jobs(student_id,week_start,available_at)
 values(new.student_id,wk,now()+interval '120 seconds')
 on conflict(student_id,week_start) do update set status='pending',phase='generate',revision=odap_private_weekly_auto_jobs.revision+1,attempts=0,
 available_at=now()+interval '120 seconds',lease=null,leased_until=null,draft_drive_file_id=null,draft_content_hash=null,error=null,updated_at=now()
 where odap_private_weekly_auto_jobs.status<>'published';
 return new;
end $$;
drop trigger if exists odap_private_weekly_auto_enqueue on public.exam_responses;
create trigger odap_private_weekly_auto_enqueue after insert or update on public.exam_responses for each row execute function public.odap_private_weekly_auto_enqueue();
create or replace function public.odap_private_weekly_auto_claim() returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.odap_private_weekly_auto_jobs%rowtype;
begin
 update public.odap_private_weekly_auto_jobs j set status='blocked',error='같은 주차 자료가 이미 있습니다.',lease=null,leased_until=null,updated_at=now()
 where j.status in ('pending','processing') and exists(select 1 from public.odap_private_weekly w where w.student_id=j.student_id and w.week_start=j.week_start);
 update public.odap_private_weekly_auto_jobs set status='blocked',error='자동 처리 재시도 한도를 초과했습니다.',lease=null,leased_until=null,updated_at=now()
 where attempts>=2 and (status='pending' or(status='processing' and leased_until<now()));
 select * into job from public.odap_private_weekly_auto_jobs where attempts<2 and available_at<=now() and (status='pending' or(status='processing' and leased_until<now())) order by available_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update public.odap_private_weekly_auto_jobs set status='processing',attempts=attempts+1,lease=gen_random_uuid(),leased_until=now()+interval '10 minutes',updated_at=now() where id=job.id returning * into job;
 return to_jsonb(job);
end $$;
create or replace function public.odap_private_weekly_auto_context(p_job uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.odap_private_weekly_auto_jobs%rowtype; v_school text; wrongs jsonb; candidates jsonb; refs jsonb;
begin
 select * into job from public.odap_private_weekly_auto_jobs where id=p_job and lease=p_lease and status='processing' and leased_until>now();
 if not found then raise exception '작업 임대가 만료되었습니다.';end if;
 select s.name into v_school from public.users u join public.qa_schools s on s.id=u.school_id where u.id::text=job.student_id and u.role='student' and u.status='active';
 if coalesce(v_school,'')='' then raise exception '학생 학교 연결이 필요합니다.';end if;
 with latest as (
  select distinct on(r.exam_id) r.* from public.exam_responses r join public.exams e on e.id=r.exam_id
  where r.student_id=job.student_id and r.submitted_at >= (job.week_start::timestamp at time zone 'Asia/Seoul')
   and r.submitted_at < ((job.week_start+7)::timestamp at time zone 'Asia/Seoul')
   and (e.category in ('clinic','homework') or e.name like '%클리닉%') order by r.exam_id,r.submitted_at desc,r.id desc
 ), found as (
  select e.id::text exam_id,(q.n-1)::integer question_index,q.value question,m.question_id,m.verified,
   coalesce(m.concepts,'[]') concepts,coalesce(bank.body->'question_types','[]') question_types,
   (bank.status='approved' and bank.body->>'answer'=q.value->>'answer') source_consistent
  from latest r join public.exams e on e.id=r.exam_id cross join lateral jsonb_array_elements(coalesce(e.questions,'[]')) with ordinality q(value,n)
  left join public.odap_mappings m on m.exam_id=e.id::text and m.question_index=q.n-1
  left join public.odap_questions bank on bank.id=m.question_id
  where public.odap_grade(case when jsonb_typeof(r.answers)='array' then r.answers->>((q.n-1)::integer) else r.answers->>((q.n-1)::text) end,q.value->>'answer')=false
 ) select coalesce(jsonb_agg(to_jsonb(f)),'[]') into wrongs from (select * from found order by exam_id,question_index limit 100) f;
 if wrongs='[]' then raise exception '이번 주 판정 가능한 오답이 없습니다.';end if;
 if exists(select 1 from jsonb_array_elements(wrongs)w where w->>'verified' is distinct from 'true' or w->>'source_consistent' is distinct from 'true' or jsonb_array_length(w->'concepts')=0) then raise exception '오답 원문·정답·개념 연결 검증이 부족합니다.';end if;
 select coalesce(jsonb_agg(v),'[]') into refs from (
  select to_jsonb(ev)||jsonb_build_object('source_title',s.title,'school',s.school,'kind',s.kind,'year',s.exam_year,'page',ev.page::text) v
  from public.odap_evidence ev join public.odap_sources s on s.id=ev.source_id
  where ev.approved and s.school=v_school and length(trim(ev.quote))>0 and length(trim(ev.statement))>0
   and (s.kind='학교 프린트' or(s.kind in ('학교 기출','내신 기출') and s.exam_year=extract(year from job.week_start)::integer-1))
   and exists(select 1 from jsonb_array_elements(wrongs)w where (w->'concepts') ? ev.concept)
  order by ev.id limit 100
 ) x;
 if not exists(select 1 from jsonb_array_elements(refs)e where e->>'kind'='학교 프린트') or not exists(select 1 from jsonb_array_elements(refs)e where e->>'kind' in ('학교 기출','내신 기출')) then raise exception '학교 프린트와 연도가 확인된 작년 기출 근거가 필요합니다.';end if;
 select coalesce(jsonb_agg(v),'[]') into candidates from (
  select q.body||jsonb_build_object('id',q.id,'source_id',q.source_id,'status',q.status,'fingerprint',q.fingerprint,'origin_type','existing','evidence',
   (select coalesce(jsonb_agg(to_jsonb(ev)||jsonb_build_object('source_title',src.title,'school',src.school,'kind',src.kind,'year',src.exam_year,'page',ev.page::text)),'[]')
    from public.odap_question_evidence qe join public.odap_evidence ev on ev.id=qe.evidence_id join public.odap_sources src on src.id=ev.source_id where qe.question_id=q.id and ev.approved)) v
  from public.odap_questions q join public.odap_sources s on s.id=q.source_id
  where q.status='approved' and coalesce(s.school,'') in ('',v_school) and coalesce(q.body->>'school','') in ('',v_school)
   and jsonb_array_length(coalesce(q.body->'choices','[]'))=5 and q.body->>'answer' ~ '^[1-5]$' and length(trim(q.body->>'explanation'))>0
   and coalesce(q.body->>'origin_type','existing') not in ('generated','ai','자작')
   and not exists(select 1 from public.odap_mappings m join public.exam_responses r on r.exam_id::text=m.exam_id where r.student_id=job.student_id and m.question_id=q.id)
   and exists(select 1 from jsonb_array_elements(wrongs)w cross join lateral jsonb_array_elements_text(w->'concepts')c where (q.body->'concepts') ? c)
   and exists(select 1 from public.odap_question_evidence qe join public.odap_evidence ev on ev.id=qe.evidence_id where qe.question_id=q.id and ev.approved)
  order by q.id limit 100
 ) x;
 return jsonb_build_object('student_id',job.student_id,'school',v_school,'week_start',job.week_start,'wrongs',wrongs,'candidates',candidates,'evidence',refs);
end $$;
create or replace function public.odap_private_weekly_auto_finish(p_job uuid,p_lease uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.odap_private_weekly_auto_jobs%rowtype; assignment public.odap_private_weekly%rowtype; v_school text;
begin
 select * into job from public.odap_private_weekly_auto_jobs where id=p_job and lease=p_lease and status='processing' and leased_until>now() for update;
 if not found then raise exception '작업 임대가 만료되거나 입력이 변경되었습니다.';end if;
 if p_payload->>'phase' in ('review','published') then
  if coalesce(p_payload->>'drive_file_id','') !~ '^[A-Za-z0-9_-]{1,200}$' or coalesce(p_payload->>'content_hash','') !~ '^[a-f0-9]{64}$' then raise exception '비공개 자료 주소와 검증값이 필요합니다.';end if;
 end if;
 if p_payload->>'phase'='review' and job.phase='generate' then
  update public.odap_private_weekly_auto_jobs set phase='review',status='pending',attempts=0,available_at=now(),lease=null,leased_until=null,
   draft_drive_file_id=p_payload->>'drive_file_id',draft_content_hash=p_payload->>'content_hash',error=null,updated_at=now() where id=job.id returning * into job;
 elsif p_payload->>'phase'='published' and job.phase='review' then
  if p_payload->>'review_provider' is distinct from 'anthropic' or p_payload->>'review_passed' is distinct from 'true' then raise exception 'Claude 검수 통과가 필요합니다.';end if;
  select s.name into v_school from public.users u join public.qa_schools s on s.id=u.school_id where u.id::text=job.student_id and u.role='student' and u.status='active';
  if coalesce(v_school,'')='' then raise exception '학교 연결을 확인하세요.';end if;
  insert into public.odap_private_weekly(student_id,week_start,title,school,drive_file_id,content_hash,status,created_by,approved_by,approved_at,published_at)
  values(job.student_id,job.week_start,p_payload->>'title',v_school,p_payload->>'drive_file_id',p_payload->>'content_hash','published','auto:clinic','claude:anthropic',now(),now()) returning * into assignment;
  update public.odap_private_weekly_auto_jobs set status='published',assignment_id=assignment.id,lease=null,leased_until=null,error=null,updated_at=now() where id=job.id returning * into job;
 elsif p_payload->>'phase' in ('blocked','retry') then
  update public.odap_private_weekly_auto_jobs set status=case when p_payload->>'phase'='retry' and attempts<2 then 'pending' else 'blocked' end,
   available_at=now()+interval '5 minutes',lease=null,leased_until=null,error=left(coalesce(p_payload->>'error','자동 처리 보류'),500),updated_at=now() where id=job.id returning * into job;
 else raise exception '자동 처리 단계가 올바르지 않습니다.';end if;
 return to_jsonb(job);
end $$;
revoke all on function public.odap_private_weekly_auto_enqueue() from public,anon,authenticated;
revoke all on function public.odap_private_weekly_auto_claim() from public,anon,authenticated;
revoke all on function public.odap_private_weekly_auto_context(uuid,uuid) from public,anon,authenticated;
revoke all on function public.odap_private_weekly_auto_finish(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.odap_private_weekly_auto_claim(),public.odap_private_weekly_auto_context(uuid,uuid),public.odap_private_weekly_auto_finish(uuid,uuid,jsonb) to service_role;
commit;
