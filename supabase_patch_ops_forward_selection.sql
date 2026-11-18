-- PREPARED ONLY. Do not execute as part of this change.
-- Apply after supabase_add_ops_daily.sql and supabase_patch_ops_daily_source.sql.
-- PC scheduled.key = 's-' + SHA256(JSON.stringify(['ops-daily-student', String(user.id)]))
-- with hexadecimal digits 0..f mapped to letters a..p (64 letters). This avoids
-- phone-like digit runs, carries no name/contact, and remains stable across days.
-- Old snapshots without keys stay valid; new PC uploads always include unique keys.
-- forward: {clinic_date, updated_at, selected: [key, ...], resend_of?: lastSentId}.
-- Omitted selected preserves legacy full-target calls; []/null/duplicates/foreign,
-- arrived or exam-completed keys are rejected. Only selected targets are frozen.
-- reject: {clinic_date, updated_at}; records rejected, never enqueues a send.
-- Existing ops_pc forward-list already filters status='pending': rejected is excluded.
-- PC must send only the frozen request.day, never re-read sources. Text remains
-- day.label + ' 미등원\n' + names.join(', ') + ' (' + count + '명)'.
begin;

alter table public.ops_forward_requests drop constraint ops_forward_requests_status_check;
alter table public.ops_forward_requests add constraint ops_forward_requests_status_check
  check (status in ('pending','sent','failed','rejected'));
alter table public.ops_forward_requests drop constraint ops_forward_requests_check;
alter table public.ops_forward_requests add constraint ops_forward_requests_check
  check ((status = 'pending' and done_at is null) or (status in ('sent','failed','rejected') and done_at is not null));

create or replace function public.ops_valid_daily(p_value jsonb)
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
    if (s - 'key' - 'name' - 'class_label' - 'start' - 'arrived' - 'arrived_at' - 'arrived_by' - 'macgai_record' - 'exam_done' = '{}'::jsonb
      and jsonb_typeof(s->'name') = 'string' and length(btrim(s->>'name')) between 1 and 100
      and jsonb_typeof(s->'class_label') = 'string' and length(btrim(s->>'class_label')) between 1 and 100
      and jsonb_typeof(s->'start') = 'string' and s->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and jsonb_typeof(s->'arrived') = 'boolean' and jsonb_typeof(s->'exam_done') = 'boolean'
      and (s->'arrived_at' = 'null'::jsonb or (jsonb_typeof(s->'arrived_at') = 'string'
        and s->>'arrived_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$')))
      is not true then return false; end if;
    if s ? 'key' and (jsonb_typeof(s->'key') = 'string' and s->>'key' ~ '^s-[a-p]{64}$') is not true then return false; end if;
    if ((s->'arrived' = 'true'::jsonb) = (s->'arrived_at' <> 'null'::jsonb)) is not true then return false; end if;
    if s ? 'arrived_by' or s ? 'macgai_record' then
      if (s ? 'arrived_by' and s ? 'macgai_record'
        and jsonb_typeof(s->'macgai_record') = 'boolean'
        and (s->'arrived_by' = 'null'::jsonb or s->>'arrived_by' in ('맥가이','패드'))
        and ((s->'arrived' = 'true'::jsonb) = (s->'arrived_by' <> 'null'::jsonb))
        and (s->>'arrived_by' is distinct from '맥가이' or s->'macgai_record' = 'true'::jsonb))
        is not true then return false; end if;
    end if;
    if s->'arrived_at' <> 'null'::jsonb then perform (s->>'arrived_at')::timestamptz; end if;
  end loop;
  if (select count(*) <> count(distinct entry.value->>'key') from jsonb_array_elements(p_value->'scheduled') entry where entry.value ? 'key') then return false; end if;
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

create or replace function public.ops_teacher(p_password text, p_action text, p_arg jsonb default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare teacher jsonb; teacher_id text; candidate record; result jsonb; selected_date date; daily public.ops_daily%rowtype; request public.ops_forward_requests%rowtype; snapshot jsonb; chosen jsonb;
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
  if p_action is null or p_action not in ('pending','board','history','weekly','daily','forward','reject') then raise exception 'APPROVAL_ACTION_INVALID'; end if;
  if p_action in ('daily','forward','reject') then
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
    if (p_arg - 'clinic_date' - 'updated_at' - 'resend_of' - 'selected' = '{}'::jsonb
      and jsonb_typeof(p_arg->'updated_at') = 'string'
      and p_arg->>'updated_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and (not (p_arg ? 'resend_of') or (jsonb_typeof(p_arg->'resend_of') = 'string'
        and p_arg->>'resend_of' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')))
      is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    if p_action = 'reject' and (p_arg ? 'selected' or p_arg ? 'resend_of') then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    if p_arg ? 'selected' then
      if (jsonb_typeof(p_arg->'selected') = 'array') is not true then raise exception 'OPS_SELECTION_INVALID'; end if;
      if jsonb_array_length(p_arg->'selected') not between 1 and 10000
        or exists (select 1 from jsonb_array_elements(p_arg->'selected') k where
          (jsonb_typeof(k) = 'string' and k #>> '{}' ~ '^s-[a-p]{64}$') is not true)
        or (select count(*) <> count(distinct value) from jsonb_array_elements(p_arg->'selected'))
        then raise exception 'OPS_SELECTION_INVALID'; end if;
    end if;
    -- Serialize initial requests and resends for this date, including concurrent phones.
    select * into daily from public.ops_daily where clinic_date = selected_date for update;
    if not found then raise exception 'OPS_DAILY_NOT_FOUND'; end if;
    -- Preserve source array order; the client cannot inject students or rewrite the day.
    select coalesce(jsonb_agg(s order by ordinal), '[]'::jsonb) into chosen
      from jsonb_array_elements(daily.day->'scheduled') with ordinality as students(s, ordinal)
      where s->'arrived' = 'false'::jsonb and s->'exam_done' = 'false'::jsonb
        and (not (p_arg ? 'selected') or p_arg->'selected' @> jsonb_build_array(s->>'key'));
    if p_arg ? 'selected' and jsonb_array_length(chosen) <> jsonb_array_length(p_arg->'selected') then
      raise exception 'OPS_SELECTION_INVALID';
    end if;
    select * into request from public.ops_forward_requests where clinic_date = selected_date and kind = 'jandi-attendance'
      order by (status = 'pending') desc, requested_at desc, id desc limit 1 for update;
    -- A queued request may already be in flight on the PC. Never promise cancellation.
    -- Reject also cannot erase a sent result or bypass its double-confirmation resend.
    if found and (request.status = 'pending' or (request.status = 'sent' and
      (p_action = 'reject' or (p_arg->>'resend_of')::uuid is distinct from request.id))
      or (request.status = 'rejected' and p_action = 'reject')) then return to_jsonb(request) - 'day'; end if;
    if daily.updated_at is distinct from (p_arg->>'updated_at')::timestamptz then
      raise exception 'OPS_DAILY_CHANGED' using errcode = '40001';
    end if;
    if p_action = 'forward' and jsonb_array_length(chosen) = 0 then raise exception 'OPS_FORWARD_EMPTY'; end if;
    snapshot := jsonb_set(daily.day, '{scheduled}', chosen);
    insert into public.ops_forward_requests(clinic_date, kind, requested_at, requested_by, day, status, done_at)
      values(selected_date, 'jandi-attendance', clock_timestamp(), teacher_id, snapshot,
        case when p_action = 'reject' then 'rejected' else 'pending' end,
        case when p_action = 'reject' then clock_timestamp() else null end) returning * into request;
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
