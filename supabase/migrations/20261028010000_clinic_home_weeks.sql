begin;
alter table public.clinic_home_requests add column if not exists clinic_week text;
alter table public.clinic_home_requests add column if not exists exams jsonb not null default '[]';
create or replace function public.clinic_home_weeks(sid text) returns jsonb
language sql stable security definer set search_path=public as $$
 with papers as (
 select e.id::text id,e.name,
 case when e.clinic_week ~ '[0-9]+\s*주차' then substring(e.clinic_week from '([0-9]+)\s*주차')::integer::text||'주차 클리닉'
 when e.clinic_week ~ '^\s*[0-9]+\s*$' then trim(e.clinic_week)::integer::text||'주차 클리닉'
 else trim(e.clinic_week)||case when e.clinic_week like '%클리닉%' then '' else ' 클리닉' end end week
 from public.exams e join public.users u on u.id::text=sid
 left join public.qa_schools s on s.id=u.school_id
 where e.category='school' and nullif(trim(e.clinic_week),'') is not null
 and (e.clinic_school=u.school_id or e.clinic_school=s.name
 or (u.school_id='sc_hanbaek' and e.clinic_school like '%한백%')
 or (u.school_id='sc_chidong' and e.clinic_school like '%치동%'))
 ), weeks as (select week,jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) exams from papers group by week)
 select coalesce(jsonb_agg(jsonb_build_object('week',week,'exams',exams) order by coalesce(substring(week from '^([0-9]+)')::integer,99999),week),'[]') from weeks;
$$;
revoke all on function public.clinic_home_weeks(text) from public,anon,authenticated;
create or replace function public.clinic_home_rpc(p_id text,p_password text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor jsonb; today date:=(now() at time zone 'Asia/Seoul')::date; chosen text;
 row public.clinic_home_requests%rowtype; target_date date; result jsonb; selected_week text; papers jsonb;
begin
 if p_action in ('get','request') then
  actor:=public.authenticate_user(p_id,p_password,'student');
  if actor is null or actor->>'role' is distinct from 'student' or actor->>'status' is distinct from 'active' then raise exception '학생 로그인을 다시 확인해주세요.'; end if;
  if p_action='get' then
   select * into row from public.clinic_home_requests where request_date=today and student_id=actor->>'id';
   return jsonb_build_object('date',today,'request',case when row.id is null then null else to_jsonb(row) end,'weeks',public.clinic_home_weeks(actor->>'id'));
  end if;
  chosen:=p_payload->>'kind';
  if chosen is null or chosen not in ('take_home','finish_home') then raise exception '신청 종류를 확인해주세요.'; end if;
  selected_week:=p_payload->>'clinic_week';
  select item->'exams' into papers from jsonb_array_elements(public.clinic_home_weeks(actor->>'id')) item where item->>'week'=selected_week;
  if papers is null or jsonb_array_length(papers)=0 then raise exception '수령할 클리닉 주차를 선택해주세요.';end if;
  -- Server owns identity/date/status. No completion or attendance records are changed.
  insert into public.clinic_home_requests(request_date,student_id,student_name,school_name,kind,clinic_week,exams)
  select today,u.id,u.name,coalesce(s.name,''),chosen,selected_week,papers from public.users u left join public.qa_schools s on s.id=u.school_id
  where u.id::text=actor->>'id' and u.status='active' and u.role='student'
  on conflict(request_date,student_id) do nothing returning * into row;
  if row.id is null then select * into row from public.clinic_home_requests where request_date=today and student_id=actor->>'id'; end if;
  if row.id is null then raise exception '재원 학생을 확인해주세요.'; end if;
  if row.kind<>chosen or row.clinic_week is distinct from selected_week then raise exception '오늘 다른 신청이 이미 있어요. 변경은 선생님께 말씀해주세요.'; end if;
  return jsonb_build_object('date',today,'request',to_jsonb(row));
 end if;
 actor:=public.authenticate_user(p_id,p_password,'teacher');
 if actor is null or actor->>'role' is distinct from 'teacher' or actor->>'status' is distinct from 'active' then raise exception '교사 로그인을 다시 확인해주세요.'; end if;
 if p_action='list' then
  target_date:=coalesce((p_payload->>'date')::date,today);
  if target_date>today then raise exception '오늘 또는 지난 날짜를 선택해주세요.'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by (r.status='pending') desc,r.requested_at),'[]') into result
   from public.clinic_home_requests r where request_date=target_date;
  return jsonb_build_object('date',target_date,'rows',result);
 end if;
 if p_action in ('approve','reject') then
  select * into row from public.clinic_home_requests where id=(p_payload->>'request_id')::bigint for update;
  if row.id is null then raise exception '신청을 찾을 수 없습니다.'; end if;
  chosen:=case when p_action='approve' then 'approved' else 'rejected' end;
  if row.status=chosen then return to_jsonb(row); end if;
  if row.status<>'pending' then raise exception '이미 처리된 신청입니다. 새로고침해주세요.'; end if;
  if chosen='approved' and (row.clinic_week is null or jsonb_array_length(row.exams)=0) then raise exception '시험지 주차가 없는 이전 신청입니다. 시험지를 먼저 확인해주세요.';end if;
  update public.clinic_home_requests set status=chosen,reviewed_at=now(),reviewed_by=actor->>'id' where id=row.id returning * into row;
  return to_jsonb(row);
 end if;
 raise exception '지원하지 않는 작업입니다.';
end $$;
revoke all on function public.clinic_home_rpc(text,text,text,jsonb) from public;
grant execute on function public.clinic_home_rpc(text,text,text,jsonb) to anon,authenticated;
commit;
