begin;
create table if not exists public.clinic_checkout (
 week_start date not null, student_id text not null,
 student_name text not null, school_name text not null default '',
 slot_id text, slot_label text not null,
 mode text not null check(mode in ('unchecked','onsite','take_home','finish_home')),
 completed boolean not null default false,
 version integer not null default 1, updated_by text not null,
 updated_at timestamptz not null default now(),
 primary key(week_start,student_id),
 check(extract(isodow from week_start)=1),
 check((mode='onsite' and completed) or (mode='unchecked' and not completed) or mode in ('take_home','finish_home'))
);
alter table public.clinic_checkout enable row level security;
revoke all on public.clinic_checkout from anon,authenticated;
create or replace function public.clinic_checkout_rpc(p_id text,p_password text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor jsonb; target_week date; result jsonb; saved public.clinic_checkout%rowtype;
 student public.users%rowtype; slot public.clinic_slots%rowtype; chosen_mode text; done boolean; expected integer; school text;
begin
 actor:=public.authenticate_user(p_id,p_password,'teacher');
 if actor is null or actor->>'role' is distinct from 'teacher' or actor->>'status' is distinct from 'active' then raise exception '교사 로그인을 다시 확인해주세요.'; end if;
 target_week:=(p_payload->>'week_start')::date;
 if target_week is null or extract(isodow from target_week)<>1 then raise exception '주차 날짜를 확인해주세요.'; end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.slot_label,x.student_name),'[]') into result from (
   select coalesce(c.student_id,u.id::text) student_id,coalesce(c.student_name,u.name) student_name,
    coalesce(c.school_name,s.name,'') school_name,case when c.student_id is not null then c.slot_id else k.id::text end slot_id,
    coalesce(c.slot_label,case when k.id is null then '시간대 미배정' else concat_ws(' · ',s.name,nullif(k.day_of_week,''),nullif(k.start_time::text,''),nullif(k.label,'')) end) slot_label,
    coalesce(c.mode,'unchecked') mode,coalesce(c.completed,false) completed,coalesce(c.version,0) version,c.updated_at
   from (select * from public.users where role='student' and status='active') u
   full join (select * from public.clinic_checkout where week_start=target_week) c on c.student_id=u.id::text
   left join lateral (
    select cs.* from public.clinic_requests cr join public.clinic_slots cs on cs.id=cr.slot_id
    where cr.student_id=u.id and cr.status='confirmed'
     and date_trunc('week',coalesce(cs.slot_date::timestamp,cr.created_at at time zone 'Asia/Seoul'))::date<=target_week
    order by date_trunc('week',coalesce(cs.slot_date::timestamp,cr.created_at at time zone 'Asia/Seoul')) desc,cr.created_at desc,cr.id desc limit 1
   ) k on true
   left join public.qa_schools s on s.id=coalesce(k.school_id,u.school_id)
  ) x;
  return result;
 end if;
 if p_action<>'save' then raise exception '지원하지 않는 작업입니다.'; end if;
 chosen_mode:=p_payload->>'mode';done:=(p_payload->>'completed')::boolean;expected:=(p_payload->>'version')::integer;
 if chosen_mode is null or chosen_mode not in ('unchecked','onsite','take_home','finish_home') or done is null or expected is null or expected<0 then raise exception '수행 상태를 확인해주세요.'; end if;
 if (chosen_mode='onsite' and not done) or (chosen_mode='unchecked' and done) then raise exception '완료 상태를 확인해주세요.'; end if;
 if target_week>date_trunc('week',now() at time zone 'Asia/Seoul')::date then raise exception '미래 주차는 미리 완료 처리할 수 없습니다.'; end if;
 select * into student from public.users where id::text=p_payload->>'student_id' and role='student' and status='active';
 if not found then raise exception '재원 학생을 확인해주세요.'; end if;
 select cs.* into slot from public.clinic_requests cr join public.clinic_slots cs on cs.id=cr.slot_id
  where cr.student_id=student.id and cr.status='confirmed'
   and date_trunc('week',coalesce(cs.slot_date::timestamp,cr.created_at at time zone 'Asia/Seoul'))::date<=target_week
  order by date_trunc('week',coalesce(cs.slot_date::timestamp,cr.created_at at time zone 'Asia/Seoul')) desc,cr.created_at desc,cr.id desc limit 1;
 select name into school from public.qa_schools where id=coalesce(slot.school_id,student.school_id);
 if expected=0 then
  insert into public.clinic_checkout(week_start,student_id,student_name,school_name,slot_id,slot_label,mode,completed,updated_by)
  values(target_week,student.id,student.name,coalesce(school,''),slot.id,case when slot.id is null then '시간대 미배정' else concat_ws(' · ',school,nullif(slot.day_of_week,''),nullif(slot.start_time::text,''),nullif(slot.label,'')) end,chosen_mode,done,p_id)
  on conflict do nothing returning * into saved;
 else
  update public.clinic_checkout set mode=chosen_mode,completed=done,version=version+1,updated_by=p_id,updated_at=now()
  where week_start=target_week and student_id=student.id and version=expected returning * into saved;
 end if;
 if saved.student_id is null then raise exception '다른 화면에서 기록이 변경되었습니다. 새로고침 후 다시 확인해주세요.'; end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.clinic_checkout_rpc(text,text,text,jsonb) from public;
grant execute on function public.clinic_checkout_rpc(text,text,text,jsonb) to anon,authenticated;
commit;
