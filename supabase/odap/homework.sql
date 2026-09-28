-- Teacher-only staged homework. Reuses clinic originals; never changes student answers.
create table if not exists public.odap_homeworks(
 id uuid primary key default gen_random_uuid(),student_id text not null,request_id uuid not null unique,
 created_at timestamptz not null default now(),body jsonb not null
);
alter table public.odap_homeworks enable row level security;
revoke all on public.odap_homeworks from public,anon,authenticated;
create or replace function public.odap_homework(p_id text,p_password text,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public set statement_timeout='60s' as $$
declare actor jsonb; sid text:=p_payload->>'student_id'; saved public.odap_homeworks%rowtype;
 base jsonb; b jsonb; current_wrongs jsonb:='[]'; needs jsonb:='[]'; stages jsonb:='[]'; items jsonb; evidence jsonb; ox jsonb:='[]';
 stage text; candidate public.odap_questions%rowtype; origin jsonb; item jsonb; ev jsonb; used text[]:='{}'; source_ids text[]:='{}'; packet_ids jsonb:='[]'; packet jsonb; wanted integer:=5; report jsonb; req uuid;
begin
 actor:=public.authenticate_user(p_id,p_password,'teacher');
 if actor is null or actor->>'role' is distinct from 'teacher' or actor->>'status' is distinct from 'active' then raise exception '교사 계정으로 로그인하세요.';end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (select jsonb_build_object('id',h.id,'student_id',h.student_id,'created_at',h.created_at,'name',h.body->>'student_name','current_wrong',h.body->>'current_wrong_count','stages',h.body->'stages','ox_count',jsonb_array_length(h.body->'ox'),'missing',h.body->'missing') x from (select distinct on(student_id) * from public.odap_homeworks order by student_id,created_at desc)h)t),'[]');
 elsif p_action in ('get','ox_context','save_ox') then
  select * into saved from public.odap_homeworks h where h.id=(p_payload->>'id')::uuid and h.student_id=sid for update;
  if not found then raise exception '선택 학생의 맞춤 과제가 아닙니다.';end if;
  if p_action='get' then
   select c.body into b from public.odap_clinics c where c.id=(saved.body->>'clinic_id')::uuid and c.student_id=sid;
   return to_jsonb(saved)||jsonb_build_object('clinic',b);
  elsif p_action='ox_context' then
   -- Reuse generic drafts only when the exact evidence still matches this student's needs.
   if jsonb_array_length(saved.body->'ox')=0 then
    select coalesce(jsonb_agg(v),'[]') into ox from(select distinct on(q->>'text') q v from public.odap_homeworks h cross join lateral jsonb_array_elements(h.body->'ox')q where h.id<>saved.id and exists(select 1 from jsonb_array_elements(saved.body->'evidence')e where e->>'id'=q->'evidence'->>'id' and e->>'quote'=q->'evidence'->>'quote' and e->>'statement'=q->'evidence'->>'statement') order by q->>'text' limit 10)t;
    if ox<>'[]' then update public.odap_homeworks set body=jsonb_set(body,'{ox}',ox) where id=saved.id returning * into saved;end if;
   end if;
   return jsonb_build_object('evidence',saved.body->'evidence','needs',saved.body->'needs','existing',jsonb_array_length(saved.body->'ox'));
  end if;
  if jsonb_array_length(saved.body->'ox')>0 then return to_jsonb(saved);end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 10 then raise exception 'OX는 1~10문항이어야 합니다.';end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
   select x into ev from jsonb_array_elements(saved.body->'evidence') x where x->>'id'=item->>'evidence_id';
   if ev is null or coalesce(item->>'answer','') not in ('O','X') or length(coalesce(item->>'text','')) not between 5 and 1500 or length(coalesce(item->>'explanation','')) not between 5 and 2500 then raise exception 'OX의 근거·정답·해설을 확인하세요.';end if;
   if not exists(select 1 from public.odap_evidence e where e.id=(ev->>'id')::uuid and e.approved and e.quote=ev->>'quote' and e.statement=ev->>'statement') then raise exception '근거가 변경되었습니다. 새 과제를 생성하세요.';end if;
   if exists(select 1 from jsonb_array_elements(ox)x where x->>'text'=item->>'text') then raise exception 'OX 문항이 중복됩니다.';end if;
   ox:=ox||jsonb_build_array(jsonb_build_object('text',item->>'text','answer',item->>'answer','explanation',item->>'explanation','choices','[]'::jsonb,'concepts',jsonb_build_array(ev->>'concept'),'evidence',ev,'status','pending','engine','검수 근거 기반 AI 초안'));
  end loop;
  update public.odap_homeworks set body=jsonb_set(body,'{ox}',ox) where id=saved.id returning * into saved;
  return to_jsonb(saved);
 elsif p_action<>'generate' then raise exception '지원하지 않는 맞춤 과제 작업';end if;
 req:=(p_payload->>'request_id')::uuid;if req is null then raise exception '제작 요청 번호가 필요합니다.';end if;
 perform pg_advisory_xact_lock(hashtext('odap-homework:'||sid));
 select * into saved from public.odap_homeworks where request_id=req;
 if found then if saved.student_id<>sid then raise exception '제작 요청 학생이 다릅니다.';end if;return to_jsonb(saved);end if;
 base:=public.odap_clinic(p_id,p_password,'generate',jsonb_build_object('student_id',sid,'request_id',req,'mode','staged'));
 b:=base->'body';
 -- Only currently wrong questions drive remediation; the clinic retains cumulative history.
 with latest as (select distinct on(r.exam_id) r.* from public.exam_responses r where r.student_id=sid order by r.exam_id,r.submitted_at desc nulls last,r.id desc)
 select coalesce(jsonb_agg(w),'[]') into current_wrongs from jsonb_array_elements(b->'wrongs')w join latest r on r.exam_id::text=w->>'exam_id'
 where public.odap_grade(case when jsonb_typeof(r.answers)='array' then r.answers->>((w->>'question_index')::integer) else r.answers->>(w->>'question_index') end,w->>'answer')=false;
 select coalesce(jsonb_agg(jsonb_build_object('concept',concept,'wrong',n) order by n desc,concept),'[]') into needs from
 (select c#>>'{}' concept,count(*) n from jsonb_array_elements(current_wrongs)w cross join lateral jsonb_array_elements(w->'concepts')c group by c)t;
 select coalesce(array_agg(qid) filter(where qid is not null),'{}') into source_ids from(select m.question_id::text qid from public.odap_mappings m join jsonb_array_elements(b->'wrongs')w on m.exam_id=w->>'exam_id' and m.question_index=(w->>'question_index')::integer)t;
 for stage in select unnest(array['개념','확장','고난도']) loop
  items:='[]';
  for candidate in
   select q.* from public.odap_questions q where q.status='approved' and not(q.id::text=any(source_ids)) and not(q.fingerprint=any(used))
    and coalesce(q.body->>'school','') in ('',b->'student'->>'school')
    and case stage when '개념' then q.body->>'difficulty' in ('하','중하','기초','easy','basic') when '확장' then q.body->>'difficulty' in ('중','중상','보통','medium','intermediate') else q.body->>'difficulty' in ('상','최상','고난도','hard','very_hard') end
    and exists(select 1 from jsonb_array_elements(current_wrongs)w where exists(select 1 from jsonb_array_elements_text(w->'concepts')c where (q.body->'concepts') ? c) or exists(select 1 from jsonb_array_elements_text(w->'question_types')t where (q.body->'question_types') ? t))
    and not exists(select 1 from jsonb_array_elements(b->'wrongs')w where regexp_replace(coalesce(w->>'text',''),'\s','','g')=regexp_replace(coalesce(q.body->>'text',''),'\s','','g'))
   order by (select coalesce(sum((n->>'wrong')::integer),0) from jsonb_array_elements(needs)n where (q.body->'concepts') ? (n->>'concept')) desc,q.id
  loop
   exit when jsonb_array_length(items)>=wanted;
   if candidate.fingerprint=any(used) then continue;end if;
   select w into origin from jsonb_array_elements(current_wrongs)w where exists(select 1 from jsonb_array_elements_text(w->'concepts')c where (candidate.body->'concepts') ? c) or exists(select 1 from jsonb_array_elements_text(w->'question_types')t where (candidate.body->'question_types') ? t)
   order by (select count(*) from jsonb_array_elements_text(w->'concepts')c where (candidate.body->'concepts') ? c) desc limit 1;
   item:=public.odap_question_json(candidate)||jsonb_build_object('stage',stage,'origin_exam',origin->>'source_title','origin_num',origin->>'num','match_reason',case when exists(select 1 from jsonb_array_elements_text(origin->'concepts')c where (candidate.body->'concepts') ? c) then '현재 오답과 세부 개념 일치' else '현재 오답과 문제 유형 일치 · 소재는 다를 수 있음' end);
   items:=items||jsonb_build_array(item);used:=array_append(used,candidate.fingerprint);
  end loop;
  stages:=stages||jsonb_build_array(jsonb_build_object('name',stage,'target',case when current_wrongs='[]' then 0 else wanted end,'items',items,'missing',case when current_wrongs='[]' then 0 else wanted-jsonb_array_length(items) end));
  if items<>'[]' then
   packet:=public.odap_rpc(p_id,p_password,'teacher','POST /api/packet',jsonb_build_object('student_id',sid,'title',(b->'student'->>'name')||' · '||stage||' 맞춤 과제','summary','현재 오답과 개념 또는 유형이 일치하는 검수 문항. 교사 확인 후 배부.', 'items',(select jsonb_agg(jsonb_build_object('type','bank','id',x->>'id')) from jsonb_array_elements(items)x)));
   packet_ids:=packet_ids||jsonb_build_array(packet->>'id');
  end if;
 end loop;
 select coalesce(jsonb_agg(x),'[]') into evidence from (
  select jsonb_build_object('id',e.id,'source_title',s.title,'page',e.page,'quote',e.quote,'statement',e.statement,'concept',e.concept) x from public.odap_evidence e join public.odap_sources s on s.id=e.source_id
  where e.approved and e.statement<>'' and e.quote<>'' and coalesce(s.school,'') in ('',b->'student'->>'school') and exists(select 1 from jsonb_array_elements(needs)n where n->>'concept'=e.concept)
  order by (select (n->>'wrong')::integer from jsonb_array_elements(needs)n where n->>'concept'=e.concept) desc,e.id limit 10
 )t;
 report:=jsonb_build_object('student_name',b->'student'->>'name','clinic_id',base->>'id','current_wrong_count',jsonb_array_length(current_wrongs),'current_wrongs',current_wrongs,'needs',needs,'stages',stages,'evidence',evidence,'ox',ox,'packet_ids',packet_ids,'missing',jsonb_build_object('unclassified',(select count(*) from jsonb_array_elements(current_wrongs)w where w->'concepts'='[]'),'ox_evidence',jsonb_array_length(evidence)=0),'notice','오답 번호만으로 결손 개념이나 오답 원인을 확정하지 않습니다. OX는 인용 근거를 대조할 교사 검수 초안입니다. 부족한 난도·유형을 임의로 채우지 않습니다.');
 insert into public.odap_homeworks(student_id,request_id,body) values(sid,req,report) returning * into saved;
 return to_jsonb(saved);
end $$;
revoke all on function public.odap_homework(text,text,text,jsonb) from public;
grant execute on function public.odap_homework(text,text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
