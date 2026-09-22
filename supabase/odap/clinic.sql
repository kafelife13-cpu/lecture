-- Teacher-only, transactional five-part clinic generation. No student publication.
-- Restrict each retrieval to classified high-difficulty rows before inspecting large source bodies.
create index if not exists odap_questions_review_difficulty_idx on public.odap_questions(status,(body->>'difficulty'));
create table if not exists public.odap_clinics(
 id uuid primary key default gen_random_uuid(),student_id text not null,request_id uuid not null unique,
 created_at timestamptz not null default now(),body jsonb not null
);
alter table public.odap_clinics enable row level security;
revoke all on public.odap_clinics from public,anon,authenticated;
create table if not exists public.odap_exam_tags(exam_id text not null,question_index integer not null check(question_index>=0),concepts jsonb not null default '[]',question_types jsonb not null default '[]',updated_at timestamptz not null default now(),primary key(exam_id,question_index));
alter table public.odap_exam_tags enable row level security;
revoke all on public.odap_exam_tags from public,anon,authenticated;
create or replace function public.odap_clinic(p_id text,p_password text,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public set statement_timeout='30s' as $$
declare actor jsonb; student jsonb; result jsonb; saved public.odap_clinics%rowtype; sid text:=p_payload->>'student_id';
 exam_filter text:=coalesce(p_payload->>'exam_id',''); request_key uuid; w record; candidate public.odap_questions%rowtype; mapped public.odap_questions%rowtype;
 wrongs jsonb:='[]'; diagnoses jsonb:='[]'; by_type jsonb:='[]'; by_concept jsonb:='[]'; native_items jsonb:='[]';
 typed jsonb; conceptual jsonb; cs jsonb; question_types jsonb; original_question jsonb; completeness jsonb; pending_type jsonb; pending_concept jsonb; pending_items jsonb; reason text; source_type text; used text[]:='{}'; original_ids uuid[]:='{}';
 type_missing integer:=0; concept_missing integer:=0; unclassified integer:=0; blank_count integer:=0; graded integer:=0;
 grading_key text; key_conflict boolean; key_conflicts jsonb:='[]';
 run_data jsonb; generated jsonb:='[]'; report jsonb; packet_id uuid; type_packet uuid; concept_packet uuid; stage text; stage_items jsonb; new_packet uuid; chunk_offset integer; slice_items jsonb; packet_ids jsonb:='[]'; type_packets jsonb:='[]'; concept_packets jsonb:='[]'; prior_index integer;
begin
 actor:=public.authenticate_user(p_id,p_password,'teacher');
 if actor is null or actor->>'role' is distinct from 'teacher' or actor->>'status' is distinct from 'active' then raise exception '김까까 교사 계정으로 로그인하세요.';end if;
 if p_action='tag' then
  if not exists(select 1 from public.exams e where e.id::text=p_payload->>'exam_id' and (p_payload->>'question_index')::integer between 0 and jsonb_array_length(e.questions)-1) then raise exception '등록된 시험 문항을 선택하세요.';end if;
  if jsonb_typeof(p_payload->'concepts') is distinct from 'array' or jsonb_typeof(p_payload->'question_types') is distinct from 'array' then raise exception '개념·유형 배열이 필요합니다.';end if;
  if jsonb_array_length(p_payload->'concepts')>20 or jsonb_array_length(p_payload->'question_types')>10 or exists(select 1 from jsonb_array_elements((p_payload->'concepts')||(p_payload->'question_types'))x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 100) then raise exception '분류 이름·개수를 확인하세요.';end if;
  insert into public.odap_exam_tags(exam_id,question_index,concepts,question_types) values(p_payload->>'exam_id',(p_payload->>'question_index')::integer,p_payload->'concepts',p_payload->'question_types') on conflict(exam_id,question_index) do update set concepts=excluded.concepts,question_types=excluded.question_types,updated_at=now();
  return '{"saved":true}';
 elsif p_action='jobs' then
  return coalesce((select jsonb_agg(jsonb_build_object('packet_id',j.packet_id,'status',j.status,'error',j.error)) from public.odap_jobs j join public.odap_packets p on p.id=j.packet_id where p.student_id=sid),'[]');
 elsif p_action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'created_at',c.created_at,'title',c.body->>'title','wrong_count',jsonb_array_length(c.body->'wrongs')) order by c.created_at desc) from (select * from public.odap_clinics where student_id=sid order by created_at desc limit 20)c),'[]');
 elsif p_action='get' then
  select * into saved from public.odap_clinics where id=(p_payload->>'id')::uuid and student_id=sid;
  if not found then raise exception '선택 학생의 제작 기록이 아닙니다.';end if;
  return to_jsonb(saved);
 elsif p_action<>'generate' then raise exception '지원하지 않는 제작 작업';end if;
 select jsonb_build_object('id',u.id,'name',u.name,'school',s.name) into student from public.users u left join public.qa_schools s on s.id=u.school_id where u.id::text=sid and u.role='student' and u.status='active';
 if student is null then raise exception '재원 학생을 선택하세요.';end if;
 request_key:=(p_payload->>'request_id')::uuid;
 if request_key is null then raise exception '제작 요청 번호가 없습니다.';end if;
 perform pg_advisory_xact_lock(hashtext('odap-clinic:'||sid));
 select * into saved from public.odap_clinics where request_id=request_key;
 if found then
  if saved.student_id<>sid then raise exception '제작 요청 학생이 다릅니다.';end if;
  return to_jsonb(saved);
 end if;
 select coalesce(array_agg(distinct m.question_id) filter(where m.question_id is not null),'{}') into original_ids from public.odap_mappings m join public.exam_responses r on r.exam_id::text=m.exam_id where r.student_id=sid;
 for w in
  with records as (
   select to_jsonb(r) raw,false archived from public.exam_responses r where r.student_id=sid
   union all select a.body,true from public.odap_attempts a where a.student_id=sid
  ), attempts as (select distinct on (raw->>'exam_id',raw->>'submitted_at',raw->'answers') raw,archived from records where exam_filter='' or raw->>'exam_id'=exam_filter order by raw->>'exam_id',raw->>'submitted_at',raw->'answers',archived)
  select e.id::text exam_id,e.name exam_title,r.raw->>'id' response_id,r.raw->>'submitted_at' submitted_at,q.value question,(q.n-1)::integer qi,r.archived,
   case when jsonb_typeof(r.raw->'answers')='array' then r.raw->'answers'->>((q.n-1)::integer) else r.raw->'answers'->>((q.n-1)::text) end student_answer,
   left(case when jsonb_typeof(r.raw->'thoughts'->'_mock_wrong_notes'->((q.n-1)::text)->'reason')='string' then r.raw->'thoughts'->'_mock_wrong_notes'->((q.n-1)::text)->>'reason' when jsonb_typeof(r.raw->'thoughts')='array' and jsonb_typeof(r.raw->'thoughts'->((q.n-1)::integer))='string' then r.raw->'thoughts'->>((q.n-1)::integer) when jsonb_typeof(r.raw->'thoughts'->((q.n-1)::text))='string' then r.raw->'thoughts'->>((q.n-1)::text) else '' end,500) student_reason,
   to_jsonb(m) mapping,to_jsonb(notes) note,to_jsonb(tags) tags
  from attempts r join public.exams e on e.id::text=r.raw->>'exam_id' cross join lateral jsonb_array_elements(e.questions) with ordinality q(value,n)
  left join public.odap_exam_tags tags on tags.exam_id=e.id::text and tags.question_index=q.n-1
  left join public.odap_mappings m on m.exam_id=e.id::text and m.question_index=q.n-1
  left join public.odap_notes notes on notes.response_id=r.raw->>'id' and notes.question_index=q.n-1 and notes.student_id=sid
  order by r.raw->>'submitted_at' desc nulls last,e.id,q.n
 loop
  original_question:=w.question;grading_key:=w.question->>'answer';key_conflict:=false;
  if coalesce((w.mapping->>'verified')::boolean,false) and nullif(w.mapping->>'question_id','') is not null then
   select * into mapped from public.odap_questions where id=(w.mapping->>'question_id')::uuid and status='approved';
   if found and coalesce(mapped.body->>'answer','') ~ '^([1-5]|all:[1-5](,[1-5])+|[OX])$' then
    key_conflict:=(mapped.body->>'answer') is distinct from grading_key;
    original_question:=public.odap_question_json(mapped)||jsonb_build_object('registered_record',w.question,'original_source_verified',true,'answer_key_conflict',key_conflict,'registered_answer',w.question->>'answer','source_answer',mapped.body->>'answer','source_explanation',mapped.body->>'explanation','answer',grading_key,'explanation',case when key_conflict then w.question->>'explanation' else mapped.body->>'explanation' end);
   end if;
  end if;
  if key_conflict and not exists(select 1 from jsonb_array_elements(key_conflicts)x where x->>'exam_id'=w.exam_id and (x->>'question_index')::integer=w.qi) then
   key_conflicts:=key_conflicts||jsonb_build_array(jsonb_build_object('exam_id',w.exam_id,'question_index',w.qi,'exam',w.exam_title,'num',coalesce(w.question->>'num',(w.qi+1)::text),'registered_answer',w.question->>'answer','verified_answer',mapped.body->>'answer'));
  end if;
  if public.odap_grade(w.student_answer,grading_key) is null then blank_count:=blank_count+1;continue;end if;
  graded:=graded+1;
  if public.odap_grade(w.student_answer,grading_key) then continue;end if;
  select (x.n-1)::integer into prior_index from jsonb_array_elements(wrongs) with ordinality x(v,n) where x.v->>'exam_id'=w.exam_id and (x.v->>'question_index')::integer=w.qi;
  if prior_index is not null then
   wrongs:=jsonb_set(wrongs,array[prior_index::text,'attempts'],(wrongs->prior_index->'attempts')||jsonb_build_array(jsonb_build_object('date',w.submitted_at,'answer',w.student_answer,'archived',w.archived)));continue;
  end if;
  if jsonb_array_length(wrongs)>=500 then raise exception '오답 500개를 초과했습니다. 시험별로 나누어 제작하세요.';end if;
  cs:=case when w.tags is not null then w.tags->'concepts' when jsonb_array_length(coalesce(w.mapping->'concepts','[]'))>0 then w.mapping->'concepts' when jsonb_typeof(w.question->'concepts')='array' then w.question->'concepts' else '[]' end;
  select coalesce(jsonb_agg(v),'[]') into cs from jsonb_array_elements(cs) v where jsonb_typeof(v)='string' and v#>>'{}' not in ('','미분류','기타','개념 적용','문법','문학','독서');
  source_type:=coalesce(nullif(w.note->>'error_type',''),'');
  question_types:=coalesce(w.tags->'question_types',w.question->'question_types',case when coalesce(w.question->>'type','') not in ('','기타','개념 적용') then jsonb_build_array(w.question->>'type') else '[]' end);
  if question_types='[]' and nullif(w.mapping->>'question_id','') is not null then
   select coalesce(body->'question_types','[]') into question_types from public.odap_questions where id=(w.mapping->>'question_id')::uuid;
  end if;
  question_types:=coalesce(question_types,'[]');
  if cs='[]' then unclassified:=unclassified+1;end if;
  reason:=case when source_type<>'' then '교사 기록: '||source_type||'. '||coalesce(w.note->>'note','') when coalesce(trim(w.student_reason),'')<>'' then '학생이 적은 이유: '||w.student_reason||' / 학생 진술이며 오답 원인 분류는 교사 확인이 필요합니다.' else '답 번호만으로 오답 원인을 확정하지 않았습니다. 선택한 선지의 어느 부분을 맞다고 판단했는지 확인하세요.' end;
  completeness:=case when coalesce((original_question->>'original_source_verified')::boolean,false) then '[]'::jsonb
   when jsonb_array_length(coalesce(original_question->'choices','[]'))=0 and not(coalesce(original_question->>'text','') like '%①%' and coalesce(original_question->>'text','') like '%⑤%')
   then '["등록된 문항에 선택지/보기 원문이 없습니다. 원본 시험지와 연결해야 합니다."]'::jsonb else '["원본 지면의 표·밑줄·옛한글 대조가 필요합니다."]'::jsonb end;
  wrongs:=wrongs||jsonb_build_array(original_question||jsonb_build_object('id',gen_random_uuid(),'selection_type','existing_record','reviewed',false,'source_issues',completeness,'question_types',question_types,'exam_id',w.exam_id,'question_index',w.qi,'response_id',w.response_id,'attempts',jsonb_build_array(jsonb_build_object('date',w.submitted_at,'answer',w.student_answer,'archived',w.archived)),'student_answer',w.student_answer,'source_title',w.exam_title||' · '||coalesce(w.question->>'num',(w.qi+1)::text)||'번','concepts',cs));
  diagnoses:=diagnoses||jsonb_build_array(jsonb_build_object('exam',w.exam_title,'num',coalesce(w.question->>'num',(w.qi+1)::text),'student_answer',w.student_answer,'correct',grading_key,'registered_answer',w.question->>'answer','answer_key_conflict',key_conflict,'source_answer',original_question->>'source_answer','question_types',question_types,'concepts',cs,'review_focus',coalesce(original_question->>'review_focus',''),'print_references',coalesce((select jsonb_agg(v) from (select jsonb_build_object('source_id',src.id,'source_title',src.title,'page',ev.page,'quote',ev.quote) v from public.odap_evidence ev join public.odap_sources src on src.id=ev.source_id where ev.approved and src.kind='학교 프린트' and src.school=student->>'school' and cs ? ev.concept order by src.title,ev.page limit 2) refs),'[]'),'student_reason',w.student_reason,'cause',reason,'basis',case when source_type<>'' then '교사 기록 있음' when coalesce(trim(w.student_reason),'')<>'' then '학생 진술 있음 · 교사 확인 필요' else '원인 확인 필요' end,'question','이 선지를 고른 근거와, 정답 선지와 다른 점을 설명해 주세요.','next_step',case when cs='[]' then '세부 개념을 먼저 분류하세요.' else '연결된 프린트 근거 확인 → 개념 설명 → 고난도 적용 → 재풀이' end));
  typed:='[]';conceptual:='[]';
  -- Alternate scarce candidates so one document cannot consume every shared match.
  for stage in select unnest(array['type','concept','type','concept','type','concept']) loop
   if (stage='type' and source_type='' and question_types='[]') or (stage='concept' and cs='[]') then continue;end if;
   for candidate in
    select q.* from public.odap_questions q
    where q.status='approved' and coalesce(q.body->>'difficulty','') in ('상','최상','고난도','hard','very_hard')
     and not(q.id=any(original_ids)) and not(q.fingerprint=any(used))
     and regexp_replace(coalesce(q.body->>'text',''),'\s','','g')<>regexp_replace(coalesce(w.question->>'text',''),'\s','','g')
     and (coalesce(q.body->>'school','')='' or q.body->>'school'=student->>'school')
     and (case when stage='type' then ((source_type<>'' and (q.body->'error_types') ? source_type) or exists(select 1 from jsonb_array_elements_text(question_types)t where (q.body->'question_types') ? t)) and (cs='[]' or exists(select 1 from jsonb_array_elements_text(cs)c where (q.body->'concepts') ? c)) else exists(select 1 from jsonb_array_elements_text(cs)c where (q.body->'concepts') ? c) end)
    order by (select count(*) from jsonb_array_elements_text(cs)c where (q.body->'concepts') ? c) desc,q.id
   loop
    if (stage='type' and jsonb_array_length(typed)>=3) or (stage='concept' and jsonb_array_length(conceptual)>=3) then exit;end if;
    if candidate.fingerprint=any(used) then continue;end if;
    used:=array_append(used,candidate.fingerprint);
    result:=public.odap_question_json(candidate)||jsonb_build_object('selection_type','bank','match_reason',case when stage='type' then concat_ws(' / ',nullif(source_type,''),nullif(question_types::text,'[]')) else cs::text end,'origin_exam',w.exam_title,'origin_num',coalesce(w.question->>'num',(w.qi+1)::text));
    if stage='type' then typed:=typed||jsonb_build_array(result);else conceptual:=conceptual||jsonb_build_array(result);end if;
    exit;
   end loop;
  end loop;
  pending_type:='[]';pending_concept:='[]';
  for stage in select unnest(array['type','concept']) loop
   select coalesce(jsonb_agg(v),'[]') into pending_items from (
    select public.odap_question_json(q)-'images'-'passage' v from public.odap_questions q
    where q.status='pending' and q.body->>'difficulty' in ('상','최상','고난도','hard','very_hard')
     and coalesce((q.body->'retrieval_review'->>'answer_valid')::boolean,false)
     and coalesce(q.body->'retrieval_review'->'extraction_issues','[]')='[]'
     and not(q.id=any(original_ids)) and not(q.fingerprint=any(used))
     and exists(select 1 from jsonb_array_elements_text(cs)c where (q.body->'concepts') ? c)
     and (stage='concept' or exists(select 1 from jsonb_array_elements_text(question_types)t where (q.body->'question_types') ? t))
    order by (select count(*) from jsonb_array_elements_text(cs)c where (q.body->'concepts') ? c) desc,q.id limit 6
   ) candidates;
   if stage='type' then pending_type:=pending_items;else pending_concept:=pending_items;end if;
  end loop;
  type_missing:=type_missing+3-jsonb_array_length(typed);concept_missing:=concept_missing+3-jsonb_array_length(conceptual);
  by_type:=by_type||jsonb_build_array(jsonb_build_object('exam',w.exam_title,'num',coalesce(w.question->>'num',(w.qi+1)::text),'items',typed,'review_candidates',pending_type,'missing',3-jsonb_array_length(typed),'reason',case when source_type='' and question_types='[]' then '원문 문항의 요구 사고 유형 또는 확인된 오답 원인 태그가 필요합니다.' else '세부 개념을 공유하며 문항 유형 또는 확인된 오답 원인이 일치하는 고난도 문항입니다.' end));
  by_concept:=by_concept||jsonb_build_array(jsonb_build_object('exam',w.exam_title,'num',coalesce(w.question->>'num',(w.qi+1)::text),'items',conceptual,'review_candidates',pending_concept,'missing',3-jsonb_array_length(conceptual),'reason',case when cs='[]' then '세부 개념 태그가 필요합니다.' else '동일 개념의 검수된 고난도 후보를 선정했습니다.' end));
 end loop;
 if wrongs='[]' then raise exception '선택한 범위에 판정 가능한 오답이 없습니다. 미응답·서술형은 오답으로 임의 처리하지 않습니다.';end if;
 -- Reuse the daily proposition ledger, preserving teacher approval and deduplication.
 if coalesce((p_payload->>'include_supplements')::boolean,false) and exists(select 1 from public.odap_evidence ev join public.odap_sources s on s.id=ev.source_id where ev.approved and s.kind='학교 프린트' and s.school=student->>'school' and exists(select 1 from jsonb_array_elements(wrongs) x where (x->'concepts') ? ev.concept)) then
  run_data:=public.odap_daily(sid);
  select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('source_title',s.title,'page',ev.page,'quote',ev.quote)),'[]') into generated from public.odap_generated g join public.odap_evidence ev on ev.id=g.evidence_id join public.odap_sources s on s.id=ev.source_id
   where g.student_id=sid and g.run_id=(run_data->>'id')::uuid and g.status<>'rejected' and ev.approved and s.kind='학교 프린트' and s.school=student->>'school' and exists(select 1 from jsonb_array_elements(wrongs)x where (x->'concepts') ? ev.concept);
 end if;
 -- The original-record document is always a private draft; publication APIs cannot approve these record IDs.
 chunk_offset:=0;
 while chunk_offset<jsonb_array_length(wrongs) loop
  select jsonb_agg(v order by n) into slice_items from jsonb_array_elements(wrongs) with ordinality x(v,n) where n>chunk_offset and n<=chunk_offset+100;
  report:=jsonb_build_object('title',(student->>'name')||' · 누적 오답 모음 '||(chunk_offset/100+1)||' (검수 전)','student_id',sid,'student_name',student->>'name','review_only',true,'mode','record_draft','analysis',diagnoses,'summary','김까까에 남은 전체 답안·보관된 재응시 이력의 오답을 현재 김까까 등록 정답 기준으로 모았습니다. 원본 정답이 다르면 교사 정정 기록을 보존하고 두 값을 함께 표시합니다. 기존 성적은 변경하지 않습니다. 같은 문항은 한 번 싣고 오답 이력을 함께 보관합니다. 과거에 덮어써서 남지 않은 답안은 복원한 것으로 표시하지 않습니다. 현재 등록 본문·원문 지면을 대조한 뒤 배부하세요.','items',slice_items,'created_at',now());
  insert into public.odap_packets(student_id,title,body) values(sid,report->>'title',report) returning id into new_packet;
  insert into public.odap_jobs(packet_id) values(new_packet);packet_ids:=packet_ids||jsonb_build_array(new_packet);
  if packet_id is null then packet_id:=new_packet;end if;
  chunk_offset:=chunk_offset+100;
 end loop;
 for stage in select unnest(array['type','concept']) loop
  select coalesce(jsonb_agg(item),'[]') into stage_items from jsonb_array_elements(case when stage='type' then by_type else by_concept end)grp cross join lateral jsonb_array_elements(grp->'items')item;
  if stage_items='[]' then continue;end if;
  chunk_offset:=0;
  while chunk_offset<jsonb_array_length(stage_items) loop
   select jsonb_agg(jsonb_build_object('type','bank','id',v->>'id') order by n) into slice_items from jsonb_array_elements(stage_items) with ordinality x(v,n) where n>chunk_offset and n<=chunk_offset+100;
   result:=public.odap_rpc(p_id,p_password,'teacher','POST /api/packet',jsonb_build_object('student_id',sid,'title',(student->>'name')||case when stage='type' then ' · 유형별 고난도 복습 ' else ' · 개념별 고난도 복습 ' end||(chunk_offset/100+1),'items',slice_items));
   new_packet:=(result->>'id')::uuid;
   update public.odap_packets p set body=p.body||jsonb_build_object(
    'summary','전체 오답 '||jsonb_array_length(wrongs)||'문항에 대해 기존 DB에서 검수된 고난도 '||jsonb_array_length(stage_items)||'문항을 찾았습니다. 목표 수량보다 '||case when stage='type' then type_missing else concept_missing end||'문항 부족합니다. 부족분을 새로 만들거나 중복 문항으로 채우지 않았습니다. 교사 배부 전 검수용입니다.',
    'items',(select jsonb_agg(x.v||jsonb_build_object('origin_exam',match->>'origin_exam','origin_num',match->>'origin_num','match_reason',match->>'match_reason') order by x.n) from jsonb_array_elements(p.body->'items') with ordinality x(v,n) join lateral (select z as match from jsonb_array_elements(stage_items) z where z->>'id'=x.v->>'id') linked on true)
   ) where p.id=new_packet;
   if not exists(select 1 from public.odap_packets p cross join lateral jsonb_array_elements(p.body->'items')x where p.id=new_packet and x->'source_ref' is null) then
    perform public.odap_rpc(p_id,p_password,'teacher','POST /api/render',jsonb_build_object('id',new_packet));
   end if;
   if stage='type' then type_packets:=type_packets||jsonb_build_array(new_packet);if type_packet is null then type_packet:=new_packet;end if;else concept_packets:=concept_packets||jsonb_build_array(new_packet);if concept_packet is null then concept_packet:=new_packet;end if;end if;
   chunk_offset:=chunk_offset+100;
  end loop;
 end loop;
 report:=jsonb_build_object('title',(student->>'name')||' · 누적 오답·고난도 복습','student',student,'scope',exam_filter,'answer_key_conflicts',key_conflicts,'graded',graded,'unknown',blank_count,'wrongs',wrongs,'diagnosis',diagnoses,'unclassified',unclassified,'generated',generated,'daily_run',run_data,'by_type',by_type,'by_concept',by_concept,'type_missing',type_missing,'concept_missing',concept_missing,'packet_id',packet_id,'packet_ids',packet_ids,'type_packets',type_packets,'concept_packets',concept_packets,'type_packet',type_packet,'concept_packet',concept_packet,'notice','교사 확인용 초안입니다. 정밀 원인 분석에는 학생 설명과 세부 개념·오답 유형 검수가 필요합니다.');
 insert into public.odap_clinics(student_id,request_id,body) values(sid,request_key,report) returning * into saved;
 return to_jsonb(saved);
end $$;
revoke all on function public.odap_clinic(text,text,text,jsonb) from public;
grant execute on function public.odap_clinic(text,text,text,jsonb) to anon,authenticated;
notify pgrst, 'reload schema';
