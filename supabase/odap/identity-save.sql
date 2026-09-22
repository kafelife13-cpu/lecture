-- Authenticated response saving for new Kkakka clients. Keeps legacy columns.
begin;
create or replace function public.odap_save_response(p_id text,p_password text,p_role text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor jsonb; sid text; v_student_name text; existing public.exam_responses%rowtype; payload jsonb; names text; fields text; assignments text; key text; result jsonb;
begin
 actor:=public.authenticate_user(p_id,p_password,p_role);
 if actor is null or actor->>'status' is distinct from 'active' or actor->>'role' is distinct from p_role or p_role not in ('teacher','student') then raise exception '본인 김까까 계정으로 다시 로그인하세요.';end if;
 if p_role='student' then sid:=p_id;
 else
  sid:=nullif(p_payload->>'student_id','');
  if sid is null and (select count(*) from public.users where role='student' and name=p_payload->>'student_name')=1 then select id::text into sid from public.users where role='student' and name=p_payload->>'student_name';end if;
 end if;
 select name into v_student_name from public.users where id::text=sid and role='student';if not found then raise exception '동명이인이 있거나 학생을 확인하지 못했습니다. 학생 ID를 지정해 주세요.';end if;
 if not exists(select 1 from public.exams where id::text=p_payload->>'exam_id') then raise exception '시험을 찾을 수 없습니다.';end if;
 perform pg_advisory_xact_lock(hashtext(sid||':'||(p_payload->>'exam_id')));
 select * into existing from public.exam_responses where exam_id::text=p_payload->>'exam_id' and student_id=sid order by submitted_at desc nulls last limit 1 for update;
 if exists(select 1 from public.exam_responses r where r.exam_id::text=p_payload->>'exam_id' and r.student_name=v_student_name and r.student_id is distinct from sid) then raise exception '동명이인의 기존 기록과 충돌합니다. 교사가 기존 제출 연결을 확인해야 합니다.';end if;
 if p_role='student' and existing.id is not null and coalesce(existing.regrade_approved,false) is not true then raise exception '이미 제출한 기록입니다. 선생님의 재응시 승인을 받은 뒤 제출하세요.';end if;
 payload:=jsonb_build_object('student_id',sid,'student_name',v_student_name,'exam_id',p_payload->>'exam_id','submitted_at',now(),'attempt_count',coalesce(existing.attempt_count,0)+1,'regrade_requested',false,'regrade_approved',false);
 foreach key in array array['answers','photo_urls','thoughts','score','correct_count','total_q','points_earned','points_total'] loop
  if p_payload ? key then payload:=payload||jsonb_build_object(key,p_payload->key);end if;
 end loop;
 if jsonb_typeof(payload->'answers') is distinct from 'object' then raise exception '문항별 답안 형식을 확인하세요.';end if;
 select string_agg(quote_ident(k),','),string_agg('v.'||quote_ident(k),','),string_agg(quote_ident(k)||'=v.'||quote_ident(k),',') into names,fields,assignments from jsonb_object_keys(payload) k;
 if existing.id is null then
  execute format('insert into public.exam_responses(%s) select %s from jsonb_populate_record(null::public.exam_responses,$1) v returning to_jsonb(exam_responses)',names,fields) into result using payload;
 else
  execute format('update public.exam_responses r set %s from jsonb_populate_record(null::public.exam_responses,$1) v where r.id::text=$2 returning to_jsonb(r)',assignments) into result using payload,existing.id::text;
 end if;
 return result;
end $$;
revoke all on function public.odap_save_response(text,text,text,jsonb) from public;
grant execute on function public.odap_save_response(text,text,text,jsonb) to anon,authenticated;
commit;
