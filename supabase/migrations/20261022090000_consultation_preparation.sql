-- Teacher-arranged arrival for writing; does not consume another student's counseling slot.
begin;
alter table public.consultation_bookings add column preparation_only boolean not null default false;
drop index public.consultation_one_slot;
create unique index consultation_one_slot on public.consultation_bookings(starts_at) where cancelled_at is null and not preparation_only;
create or replace function public.consultation_rpc(p_id text,p_password text,p_role text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor jsonb; eligible boolean; slot_at timestamptz; booking public.consultation_bookings%rowtype; result jsonb; preparations jsonb;
begin
 actor:=public.authenticate_user(p_id,p_password,p_role);
 if actor is null or actor->>'status' is distinct from 'active' or actor->>'role' is distinct from p_role or p_role not in ('student','teacher') then
  raise exception '본인 계정으로 다시 로그인해 주세요.';
 end if;
 -- Eligibility is a recorded school-exam result, not a clinic/homework score.
 select exists(select 1 from public.exam_responses r join public.exams e on e.id=r.exam_id
  where r.student_id=p_id and r.score is not null and e.category='naeshin') into eligible;
 if p_action in ('book','cancel') then
  -- Serialize this small 64-slot campaign, including retries and cancellations.
  perform pg_advisory_xact_lock(20261022,15);
  if p_action='book' then
   if p_role<>'student' or not eligible then raise exception '중간·기말고사 성적을 국어왕에 입력한 학생만 신청할 수 있습니다.'; end if;
   if p_payload->>'paper_confirmed' is distinct from 'true' then raise exception '시험지 지참 안내를 확인해 주세요.'; end if;
   slot_at:=(p_payload->>'starts_at')::timestamptz;
   if not exists(select 1 from public.consultation_slots where starts_at=slot_at and starts_at>now()) then raise exception '신청 가능한 상담 시간이 아닙니다.'; end if;
   select * into booking from public.consultation_bookings where student_id=p_id and cancelled_at is null;
   if found then
    if booking.starts_at=slot_at then return jsonb_build_object('ok',true,'id',booking.id); end if;
    raise exception '학생당 한 번만 신청할 수 있습니다. 기존 예약을 취소한 뒤 다시 신청해 주세요.';
   end if;
   if exists(select 1 from public.consultation_bookings where starts_at=slot_at and cancelled_at is null and not preparation_only) then raise exception '방금 다른 학생이 신청한 시간입니다. 다른 시간을 선택해 주세요.'; end if;
   insert into public.consultation_bookings(starts_at,student_id) values(slot_at,p_id) returning * into booking;
   return jsonb_build_object('ok',true,'id',booking.id);
  end if;
  select * into booking from public.consultation_bookings where id=(p_payload->>'id')::uuid and cancelled_at is null;
  if not found or (p_role<>'teacher' and booking.student_id<>p_id) then raise exception '취소할 본인 예약을 확인해 주세요.'; end if;
  if p_role<>'teacher' and booking.starts_at<=now() then raise exception '상담 시작 이후에는 선생님께 문의해 주세요.'; end if;
  update public.consultation_bookings set cancelled_at=now() where id=booking.id;
  return jsonb_build_object('ok',true);
 end if;
 if p_action<>'list' then raise exception '지원하지 않는 요청입니다.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at,'available',b.id is null and s.starts_at>now(),
  'mine',coalesce(b.student_id=p_id,false),
  'booking_id',case when p_role='teacher' or b.student_id=p_id then b.id end,
  'student_name',case when p_role='teacher' then u.name end,
  'student_id',case when p_role='teacher' then b.student_id end,
  'created_at',case when p_role='teacher' or b.student_id=p_id then b.created_at end) order by s.starts_at),'[]') into result
 from public.consultation_slots s left join public.consultation_bookings b on b.starts_at=s.starts_at and b.cancelled_at is null and not b.preparation_only
 left join public.users u on u.id::text=b.student_id;
 select coalesce(jsonb_agg(jsonb_build_object('starts_at',b.starts_at,'mine',b.student_id=p_id,
 'booking_id',b.id,'student_name',case when p_role='teacher' then u.name end,
 'student_id',case when p_role='teacher' then b.student_id end) order by b.starts_at),'[]') into preparations
 from public.consultation_bookings b left join public.users u on u.id::text=b.student_id
 where b.cancelled_at is null and b.preparation_only and (p_role='teacher' or b.student_id=p_id);
 return jsonb_build_object('eligible',eligible,'slots',result,'preparations',preparations,'server_now',now());
end $$;
commit;
