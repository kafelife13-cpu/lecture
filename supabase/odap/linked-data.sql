-- Read existing Kkakka content directly; no duplicate student or response tables.
create or replace function public.odap_external_revision() returns text language plpgsql security definer set search_path=public as $$
declare table_name text; part text; revision text:='';
begin
 foreach table_name in array array['qa_materials','qa_questions','weekly_homework','weekly_homework_work','ox_questions','ox_attempts','vocab_units','vocab_responses','special_tests','special_test_results'] loop
  if to_regclass('public.'||table_name) is not null then
   execute format('select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',table_name) into part;
   revision:=revision||table_name||coalesce(part,'');
  end if;
 end loop;
 return md5(revision);
end $$;
revoke all on function public.odap_external_revision() from public,anon,authenticated;
create or replace function public.odap_linked_data(p_id text,p_password text,p_table text,p_student_id text default '',p_offset integer default 0) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor jsonb; total bigint; records jsonb; student_name text; filter text:='true';
begin
 actor:=public.authenticate_user(p_id,p_password,'teacher');
 if actor is null or actor->>'status' is distinct from 'active' or actor->>'role' is distinct from 'teacher' then raise exception '김까까 교사 계정으로 로그인하세요.';end if;
 if p_table not in ('exams','exam_responses','qa_materials','qa_questions','weekly_homework','weekly_homework_work','ox_questions','ox_attempts','vocab_units','vocab_responses','special_tests','special_test_results') then raise exception '연결할 자료 종류를 확인하세요.';end if;
 if p_student_id<>'' and p_table in ('exam_responses','qa_questions','weekly_homework_work','ox_attempts','vocab_responses','special_test_results') then
  select name into student_name from public.users where id::text=p_student_id and role='student';
  if not found then raise exception '기존 학생 ID를 확인하세요.';end if;
  filter:=format('(to_jsonb(t)->>''student_id''=%L)',p_student_id);
  if p_table='vocab_responses' and (select count(*) from public.users where name=student_name and role='student')=1 then filter:=format('(to_jsonb(t)->>''student_name''=%L)',student_name);end if;
 end if;
 execute format('select count(*) from public.%I t where %s',p_table,filter) into total;
 execute format('select coalesce(jsonb_agg(x),''[]'') from (select to_jsonb(t) x from public.%I t where %s order by coalesce(to_jsonb(t)->>''submitted_at'',to_jsonb(t)->>''updated_at'',to_jsonb(t)->>''created_at'','''') desc,to_jsonb(t)::text limit 50 offset %s) q',p_table,filter,greatest(0,p_offset)) into records;
 return jsonb_build_object('total',total,'items',records,'checked_at',now());
end $$;
revoke all on function public.odap_linked_data(text,text,text,text,integer) from public;
grant execute on function public.odap_linked_data(text,text,text,text,integer) to anon,authenticated;
