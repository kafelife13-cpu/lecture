-- 2026-11-21 선생님 요청: 운영앱 출석부에서 직접 출석 체크 → [미등원 발송] → 잔디.
-- 웹훅 주소는 서버·브라우저 어디에도 저장하지 않는다. 앱은 체크와 발송 요청 행만 남기고,
-- 학원 PC(src/ops-absence-send.mjs)가 요청을 읽어 DPAPI 웹훅으로 보낸 뒤 결과를 적는다.
-- 기존 ops_pc / ops_teacher / ops_teacher_attendance 는 건드리지 않는다.
-- 앱: ops_teacher_absence(password, action, arg)   PC: ops_pc_absence(token, action, row)
begin;

create table if not exists public.ops_att_marks (
  class_label text not null check (length(class_label) between 1 and 100),
  att_date date not null,
  marks jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (class_label, att_date)
);

create table if not exists public.ops_absence_sends (
  id uuid primary key default gen_random_uuid(),
  class_label text not null check (length(class_label) between 1 and 100),
  att_date date not null,
  class_time text check (class_time is null or class_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  round integer not null check (round between 1 and 50),
  destination text not null check (destination in ('self', 'room')),
  absent jsonb not null check (jsonb_typeof(absent) = 'array'),
  arrived jsonb not null check (jsonb_typeof(arrived) = 'array'),
  example boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  claimed_at timestamptz,
  reason text check (reason is null or reason ~ '^[A-Z_]{1,60}$'),
  body text check (body is null or length(body) <= 2000),
  requested_at timestamptz not null default now(),
  requested_by text,
  done_at timestamptz
);
-- 11/21 [발송 취소]: 이미 만든 테이블에도 취소 상태·PC 처리 시작 시각을 더한다.
alter table public.ops_absence_sends add column if not exists claimed_at timestamptz;
alter table public.ops_absence_sends drop constraint if exists ops_absence_sends_status_check;
alter table public.ops_absence_sends add constraint ops_absence_sends_status_check check (status in ('pending', 'sent', 'failed', 'cancelled'));
create index if not exists ops_absence_sends_class_idx on public.ops_absence_sends (class_label, att_date, requested_at desc);

create table if not exists public.ops_absence_settings (
  id text primary key default 'current' check (id = 'current'),
  destination text not null default 'self' check (destination in ('self', 'room')),
  room_ready boolean not null default false,
  room_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.ops_absence_settings (id) values ('current') on conflict (id) do nothing;

alter table public.ops_att_marks enable row level security;
alter table public.ops_absence_sends enable row level security;
alter table public.ops_absence_settings enable row level security;
revoke all on public.ops_att_marks, public.ops_absence_sends, public.ops_absence_settings from public, anon, authenticated;

create or replace function public.ops_teacher_absence(p_password text, p_action text, p_arg jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare
  teacher jsonb; teacher_id text; candidate record; cls jsonb; names text[]; label text; day date;
  v_marks jsonb; k text; settings public.ops_absence_settings%rowtype; last public.ops_absence_sends%rowtype;
  v_absent jsonb; v_arrived jsonb; saved public.ops_absence_sends%rowtype; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_password is not null and length(p_password) > 0 then
    for candidate in select id from public.users where role = 'teacher' and status = 'active' order by id loop
      teacher := public.authenticate_user(candidate.id, p_password, 'teacher');
      if teacher->>'role' = 'teacher' and teacher->>'status' = 'active' then teacher_id := candidate.id; exit; end if;
    end loop;
  end if;
  if teacher_id is null then raise exception 'TEACHER_AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('get', 'save', 'send', 'dest', 'cancel') then raise exception 'ABSENCE_ACTION_INVALID'; end if;
  if p_arg is null or jsonb_typeof(p_arg) <> 'object' then raise exception 'ABSENCE_INVALID'; end if;

  if p_action = 'get' then
    return jsonb_build_object(
      'settings', (select jsonb_build_object('destination', destination, 'room_ready', room_ready, 'room_checked_at', room_checked_at) from public.ops_absence_settings where id = 'current'),
      'marks', coalesce((select jsonb_agg(jsonb_build_object('class_label', class_label, 'att_date', att_date, 'marks', marks, 'updated_at', updated_at)) from public.ops_att_marks where att_date >= today - 7), '[]'::jsonb),
      'sends', coalesce((select jsonb_agg(to_jsonb(s) - 'requested_by' order by s.requested_at) from public.ops_absence_sends s where s.att_date >= today - 7 and not s.example), '[]'::jsonb));
  end if;

  if p_action = 'dest' then
    if p_arg->>'destination' not in ('self', 'room') then raise exception 'ABSENCE_INVALID'; end if;
    select * into settings from public.ops_absence_settings where id = 'current' for update;
    -- 출결방 웹훅이 학원 PC에 없으면 전환할 수 없다(PC가 room_ready를 알려 준다).
    if p_arg->>'destination' = 'room' and settings.room_ready is not true then raise exception 'ABSENCE_ROOM_NOT_READY'; end if;
    update public.ops_absence_settings set destination = p_arg->>'destination', updated_at = now(), updated_by = teacher_id where id = 'current';
    return (select jsonb_build_object('destination', destination, 'room_ready', room_ready, 'room_checked_at', room_checked_at) from public.ops_absence_settings where id = 'current');
  end if;

  if p_action = 'cancel' then
    -- 학원 PC가 아직 집어 가지 않은(claimed_at 없음) 대기 요청만 취소한다.
    begin update public.ops_absence_sends set status = 'cancelled', done_at = now()
      where id = (p_arg->>'id')::uuid and status = 'pending' and claimed_at is null returning * into saved;
    exception when invalid_text_representation then raise exception 'ABSENCE_INVALID'; end;
    if saved.id is null then raise exception 'ABSENCE_NOT_CANCELLABLE'; end if;
    return to_jsonb(saved) - 'requested_by';
  end if;

  -- save / send: 반·날짜는 학원 PC가 올린 현재 출석부에 있어야 하고, 이름도 그 반 명단 안에서만 받는다.
  label := p_arg->>'class_label';
  begin day := (p_arg->>'att_date')::date; exception when others then raise exception 'ABSENCE_INVALID'; end;
  if label is null or day is null or day > today or day < today - 7 then raise exception 'ABSENCE_INVALID'; end if;
  select c into cls from public.ops_attendance a, jsonb_array_elements(a.book->'regular') c
    where a.id = 'current' and c->>'label' = label and (c->'dates') ? day::text limit 1;
  if cls is null then raise exception 'ABSENCE_CLASS_NOT_FOUND'; end if;
  select array_agg(s->>'name') into names from jsonb_array_elements(cls->'students') s;
  v_marks := p_arg->'marks';
  if v_marks is null or jsonb_typeof(v_marks) <> 'object' then raise exception 'ABSENCE_INVALID'; end if;
  for k in select jsonb_object_keys(v_marks) loop
    if not (k = any(names)) or v_marks->>k not in ('출석', '지각', '미등원') then raise exception 'ABSENCE_INVALID'; end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext('ops_absence:' || label || ':' || day::text));
  insert into public.ops_att_marks (class_label, att_date, marks, updated_at, updated_by) values (label, day, v_marks, now(), teacher_id)
    on conflict (class_label, att_date) do update set marks = excluded.marks, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  if p_action = 'save' then return jsonb_build_object('ok', true); end if;

  if exists (select 1 from unnest(names) n where not v_marks ? n) then raise exception 'ABSENCE_UNMARKED'; end if;
  select * into settings from public.ops_absence_settings where id = 'current';
  if settings.destination = 'room' and settings.room_ready is not true then raise exception 'ABSENCE_ROOM_NOT_READY'; end if;
  if exists (select 1 from public.ops_absence_sends where class_label = label and att_date = day and destination = settings.destination and status = 'pending' and not example) then
    raise exception 'ABSENCE_PENDING';
  end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into v_absent from unnest(names) n where v_marks->>n = '미등원';
  select * into last from public.ops_absence_sends where class_label = label and att_date = day and destination = settings.destination
    and status = 'sent' and not example order by requested_at desc limit 1;
  -- 같은 반·회차에 같은 미등원 명단은 다시 보내지 않는다.
  if last.id is not null and last.absent = v_absent then raise exception 'ABSENCE_DUPLICATE'; end if;
  select coalesce(jsonb_agg(n order by n), '[]'::jsonb) into v_arrived from jsonb_array_elements_text(coalesce(last.absent, '[]'::jsonb)) n where v_marks->>n in ('출석', '지각');
  insert into public.ops_absence_sends (class_label, att_date, class_time, round, destination, absent, arrived, requested_by)
    values (label, day, case when cls->'times'->>(day::text) ~ '^[0-2][0-9]:[0-5][0-9]$' then cls->'times'->>(day::text) end,
      (select count(*) + 1 from public.ops_absence_sends where class_label = label and att_date = day and destination = settings.destination and status = 'sent' and not example),
      settings.destination, v_absent, v_arrived, teacher_id)
    returning * into saved;
  return to_jsonb(saved) - 'requested_by';
end;
$$;
revoke all on function public.ops_teacher_absence(text, text, jsonb) from public;
grant execute on function public.ops_teacher_absence(text, text, jsonb) to anon, authenticated;

create or replace function public.ops_pc_absence(p_token text, p_action text, p_row jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare request public.ops_absence_sends%rowtype;
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from public.sms_approval_publishers where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'PUBLISHER_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('status', 'list', 'claim', 'done') or p_row is null or jsonb_typeof(p_row) <> 'object' then raise exception 'ABSENCE_INVALID'; end if;
  if p_action = 'status' then
    if jsonb_typeof(p_row->'room_ready') <> 'boolean' then raise exception 'ABSENCE_INVALID'; end if;
    update public.ops_absence_settings set room_ready = (p_row->>'room_ready')::boolean, room_checked_at = now() where id = 'current';
    return jsonb_build_object('ok', true);
  elsif p_action = 'list' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'class_label', class_label, 'att_date', att_date, 'class_time', class_time, 'round', round,
      'destination', destination, 'absent', absent, 'arrived', arrived, 'example', example, 'requested_at', requested_at) order by requested_at)
      from public.ops_absence_sends where status = 'pending'), '[]'::jsonb);
  end if;
  if p_action = 'claim' then
    -- 보내기 직전에 PC가 집어 간다. 취소된 요청은 여기서 거부되어 보내지 않는다.
    update public.ops_absence_sends set claimed_at = now() where id = (p_row->>'id')::uuid and status = 'pending' and claimed_at is null returning * into request;
    if request.id is null then raise exception 'ABSENCE_NOT_PENDING'; end if;
    return jsonb_build_object('ok', true);
  end if;
  -- done
  if p_row->>'status' not in ('sent', 'failed') then raise exception 'ABSENCE_INVALID'; end if;
  if p_row->>'body' is not null and (length(p_row->>'body') > 2000
     or (p_row->>'body') ~ '(^|[^0-9])(01[016789][[:space:].-]*[0-9]{3,4}[[:space:].-]*[0-9]{4}|0[2-6][0-9]?[[:space:].-]*[0-9]{3,4}[[:space:].-]*[0-9]{4})([^0-9]|$)'
     or (p_row->>'body') ~* '(https?://|bearer |service_role)') then raise exception 'ABSENCE_INVALID'; end if;
  if p_row->>'reason' is not null and (p_row->>'reason') !~ '^[A-Z_]{1,60}$' then raise exception 'ABSENCE_INVALID'; end if;
  select * into request from public.ops_absence_sends where id = (p_row->>'id')::uuid for update;
  if request.id is null or request.status <> 'pending' then raise exception 'ABSENCE_NOT_PENDING'; end if;
  update public.ops_absence_sends set status = p_row->>'status', body = p_row->>'body', reason = p_row->>'reason', done_at = now() where id = request.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.ops_pc_absence(text, text, jsonb) from public;
grant execute on function public.ops_pc_absence(text, text, jsonb) to anon, authenticated;

commit;
