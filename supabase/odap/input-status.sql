-- Read current records in one snapshot; do not rewrite or infer student ownership.
create or replace function public.odap_input_status(p_id text,p_password text) returns jsonb
language plpgsql security definer set search_path=public set statement_timeout='20s' as $$
declare actor jsonb; result jsonb;
begin
 actor:=public.authenticate_user(p_id,p_password,'teacher');
 if actor is null or actor->>'role' is distinct from 'teacher' or actor->>'status' is distinct from 'active' then raise exception '교사 로그인이 필요합니다.';end if;
 with latest as (
  select distinct on (r.student_id,r.exam_id) r.* from public.exam_responses r where r.student_id is not null
  order by r.student_id,r.exam_id,r.submitted_at desc nulls last,r.id desc
 ), answers as (
  select r.student_id,r.id,r.submitted_at,public.odap_grade(r.answers->>((q.n-1)::text),q.value->>'answer') correct,
   nullif(btrim(coalesce(nullif(to_jsonb(r)->'thoughts'->'_mock_wrong_notes'->((q.n-1)::text)->>'reason',''),
    case when jsonb_typeof(to_jsonb(r)->'thoughts'->((q.n-1)::text))='string' then to_jsonb(r)->'thoughts'->>((q.n-1)::text) else to_jsonb(r)->'thoughts'->((q.n-1)::text)->>'reason' end,'')),'') reason
  from latest r join public.exams e on e.id=r.exam_id cross join lateral jsonb_array_elements(coalesce(e.questions,'[]')) with ordinality q(value,n)
 ), counts as (
  select student_id,count(*) filter(where correct is not null) graded,count(*) filter(where correct=false) wrong,
   count(*) filter(where correct=false and reason is not null) reasons,count(*) filter(where correct is null) ungraded
  from answers group by student_id
 )
 select jsonb_build_object('checked_at',statement_timestamp(),'responses',(select count(*) from public.exam_responses),
  'unlinked_responses',(select count(*) from public.exam_responses where student_id is null),
  'items',coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'school',coalesce(s.name,''),'status',u.status,
   'submissions',(select count(*) from latest r where r.student_id=u.id::text),
   'last_submitted_at',(select max(r.submitted_at) from latest r where r.student_id=u.id::text),
   'graded',coalesce(c.graded,0),'wrong',coalesce(c.wrong,0),'reasons',coalesce(c.reasons,0),'ungraded',coalesce(c.ungraded,0)) order by u.name,u.id),'[]'))
 into result from public.users u left join public.qa_schools s on s.id::text=u.school_id::text left join counts c on c.student_id=u.id::text where u.role='student';
 return result;
end $$;
revoke all on function public.odap_input_status(text,text) from public;
grant execute on function public.odap_input_status(text,text) to anon,authenticated;
