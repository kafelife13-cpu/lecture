-- 2026-11-20 선생님 요청: 운영앱 '출석부' 탭(이번 주 맥가이 정규반 출결 + 클리닉 등원·시험지 입력).
-- 기존 ops_pc / ops_teacher 함수는 건드리지 않고 별도 테이블·함수 두 개만 추가한다.
-- PC: ops_pc_attendance(token, book)  /  앱: ops_teacher_attendance(password) → {book, updated_at}
-- 전화번호 모양 문자열이 들어 있으면 저장을 거부한다.
begin;

create table if not exists public.ops_attendance (
  id text primary key default 'current' check (id = 'current'),
  book jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.ops_attendance enable row level security;
revoke all on public.ops_attendance from public, anon, authenticated;

create or replace function public.ops_valid_attendance(p jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public as $$
begin
  if (jsonb_typeof(p) = 'object') is not true then return false; end if;
  if octet_length(p::text) > 1048576 then return false; end if;
  if p::text ~ '(^|[^0-9])(01[016789][[:space:].-]*[0-9]{3,4}[[:space:].-]*[0-9]{4}|0[2-6][0-9]?[[:space:].-]*[0-9]{3,4}[[:space:].-]*[0-9]{4})([^0-9]|$)' then return false; end if;
  if (jsonb_typeof(p->'label') = 'string' and jsonb_typeof(p->'at') = 'string'
      and jsonb_typeof(p->'issues') = 'array' and jsonb_typeof(p->'regular') = 'array'
      and jsonb_typeof(p->'clinic') = 'array') is not true then return false; end if;
  perform (p->>'at')::timestamptz;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.ops_valid_attendance(jsonb) from public, anon, authenticated;

create or replace function public.ops_pc_attendance(p_token text, p_row jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from public.sms_approval_publishers where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'PUBLISHER_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not public.ops_valid_attendance(p_row) then raise exception 'ATTENDANCE_INVALID'; end if;
  insert into public.ops_attendance(id, book, updated_at) values ('current', p_row, now())
    on conflict (id) do update set book = excluded.book, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.ops_pc_attendance(text, jsonb) from public;
grant execute on function public.ops_pc_attendance(text, jsonb) to anon, authenticated;

create or replace function public.ops_teacher_attendance(p_password text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare teacher jsonb; teacher_id text; candidate record; result jsonb;
begin
  if p_password is not null and length(p_password) > 0 then
    for candidate in select id from public.users where role = 'teacher' and status = 'active' order by id loop
      teacher := public.authenticate_user(candidate.id, p_password, 'teacher');
      if teacher->>'role' = 'teacher' and teacher->>'status' = 'active' then teacher_id := candidate.id; exit; end if;
    end loop;
  end if;
  if teacher_id is null then raise exception 'TEACHER_AUTH_REQUIRED' using errcode = '42501'; end if;
  select jsonb_build_object('book', book, 'updated_at', updated_at) into result from public.ops_attendance where id = 'current';
  return result;
end;
$$;
revoke all on function public.ops_teacher_attendance(text) from public;
grant execute on function public.ops_teacher_attendance(text) to anon, authenticated;

commit;
