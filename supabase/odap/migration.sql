-- Additive research schema. Existing users remain the identity authority.
begin;
alter table public.exam_responses add column if not exists student_id text;
update public.exam_responses r set student_id=u.id::text
from public.users u where r.student_id is null and u.role='student' and r.student_name=u.name
and 1=(select count(*) from public.users x where x.role='student' and x.name=r.student_name);
create index if not exists odap_response_student_idx on public.exam_responses(student_id);

create table if not exists public.odap_attempts(id uuid primary key default gen_random_uuid(),response_id text not null,student_id text,exam_id text not null,body jsonb not null,archived_at timestamptz not null default now());
create or replace function public.odap_capture_attempt() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and old.student_id is not null and new.student_id is distinct from old.student_id then raise exception '기존 제출의 학생 ID를 바꿀 수 없습니다.'; end if;
 if new.student_id is not null and not exists(select 1 from public.users where id::text=new.student_id and role='student' and name=new.student_name) then raise exception '학생 ID와 학생 이름이 일치하지 않습니다.'; end if;
 if new.student_id is null and (select count(*) from public.users where role='student' and name=new.student_name)=1 then select id::text into new.student_id from public.users where role='student' and name=new.student_name; end if;
 if tg_op='UPDATE' and (old.answers is distinct from new.answers or old.score is distinct from new.score) then
  insert into public.odap_attempts(response_id,student_id,exam_id,body) values(old.id::text,old.student_id,old.exam_id::text,to_jsonb(old));
 end if;
 return new;
end $$;
drop trigger if exists odap_capture_attempt on public.exam_responses;
create trigger odap_capture_attempt before insert or update on public.exam_responses for each row execute function public.odap_capture_attempt();
revoke all on function public.odap_capture_attempt() from public;

create table if not exists public.odap_sources(id uuid primary key default gen_random_uuid(),title text not null,kind text not null,school text not null default '',sha256 text unique,bytes bigint not null default 0,object_path text,created_at timestamptz not null default now());
create table if not exists public.odap_questions(id uuid primary key default gen_random_uuid(),source_id uuid references public.odap_sources(id),body jsonb not null,fingerprint text not null,source_key text unique,status text not null default 'pending' check(status in ('pending','approved')),version integer not null default 1,created_at timestamptz not null default now());
create index if not exists odap_q_source on public.odap_questions(source_id);
create index if not exists odap_q_status on public.odap_questions(status);
create table if not exists public.odap_evidence(id uuid primary key default gen_random_uuid(),source_id uuid not null references public.odap_sources(id),page integer not null check(page>0),quote text not null,concept text not null,statement text not null,blank_answer text not null default '',proposition_key text not null unique,approved boolean not null default false);
create table if not exists public.odap_question_evidence(question_id uuid references public.odap_questions(id),evidence_id uuid references public.odap_evidence(id),primary key(question_id,evidence_id));
create table if not exists public.odap_mappings(exam_id text not null,question_index integer not null check(question_index>=0),question_id uuid references public.odap_questions(id),concepts jsonb not null default '[]',verified boolean not null default false,primary key(exam_id,question_index));
create table if not exists public.odap_notes(response_id text not null,question_index integer not null,student_id text not null,error_type text not null default '',note text not null default '',primary key(response_id,question_index));
create table if not exists public.odap_runs(id uuid primary key default gen_random_uuid(),student_id text not null,day date not null,status text not null,detail text not null default '',created_at timestamptz not null default now(),unique(student_id,day));
create table if not exists public.odap_generated(id uuid primary key default gen_random_uuid(),student_id text not null,run_id uuid references public.odap_runs(id),evidence_id uuid references public.odap_evidence(id),proposition_key text not null,fingerprint text not null,kind text not null,body jsonb not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),version integer not null default 1,created_at timestamptz not null default now(),unique(student_id,proposition_key),unique(student_id,fingerprint));
create table if not exists public.odap_packets(id uuid primary key default gen_random_uuid(),student_id text not null,title text not null,body jsonb not null,status text not null default 'draft' check(status in ('draft','approved','published')),created_at timestamptz not null default now(),files jsonb not null default '[]',verified boolean not null default false);
create table if not exists public.odap_jobs(id uuid primary key default gen_random_uuid(),packet_id uuid not null unique references public.odap_packets(id),status text not null default 'pending',lease uuid,error text,updated_at timestamptz not null default now());
create table if not exists public.odap_settings(key text primary key,value jsonb not null);
create table if not exists public.odap_audit(id bigint generated always as identity primary key,actor text,action text not null,detail jsonb,created_at timestamptz not null default now());

do $$ declare t text; begin
 foreach t in array array['odap_attempts','odap_sources','odap_questions','odap_evidence','odap_question_evidence','odap_mappings','odap_notes','odap_runs','odap_generated','odap_packets','odap_jobs','odap_settings','odap_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

create or replace function public.odap_grade(a text,k text) returns boolean language sql immutable set search_path=public as $$
select case when k ~ '^[1-5]$' and btrim(coalesce(a,'')) ~ '^[1-5]$' then btrim(a)=k
when k ~ '^all:[1-5](,[1-5])+$' and btrim(coalesce(a,'')) ~ '^[1-5](\s*,\s*[1-5])*$' then
 (select array_agg(distinct x order by x) from regexp_split_to_table(regexp_replace(a,'\s','','g'),',') x)=(select array_agg(distinct x order by x) from regexp_split_to_table(substr(k,5),',') x)
when upper(k) in ('O','X') and upper(a) in ('O','X') then upper(k)=upper(a) else null end $$;
create or replace function public.odap_question_json(q public.odap_questions) returns jsonb language sql stable set search_path=public as $$
 select q.body||jsonb_build_object('id',q.id,'source_id',q.source_id,'status',q.status,'reviewed',q.status='approved','version',q.version)
$$;
create or replace function public.odap_weak_concepts(sid text) returns table(concept text,wrong bigint) language sql stable set search_path=public as $$
with latest as (select distinct on (exam_id) * from public.exam_responses where student_id=sid order by exam_id,submitted_at desc nulls last,id desc)
select ct.value,count(*) from latest r join public.exams e on e.id=r.exam_id
cross join lateral jsonb_array_elements(coalesce(e.questions,'[]')) with ordinality q(value,n)
left join public.odap_mappings m on m.exam_id=e.id::text and m.question_index=q.n-1
cross join lateral jsonb_array_elements_text(case when m.concepts is not null and jsonb_array_length(m.concepts)>0 then m.concepts when jsonb_typeof(q.value->'concepts')='array' then q.value->'concepts' else jsonb_build_array(coalesce(q.value->>'type',q.value->>'domain','미분류')) end) ct
where public.odap_grade(r.answers->>((q.n-1)::text),q.value->>'answer')=false group by ct.value
$$;
create or replace function public.odap_daily(sid text) returns jsonb language plpgsql security definer set search_path=public as $$
declare run public.odap_runs%rowtype; e record; body jsonb; kind text; stem text; answer text; total integer:=0; inserted integer; sch text;
begin
 if not exists(select 1 from public.users where id::text=sid and role='student' and status='active') then raise exception '재원 학생을 확인하세요.'; end if;
 insert into public.odap_runs(student_id,day,status) values(sid,(now() at time zone 'Asia/Seoul')::date,'running') on conflict(student_id,day) do nothing returning * into run;
 if not found then select * into run from public.odap_runs where student_id=sid and day=(now() at time zone 'Asia/Seoul')::date;return to_jsonb(run)||'{"reused":true}';end if;
 select s.name into sch from public.users u join public.qa_schools s on s.id::text=u.school_id::text where u.id::text=sid;
 for e in select ev.*,s.title from public.odap_evidence ev join public.odap_sources s on s.id=ev.source_id join public.odap_weak_concepts(sid) w on w.concept=ev.concept where ev.approved and (s.school='' or s.school=sch) and not exists(select 1 from public.odap_generated g where g.student_id=sid and g.proposition_key=ev.proposition_key) order by w.wrong desc,ev.id limit 10 loop
  kind:=case when e.blank_answer<>'' and position(e.blank_answer in e.statement)>0 and total%2=1 then 'blank' else 'ox' end;
  stem:=case when kind='blank' then replace(e.statement,e.blank_answer,'(                    )') else e.statement||' (O / X)' end;
  answer:=case when kind='blank' then e.blank_answer else 'O' end;
  body:=jsonb_build_object('text',stem,'answer',answer,'explanation',e.quote,'concepts',jsonb_build_array(e.concept),'source_title',e.title,'page',e.page,'engine','검수 명제 기반 규칙 생성','choices','[]'::jsonb);
  insert into public.odap_generated(student_id,run_id,evidence_id,proposition_key,fingerprint,kind,body) values(sid,run.id,e.id,e.proposition_key,md5(regexp_replace(lower(stem),'[^[:alnum:]가-힣]','','g')),kind,body) on conflict do nothing;
  get diagnostics inserted=row_count;total:=total+inserted;
 end loop;
 update public.odap_runs set status=case when total>0 then 'ready' else 'insufficient' end,detail=case when total>0 then total||'문항 생성 · 교사 승인 대기' else '새로 출제할 검수 명제가 부족합니다. 중복 문항으로 채우지 않았습니다.' end where id=run.id returning * into run;
 return to_jsonb(run)||jsonb_build_object('count',total);
end $$;
revoke all on function public.odap_grade(text,text),public.odap_question_json(public.odap_questions),public.odap_weak_concepts(text),public.odap_daily(text) from public,anon,authenticated;

create or replace function public.odap_rpc(p_id text,p_password text,p_role text,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare actor jsonb; result jsonb; q jsonb; item jsonb; body jsonb; items jsonb:='[]'; oldq public.odap_questions%rowtype; src public.odap_sources%rowtype; ev public.odap_evidence%rowtype; gen public.odap_generated%rowtype; packet public.odap_packets%rowtype; job public.odap_jobs%rowtype; sid text; rid text; student_name text; count_added integer:=0; count_skipped integer:=0; n integer; v_status text; v_id uuid; prop text; stmt text;
begin
 actor:=public.authenticate_user(p_id,p_password,p_role);
 if actor is null or actor->>'status' is distinct from 'active' or actor->>'role' is distinct from p_role then raise exception '기존 김까까 계정으로 로그인하세요.';end if;
 if p_action='profile' then return jsonb_build_object('id',actor->>'id','name',actor->>'name','role',actor->>'role');end if;
 if p_role='student' then
  if p_action='student_packets' then select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'created_at',p.created_at,'body',p.body-'items'||jsonb_build_object('items',(select jsonb_agg(x.value-'source_ref'-'source_file'-'source_sha256') from jsonb_array_elements(p.body->'items') x)),'files',p.files) order by p.created_at desc),'[]') into result from public.odap_packets p where p.student_id=p_id and p.status='published';return result;end if;
  if p_action='asset_permission' then
   if exists(select 1 from public.odap_packets p cross join lateral jsonb_array_elements(p.files) f where p.student_id=p_id and p.status='published' and f->>'path'=p_payload->>'path' and f->>'kind'='pdf') then return jsonb_build_object('allowed',true);end if;
  end if;
  raise exception '교사 전용 작업입니다.';
 end if;
 if p_role<>'teacher' then raise exception '교사 전용 작업입니다.';end if;
 sid:=p_payload->>'student_id';
 if sid is not null and not exists(select 1 from public.users where id::text=sid and role='student') then raise exception '기존 학생 ID를 확인하세요.';end if;
 if p_action='GET /api/sync' then
  return to_jsonb(md5(concat(
   public.odap_external_revision(),
   (select jsonb_agg(jsonb_build_array(id,name,role,status,school_id) order by id)::text from public.users where role='student'),
   (select jsonb_agg(to_jsonb(e) order by id)::text from public.exams e),
   (select jsonb_agg(to_jsonb(r) order by id)::text from public.exam_responses r),
   (select count(*)::text||coalesce(max(created_at)::text,'') from public.odap_questions),
   (select count(*)::text||coalesce(max(created_at)::text,'') from public.odap_sources)
  )));
 elsif p_action='GET /api/summary' or p_action='POST /api/refresh' then
  return jsonb_build_object('totals',jsonb_build_object('questions',(select count(*) from public.odap_questions),'approved',(select count(*) from public.odap_questions where status='approved'),'sources',(select count(*) from public.odap_sources),'pending_generated',(select count(*) from public.odap_generated where status='pending'),'packets',(select count(*) from public.odap_packets),'evidence',(select count(*) from public.odap_evidence)),
  'sources',(select coalesce(jsonb_agg(x order by total desc),'[]') from (select s.id,s.title,s.kind,s.school,s.bytes,count(q.id) total,count(q.id) filter(where q.status='approved') approved from public.odap_sources s left join public.odap_questions q on q.source_id=s.id group by s.id) x),
  'connection',jsonb_build_object('ok',true,'students',(select count(*) from public.users where role='student'),'responses',(select count(*) from public.exam_responses),'exams',(select count(*) from public.exams),'checked_at',now(),'has_student_id',true),
  'runs',(select coalesce(jsonb_agg(x),'[]') from (select * from public.odap_runs order by created_at desc limit 20) x),'scheduled',coalesce((select value from public.odap_settings where key='daily'),'false'::jsonb),'storage','김까까 Supabase · 기존 학생 ID 공유','kkakka_url','https://kafelife13-cpu.github.io/lecture/');
 elsif p_action='GET /api/sources' then select coalesce(jsonb_agg(to_jsonb(s)),'[]') into result from public.odap_sources s;return result;
 elsif p_action='GET /api/students' then
  return jsonb_build_object('students',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role,'status',status,'school_id',school_id) order by name),'[]') from public.users where role='student'),'schools',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.qa_schools),'checked_at',now(),'has_student_id',true);
 elsif p_action='GET /api/records' then
  return jsonb_build_object('student',(select jsonb_build_object('id',id,'name',name,'school_id',school_id,'school',(select name from public.qa_schools where id=users.school_id)) from public.users where id::text=sid),'responses',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.exam_responses r where r.student_id=sid),
   'history',(select coalesce(jsonb_agg(odap_attempts.body order by archived_at),'[]') from public.odap_attempts where student_id=sid),
   'unlinked',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'exam',e.name,'date',r.submitted_at,'same_name_count',(select count(*) from public.users where role='student' and name=r.student_name))),'[]') from public.exam_responses r join public.exams e on e.id=r.exam_id where r.student_id is null and r.student_name=(select name from public.users where id::text=sid)),
   'exams',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'category',category,'questions',questions)),'[]') from public.exams),'mappings',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.odap_mappings m),'notes',(select coalesce(jsonb_agg(to_jsonb(n.*)),'[]') from public.odap_notes n where student_id=sid),'evidence',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('title',s.title,'school',s.school)),'[]') from public.odap_evidence e join public.odap_sources s on s.id=e.source_id where e.approved),'checked_at',now());
 elsif p_action='GET /api/questions' then
  select coalesce(jsonb_agg(x),'[]') into items from (select public.odap_question_json(q.*)-'images'-'passage'-'explanation' x from public.odap_questions q where (coalesce(p_payload->>'q','')='' or q.body::text ilike '%'||(p_payload->>'q')||'%') and (coalesce(p_payload->>'status','')='' or q.status=p_payload->>'status') and (coalesce(p_payload->>'source_id','')='' or q.source_id::text=p_payload->>'source_id') order by q.source_id,q.source_key limit 30 offset greatest(0,coalesce((p_payload->>'offset')::integer,0))) t;
  return jsonb_build_object('items',items,'total',(select count(*) from public.odap_questions q where (coalesce(p_payload->>'q','')='' or q.body::text ilike '%'||(p_payload->>'q')||'%') and (coalesce(p_payload->>'status','')='' or q.status=p_payload->>'status') and (coalesce(p_payload->>'source_id','')='' or q.source_id::text=p_payload->>'source_id')));
 elsif p_action='GET /api/question' then
  select * into oldq from public.odap_questions where id=(p_payload->>'id')::uuid;if not found then raise exception '문항 없음';end if;
  return public.odap_question_json(oldq)||jsonb_build_object('evidence',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('title',s.title)),'[]') from public.odap_question_evidence qe join public.odap_evidence e on e.id=qe.evidence_id join public.odap_sources s on s.id=e.source_id where qe.question_id=oldq.id));
 elsif p_action='GET /api/evidence' then select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('title',s.title) order by s.title,e.page),'[]') into result from public.odap_evidence e join public.odap_sources s on s.id=e.source_id;return result;
 elsif p_action='GET /api/generated' then select coalesce(jsonb_agg(to_jsonb(g) order by created_at desc),'[]') into result from public.odap_generated g where student_id=sid;return result;
 elsif p_action='GET /api/packets' then select coalesce(jsonb_agg(to_jsonb(p) order by created_at desc),'[]') into result from public.odap_packets p where student_id=sid;return result;
 elsif p_action='GET /api/packet' then select case when p_payload->>'metadata_only'='true' then to_jsonb(p)-'body' else to_jsonb(p) end into result from public.odap_packets p where id=(p_payload->>'id')::uuid;return result;
 elsif p_action='GET /api/recommend' then
  select coalesce(jsonb_agg(t order by score desc),'[]') into result from (select public.odap_question_json(q.*) as question,jsonb_agg(w.concept) matched,sum(w.wrong) score from public.odap_questions q join public.odap_weak_concepts(sid) w on q.body->'concepts' ? w.concept where q.status='approved' group by q.id order by sum(w.wrong) desc limit 30) t;return result;
 elsif p_action='POST /api/schedule' then insert into public.odap_settings values('daily',coalesce(p_payload->'enabled','false')) on conflict(key) do update set value=excluded.value;return p_payload;
 elsif p_action='POST /api/generate' then return public.odap_daily(sid);
 elsif p_action='POST /api/source' then
  if coalesce(trim(p_payload->>'title'),'')='' then raise exception '자료명을 입력하세요.';end if;
  insert into public.odap_sources(id,title,kind,school,sha256,bytes,object_path) values(coalesce((p_payload->>'id')::uuid,gen_random_uuid()),p_payload->>'title',coalesce(p_payload->>'kind','원본'),coalesce(p_payload->>'school',''),nullif(p_payload->>'sha256',''),coalesce((p_payload->>'bytes')::bigint,0),p_payload->>'object_path') on conflict(sha256) do update set title=odap_sources.title,object_path=coalesce(excluded.object_path,odap_sources.object_path) returning * into src;return to_jsonb(src);
 elsif p_action='POST /api/import' then
  if jsonb_typeof(p_payload->'questions') is distinct from 'array' or jsonb_array_length(p_payload->'questions')>500 then raise exception '500문항 이하로 가져오세요.';end if;
  for q in select value from jsonb_array_elements(p_payload->'questions') loop
   if coalesce(trim(q->>'text'),'')='' then count_skipped:=count_skipped+1;continue;end if;
   if jsonb_typeof(coalesce(q->'choices','[]'))<>'array' or jsonb_typeof(coalesce(q->'concepts','[]'))<>'array' then raise exception '문항 배열 형식 오류';end if;
   v_id:=coalesce((p_payload->>'source_id')::uuid,(select id from public.odap_sources where sha256=q->>'source_sha256'));
   if v_id is null then raise exception '원본을 먼저 등록하세요.';end if;
   prop:=case when q ? 'source_ref' then concat(q->>'source_sha256',':',q->'source_ref'->>'section',':',q->'source_ref'->>'start') else v_id::text||':'||coalesce(q->>'original_number','')||':'||md5(q::text) end;
   insert into public.odap_questions(id,source_id,body,fingerprint,source_key) values(coalesce((q->>'id')::uuid,gen_random_uuid()),v_id,q-'id'-'version'-'status'-'reviewed',md5(regexp_replace(lower(q->>'text'),'[^[:alnum:]가-힣]','','g')||coalesce((q->'choices')::text,'')),prop) on conflict(source_key) do nothing;
   get diagnostics n=row_count;count_added:=count_added+n;count_skipped:=count_skipped+1-n;
  end loop;return jsonb_build_object('added',count_added,'skipped',count_skipped);
 elsif p_action='POST /api/question' then
  select * into oldq from public.odap_questions where id=(p_payload->>'id')::uuid for update;
  if not found or oldq.version is distinct from (p_payload->>'version')::integer then raise exception '문항이 변경됐습니다. 다시 여세요.';end if;
  q:=oldq.body||(p_payload-'id'-'version'-'approved'-'evidence_ids'-'source_id'-'status'-'reviewed'-'evidence');
  v_status:=case when coalesce((p_payload->>'approved')::boolean,false) then 'approved' else 'pending' end;
  if coalesce(trim(q->>'text'),'')='' or jsonb_typeof(q->'choices') is distinct from 'array' or jsonb_typeof(q->'concepts') is distinct from 'array' then raise exception '문항 형식 오류';end if;
  if v_status='approved' and (coalesce(trim(q->>'answer'),'')='' or coalesce(trim(q->>'explanation'),'')='' or jsonb_array_length(q->'concepts')=0) then raise exception '정답·해설·개념을 확인하세요.';end if;
  update public.odap_questions set body=q,status=v_status,version=version+1 where id=oldq.id;
  update public.odap_mappings set verified=false where question_id=oldq.id;
  delete from public.odap_question_evidence where question_id=oldq.id;
  insert into public.odap_question_evidence select oldq.id,value::uuid from jsonb_array_elements_text(coalesce(p_payload->'evidence_ids','[]'));
  return '{"saved":true}';
 elsif p_action='POST /api/evidence' then
  stmt:=trim(p_payload->>'statement');prop:=md5(regexp_replace(lower((p_payload->>'concept')||':'||stmt),'[^[:alnum:]가-힣]','','g'));
  if coalesce(stmt,'')='' or coalesce(trim(p_payload->>'quote'),'')='' or coalesce(trim(p_payload->>'concept'),'')='' then raise exception '근거·개념·명제를 모두 입력하세요.';end if;
  if coalesce(p_payload->>'blank_answer','')<>'' and position((p_payload->>'blank_answer') in stmt)=0 then raise exception '빈칸 정답이 명제에 없습니다.';end if;
  insert into public.odap_evidence(source_id,page,quote,concept,statement,blank_answer,proposition_key,approved) values((p_payload->>'source_id')::uuid,(p_payload->>'page')::integer,p_payload->>'quote',p_payload->>'concept',stmt,coalesce(p_payload->>'blank_answer',''),prop,coalesce((p_payload->>'approved')::boolean,false)) returning id into v_id;return jsonb_build_object('id',v_id);
 elsif p_action='POST /api/link' then
  if coalesce((p_payload->>'confirmed')::boolean,false) is not true then raise exception '학생을 확인하세요.';end if;
  for rid in select value from jsonb_array_elements_text(p_payload->'response_ids') loop
   update public.exam_responses r set student_id=sid where r.id::text=rid and r.student_id is null and r.student_name=(select name from public.users where id::text=sid);
   if not found then raise exception '기존 학생 연결을 변경할 수 없습니다.';end if;
  end loop;return jsonb_build_object('linked',jsonb_array_length(p_payload->'response_ids'));
 elsif p_action='POST /api/mapping' then
  select r.exam_id::text into rid from public.exam_responses r join public.exams e on e.id=r.exam_id where r.id::text=p_payload->>'response_id' and r.student_id=sid and public.odap_grade(r.answers->>(p_payload->>'question_index'),e.questions->(p_payload->>'question_index')::integer->>'answer')=false;
  if not found then raise exception '선택 학생의 오답 기록이 아닙니다.';end if;
  v_id:=nullif(p_payload->>'question_id','')::uuid;
  if coalesce((p_payload->>'verified')::boolean,false) and not exists(select 1 from public.odap_questions where id=v_id and status='approved') then raise exception '검수한 동일 원문을 선택하세요.';end if;
  insert into public.odap_mappings values(rid,(p_payload->>'question_index')::integer,v_id,p_payload->'concepts',coalesce((p_payload->>'verified')::boolean,false)) on conflict(exam_id,question_index) do update set question_id=excluded.question_id,concepts=excluded.concepts,verified=excluded.verified;
  insert into public.odap_notes values(p_payload->>'response_id',(p_payload->>'question_index')::integer,sid,coalesce(p_payload->>'error_type',''),coalesce(p_payload->>'note','')) on conflict(response_id,question_index) do update set error_type=excluded.error_type,note=excluded.note;
  return '{"saved":true}';
 elsif p_action='POST /api/generated/review' then
  if p_payload->>'status' not in ('approved','rejected') then raise exception '승인/반려 오류';end if;
  update public.odap_generated set status=p_payload->>'status',version=version+1 where id=(p_payload->>'id')::uuid;return '{"saved":true}';
 elsif p_action='variant_context' then
  select * into oldq from public.odap_questions where id=(p_payload->>'question_id')::uuid and status='approved';
  select * into ev from public.odap_evidence where id=(p_payload->>'evidence_id')::uuid and approved;
  if oldq.id is null or ev.id is null or not exists(select 1 from public.odap_question_evidence where question_id=oldq.id and evidence_id=ev.id) then raise exception '검수한 문항·근거 연결을 먼저 확인하세요.';end if;
  if exists(select 1 from public.odap_generated where student_id=sid and proposition_key=ev.proposition_key) then raise exception '이미 출제한 핵심명제입니다.';end if;
  return jsonb_build_object('question',public.odap_question_json(oldq),'evidence',to_jsonb(ev));
 elsif p_action='variant_save' then
  select * into ev from public.odap_evidence where id=(p_payload->>'evidence_id')::uuid and approved;
  if not found or not exists(select 1 from public.odap_question_evidence qe join public.odap_questions q on q.id=qe.question_id where qe.question_id=(p_payload->>'question_id')::uuid and qe.evidence_id=ev.id and q.status='approved') then raise exception '검수 근거가 없습니다.';end if;
  q:=p_payload->'body';
  if coalesce(q->>'text','')='' or coalesce(q->>'explanation','')='' or coalesce(q->>'answer','') !~ '^[1-5]$' or jsonb_typeof(q->'choices') is distinct from 'array' or jsonb_array_length(q->'choices')<>5 then raise exception 'AI 문항 형식 오류';end if;
  body:=q||jsonb_build_object('concepts',jsonb_build_array(ev.concept),'source_title',(select title from public.odap_sources where id=ev.source_id),'page',ev.page,'parent_id',p_payload->>'question_id','engine','김까까 AI 변형 · 교사 검수 필수');
  insert into public.odap_generated(student_id,evidence_id,proposition_key,fingerprint,kind,body) values(sid,ev.id,ev.proposition_key,md5(regexp_replace(lower(q->>'text'),'[^[:alnum:]가-힣]','','g')),'variant',body) returning id into v_id;return jsonb_build_object('id',v_id,'status','pending');
 elsif p_action='POST /api/packet' then
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception '1~100문항을 선택하세요.';end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
   if item->>'type'='generated' then
    select * into gen from public.odap_generated where id=(item->>'id')::uuid and student_id=sid and status='approved';if not found then raise exception '승인된 해당 학생 생성문항만 담을 수 있습니다.';end if;
    q:=gen.body||jsonb_build_object('id',gen.id,'version',gen.version,'reviewed',true,'kind',gen.kind);
   else
    select * into oldq from public.odap_questions where id=(item->>'id')::uuid and status='approved';if not found then raise exception '문항 검수를 먼저 완료하세요.';end if;q:=public.odap_question_json(oldq);
   end if;
   items:=items||jsonb_build_array(q||jsonb_build_object('selection_type',item->>'type'));
  end loop;
  select name into student_name from public.users where id::text=sid;
  body:=jsonb_build_object('title',coalesce(nullif(trim(p_payload->>'title'),''),'주간 맞춤 오답정리'),'student_id',sid,'student_name',student_name,'summary',coalesce(p_payload->>'summary',''),'items',items,'created_at',now());
  insert into public.odap_packets(student_id,title,body) values(sid,body->>'title',body) returning id into v_id;return jsonb_build_object('id',v_id);
 elsif p_action in ('POST /api/packet/approve','POST /api/publish','POST /api/render') then
  select * into packet from public.odap_packets where id=(p_payload->>'id')::uuid for update;if not found then raise exception '자료 없음';end if;
  for item in select value from jsonb_array_elements(packet.body->'items') loop
   if item->>'selection_type'='generated' then
    if not exists(select 1 from public.odap_generated where id=(item->>'id')::uuid and student_id=packet.student_id and status='approved' and version=(item->>'version')::integer) then raise exception '생성문항이 변경됐습니다.';end if;
   else
    if not exists(select 1 from public.odap_questions where id=(item->>'id')::uuid and status='approved' and version=(item->>'version')::integer) then raise exception '원문 문항이 변경됐습니다.';end if;
   end if;
  end loop;
  if p_action='POST /api/render' then
   if packet.status='published' then raise exception '공개 자료는 새 초안으로 복사한 뒤 제작하세요.';end if;
   if exists(select 1 from jsonb_array_elements(packet.body->'items') x where x.value->'source_ref' is null) then raise exception '원문 한글이 연결된 문항만 한글 제작이 가능합니다. 생성문항은 인쇄/PDF를 이용하세요.';end if;
   insert into public.odap_jobs(packet_id) values(packet.id) on conflict(packet_id) do update set status=case when odap_jobs.status='failed' then 'pending' else odap_jobs.status end,error=null returning * into job;return to_jsonb(job);
  end if;
  if coalesce((p_payload->>'confirmed')::boolean,false) is not true then raise exception '자료·지면을 확인한 뒤 승인하세요.';end if;
  if p_action='POST /api/publish' and packet.status<>'approved' then raise exception '교사 승인 자료만 공개할 수 있습니다.';end if;
  update public.odap_packets set status=case when p_action='POST /api/publish' then 'published' else 'approved' end,verified=true where id=packet.id returning * into packet;
  return jsonb_build_object('status',packet.status);
 elsif p_action='POST /api/export' then
  select * into packet from public.odap_packets where id=(p_payload->>'id')::uuid and status in ('approved','published');if not found then raise exception '승인 자료만 내보낼 수 있습니다.';end if;
  return packet.body||jsonb_build_object('schema_version',1,'external_packet_id',packet.id,'approved_at',now());
 elsif p_action='asset_permission' then
  if p_payload->>'kind'='source' then select * into src from public.odap_sources where id=(p_payload->>'id')::uuid;return jsonb_build_object('path',src.object_path,'filename',src.title);
  end if;
  if exists(select 1 from public.odap_packets p cross join lateral jsonb_array_elements(p.files) f where f->>'path'=p_payload->>'path') then return '{"allowed":true}';end if;
  raise exception '등록된 파일이 아닙니다.';
 elsif p_action='worker_claim' then
  update public.odap_jobs set status='failed',error='제작 시간이 초과됐습니다. 다시 요청하세요.' where status='running' and updated_at<now()-interval '15 minutes';
  select * into job from public.odap_jobs where status='pending' order by updated_at for update skip locked limit 1;
  if not found then return null;end if;
  update public.odap_jobs set status='running',lease=gen_random_uuid(),updated_at=now() where id=job.id returning * into job;
  select * into packet from public.odap_packets where id=job.packet_id;return to_jsonb(job)||jsonb_build_object('packet',packet.body);
 elsif p_action='worker_finish' then
  select * into job from public.odap_jobs where id=(p_payload->>'id')::uuid and lease=(p_payload->>'lease')::uuid and status='running' for update;
  if not found then raise exception '제작 요청이 만료됐습니다.';end if;
  if p_payload->>'error' is not null then update public.odap_jobs set status='failed',error=left(p_payload->>'error',300),updated_at=now() where id=job.id;return '{"status":"failed"}';end if;
  select * into packet from public.odap_packets where id=job.packet_id for update;
  if packet.status='published' then raise exception '공개 자료를 덮어쓸 수 없습니다.';end if;
  if jsonb_typeof(p_payload->'files') is distinct from 'array' or jsonb_array_length(p_payload->'files')<>3 then raise exception 'HWP·HWPX·PDF 파일이 필요합니다.';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'files') f where f->>'kind' not in ('hwp','hwpx','pdf') or coalesce(f->>'path','') not like 'packets/'||job.packet_id::text||'/%') or (select count(distinct f->>'kind') from jsonb_array_elements(p_payload->'files') f)<>3 then raise exception '제작 파일 경로·형식을 확인하세요.';end if;
  update public.odap_packets set files=p_payload->'files',verified=false,status='draft' where id=job.packet_id;
  update public.odap_jobs set status='ready',updated_at=now(),error=null where id=job.id;return '{"status":"ready"}';
 else raise exception '지원하지 않는 오답연구소 작업: %',p_action;
 end if;
end $$;
revoke all on function public.odap_rpc(text,text,text,text,jsonb) from public;
grant execute on function public.odap_rpc(text,text,text,text,jsonb) to anon,authenticated;
commit;

create index if not exists odap_questions_source_status_idx on public.odap_questions(source_id,status);

create index if not exists odap_questions_summary_idx on public.odap_questions(source_id,status) include(id);
