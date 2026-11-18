-- NOT EXECUTED: apply after supabase_add_ops_weekly.sql by the operator.
-- PC: ops_pc(token, 'daily', {clinic_date: 'YYYY-MM-DD', day: {...}}).
-- Teacher: ops_teacher(password, 'daily', {clinic_date: 'YYYY-MM-DD'}) returns an array;
-- omit p_arg for the last 14 calendar days, newest first (Korea time).
-- Teacher forward: {clinic_date, updated_at}; resend additionally uses resend_of: last sent ID.
-- updated_at binds approval to the displayed snapshot; changes require a new review.
-- PC: 'forward-list', {} returns pending requests with their approved day snapshots.
-- Format Jandi text as: day.label + ' · 미등원 학원 전달명단\n', then lines
-- class_label + ' · ' + name + ' · 예정 ' + start for !arrived && !exam_done, in array order.
-- PC: 'forward-done', {id, status: 'sent'|'failed'}. Repeating the same result is safe.
-- The external PC worker must deduplicate by request ID before sending; it is not in this repo.
begin;

create function public.ops_valid_daily(p_value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public as $$
declare s jsonb; item jsonb;
begin
  if (jsonb_typeof(p_value) = 'object') is not true then return false; end if;
  if octet_length(p_value::text) > 1048576 then return false; end if;
  if regexp_replace(p_value::text, '\\[nrt]', ' ', 'g') ~ '(^|[^0-9])(0[0-9]{1,2}[[:space:].()+-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4}|[+]82[[:space:].()-]*0?[0-9]{1,2}[[:space:].()-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4})([^0-9]|$)' then return false; end if;
  if (p_value - 'label' - 'at' - 'issues' - 'scheduled' - 'unresolved' - 'sms' = '{}'::jsonb
    and jsonb_typeof(p_value->'label') = 'string' and length(btrim(p_value->>'label')) between 1 and 100
    and jsonb_typeof(p_value->'at') = 'string'
    and p_value->>'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and jsonb_typeof(p_value->'unresolved') = 'number' and p_value->>'unresolved' ~ '^[0-9]{1,6}$'
    and jsonb_typeof(p_value->'issues') = 'array'
    and jsonb_typeof(p_value->'scheduled') = 'array'
    and jsonb_typeof(p_value->'sms') = 'array') is not true then return false; end if;
  perform (p_value->>'at')::timestamptz;
  if jsonb_array_length(p_value->'issues') > 200 or jsonb_array_length(p_value->'scheduled') > 10000
    or jsonb_array_length(p_value->'sms') > 10000 then return false; end if;
  for item in select value from jsonb_array_elements(p_value->'issues') loop
    if (jsonb_typeof(item) = 'string' and length(btrim(item #>> '{}')) between 1 and 2000) is not true then return false; end if;
  end loop;
  for s in select value from jsonb_array_elements(p_value->'scheduled') loop
    if (jsonb_typeof(s) = 'object') is not true then return false; end if;
    if (s - 'name' - 'class_label' - 'start' - 'arrived' - 'arrived_at' - 'exam_done' = '{}'::jsonb
      and jsonb_typeof(s->'name') = 'string' and length(btrim(s->>'name')) between 1 and 100
      and jsonb_typeof(s->'class_label') = 'string' and length(btrim(s->>'class_label')) between 1 and 100
      and jsonb_typeof(s->'start') = 'string' and s->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and jsonb_typeof(s->'arrived') = 'boolean' and jsonb_typeof(s->'exam_done') = 'boolean'
      and (s->'arrived_at' = 'null'::jsonb or (jsonb_typeof(s->'arrived_at') = 'string'
        and s->>'arrived_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$')))
      is not true then return false; end if;
    if s->'arrived_at' <> 'null'::jsonb then perform (s->>'arrived_at')::timestamptz; end if;
  end loop;
  for s in select value from jsonb_array_elements(p_value->'sms') loop
    if (jsonb_typeof(s) = 'object') is not true then return false; end if;
    if (s - 'name' - 'class_label' - 'recipients' = '{}'::jsonb
      and jsonb_typeof(s->'name') = 'string' and length(btrim(s->>'name')) between 1 and 100
      and jsonb_typeof(s->'class_label') = 'string' and length(btrim(s->>'class_label')) between 1 and 100
      and jsonb_typeof(s->'recipients') = 'array') is not true then return false; end if;
    if jsonb_array_length(s->'recipients') not between 1 and 2 or not (s->'recipients' <@ '["student","parent"]'::jsonb)
      or (select count(*) <> count(distinct value) from jsonb_array_elements(s->'recipients')) then return false; end if;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function public.ops_valid_daily(jsonb) from public, anon, authenticated;

create table public.ops_daily (
  clinic_date date primary key,
  day jsonb not null check (public.ops_valid_daily(day)),
  updated_at timestamptz not null default now()
);
create table public.ops_forward_requests (
  id uuid default gen_random_uuid() primary key,
  clinic_date date not null references public.ops_daily(clinic_date),
  kind text not null check (kind = 'jandi-attendance'),
  requested_at timestamptz not null default now(),
  requested_by text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  done_at timestamptz,
  -- Preserve the exact reviewed roster even when the PC publishes a newer daily snapshot.
  day jsonb not null check (public.ops_valid_daily(day)),
  check ((status = 'pending' and done_at is null) or (status in ('sent','failed') and done_at is not null))
);
create unique index ops_forward_one_pending on public.ops_forward_requests(clinic_date, kind) where status = 'pending';
alter table public.ops_daily enable row level security;
alter table public.ops_forward_requests enable row level security;
revoke all on public.ops_daily, public.ops_forward_requests from public, anon, authenticated;

-- RPC definitions below retain every existing action and its authentication.

create or replace function public.ops_pc(p_token text, p_action text, p_row jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare approval public.sms_approvals%rowtype; saved_roster jsonb; total integer; item jsonb; request public.ops_forward_requests%rowtype;
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from public.sms_approval_publishers where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'PUBLISHER_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('roster','board','weekly','daily','forward-list','forward-done') then raise exception 'APPROVAL_ACTION_INVALID'; end if;
  if (jsonb_typeof(p_row) = 'object') is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
  if p_action = 'roster' then
    if (p_row - 'approval_id' - 'roster' = '{}'::jsonb and jsonb_typeof(p_row->'approval_id') = 'string'
      and public.ops_valid_payload('roster', p_row->'roster')) is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    select * into approval from public.sms_approvals where id = p_row->>'approval_id' for update;
    if not found then raise exception 'APPROVAL_NOT_FOUND'; end if;
    if approval.status <> 'pending' or approval.expires_at <= clock_timestamp() then raise exception 'APPROVAL_IMMUTABLE'; end if;
    select sum(jsonb_array_length(s.value->'recipients')) into total
      from jsonb_array_elements(p_row->'roster'->'classes') c,
        lateral jsonb_array_elements(c.value->'students') s;
    if total is distinct from approval.recipient_count then raise exception 'OPS_RECIPIENT_COUNT_MISMATCH'; end if;
    -- Never substitute a roster after a phone has already displayed it for review.
    insert into public.ops_rosters(approval_id, roster) values(approval.id, p_row->'roster') on conflict do nothing;
    select roster into saved_roster from public.ops_rosters where approval_id = approval.id;
    if saved_roster is distinct from p_row->'roster' then raise exception 'OPS_ROSTER_IMMUTABLE'; end if;
  elsif p_action = 'daily' then
    if (p_row - 'clinic_date' - 'day' = '{}'::jsonb
      and jsonb_typeof(p_row->'clinic_date') = 'string' and p_row->>'clinic_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and public.ops_valid_daily(p_row->'day')) is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    insert into public.ops_daily(clinic_date, day, updated_at) values((p_row->>'clinic_date')::date, p_row->'day', clock_timestamp())
      on conflict (clinic_date) do update set day = excluded.day, updated_at = excluded.updated_at;
  elsif p_action = 'forward-list' then
    if p_row <> '{}'::jsonb then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    return (select coalesce(jsonb_agg(to_jsonb(r) order by r.requested_at, r.id), '[]'::jsonb)
      from public.ops_forward_requests r where r.status = 'pending');
  elsif p_action = 'forward-done' then
    if (p_row - 'id' - 'status' = '{}'::jsonb and jsonb_typeof(p_row->'id') = 'string'
      and p_row->>'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and p_row->>'status' in ('sent','failed')) is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    select * into request from public.ops_forward_requests where id = (p_row->>'id')::uuid for update;
    if not found then raise exception 'OPS_FORWARD_NOT_FOUND'; end if;
    if request.status = 'pending' then
      update public.ops_forward_requests set status = p_row->>'status', done_at = clock_timestamp() where id = request.id;
    elsif request.status <> p_row->>'status' then raise exception 'OPS_FORWARD_IMMUTABLE'; end if;
  elsif p_action = 'weekly' then
    if (p_row - 'week' = '{}'::jsonb and public.ops_valid_weekly(p_row->'week')) is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    insert into public.ops_weekly(id, week, updated_at) values('current', p_row->'week', clock_timestamp())
      on conflict (id) do update set week = excluded.week, updated_at = excluded.updated_at;
  else
    if (p_row - 'board' = '{}'::jsonb and public.ops_valid_payload('board', p_row->'board')) is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    for item in select value from jsonb_array_elements(p_row->'board'->'tasks') loop
      perform (item->>'last_run_at')::timestamptz;
    end loop;
    insert into public.ops_board(id, board, updated_at) values('main', p_row->'board', clock_timestamp())
      on conflict (id) do update set board = excluded.board, updated_at = excluded.updated_at;
  end if;
  -- PC writes acknowledge success without exposing stored names.
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.ops_pc(text,text,jsonb) from public;
grant execute on function public.ops_pc(text,text,jsonb) to anon, authenticated;

-- PostgreSQL requires removing the old identity when adding a default argument.
-- The transaction leaves only one signature; existing two-argument calls still work.
drop function public.ops_teacher(text,text);
create or replace function public.ops_teacher(p_password text, p_action text, p_arg jsonb default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare teacher jsonb; teacher_id text; candidate record; result jsonb; selected_date date; daily public.ops_daily%rowtype; request public.ops_forward_requests%rowtype;
begin
  if p_password is not null and length(p_password) > 0 then
    -- Reuse the existing verifier, including any server-side lockout it gains.
    -- ponytail: password-only login scans active teachers; add an ID field if the staff list grows large.
    for candidate in select id from public.users where role = 'teacher' and status = 'active' order by id loop
      teacher := public.authenticate_user(candidate.id, p_password, 'teacher');
      if teacher->>'role' = 'teacher' and teacher->>'status' = 'active' then teacher_id := candidate.id; exit; end if;
    end loop;
  end if;
  if teacher_id is null then raise exception 'TEACHER_AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('pending','board','history','weekly','daily','forward') then raise exception 'APPROVAL_ACTION_INVALID'; end if;
  if p_action in ('daily','forward') then
    if p_arg is not null then
      if (jsonb_typeof(p_arg) = 'object') is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
      if (jsonb_typeof(p_arg->'clinic_date') = 'string' and p_arg->>'clinic_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
      selected_date := (p_arg->>'clinic_date')::date;
    end if;
    if p_action = 'daily' then
      if p_arg is not null and p_arg - 'clinic_date' <> '{}'::jsonb then raise exception 'OPS_PAYLOAD_INVALID'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('clinic_date', d.clinic_date, 'day', d.day, 'updated_at', d.updated_at,
        'forward', (select to_jsonb(r) - 'day' from public.ops_forward_requests r where r.clinic_date = d.clinic_date
          and r.kind = 'jandi-attendance' order by (r.status = 'pending') desc, r.requested_at desc, r.id desc limit 1)
        ) order by d.clinic_date desc), '[]'::jsonb) into result
      from public.ops_daily d where (selected_date is not null and d.clinic_date = selected_date)
        or (selected_date is null and d.clinic_date between (now() at time zone 'Asia/Seoul')::date - 13 and (now() at time zone 'Asia/Seoul')::date);
      return result;
    end if;
    if (p_arg - 'clinic_date' - 'updated_at' - 'resend_of' = '{}'::jsonb
      and jsonb_typeof(p_arg->'updated_at') = 'string'
      and p_arg->>'updated_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and (not (p_arg ? 'resend_of') or (jsonb_typeof(p_arg->'resend_of') = 'string'
        and p_arg->>'resend_of' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')))
      is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    -- Serialize initial requests and resends for this date, including concurrent phones.
    select * into daily from public.ops_daily where clinic_date = selected_date for update;
    if not found then raise exception 'OPS_DAILY_NOT_FOUND'; end if;
    select * into request from public.ops_forward_requests where clinic_date = selected_date and kind = 'jandi-attendance'
      order by (status = 'pending') desc, requested_at desc, id desc limit 1 for update;
    if found and (request.status = 'pending' or (request.status = 'sent' and
      (p_arg->>'resend_of')::uuid is distinct from request.id)) then return to_jsonb(request) - 'day'; end if;
    if daily.updated_at is distinct from (p_arg->>'updated_at')::timestamptz then
      raise exception 'OPS_DAILY_CHANGED' using errcode = '40001';
    end if;
    if not exists (select 1 from jsonb_array_elements(daily.day->'scheduled') s
      where s->'arrived' = 'false'::jsonb and s->'exam_done' = 'false'::jsonb) then raise exception 'OPS_FORWARD_EMPTY'; end if;
    insert into public.ops_forward_requests(clinic_date, kind, requested_at, requested_by, day)
      values(selected_date, 'jandi-attendance', clock_timestamp(), teacher_id, daily.day) returning * into request;
    return to_jsonb(request) - 'day';
  end if;
  if p_action = 'pending' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'job', a.job, 'slot', a.slot, 'expires_at', a.expires_at,
      'status', a.status, 'recipient_count', a.recipient_count, 'preview', a.preview, 'roster', r.roster
    ) order by a.slot), '[]'::jsonb) into result
    from public.sms_approvals a left join public.ops_rosters r on r.approval_id = a.id
    where a.status = 'pending' and a.expires_at > clock_timestamp();
    return jsonb_build_object('teacher_id', teacher_id, 'approvals', result);
  elsif p_action = 'weekly' then
    select jsonb_build_object('week', week, 'updated_at', updated_at) into result from public.ops_weekly where id = 'current';
    return result;
  elsif p_action = 'board' then
    select jsonb_build_object('board', board - 'sent_counts', 'updated_at', updated_at) into result from public.ops_board where id = 'main';
    return result;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'job', a.job, 'slot', a.slot,
    'status', case when a.status = 'pending' then 'expired' else a.status end,
    'sent_count', (b.board->'sent_counts'->>a.id)::integer
  ) order by a.slot desc), '[]'::jsonb) into result
  from public.sms_approvals a left join public.ops_board b on b.id = 'main'
  where a.created_at >= now() - interval '7 days' and a.created_at <= now()
    and (a.status in ('approved','rejected','expired') or (a.status = 'pending' and a.expires_at <= clock_timestamp()));
  return result;
end;
$$;
revoke all on function public.ops_teacher(text,text,jsonb) from public;
grant execute on function public.ops_teacher(text,text,jsonb) to anon, authenticated;
commit;
