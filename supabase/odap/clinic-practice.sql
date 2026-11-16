-- Local preparation only. Apply separately after the existing identity/mapping schema.
begin;
create or replace function public.odap_grade(a text,k text) returns boolean language sql immutable set search_path=public as $$
select case when k ~ '^[1-5]$' and btrim(coalesce(a,'')) ~ '^[1-5]$' then btrim(a)=k
when k ~ '^any:[1-5](,[1-5])+$' and btrim(coalesce(a,'')) ~ '^[1-5](\s*,\s*[1-5])*$' then btrim(a)=any(string_to_array(substr(k,5),','))
when k ~ '^all:[1-5](,[1-5])+$' and btrim(coalesce(a,'')) ~ '^[1-5](\s*,\s*[1-5])*$' then
 (select array_agg(distinct x order by x) from regexp_split_to_table(regexp_replace(a,'\s','','g'),',') x)=(select array_agg(distinct x order by x) from regexp_split_to_table(substr(k,5),',') x)
when upper(k) in ('O','X') and upper(a) in ('O','X') then upper(k)=upper(a) else null end $$;
revoke all on function public.odap_grade(text,text) from public,anon,authenticated;

create table if not exists public.odap_clinic_practice_settings(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 allowed_student_ids text[] not null default '{}',
 allowed_clinic_weeks text[] not null default '{}',
 homework_since timestamptz not null default (now()-interval '90 days'),
 homework_exam_ids text[] not null default '{}'
);
insert into public.odap_clinic_practice_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.odap_clinic_practice_items(
 id uuid primary key default gen_random_uuid(),student_id text not null,exam_id text not null,
 question_index integer not null check(question_index>=0),clinic_week text not null,
 question_id uuid references public.odap_questions(id),
 homework_exam_id text,homework_question_index integer,content_key text,practice_body jsonb,
 status text not null check(status in ('open','answered','skipped','retired','withdrawn')),
 skip_reason text check(skip_reason in ('no_mapping','mapping_conflict','no_type','no_candidate')),
 fallback_skip_reason text check(fallback_skip_reason in ('no_domain','no_homework_candidate','no_choices')),
 my_answer text,correct boolean,answered_at timestamptz,
 -- Freeze the first server result even if a bank answer/explanation is later edited.
 result jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(student_id,exam_id,question_index)
);
alter table public.odap_clinic_practice_items drop constraint if exists odap_clinic_practice_items_fallback_skip_reason_check;
alter table public.odap_clinic_practice_items add constraint odap_clinic_practice_items_fallback_skip_reason_check
 check(fallback_skip_reason in ('no_domain','no_homework_candidate','no_choices'));
alter table public.odap_clinic_practice_items add column if not exists response_key text;
create unique index if not exists odap_clinic_practice_student_question
 on public.odap_clinic_practice_items(student_id,question_id) where question_id is not null and status<>'retired';
create unique index if not exists odap_clinic_practice_student_content
 on public.odap_clinic_practice_items(student_id,content_key) where content_key is not null and status<>'retired';
create table if not exists public.odap_clinic_practice_reports(
 id uuid primary key default gen_random_uuid(),item_id uuid not null references public.odap_clinic_practice_items(id),
 student_id text not null,reason text not null check(length(btrim(reason)) between 1 and 500),
 status text not null default 'open' check(status in ('open','resolved')),
 created_at timestamptz not null default now(),unique(item_id,student_id)
);
alter table public.odap_clinic_practice_settings enable row level security;
alter table public.odap_clinic_practice_items enable row level security;
alter table public.odap_clinic_practice_reports enable row level security;
revoke all on public.odap_clinic_practice_settings,public.odap_clinic_practice_items,public.odap_clinic_practice_reports from public,anon,authenticated;

create table if not exists public.odap_clinic_practice_blocks(
 key text primary key,created_at timestamptz not null default now()
);
alter table public.odap_clinic_practice_blocks enable row level security;
revoke all on public.odap_clinic_practice_blocks from public,anon,authenticated;
-- Upgrade earlier withdrawals to global exclusions without deleting any history.
insert into public.odap_clinic_practice_blocks(key)
 select 'content:'||content_key from public.odap_clinic_practice_items where status='withdrawn' and content_key is not null
 union select 'question:'||question_id from public.odap_clinic_practice_items where status='withdrawn' and question_id is not null
 on conflict do nothing;
update public.odap_clinic_practice_items i set status='withdrawn',updated_at=now()
 where i.status in ('open','answered') and exists(select 1 from public.odap_clinic_practice_blocks b
  where b.key='content:'||i.content_key or b.key='question:'||i.question_id);

create or replace function public.odap_clinic_practice_has_choices(body jsonb) returns boolean language sql immutable set search_path=public as $$
 select (jsonb_array_length(case when jsonb_typeof(body->'choices')='array' then body->'choices' else '[]' end)=5
  and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(body->'choices')='array' then body->'choices' else '[]' end) c
   where jsonb_typeof(c)<>'string' or btrim(c#>>'{}')=''))
  or (coalesce(body->>'text','')||E'\n'||coalesce(body->>'passage','')) ~ '(?s)①.+②.+③.+④.+⑤.+'
$$;
revoke all on function public.odap_clinic_practice_has_choices(jsonb) from public,anon,authenticated;

-- One correspondence table for both clinic domains and homework domains.
create or replace function public.odap_clinic_practice_domain(d text) returns text language sql immutable set search_path=public as $$
 select case
 -- Clinic papers label questions by topic (work or grammar unit); fold those into the homework domains.
 when d ~ '고전소설|춘향전' then '문학(고전소설)'
 when d ~ '현대시|진달래꽃' then '문학(현대시)'
 when d ~ '고전시가|고전시|속미인곡' then '문학(고전시)'
 when d ~ '현대 국어 문법|중세 국어|한글 맞춤법|문법|높임|사동|피동|시간 표현' then '문법'
 when d ~ '화법|발표' then '화법'
 else null end
$$;
revoke all on function public.odap_clinic_practice_domain(text) from public,anon,authenticated;

-- No practice code runs inside an answer save, including marker writes or locks.
drop trigger if exists odap_clinic_practice_sync on public.exam_responses;
drop function if exists public.odap_clinic_practice_sync();
-- Derive pending work from saved answers, so a canceled allocation still has a visible pending count.
create or replace function public.odap_clinic_practice_work(p_student_id text)
returns table(exam_id text,clinic_week text,idx integer,value jsonb,is_wrong boolean,response_key text)
language sql stable set search_path=public as $$
 with latest as materialized (
  select distinct on(e.id) e.id::text exam_id,e.clinic_week,e.questions,r.answers,
   md5(jsonb_build_array(r.id,r.submitted_at,r.answers,e.questions,cfg.homework_since,cfg.homework_exam_ids)::text) response_key
  from public.exam_responses r join public.exams e on e.id=r.exam_id
  join public.odap_clinic_practice_settings cfg on cfg.singleton and cfg.enabled
  join public.users u on u.id::text=r.student_id and u.role='student' and u.status='active'
  where r.student_id=p_student_id and p_student_id=any(cfg.allowed_student_ids)
   and coalesce(e.category,'school')='school' and nullif(btrim(e.clinic_week),'') is not null and e.clinic_week=any(cfg.allowed_clinic_weeks)
  order by e.id,r.submitted_at desc nulls last,r.id desc
 ), entries as (
  select l.*,q.idx,l.questions->q.idx value,
   public.odap_grade(case when jsonb_typeof(l.answers)='array' then l.answers->>q.idx else l.answers->>q.idx::text end,l.questions->q.idx->>'answer') graded
  from latest l cross join lateral (
   select n::int-1 idx from jsonb_array_elements(l.questions) with ordinality x(v,n)
   union select question_index from public.odap_clinic_practice_items where student_id=p_student_id and exam_id=l.exam_id and status in ('open','skipped')
  ) q
 ) select e.exam_id,e.clinic_week,e.idx,e.value,coalesce(e.graded=false,false),e.response_key
 from entries e left join public.odap_clinic_practice_items i on i.student_id=p_student_id and i.exam_id=e.exam_id and i.question_index=e.idx
 where (e.graded=false and (i.id is null or i.status='retired' or i.status='skipped' and i.response_key is distinct from e.response_key))
  or (e.graded is distinct from false and i.status in ('open','skipped'))
 order by e.exam_id,e.idx
$$;
revoke all on function public.odap_clinic_practice_work(text) from public,anon,authenticated;

create or replace function public.odap_clinic_practice_allocate(p_student_id text) returns void
language plpgsql security definer set search_path=public as $$
declare cfg public.odap_clinic_practice_settings%rowtype;
 m public.odap_mappings%rowtype; original jsonb; w record; sch text; chosen uuid; reason text;
 hw_exam text;hw_idx integer;hw_body jsonb;domain text;work_title text;content text;fallback_reason text;
 submitted_ids text[];seen_content text[];seen_questions uuid[];blocked_keys text[];homework_pool jsonb;bank_pool jsonb;work_batch jsonb;
begin
 select * into cfg from public.odap_clinic_practice_settings where singleton for share;
 if not coalesce(cfg.enabled,false) or not coalesce(p_student_id=any(cfg.allowed_student_ids),false) then return;end if;
 select s.name into sch from public.users u left join public.qa_schools s on s.id::text=u.school_id::text
 where u.id::text=p_student_id and u.role='student' and u.status='active';
 if not found then return;end if;
 -- Concurrent allocation calls do not wait; withdrawal takes the exclusive catalog lock.
 if not pg_try_advisory_xact_lock_shared(hashtext('odap-clinic-practice-catalog'))
 or not pg_try_advisory_xact_lock(hashtext('odap-clinic-practice:'||p_student_id)) then return;end if;
 -- Each RPC commits at most three decisions. Skipped decisions are terminal for this saved response.
 select coalesce(jsonb_agg(to_jsonb(entry)),'[]') into work_batch from (select * from public.odap_clinic_practice_work(p_student_id) limit 3) entry;
 if jsonb_array_length(work_batch)=0 then return;end if;
 if exists(select 1 from jsonb_array_elements(work_batch) entry where (entry->>'is_wrong')::boolean) then
 select coalesce(array_agg(id) filter(where id is not null),'{}') into submitted_ids from (
  select exam_id::text id from public.exam_responses where student_id=p_student_id
  union select exam_id from public.odap_attempts where student_id=p_student_id
 ) submitted;
 -- Missing answer keys can mean correct answers in wrong-only/OMR entry. Exclude the entire submitted paper.
 select coalesce(array_agg(distinct md5(regexp_replace(v->>'text','\s','','g'))) filter(where v->>'text' is not null),'{}') into seen_content
 from public.exams h cross join lateral jsonb_array_elements(h.questions) v where h.id::text=any(submitted_ids);
 select coalesce(array_agg(distinct question_id) filter(where question_id is not null),'{}') into seen_questions
 from public.odap_mappings where exam_id=any(submitted_ids);
 select coalesce(array_agg(key),'{}') into blocked_keys from public.odap_clinic_practice_blocks;
 -- Student eligibility and normalization run once per batch, never once per wrong answer.
 with candidates as materialized (
  select q.id,q.body->'concepts' concepts,q.body->'question_types' question_types,
   md5(regexp_replace(q.body->>'text','\s','','g')) content_key
  from public.odap_questions q left join public.odap_sources s on s.id=q.source_id
  where q.status='approved'
   and jsonb_array_length(case when jsonb_typeof(q.body->'choices')='array' then q.body->'choices' else '[]' end)=5
   and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(q.body->'choices')='array' then q.body->'choices' else '[]' end) c where jsonb_typeof(c)<>'string' or btrim(c#>>'{}')='')
   and q.body->>'answer' ~ '^[1-5]$'
   and jsonb_typeof(q.body->'text')='string' and btrim(q.body->>'text')<>''
   and jsonb_typeof(q.body->'explanation')='string' and btrim(q.body->>'explanation')<>''
   and lower(btrim(coalesce(q.body->>'origin_type',''))) not in ('generated','ai','자작')
   and coalesce(s.school,'') in ('',sch) and coalesce(q.body->>'school','') in ('',sch)
   and not (q.id=any(seen_questions)) and not ('question:'||q.id=any(blocked_keys))
 ) select coalesce(jsonb_agg(to_jsonb(c)),'[]') into bank_pool from candidates c
 where not (c.content_key=any(seen_content)) and not ('content:'||c.content_key=any(blocked_keys))
  and not exists(select 1 from public.odap_clinic_practice_items i where i.student_id=p_student_id and i.status<>'retired' and (i.question_id=c.id or i.content_key=c.content_key));
 -- ponytail: keep compact pools in this bounded RPC; use an indexed catalog only if measured batch cost requires it.
 with candidates as materialized (
  select h.id::text exam_id,h.name,h.created_at,(x.n-1)::int idx,x.v body,
   md5(regexp_replace(x.v->>'text','\s','','g')) content_key,
   coalesce(public.odap_clinic_practice_domain(x.v->>'domain'),public.odap_clinic_practice_domain(x.v->>'type')) domain,
   public.odap_clinic_practice_has_choices(x.v) choices_ok
  from public.exams h cross join lateral jsonb_array_elements(h.questions) with ordinality x(v,n)
  where h.category='homework' and nullif(h.clinic_school,'')=sch and h.created_at>=cfg.homework_since
   and not (h.id::text=any(submitted_ids))
   and (case when cardinality(cfg.homework_exam_ids)>0 then h.id::text=any(cfg.homework_exam_ids) else h.name like '%기말%' end)
   and jsonb_typeof(x.v->'text')='string' and btrim(x.v->>'text')<>''
   and x.v->>'answer' ~ '^[1-5]$' and jsonb_typeof(x.v->'explanation')='string' and btrim(x.v->>'explanation')<>''
 ) select coalesce(jsonb_agg(to_jsonb(c)),'[]') into homework_pool from candidates c
 where not (c.content_key=any(seen_content)) and not ('content:'||c.content_key=any(blocked_keys));
 end if;
 for w in select * from jsonb_to_recordset(work_batch) as x(exam_id text,clinic_week text,idx integer,value jsonb,is_wrong boolean,response_key text) loop
  if not w.is_wrong then
   update public.odap_clinic_practice_items set status='retired',updated_at=now() where student_id=p_student_id and exam_id=w.exam_id and question_index=w.idx and status in ('open','skipped');
   continue;
  end if;
  chosen:=null;reason:=null;original:=null;hw_exam:=null;hw_idx:=null;hw_body:=null;content:=null;fallback_reason:=null;
  select * into m from public.odap_mappings where exam_id=w.exam_id and question_index=w.idx;
  if not found or m.verified is distinct from true or m.question_id is null
   or jsonb_array_length(case when jsonb_typeof(m.concepts)='array' then m.concepts else '[]' end)=0 then reason:='no_mapping';
  else
   select body into original from public.odap_questions where id=m.question_id;
   if public.odap_grade(original->>'answer',w.value->>'answer') is distinct from true then reason:='mapping_conflict';
   elsif jsonb_array_length(case when jsonb_typeof(original->'question_types')='array' then original->'question_types' else '[]' end)=0 then reason:='no_type';
   else
    select (q->>'id')::uuid,q->>'content_key' into chosen,content from jsonb_array_elements(bank_pool) q
    where (q->>'id')::uuid<>m.question_id
     and q->>'content_key'<>md5(regexp_replace(coalesce(w.value->>'text',''),'\s','','g'))
     and not exists(select 1 from public.odap_clinic_practice_items i where i.student_id=p_student_id and i.content_key=q->>'content_key' and i.status<>'retired')
     and exists(select 1 from jsonb_array_elements_text(m.concepts) c where jsonb_typeof(q->'concepts')='array' and q->'concepts' ? c)
     and exists(select 1 from jsonb_array_elements_text(original->'question_types') t where jsonb_typeof(q->'question_types')='array' and q->'question_types' ? t)
    order by (select count(distinct c) from jsonb_array_elements_text(m.concepts) c where q->'concepts' ? c) desc,q->>'id' limit 1;
    if chosen is null then reason:='no_candidate';end if;
   end if;
  end if;
  if chosen is null then
   domain:=public.odap_clinic_practice_domain(w.value->>'domain');
   -- Prefer homework on the same work/unit: "문학(현대시)" -> 현대시, "높임 표현" -> 높임, "중세 국어" -> 중세.
   work_title:=coalesce(substring(w.value->>'domain' from '\(([^)]+)\)'),nullif(split_part(btrim(coalesce(w.value->>'domain','')),' ',1),''));
   if domain is null then fallback_reason:='no_domain';
   else
    select h->>'exam_id',(h->>'idx')::int,h->'body',h->>'content_key' into hw_exam,hw_idx,hw_body,content
    from jsonb_array_elements(homework_pool) h where h->>'domain'=domain and (h->>'choices_ok')::boolean
     and h->>'content_key'<>md5(regexp_replace(coalesce(w.value->>'text',''),'\s','','g'))
     and not exists(select 1 from public.odap_clinic_practice_items i where i.student_id=p_student_id and i.status<>'retired' and i.content_key=h->>'content_key')
    order by case when nullif(work_title,'') is not null and position(replace(work_title,' ','') in
      replace(coalesce(h->>'name','')||' '||coalesce(h->'body'->>'text','')||' '||coalesce(h->'body'->>'passage',''),' ',''))>0 then 0 else 1 end,
     (h->>'created_at')::timestamptz desc,h->>'exam_id',(h->>'idx')::int limit 1;
    if hw_exam is null then
     fallback_reason:=case when exists(select 1 from jsonb_array_elements(homework_pool) h where h->>'domain'=domain and not (h->>'choices_ok')::boolean) then 'no_choices' else 'no_homework_candidate' end;
    else reason:=null;end if;
   end if;
  end if;
  insert into public.odap_clinic_practice_items(student_id,exam_id,question_index,clinic_week,question_id,status,skip_reason,
   homework_exam_id,homework_question_index,content_key,practice_body,fallback_skip_reason,response_key)
  values(p_student_id,w.exam_id,w.idx,w.clinic_week,chosen,case when content is null then 'skipped' else 'open' end,reason,
   hw_exam,hw_idx,content,hw_body,fallback_reason,w.response_key)
  on conflict(student_id,exam_id,question_index) do update set question_id=excluded.question_id,status=excluded.status,
   skip_reason=excluded.skip_reason,clinic_week=excluded.clinic_week,updated_at=now(),
   homework_exam_id=excluded.homework_exam_id,homework_question_index=excluded.homework_question_index,
   content_key=excluded.content_key,practice_body=excluded.practice_body,fallback_skip_reason=excluded.fallback_skip_reason,response_key=excluded.response_key
  where odap_clinic_practice_items.status in ('skipped','retired');
 end loop;
end $$;
revoke all on function public.odap_clinic_practice_allocate(text) from public,anon,authenticated;

create or replace function public.odap_clinic_practice_rpc(p_id text,p_password text,p_role text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor jsonb; cfg public.odap_clinic_practice_settings%rowtype; item public.odap_clinic_practice_items%rowtype;
 bank_row public.odap_questions%rowtype; output jsonb; reason text; affected integer; practice jsonb;target_keys text[];
begin
 actor:=public.authenticate_user(p_id,p_password,p_role);
 if actor is null or actor->>'id' is distinct from p_id or actor->>'role' is distinct from p_role then raise exception '본인 계정으로 로그인하세요.';end if;
 if p_role='student' then
  select * into cfg from public.odap_clinic_practice_settings where singleton for share;
  if actor->>'status' is distinct from 'active' or not coalesce(cfg.enabled,false) or not coalesce(p_id=any(cfg.allowed_student_ids),false) then
   if p_action='list' then return '{"enabled":false,"items":[]}';end if;
   raise exception '현재 연습을 사용할 수 없습니다.';
  end if;
  if p_action='allocate' then
   perform public.odap_clinic_practice_allocate(p_id);
   return jsonb_build_object('pending',(select count(*) from public.odap_clinic_practice_work(p_id)));
  elsif p_action='list' then
   select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'exam_name',e.name,'num',coalesce(e.questions->i.question_index->>'num',(i.question_index+1)::text),
    'text',b.body->>'text','passage',coalesce(b.body->>'passage',''),
    'choices',case when jsonb_array_length(case when jsonb_typeof(b.body->'choices')='array' then b.body->'choices' else '[]' end)=5
     and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(b.body->'choices')='array' then b.body->'choices' else '[]' end) c where jsonb_typeof(c)<>'string' or btrim(c#>>'{}')='')
     then (select jsonb_agg(c#>>'{}' order by n) from jsonb_array_elements(b.body->'choices') with ordinality x(c,n)) else '[]'::jsonb end,
    'images',(select coalesce(jsonb_agg(jsonb_build_object('data',im->>'data','alt',coalesce(im->>'alt','문항 그림')) order by n),'[]')
     from jsonb_array_elements(case when jsonb_typeof(b.body->'images')='array' then b.body->'images' else '[]' end) with ordinality x(im,n)
     where im->>'data' ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$')
    )||case when i.status='answered' then jsonb_build_object('result',i.result) else '{}'::jsonb end order by i.created_at,i.exam_id,i.question_index),'[]') into output
   from public.odap_clinic_practice_items i left join public.odap_questions q on q.id=i.question_id join public.exams e on e.id::text=i.exam_id
   left join public.exams h on h.id::text=i.homework_exam_id
   cross join lateral(select case when i.question_id is not null then q.body else i.practice_body end body) b
   where i.student_id=p_id and i.status in ('open','answered')
    and public.odap_clinic_practice_has_choices(b.body)
    and not exists(select 1 from public.odap_clinic_practice_blocks blocked where blocked.key='content:'||i.content_key or blocked.key='question:'||i.question_id)
    and (q.status='approved' or i.question_id is null and h.category='homework' and h.clinic_school=(select s.name from public.users u join public.qa_schools s on s.id::text=u.school_id::text where u.id::text=p_id))
    and i.clinic_week=any(cfg.allowed_clinic_weeks)
    and (coalesce(p_payload->>'exam_id','')='' or i.exam_id=p_payload->>'exam_id');
   return jsonb_build_object('enabled',true,'items',output,'pending',(select count(*) from public.odap_clinic_practice_work(p_id)));
  elsif p_action in ('submit','report') then
   select * into item from public.odap_clinic_practice_items where id=(p_payload->>'id')::uuid and student_id=p_id for update;
   if not found or not coalesce(item.clinic_week=any(cfg.allowed_clinic_weeks),false) or item.status not in ('open','answered') then raise exception '본인의 사용 가능한 문항이 아닙니다.';end if;
   if exists(select 1 from public.odap_clinic_practice_blocks blocked where blocked.key='content:'||item.content_key or blocked.key='question:'||item.question_id) then raise exception '회수된 문항입니다.';end if;
   if item.question_id is not null then
    select * into bank_row from public.odap_questions where id=item.question_id and status='approved' for share;
    if not found then raise exception '승인된 문항이 아닙니다.';end if;
    practice:=bank_row.body;
   else
    perform 1 from public.exams h where h.id::text=item.homework_exam_id and h.category='homework'
     and h.clinic_school=(select s.name from public.users u join public.qa_schools s on s.id::text=u.school_id::text where u.id::text=p_id) for share;
    if not found then raise exception '사용 가능한 과제 문항이 아닙니다.';end if;
    practice:=item.practice_body;
   end if;
   if not public.odap_clinic_practice_has_choices(practice) then raise exception '선택지가 확인되지 않은 문항입니다.';end if;
   if p_action='report' then
    reason:=btrim(p_payload->>'reason');
    if reason is null or length(reason) not between 1 and 500 then raise exception '신고 사유는 1~500자입니다.';end if;
    insert into public.odap_clinic_practice_reports(item_id,student_id,reason) values(item.id,p_id,reason)
     on conflict(item_id,student_id) do nothing;
    return '{"saved":true}';
   end if;
   if item.status='answered' then return item.result;end if;
   if coalesce(p_payload->>'answer','') !~ '^[1-5]$' or coalesce(practice->>'answer','') !~ '^[1-5]$' then raise exception '답을 하나 선택하세요.';end if;
   output:=jsonb_build_object('id',item.id,'my_answer',p_payload->>'answer','correct',public.odap_grade(p_payload->>'answer',practice->>'answer'),
    'answer',practice->>'answer','explanation',practice->>'explanation','answered_at',now());
   update public.odap_clinic_practice_items set status='answered',my_answer=p_payload->>'answer',correct=(output->>'correct')::boolean,
    answered_at=now(),updated_at=now(),result=output where id=item.id;
   return output;
  end if;
  raise exception '허용되지 않은 학생 작업입니다.';
 end if;
 if p_role<>'teacher' or actor->>'status' is distinct from 'active' then raise exception '교사 전용 작업입니다.';end if;
 if p_action='summary' then
  with latest as (
   select distinct on(r.student_id,r.exam_id) r.* from public.exam_responses r join public.exams e on e.id=r.exam_id
   where coalesce(e.category,'school')='school' and nullif(btrim(e.clinic_week),'') is not null and e.clinic_week=p_payload->>'clinic_week'
   order by r.student_id,r.exam_id,r.submitted_at desc nulls last,r.id desc
  ), wrongs as (
   select r.student_id,r.exam_id::text exam_id,count(*) filter(where public.odap_grade(
    case when jsonb_typeof(r.answers)='array' then r.answers->>(n::int-1) else r.answers->>((n-1)::text) end,v->>'answer')=false) wrong
   from latest r join public.exams e on e.id=r.exam_id cross join lateral jsonb_array_elements(e.questions) with ordinality x(v,n) group by r.student_id,r.exam_id
  ), pending as materialized (
   select s.student_id,p.exam_id,count(*) total from (select distinct student_id from latest) s
   cross join lateral public.odap_clinic_practice_work(s.student_id) p
   where p.is_wrong and p.clinic_week=p_payload->>'clinic_week' group by s.student_id,p.exam_id
  ), counts as (
   select student_id,exam_id,count(*) filter(where status in ('open','answered','withdrawn')) assigned,
    count(*) filter(where status='skipped') skipped,count(*) filter(where answered_at is not null) answered,
    count(*) filter(where correct=true) correct,
    jsonb_build_object('no_mapping',count(*) filter(where status='skipped' and skip_reason='no_mapping'),
     'mapping_conflict',count(*) filter(where status='skipped' and skip_reason='mapping_conflict'),
     'no_type',count(*) filter(where status='skipped' and skip_reason='no_type'),
     'no_candidate',count(*) filter(where status='skipped' and skip_reason='no_candidate'),
     'no_domain',count(*) filter(where status='skipped' and fallback_skip_reason='no_domain'),
     'no_homework_candidate',count(*) filter(where status='skipped' and fallback_skip_reason='no_homework_candidate'),
     'no_choices',count(*) filter(where status='skipped' and fallback_skip_reason='no_choices')) skip_reasons
   from public.odap_clinic_practice_items where clinic_week=p_payload->>'clinic_week' group by student_id,exam_id
  ) select coalesce(jsonb_agg(jsonb_build_object('student_id',coalesce(w.student_id,c.student_id),'student_name',u.name,
   'exam_id',coalesce(w.exam_id,c.exam_id),'exam_name',e.name,'wrong',coalesce(w.wrong,0),'assigned',coalesce(c.assigned,0),
   'pending',coalesce(p.total,0),'skipped',coalesce(c.skipped,0),'answered',coalesce(c.answered,0),'correct',coalesce(c.correct,0),'skip_reasons',coalesce(c.skip_reasons,'{}'))
   order by u.name,e.name),'[]') into output from wrongs w full join counts c using(student_id,exam_id)
   left join pending p on p.student_id=coalesce(w.student_id,c.student_id) and p.exam_id=coalesce(w.exam_id,c.exam_id)
   left join public.users u on u.id::text=coalesce(w.student_id,c.student_id) left join public.exams e on e.id::text=coalesce(w.exam_id,c.exam_id);
  return jsonb_build_object('rows',output,'weeks',(select coalesce(jsonb_agg(week order by week desc),'[]') from
   (select distinct clinic_week week from public.exams where coalesce(category,'school')='school' and nullif(btrim(clinic_week),'') is not null) x),
   'questions',(select coalesce(jsonb_agg(x order by x.content_key),'[]') from (
    select i.content_key,max(coalesce(q.body,i.practice_body)->>'text') text,count(distinct i.student_id) students,count(*) items
    from public.odap_clinic_practice_items i left join public.odap_questions q on q.id=i.question_id where i.status in ('open','answered')
    and exists(select 1 from public.odap_clinic_practice_items week_item where week_item.content_key=i.content_key and week_item.clinic_week=p_payload->>'clinic_week')
    group by i.content_key) x));
 elsif p_action='withdraw' then
  if coalesce(p_payload->>'id',p_payload->>'question_id',p_payload->>'content_key') is null then raise exception '회수할 문항을 선택하세요.';end if;
  perform pg_advisory_xact_lock(hashtext('odap-clinic-practice-catalog'));
  select coalesce(array_agg(distinct key),'{}') into target_keys from (
   select unnest(array['content:'||i.content_key,'question:'||i.question_id]) key from public.odap_clinic_practice_items i
   where (case when p_payload->>'id' is not null then i.id=(p_payload->>'id')::uuid when p_payload->>'content_key' is not null then i.content_key=p_payload->>'content_key' else i.question_id=(p_payload->>'question_id')::uuid end)
   union select 'content:'||(p_payload->>'content_key')
   union select 'question:'||(p_payload->>'question_id')
   union select 'content:'||md5(regexp_replace(q.body->>'text','\s','','g')) from public.odap_questions q where q.id=(p_payload->>'question_id')::uuid
  ) keys where key is not null;
  select array_agg(distinct key) into target_keys from (
   select unnest(target_keys) key
   union select 'content:'||md5(regexp_replace(body->>'text','\s','','g')) from public.odap_questions where 'question:'||id=any(target_keys)
  ) keys where key is not null;
  if coalesce(cardinality(target_keys),0)=0 then raise exception '회수할 문항이 없습니다.';end if;
  perform 1 from public.odap_clinic_practice_items where status in ('open','answered')
   and ('content:'||content_key=any(target_keys) or 'question:'||question_id=any(target_keys)) for update;
  select jsonb_build_object('items',count(*),'students',count(distinct student_id)) into output from public.odap_clinic_practice_items
   where status in ('open','answered') and ('content:'||content_key=any(target_keys) or 'question:'||question_id=any(target_keys));
  if p_payload->>'dry_run'='true' then return output;end if;
  if p_payload ? 'expected_items' and (p_payload->>'expected_items')::int<>(output->>'items')::int then raise exception '영향 범위가 바뀌었습니다. 다시 확인하세요.';end if;
  insert into public.odap_clinic_practice_blocks(key) select unnest(target_keys) on conflict do nothing;
  -- Include every source identity sharing a withdrawn text, even when a bank row later changes text.
  insert into public.odap_clinic_practice_blocks(key)
   select 'question:'||question_id from public.odap_clinic_practice_items where 'content:'||content_key=any(target_keys) and question_id is not null
   on conflict do nothing;
  update public.odap_clinic_practice_items set status='withdrawn',updated_at=now() where status in ('open','answered')
   and ('content:'||content_key=any(target_keys) or 'question:'||question_id=any(target_keys));
  get diagnostics affected=row_count;
  return output||jsonb_build_object('withdrawn',affected);
 elsif p_action='reports' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'item_id',r.item_id,'student_id',r.student_id,'student_name',u.name,
   'reason',r.reason,'status',r.status,'created_at',r.created_at,'question_id',i.question_id,'content_key',i.content_key,'text',coalesce(q.body,i.practice_body)->>'text') order by r.created_at desc),'[]') into output
  from public.odap_clinic_practice_reports r join public.odap_clinic_practice_items i on i.id=r.item_id
  left join public.users u on u.id::text=r.student_id left join public.odap_questions q on q.id=i.question_id;
  return output;
 elsif p_action='report_resolve' then
  update public.odap_clinic_practice_reports set status='resolved' where id=(p_payload->>'id')::uuid;
  return jsonb_build_object('resolved',found);
 end if;
 raise exception '지원하지 않는 작업입니다.';
end $$;
revoke all on function public.odap_clinic_practice_rpc(text,text,text,text,jsonb) from public;
grant execute on function public.odap_clinic_practice_rpc(text,text,text,text,jsonb) to anon,authenticated;
commit;
