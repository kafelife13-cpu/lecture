-- NOT EXECUTED: apply after supabase_add_teacher_ops.sql by the operator.
-- PC publishes a complete snapshot with ops_pc(token, 'weekly', {"week":{
--   "label":"기말대비 4주차","at":"2026-11-19T09:00:00+09:00","blocked":false,"issues":[],
--   "classes":[{"class_id":"class-a","label":"반 이름","students":[{
--     "name":"학생 이름","attendance":"미등원","clinic":"미입력","score":null,
--     "retest":false,"homework":"미완","absence_dates":["2026-11-18"]}]}]}}).
-- attendance: 등원|미등원|시험지만 수령|확인 불가; clinic: 입력완료|미입력|확인 불가;
-- homework: 완료|미완|없음. No phone numbers, passwords, tokens or raw command output.
-- ops_teacher(password, 'weekly') returns {week, updated_at}, or null before the first upload.
begin;

create function public.ops_valid_weekly(p_value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public as $$
declare c jsonb; s jsonb; item jsonb;
begin
  if (jsonb_typeof(p_value) = 'object') is not true then return false; end if;
  if octet_length(p_value::text) > 1048576 then return false; end if;
  if regexp_replace(p_value::text, '\\[nrt]', ' ', 'g') ~ '(^|[^0-9])(0[0-9]{1,2}[[:space:].()+-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4}|[+]82[[:space:].()-]*0?[0-9]{1,2}[[:space:].()-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4})([^0-9]|$)' then return false; end if;
  if (p_value - 'label' - 'at' - 'blocked' - 'issues' - 'classes' = '{}'::jsonb
    and jsonb_typeof(p_value->'label') = 'string' and length(btrim(p_value->>'label')) between 1 and 100
    and jsonb_typeof(p_value->'at') = 'string'
    and p_value->>'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and jsonb_typeof(p_value->'blocked') = 'boolean'
    and jsonb_typeof(p_value->'issues') = 'array'
    and jsonb_typeof(p_value->'classes') = 'array') is not true then return false; end if;
  perform (p_value->>'at')::timestamptz;
  if jsonb_array_length(p_value->'issues') > 200 or jsonb_array_length(p_value->'classes') > 200 then return false; end if;
  for item in select value from jsonb_array_elements(p_value->'issues') loop
    if (jsonb_typeof(item) = 'string' and length(btrim(item #>> '{}')) between 1 and 2000) is not true then return false; end if;
  end loop;
  if (select count(*) <> count(distinct value->>'class_id') from jsonb_array_elements(p_value->'classes')) then return false; end if;
  for c in select value from jsonb_array_elements(p_value->'classes') loop
    if (jsonb_typeof(c) = 'object') is not true then return false; end if;
    if (c - 'class_id' - 'label' - 'students' = '{}'::jsonb
      and jsonb_typeof(c->'class_id') = 'string' and length(btrim(c->>'class_id')) between 1 and 100
      and jsonb_typeof(c->'label') = 'string' and length(btrim(c->>'label')) between 1 and 100
      and jsonb_typeof(c->'students') = 'array') is not true then return false; end if;
    if jsonb_array_length(c->'students') > 1000 then return false; end if;
    for s in select value from jsonb_array_elements(c->'students') loop
      if (jsonb_typeof(s) = 'object') is not true then return false; end if;
      if (s - 'name' - 'attendance' - 'clinic' - 'score' - 'retest' - 'homework' - 'absence_dates' = '{}'::jsonb
        and jsonb_typeof(s->'name') = 'string' and length(btrim(s->>'name')) between 1 and 100
        and s->>'attendance' in ('등원','미등원','시험지만 수령','확인 불가')
        and s->>'clinic' in ('입력완료','미입력','확인 불가')
        and jsonb_typeof(s->'score') in ('number','null')
        and jsonb_typeof(s->'retest') = 'boolean'
        and s->>'homework' in ('완료','미완','없음')
        and jsonb_typeof(s->'absence_dates') = 'array') is not true then return false; end if;
      if jsonb_array_length(s->'absence_dates') > 366 then return false; end if;
      for item in select value from jsonb_array_elements(s->'absence_dates') loop
        if (jsonb_typeof(item) = 'string' and item #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') is not true then return false; end if;
        perform (item #>> '{}')::date;
      end loop;
    end loop;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function public.ops_valid_weekly(jsonb) from public, anon, authenticated;

create table public.ops_weekly (
  id text primary key default 'current' check (id = 'current'),
  week jsonb not null check (public.ops_valid_weekly(week)),
  updated_at timestamptz not null default now()
);
alter table public.ops_weekly enable row level security;
revoke all on public.ops_weekly from public, anon, authenticated;
-- No anon/authenticated table policies or table grants. Only authenticated RPC paths below.

create or replace function public.ops_pc(p_token text, p_action text, p_row jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare approval public.sms_approvals%rowtype; saved_roster jsonb; total integer; item jsonb;
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from public.sms_approval_publishers where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'PUBLISHER_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('roster','board','weekly') then raise exception 'APPROVAL_ACTION_INVALID'; end if;
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

create or replace function public.ops_teacher(p_password text, p_action text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare teacher jsonb; teacher_id text; candidate record; result jsonb;
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
  if p_action is null or p_action not in ('pending','board','history','weekly') then raise exception 'APPROVAL_ACTION_INVALID'; end if;
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
revoke all on function public.ops_teacher(text,text) from public;
grant execute on function public.ops_teacher(text,text) to anon, authenticated;
commit;
