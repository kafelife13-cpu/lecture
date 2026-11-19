-- 서로국어 운영앱: 오늘 체크리스트 + 문자 문구 수정 + 새 문자 요청 (2026-11-19 선생님 "진행해")
-- 영상명단_켜기.ps1이 함께 실행한다. 여러 번 실행해도 된다.
begin;

create table if not exists public.ops_checklist (
  id text primary key default 'main' check (id = 'main'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 600000
    and data::text !~ '01[016789][ -]?[0-9]{3,4}[ -]?[0-9]{4}'),
  updated_at timestamptz not null default now()
);
create table if not exists public.sms_templates (
  job text not null check (job in ('clinic-missing-evening','clinic-missing-morning','clinic-retest-friday','video-incomplete-thursday')),
  recipient_type text not null check (recipient_type in ('student','parent')),
  variant text not null default '' check (variant in ('','재시험','미입력')),
  body text not null check (length(body) between 10 and 1000
    and body ~ '\{이름\}'
    and body !~ '\{(?!이름\}|날짜\}|사유\}|일요일\}|시각\}|퍼센트\})'
    and body !~ '01[016789][ -]?[0-9]{3,4}[ -]?[0-9]{4}'
    and body !~* 'https?://'),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (job, recipient_type, variant)
);
create table if not exists public.sms_requests (
  id uuid primary key default gen_random_uuid(),
  body text not null check (length(body) between 5 and 1000 and body !~ '01[016789][ -]?[0-9]{3,4}[ -]?[0-9]{4}'),
  target text not null check (length(target) between 1 and 200),
  when_text text not null check (length(when_text) between 1 and 100),
  created_at timestamptz not null default now(),
  created_by text not null,
  status text not null default 'pending' check (status in ('pending','done','rejected'))
);
alter table public.ops_checklist enable row level security;
alter table public.sms_templates enable row level security;
alter table public.sms_requests enable row level security;
revoke all on public.ops_checklist, public.sms_templates, public.sms_requests from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ops_pc(p_token text, p_action text, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare approval public.sms_approvals%rowtype; saved_roster jsonb; total integer; item jsonb; request public.ops_forward_requests%rowtype;
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from public.sms_approval_publishers where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'PUBLISHER_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('roster','board','weekly','daily','forward-list','forward-done','checklist','templates') then raise exception 'APPROVAL_ACTION_INVALID'; end if;
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
  elsif p_action = 'checklist' then
    if (p_row - 'data' = '{}'::jsonb and jsonb_typeof(p_row->'data') = 'object') is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    insert into public.ops_checklist(id, data, updated_at) values('main', p_row->'data', clock_timestamp())
      on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
  elsif p_action = 'templates' then
    if p_row <> '{}'::jsonb then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    return jsonb_build_object(
      'templates', (select coalesce(jsonb_agg(jsonb_build_object('job', t.job, 'recipient_type', t.recipient_type, 'variant', t.variant, 'body', t.body, 'updated_at', t.updated_at) order by t.job, t.recipient_type, t.variant), '[]'::jsonb) from public.sms_templates t),
      'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'target', r.target, 'when_text', r.when_text, 'created_at', r.created_at) order by r.created_at), '[]'::jsonb) from public.sms_requests r where r.status = 'pending'));
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
$function$;

CREATE OR REPLACE FUNCTION public.ops_teacher(p_password text, p_action text, p_arg jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  if p_action is null or p_action not in ('pending','board','history','weekly','daily','forward','reject','checklist','templates','template_save','template_reset','sms_request','videos','clinic_watch') then raise exception 'APPROVAL_ACTION_INVALID'; end if;
  -- 11/19: 영상 시청 조회(주차별 영상대체 / 보강신청 / 클리닉 해설강의). 국어왕 시청률 기준.
  if p_action = 'videos' then
    if p_arg is not null and ((jsonb_typeof(p_arg) = 'object' and p_arg - 'days' = '{}'::jsonb
      and jsonb_typeof(p_arg->'days') = 'number' and (p_arg->>'days')::int between 1 and 120) is not true) then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    with tv as (
      select v.id, v.title, v.category, v.created_at,
        substring(v.description from '\[학교:([a-z_]+)\]') school,
        case when v.description ~ '\[시험:[^\]]+\]' then regexp_split_to_array(substring(v.description from '\[시험:([^\]]+)\]'), '\s*,\s*') end exams
      from public.videos v where v.category in ('makeup','clinic') and v.created_at >= now() - make_interval(days => coalesce((p_arg->>'days')::int, 21))
    ), rows as (
      select 'replacement' kind, u.name student, u.school_id school, g.name grp, v.title, a.granted_at at, a.absence_date, a.expires_at, coalesce(pr.percent, 0) percent, pr.updated_at watched_at
      from public.video_access a join public.videos v on v.id = a.video_id
        join public.users u on u.id = a.student_id and u.role = 'student' and u.status = 'active'
        left join public.groups g on g.id = u.group_id
        left join public.progress pr on pr.student_id = a.student_id and pr.video_id = a.video_id
      where a.access_kind = 'replacement' and a.granted_at >= now() - make_interval(days => coalesce((p_arg->>'days')::int, 21))
      union all
      select tv.category, u.name, u.school_id, g.name, tv.title, tv.created_at, null, null, coalesce(pr.percent, 0), pr.updated_at
      from tv join public.users u on u.role = 'student' and u.status = 'active' and (tv.school is null or u.school_id = tv.school)
        left join public.groups g on g.id = u.group_id
        left join public.progress pr on pr.student_id = u.id and pr.video_id = tv.id
      where tv.exams is null or exists (select 1 from public.exam_responses r where r.student_id::text = u.id::text and r.exam_id::text = any(tv.exams))
    )
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'student', student, 'school', school, 'group', grp, 'title', title,
      'at', at, 'absence_date', absence_date, 'expires_at', expires_at, 'percent', percent, 'watched_at', watched_at) order by at desc, title, student), '[]'::jsonb) into result from rows;
    return result;
  elsif p_action = 'clinic_watch' then
    -- 해설강의 번호별 시청: 시험 태그가 있는 클리닉 영상별로 응시 학생의 답안과 시청 초(초 단위 배열)를 준다.
    with tv as (
      select v.id, v.title, v.url, v.created_at,
        regexp_split_to_array(substring(v.description from '\[시험:([^\]]+)\]'), '\s*,\s*') exams
      from public.videos v where v.category = 'clinic' and v.description ~ '\[시험:[^\]]+\]' and v.created_at >= now() - interval '60 days'
    )
    select coalesce(jsonb_agg(jsonb_build_object('video_id', tv.id, 'title', tv.title, 'url', tv.url, 'created_at', tv.created_at,
      'exams', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'questions',
          (select coalesce(jsonb_agg(jsonb_build_object('num', q->'num', 'answer', q->'answer', 'type', q->'type')), '[]'::jsonb) from jsonb_array_elements(e.questions) q))), '[]'::jsonb)
        from public.exams e where e.id::text = any(tv.exams)),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('student', u.name, 'school', u.school_id, 'group', g.name, 'exam_id', r.exam_id, 'score', r.score, 'answers', r.answers,
          'watch', (select coalesce(jsonb_agg(jsonb_build_object('source_id', w.source_id, 'seconds', w.seconds, 'updated_at', w.updated_at)), '[]'::jsonb)
            from public.video_chapter_watch w where w.student_id::text = u.id::text and w.video_id::text = tv.id::text)) order by g.name, u.name), '[]'::jsonb)
        from (select distinct on (r.student_id) r.* from public.exam_responses r where r.exam_id::text = any(tv.exams) order by r.student_id, array_position(tv.exams, r.exam_id::text)) r
          join public.users u on u.id::text = r.student_id::text and u.role = 'student' and u.status = 'active'
          left join public.groups g on g.id = u.group_id)
    ) order by tv.created_at desc), '[]'::jsonb) into result from tv;
    return result;
  end if;
  -- 11/19: 오늘 체크리스트·문자 문구·새 문자 요청
  if p_action = 'checklist' then
    select jsonb_build_object('data', data, 'updated_at', updated_at) into result from public.ops_checklist where id = 'main';
    return result;
  elsif p_action = 'templates' then
    return jsonb_build_object(
      'templates', (select coalesce(jsonb_agg(jsonb_build_object('job', t.job, 'recipient_type', t.recipient_type, 'variant', t.variant, 'body', t.body, 'updated_at', t.updated_at) order by t.job, t.recipient_type, t.variant), '[]'::jsonb) from public.sms_templates t),
      'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'target', r.target, 'when_text', r.when_text, 'created_at', r.created_at, 'status', r.status) order by r.created_at desc), '[]'::jsonb) from (select * from public.sms_requests order by created_at desc limit 30) r));
  elsif p_action in ('template_save','template_reset') then
    if (jsonb_typeof(p_arg) = 'object' and jsonb_typeof(p_arg->'job') = 'string' and jsonb_typeof(p_arg->'recipient_type') = 'string'
      and jsonb_typeof(p_arg->'variant') = 'string'
      and ((p_action = 'template_save' and p_arg - 'job' - 'recipient_type' - 'variant' - 'body' = '{}'::jsonb and jsonb_typeof(p_arg->'body') = 'string')
        or (p_action = 'template_reset' and p_arg - 'job' - 'recipient_type' - 'variant' = '{}'::jsonb))) is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    if p_action = 'template_reset' then
      delete from public.sms_templates where job = p_arg->>'job' and recipient_type = p_arg->>'recipient_type' and variant = p_arg->>'variant';
    else
      insert into public.sms_templates(job, recipient_type, variant, body, updated_at, updated_by)
        values(p_arg->>'job', p_arg->>'recipient_type', p_arg->>'variant', p_arg->>'body', clock_timestamp(), teacher_id)
        on conflict (job, recipient_type, variant) do update set body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    end if;
    return jsonb_build_object('ok', true);
  elsif p_action = 'sms_request' then
    if (jsonb_typeof(p_arg) = 'object' and p_arg - 'body' - 'target' - 'when_text' = '{}'::jsonb
      and jsonb_typeof(p_arg->'body') = 'string' and jsonb_typeof(p_arg->'target') = 'string' and jsonb_typeof(p_arg->'when_text') = 'string') is not true then raise exception 'OPS_PAYLOAD_INVALID'; end if;
    insert into public.sms_requests(body, target, when_text, created_by) values(p_arg->>'body', p_arg->>'target', p_arg->>'when_text', teacher_id);
    return jsonb_build_object('ok', true);
  end if;
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
$function$;
commit;
