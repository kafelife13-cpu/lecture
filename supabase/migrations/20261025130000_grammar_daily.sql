begin;
create table if not exists public.grammar_ox_bank (
 id text primary key, level smallint not null check(level between 1 and 4), topic text not null,
 tags text[] not null default '{}', data jsonb not null check(jsonb_typeof(data)='object' and data ? 'answer' and data->>'answer' in ('0','1')),
 source_kind text not null check(source_kind in ('public','protected')),source_title text not null,created_at timestamptz not null default now()
);
create table if not exists public.grammar_ox_daily (
 student_id text not null,day date not null,items text[] not null check(cardinality(items)=10),
 level smallint not null check(level between 1 and 4),completed_at timestamptz,
 roles jsonb not null default '{}', targets jsonb not null default '{}',primary key(student_id,day)
);
-- Canonical daily answers cannot be forged through the legacy public attempt table.
create table if not exists public.grammar_ox_daily_answers (
 student_id text not null, day date not null,question_id text not null,choice smallint not null check(choice in(0,1)),
 is_correct boolean not null,target_question_id text,is_review_success boolean not null default false,submitted_at timestamptz not null default now(),
 primary key(student_id,day,question_id),foreign key(student_id,day) references public.grammar_ox_daily(student_id,day)
);
alter table public.grammar_ox_bank enable row level security;
alter table public.grammar_ox_daily enable row level security;
alter table public.grammar_ox_daily_answers enable row level security;
revoke all on public.grammar_ox_bank,public.grammar_ox_daily,public.grammar_ox_daily_answers from public,anon,authenticated;

create or replace function public.grammar_ox_next_level(h jsonb) returns integer language plpgsql immutable set search_path=public as $$
declare d jsonb; previous jsonb; latest jsonb; lvl int; n int:=0; total int:=0; correct int:=0;
begin
 select value into latest from jsonb_array_elements(h) where value->>'completed_at' is not null order by value->>'day' desc limit 1;
 if latest is null then return 1;end if;lvl=(latest->>'level')::int;
 for d in select value from jsonb_array_elements(h) where value->>'completed_at' is not null order by value->>'day' desc loop
  exit when (d->>'level')::int<>lvl;n=n+1;if n=2 then previous=d;end if;
  if n<=3 then total=total+(d->>'total')::int;correct=correct+(d->>'correct')::int;end if;
 end loop;
 if previous is not null and (latest->>'day')::date-(previous->>'day')::date=1 and (latest->>'correct')::numeric/nullif((latest->>'total')::int,0)<.5 and (previous->>'correct')::numeric/nullif((previous->>'total')::int,0)<.5 then return greatest(1,lvl-1);end if;
 if lvl<4 and n>=(case lvl when 1 then 5 when 2 then 7 else 10 end) and total>=30 and correct::numeric/total>=.8 then return lvl+1;end if;return lvl;
end $$;
create or replace function public.grammar_ox_daily_history(sid text) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.day),'[]'::jsonb) from (
 select d.day,d.level,d.completed_at,count(a.question_id)::int as total,count(a.question_id) filter(where a.is_correct)::int as correct
 from grammar_ox_daily d left join grammar_ox_daily_answers a on a.student_id=d.student_id and a.day=d.day
 where d.student_id=sid group by d.day,d.level,d.completed_at) x;
$$;
create or replace function public.grammar_ox_due(sid text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare cards jsonb:='{}';a record;c jsonb;key text;stage int;due_at timestamptz;last_at timestamptz;result jsonb;
begin
 for a in select * from grammar_ox_attempts where student_id=sid and submitted_at<=now() order by submitted_at,id loop
  key=coalesce(a.target_question_id,a.question_id);c=cards->key;
  if not a.is_correct then stage=0;due_at=a.submitted_at+interval '1 day';
  elsif c is null then stage=1;due_at=a.submitted_at+interval '1 day';
  elsif a.submitted_at>=(c->>'due')::timestamptz and a.submitted_at>=(c->>'lastSeen')::timestamptz+interval '1 day' then stage=least(5,greatest(2,(c->>'stage')::int+1));due_at=a.submitted_at+make_interval(days= (array[1,3,7,14,30])[stage]);
  else stage=(c->>'stage')::int;due_at=(c->>'due')::timestamptz;end if;
  cards=jsonb_set(cards,array[key],jsonb_build_object('stage',stage,'due',due_at,'lastSeen',a.submitted_at));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.key,'due',e.value->>'due') order by e.value->>'due'),'[]') into result from jsonb_each(cards) e
 where (e.value->>'due')::timestamptz<=now() and (e.value->>'lastSeen')::timestamptz<=now()-interval '1 day';return result;
end $$;
revoke all on function public.grammar_ox_next_level(jsonb),public.grammar_ox_daily_history(text),public.grammar_ox_due(text) from public,anon,authenticated;

create table if not exists public.grammar_ox_settings(id boolean primary key default true check(id),reminders_enabled boolean not null default false);
insert into public.grammar_ox_settings(id) values(true) on conflict do nothing;
alter table public.grammar_ox_settings enable row level security;
revoke all on public.grammar_ox_settings from public,anon,authenticated;
create or replace function public.grammar_ox_queue_reminders() returns integer language plpgsql security definer set search_path=public as $$
declare n integer;today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if extract(hour from now() at time zone 'Asia/Seoul')<20 or not exists(select 1 from grammar_ox_settings where reminders_enabled) then return 0;end if;
 insert into push_queue(id,title,body,target_ids)
 select 'gox-daily:'||u.id||':'||today,'오늘의 문법 복습OX','오늘 OX 10문항을 아직 마치지 않았어요. 문법 복습OX에서 이어서 풀어 보세요.',array[u.id::text]
 from users u where u.role='student' and u.status='active'
 and exists(select 1 from push_subscriptions s where s.student_id=u.id)
 and not exists(select 1 from grammar_ox_daily d where d.student_id=u.id and d.day=today and d.completed_at is not null)
 on conflict(id) do nothing;get diagnostics n=row_count;return n;
end $$;
revoke all on function public.grammar_ox_queue_reminders() from public;
grant execute on function public.grammar_ox_queue_reminders() to anon,authenticated;

create or replace function public.grammar_ox_rpc(p_id text,p_password text,p_role text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor jsonb;sid text;today date:=(now() at time zone 'Asia/Seoul')::date;daily grammar_ox_daily%rowtype;
 history_rows jsonb;result jsonb;chosen text[]:='{}';roles jsonb:='{}';targets jsonb:='{}';due jsonb;item jsonb;original grammar_ox_bank%rowtype;candidate grammar_ox_bank%rowtype;
 lvl int;wanted int;zeros int:=0;desired int;slot int;purpose text;choice_value int;qid text;target text;success boolean;answer_row grammar_ox_daily_answers%rowtype;attempt jsonb;ids text[];
begin
 actor=public.authenticate_user(p_id,p_password,p_role);
 if actor is null or actor->>'status' is distinct from 'active' then raise exception '로그인을 다시 확인해주세요.';end if;
 sid=actor->>'id';if sid is null or sid<>p_id or actor->>'role' is distinct from p_role then raise exception '계정이 일치하지 않습니다.';end if;
 if p_role='teacher' then
  if p_action='reminders' then
   update grammar_ox_settings set reminders_enabled=coalesce((p_payload->>'enabled')::boolean,false);return jsonb_build_object('enabled',(select reminders_enabled from grammar_ox_settings));
  elsif p_action='stats' then
   select coalesce(jsonb_agg(jsonb_build_object('student_id',u.id,'history',grammar_ox_daily_history(u.id::text)) order by u.name),'[]') into result from users u where role='student' and status='active';return jsonb_build_object('students',result,'day',today,'reminders_enabled',(select reminders_enabled from grammar_ox_settings),'topic_totals',(select jsonb_object_agg(topic,n) from (select topic,count(*) n from grammar_ox_bank group by topic) counts));
  elsif p_action='items' then
   select array_agg(value) into ids from jsonb_array_elements_text(p_payload->'ids');if coalesce(cardinality(ids),0)>30 then raise exception '최대 30문항까지 조회할 수 있습니다.';end if;
   select coalesce(jsonb_agg(b.data||jsonb_build_object('id',b.id,'level',b.level,'protected',b.source_kind='protected','tags',b.tags)),'[]') into result from grammar_ox_bank b where b.id=any(ids);return result;
  else raise exception '지원하지 않는 교사 작업입니다.';end if;
 end if;
 if p_role<>'student' then raise exception '학생 계정이 필요합니다.';end if;
 if p_payload ? 'student_id' and p_payload->>'student_id'<>sid then raise exception '다른 학생 기록은 조회할 수 없습니다.';end if;
 if p_action='status' then
  return jsonb_build_object('day',today,'history',grammar_ox_daily_history(sid),'topic_totals',(select jsonb_object_agg(topic,n) from (select topic,count(*) n from grammar_ox_bank group by topic) counts));
 elsif p_action='items' then
  select array_agg(distinct value) into ids from jsonb_array_elements_text(p_payload->'ids');
  if coalesce(cardinality(ids),0)>30 then raise exception '최대 30문항까지 조회할 수 있습니다.';end if;
  if exists(select 1 from unnest(ids) id where not exists(select 1 from grammar_ox_daily_answers a where a.student_id=sid and a.question_id=id)) then raise exception '본인이 푼 문항만 조회할 수 있습니다.';end if;
  select coalesce(jsonb_agg(b.data||jsonb_build_object('id',b.id,'level',b.level,'protected',b.source_kind='protected','tags',b.tags)),'[]') into result from grammar_ox_bank b where b.id=any(ids);return result;
 elsif p_action not in('daily','answer') then raise exception '지원하지 않는 작업입니다.';end if;
 -- A per-student transaction lock fixes the same day's set across devices/retries.
 perform pg_advisory_xact_lock(hashtextextended('grammar-daily:'||sid,0));
 select * into daily from grammar_ox_daily where student_id=sid and day=today for update;
 if p_action='answer' then
  if daily.student_id is null then raise exception '오늘 OX를 먼저 시작해주세요.';end if;
  if p_payload->>'day' is distinct from today::text then raise exception '날짜가 바뀌었습니다. 오늘 OX를 다시 열어주세요.';end if;
  qid=p_payload->>'question_id';if qid is null or not(qid=any(daily.items)) then raise exception '오늘 세트에 없는 문항입니다.';end if;
  choice_value=(p_payload->>'choice')::int;if choice_value is null or choice_value not in(0,1) then raise exception 'O 또는 X를 선택해주세요.';end if;
  select * into candidate from grammar_ox_bank where id=qid;target=daily.targets->>qid;due=grammar_ox_due(sid);
  success=choice_value=(candidate.data->>'answer')::int and exists(select 1 from jsonb_array_elements(due) d where d->>'id'=coalesce(target,qid));
  insert into grammar_ox_daily_answers(student_id,day,question_id,choice,is_correct,target_question_id,is_review_success) values(sid,today,qid,choice_value,choice_value=(candidate.data->>'answer')::int,target,success) on conflict do nothing returning * into answer_row;
  if not found then select * into answer_row from grammar_ox_daily_answers where student_id=sid and day=today and question_id=qid;end if;
  insert into grammar_ox_attempts(id,student_id,set_id,question_id,topic,choice,is_correct,submitted_at,target_question_id,is_review_success)
  values('daily:'||sid||':'||today||':'||qid,sid,'daily:'||sid||':'||today,qid,candidate.topic,answer_row.choice,answer_row.is_correct,answer_row.submitted_at,answer_row.target_question_id,answer_row.is_review_success)
  on conflict(set_id,question_id) do update set student_id=excluded.student_id,topic=excluded.topic,choice=excluded.choice,is_correct=excluded.is_correct,submitted_at=excluded.submitted_at,target_question_id=excluded.target_question_id,is_review_success=excluded.is_review_success;
  if (select count(*) from grammar_ox_daily_answers where student_id=sid and day=today)=10 then update grammar_ox_daily set completed_at=coalesce(completed_at,now()) where student_id=sid and day=today;end if;
  select to_jsonb(a) into attempt from grammar_ox_attempts a where set_id='daily:'||sid||':'||today and question_id=qid;
  return jsonb_build_object('attempt',attempt,'history',grammar_ox_daily_history(sid));
 end if;
 if daily.student_id is null then
  history_rows=grammar_ox_daily_history(sid);lvl=grammar_ox_next_level(history_rows);due=grammar_ox_due(sid);
  for item in select value from jsonb_array_elements(due) limit 4 loop
   select * into original from grammar_ox_bank where id=item->>'id';if not found then continue;end if;
   select b.* into candidate from grammar_ox_bank b where not(b.id=any(chosen)) and b.id<>original.id and (
    coalesce(b.data->'variantOf','[]') ? original.id or (nullif(original.data->>'objectiveId','') is not null and b.data->>'objectiveId'=original.data->>'objectiveId') or (b.topic=original.topic and case when b.topic='expression' then b.tags&&original.tags else b.data->>'concept'=original.data->>'concept' end))
   order by case when coalesce(b.data->'variantOf','[]') ? original.id then 0 when nullif(original.data->>'objectiveId','') is not null and b.data->>'objectiveId'=original.data->>'objectiveId' then 1 else 2 end,
    exists(select 1 from grammar_ox_attempts a where a.student_id=sid and a.question_id=b.id),random() limit 1;
   if not found then candidate=original;end if;if candidate.id=any(chosen) then continue;end if;
   chosen=array_append(chosen,candidate.id);targets=targets||jsonb_build_object(candidate.id,original.id);roles=roles||jsonb_build_object(candidate.id,'review');if candidate.data->>'answer'='0' then zeros=zeros+1;end if;
  end loop;
  -- Reserve the tenth slot for a next-level challenge. Fill missing review slots with new items.
  for slot in cardinality(chosen)+1..10 loop
   wanted=case when slot=10 then least(4,lvl+1) else lvl end;purpose=case when slot=10 then 'challenge' else 'new' end;desired=case when zeros<5 then 0 else 1 end;
   select b.* into candidate from grammar_ox_bank b where not(b.id=any(chosen)) order by abs(b.level-wanted),
    exists(select 1 from grammar_ox_attempts a where a.student_id=sid and a.question_id=b.id),
    case when (b.data->>'answer')::int=desired then 0 else 1 end,random() limit 1;
   if not found then raise exception '문제은행에 10문항 이상이 필요합니다.';end if;
   chosen=array_append(chosen,candidate.id);roles=roles||jsonb_build_object(candidate.id,purpose);if candidate.data->>'answer'='0' then zeros=zeros+1;end if;
  end loop;
  insert into grammar_ox_daily(student_id,day,items,level,roles,targets) values(sid,today,chosen,lvl,roles,targets) returning * into daily;
 end if;
 select coalesce(jsonb_agg(b.data||jsonb_build_object('id',b.id,'level',b.level,'protected',b.source_kind='protected','tags',b.tags) order by x.n),'[]') into result from unnest(daily.items) with ordinality x(id,n) join grammar_ox_bank b on b.id=x.id;
 return jsonb_build_object('set',to_jsonb(daily),'items',result,'history',grammar_ox_daily_history(sid),'answers',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('id','daily:'||sid||':'||today||':'||a.question_id,'set_id','daily:'||sid||':'||today,'topic',b.topic) order by array_position(daily.items,a.question_id)) from grammar_ox_daily_answers a join grammar_ox_bank b on b.id=a.question_id where a.student_id=sid and a.day=today),'[]'::jsonb));
end $$;
revoke all on function public.grammar_ox_rpc(text,text,text,text,jsonb) from public;
grant execute on function public.grammar_ox_rpc(text,text,text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
