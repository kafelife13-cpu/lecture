-- NOT EXECUTED: apply after supabase_add_sms_approvals.sql by the operator.
-- PC contracts (no phone numbers, passwords, tokens or raw command output):
-- ops_pc(token, 'roster', {"approval_id":"...","roster":{"classes":[
--   {"class_id":"...","label":"반 이름","students":[{"name":"학생 이름","recipients":["student","parent"]}]}]}})
-- ops_pc(token, 'board', {"board":{
--   "items":[{"name":"작업 이름","status":"됨|진행중|대기|실패|선생님할일","memo":"메모"}],
--   "tasks":[{"name":"예약 작업","last_run_at":"2026-11-18T09:00:00+09:00","result":"성공|실패"}],
--   "sent_counts":{"approval-id":3}}})
-- sent_counts is optional: publish a complete seven-day snapshot of actual sent counts (including zero) from PC logs.
-- Missing counts remain NULL/미집계, never inferred from approval or recipient_count.
-- No checklist.json producer exists in this repository; items/tasks above define its upload adapter contract.
begin;

create function public.ops_valid_payload(p_kind text, p_value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public as $$
declare c jsonb; s jsonb; item jsonb;
begin
  if (jsonb_typeof(p_value) = 'object') is not true then return false; end if;
  if octet_length(p_value::text) > 1048576 then return false; end if;
  if regexp_replace(p_value::text, '\\[nrt]', ' ', 'g') ~ '(^|[^0-9])(0[0-9]{1,2}[[:space:].()+-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4}|[+]82[[:space:].()-]*0?[0-9]{1,2}[[:space:].()-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4})([^0-9]|$)' then return false; end if;
  if p_kind = 'roster' then
    if (p_value - 'classes' = '{}'::jsonb and jsonb_typeof(p_value->'classes') = 'array') is not true then return false; end if;
    if jsonb_array_length(p_value->'classes') not between 1 and 200 then return false; end if;
    if (select count(*) <> count(distinct value->>'class_id') from jsonb_array_elements(p_value->'classes')) then return false; end if;
    for c in select value from jsonb_array_elements(p_value->'classes') loop
      if (jsonb_typeof(c) = 'object') is not true then return false; end if;
      if (c - 'class_id' - 'label' - 'students' = '{}'::jsonb
        and jsonb_typeof(c->'class_id') = 'string' and length(btrim(c->>'class_id')) between 1 and 100
        and jsonb_typeof(c->'label') = 'string' and length(btrim(c->>'label')) between 1 and 100
        and jsonb_typeof(c->'students') = 'array') is not true then return false; end if;
      if jsonb_array_length(c->'students') not between 1 and 1000 then return false; end if;
      for s in select value from jsonb_array_elements(c->'students') loop
        if (jsonb_typeof(s) = 'object') is not true then return false; end if;
        if (s - 'name' - 'recipients' = '{}'::jsonb
          and jsonb_typeof(s->'name') = 'string' and length(btrim(s->>'name')) between 1 and 100
          and jsonb_typeof(s->'recipients') = 'array') is not true then return false; end if;
        if jsonb_array_length(s->'recipients') not between 1 and 2
          or not (s->'recipients' <@ '["student","parent"]'::jsonb)
          or (select count(*) <> count(distinct value) from jsonb_array_elements(s->'recipients')) then return false; end if;
      end loop;
    end loop;
  elsif p_kind = 'board' then
    if (p_value - 'items' - 'tasks' - 'sent_counts' = '{}'::jsonb
      and jsonb_typeof(p_value->'items') = 'array' and jsonb_typeof(p_value->'tasks') = 'array') is not true then return false; end if;
    if jsonb_array_length(p_value->'items') > 500 or jsonb_array_length(p_value->'tasks') > 500 then return false; end if;
    for item in select value from jsonb_array_elements(p_value->'items') loop
      if (jsonb_typeof(item) = 'object') is not true then return false; end if;
      if (item - 'name' - 'status' - 'memo' = '{}'::jsonb
        and jsonb_typeof(item->'name') = 'string' and length(btrim(item->>'name')) between 1 and 200
        and item->>'status' in ('됨','진행중','대기','실패','선생님할일')
        and jsonb_typeof(item->'memo') = 'string' and length(item->>'memo') <= 2000) is not true then return false; end if;
    end loop;
    for item in select value from jsonb_array_elements(p_value->'tasks') loop
      if (jsonb_typeof(item) = 'object') is not true then return false; end if;
      if (item - 'name' - 'last_run_at' - 'result' = '{}'::jsonb
        and jsonb_typeof(item->'name') = 'string' and length(btrim(item->>'name')) between 1 and 200
        and jsonb_typeof(item->'last_run_at') = 'string'
        and item->>'last_run_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
        and item->>'result' in ('성공','실패')) is not true then return false; end if;
    end loop;
    if p_value ? 'sent_counts' then
      if (jsonb_typeof(p_value->'sent_counts') = 'object') is not true then return false; end if;
      if exists (select 1 from jsonb_each(p_value->'sent_counts')
        where length(key) not between 1 and 200 or jsonb_typeof(value) <> 'number' or value::text !~ '^[0-9]{1,9}$') then return false; end if;
    end if;
  else return false;
  end if;
  return true;
end;
$$;
revoke all on function public.ops_valid_payload(text,jsonb) from public, anon, authenticated;

create table public.ops_rosters (
  approval_id text primary key references public.sms_approvals(id),
  roster jsonb not null check (public.ops_valid_payload('roster', roster)),
  created_at timestamptz not null default now()
);
create table public.ops_board (
  id text primary key default 'main' check (id = 'main'),
  board jsonb not null check (public.ops_valid_payload('board', board)),
  updated_at timestamptz not null default now()
);
alter table public.ops_rosters enable row level security;
alter table public.ops_board enable row level security;
revoke all on public.ops_rosters, public.ops_board from public, anon, authenticated;
-- No anon/authenticated table policies or table grants. Only the RPCs below.

create function public.ops_pc(p_token text, p_action text, p_row jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare approval public.sms_approvals%rowtype; saved_roster jsonb; total integer; item jsonb;
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from public.sms_approval_publishers where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'PUBLISHER_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('roster','board') then raise exception 'APPROVAL_ACTION_INVALID'; end if;
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

create function public.ops_teacher(p_password text, p_action text)
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
  if p_action is null or p_action not in ('pending','board','history') then raise exception 'APPROVAL_ACTION_INVALID'; end if;
  if p_action = 'pending' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'job', a.job, 'slot', a.slot, 'expires_at', a.expires_at,
      'status', a.status, 'recipient_count', a.recipient_count, 'preview', a.preview, 'roster', r.roster
    ) order by a.slot), '[]'::jsonb) into result
    from public.sms_approvals a left join public.ops_rosters r on r.approval_id = a.id
    where a.status = 'pending' and a.expires_at > clock_timestamp();
    return jsonb_build_object('teacher_id', teacher_id, 'approvals', result);
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
