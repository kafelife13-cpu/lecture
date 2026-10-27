begin;
create table public.clinic_home_reminder_settings(id boolean primary key default true check(id),enabled boolean not null default false,start_at timestamptz not null default now());
insert into public.clinic_home_reminder_settings(id) values(true);
create table public.clinic_home_grading(request_id bigint references public.clinic_home_requests(id),exam_id text,completed_at timestamptz not null,primary key(request_id,exam_id));
create table public.clinic_home_messages(
 id bigint generated always as identity primary key,request_id bigint references public.clinic_home_requests(id),recipient text not null,
 text text not null,status text not null default 'queued' check(status in ('queued','claimed','accepted','failed','unknown')),
 created_at timestamptz not null default now(),claimed_at timestamptz,finished_at timestamptz,provider_reference text,
 unique(request_id,recipient)
);
alter table public.clinic_home_reminder_settings enable row level security;
alter table public.clinic_home_grading enable row level security;
alter table public.clinic_home_messages enable row level security;
revoke all on public.clinic_home_reminder_settings,public.clinic_home_grading,public.clinic_home_messages from anon,authenticated;
revoke all on sequence public.clinic_home_messages_id_seq from anon,authenticated;

-- Record server observation time, not a client supplied submitted_at timestamp.
create or replace function public.clinic_home_capture_grade() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.score is not null and new.student_id is not null then
  insert into public.clinic_home_grading(request_id,exam_id,completed_at)
  select r.id,new.exam_id::text,now() from public.clinic_home_requests r
  where r.student_id=new.student_id and r.kind='take_home' and r.status in ('pending','approved')
  and exists(select 1 from jsonb_array_elements(r.exams) e where e->>'id'=new.exam_id::text)
  on conflict do nothing;
 end if;
 return new;
end $$;
create trigger clinic_home_grade_saved after insert or update on public.exam_responses for each row execute function public.clinic_home_capture_grade();
create or replace function public.clinic_home_capture_existing() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.clinic_home_grading(request_id,exam_id,completed_at)
 select distinct new.id,e->>'id',now() from jsonb_array_elements(new.exams) e
 join public.exam_responses a on a.exam_id::text=e->>'id' and a.student_id=new.student_id and a.score is not null
 where new.kind='take_home' on conflict do nothing;
 return new;
end $$;
create trigger clinic_home_existing_grade after insert on public.clinic_home_requests for each row execute function public.clinic_home_capture_existing();

create or replace function public.clinic_home_prepare_reminders(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if not (select enabled from public.clinic_home_reminder_settings where id) then return 0;end if;
 -- Only this morning. Never backfill historical reminders after downtime.
 if (p_now at time zone 'Asia/Seoul')::time < time '08:00' or (p_now at time zone 'Asia/Seoul')::time >= time '10:00' then return 0;end if;
 insert into public.clinic_home_messages(request_id,recipient,text)
 select distinct r.id,regexp_replace(phone,'\D','','g'),
 '[국어왕 김까까] '||r.student_name||' 학생의 '||r.clinic_week||' 시험지 수령 후 채점이 '||to_char(r.request_date+1,'MM월 DD일')||' 새벽 1시 기준 완료되지 않았습니다. 국어왕에서 채점을 마무리해 주세요. 이후 완료했다면 이 안내는 참고만 해 주세요.'
 from public.clinic_home_requests r join public.users u on u.id::text=r.student_id
 cross join lateral unnest(array[u.student_phone,u.parent_phone]) phone
 where r.kind='take_home' and r.status='approved' and u.role='student' and u.status='active'
 and r.requested_at >= (select start_at from public.clinic_home_reminder_settings where id)
 and r.request_date=(p_now at time zone 'Asia/Seoul')::date-1
 and r.reviewed_at <= (r.request_date+1+time '01:00') at time zone 'Asia/Seoul'
 and jsonb_array_length(r.exams)>0
 and exists(select 1 from jsonb_array_elements(r.exams) e where not exists(
  select 1 from public.clinic_home_grading g where g.request_id=r.id and g.exam_id=e->>'id'
  and g.completed_at <= (r.request_date+1+time '01:00') at time zone 'Asia/Seoul'))
 and regexp_replace(phone,'\D','','g') ~ '^01[0-9]{8,9}$'
 on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
create or replace function public.clinic_home_claim_message() returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.clinic_home_messages%rowtype;
begin
 if not (select enabled from public.clinic_home_reminder_settings where id) then return null;end if;
 if (now() at time zone 'Asia/Seoul')::time < time '08:00' or (now() at time zone 'Asia/Seoul')::time >= time '10:00' then return null;end if;
 select m.* into item from public.clinic_home_messages m join public.clinic_home_requests r on r.id=m.request_id
 where m.status='queued' and r.request_date=(now() at time zone 'Asia/Seoul')::date-1
 order by m.id for update of m skip locked limit 1;
 if item.id is null then return null;end if;
 update public.clinic_home_messages set status='claimed',claimed_at=now() where id=item.id;
 return to_jsonb(item);
end $$;
create or replace function public.clinic_home_finish_message(p_id bigint,p_status text,p_reference text default null) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_status not in ('accepted','failed','unknown') then raise exception 'invalid status';end if;
 update public.clinic_home_messages set status=p_status,finished_at=now(),provider_reference=left(p_reference,200)
 where id=p_id and status='claimed';
end $$;
revoke all on function public.clinic_home_capture_grade(),public.clinic_home_capture_existing(),public.clinic_home_prepare_reminders(timestamptz),public.clinic_home_claim_message(),public.clinic_home_finish_message(bigint,text,text) from public,anon,authenticated;
grant execute on function public.clinic_home_prepare_reminders(timestamptz),public.clinic_home_claim_message(),public.clinic_home_finish_message(bigint,text,text) to service_role;
commit;
