-- Released 2026-11-18 by teacher ("운영 반영해").
-- Legacy app login is not Supabase Auth: auth.uid() cannot identify these users.
-- RLS denies direct anon/authenticated table access. The teacher RPC below is
-- the sole browser path and checks the existing server-side password verifier.
begin;

create table public.sms_approvals (
  id text primary key,
  job text not null check (job in ('clinic-missing-evening','clinic-missing-morning')),
  slot timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  recipient_count integer not null check (recipient_count > 0),
  preview jsonb not null check (jsonb_typeof(preview) = 'object'
    and jsonb_typeof(preview->'examples') = 'array'
    and jsonb_array_length(preview->'examples') between 1 and 2
    and jsonb_typeof(preview->'classes') = 'array'
    and jsonb_array_length(preview->'classes') > 0
    and preview - 'examples' - 'classes' = '{}'::jsonb
    and preview::text !~ '01[016789][ -]?[0-9]{3,4}[ -]?[0-9]{4}'),
  plan_digest text not null check (plan_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  decided_at timestamptz,
  decided_by text,
  unique(job, slot),
  check (created_at < slot and expires_at > slot and expires_at <= slot + interval '15 minutes'),
  check ((status in ('pending','expired') and decided_at is null and decided_by is null)
    or (status in ('approved','rejected') and decided_by is not null and decided_at >= created_at and decided_at < expires_at))
);
alter table public.sms_approvals enable row level security;
revoke all on public.sms_approvals from public, anon, authenticated;
grant select, insert, update on public.sms_approvals to service_role;

create function public.sms_approval_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'APPROVAL_MUST_START_PENDING'; end if;
  elsif old.status <> 'pending'
    or new.status not in ('approved','rejected','expired')
    or (to_jsonb(new) - 'status' - 'decided_at' - 'decided_by') is distinct from
       (to_jsonb(old) - 'status' - 'decided_at' - 'decided_by') then
    raise exception 'APPROVAL_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger sms_approval_immutable before insert or update on public.sms_approvals
for each row execute function public.sms_approval_immutable();

create function public.sms_approval_rpc(p_id text, p_password text, p_action text, p_request_id text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare teacher jsonb; saved public.sms_approvals%rowtype; result jsonb;
begin
  teacher := public.authenticate_user(p_id, p_password, 'teacher');
  if teacher is null or teacher->>'role' is distinct from 'teacher'
    or teacher->>'status' is distinct from 'active' then
    raise exception 'TEACHER_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('list','approve','reject') then
    raise exception 'APPROVAL_ACTION_INVALID';
  end if;
  update public.sms_approvals set status = 'expired'
    where status = 'pending' and expires_at <= clock_timestamp();
  if p_action = 'list' then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.slot desc), '[]'::jsonb) into result
    from (select * from public.sms_approvals where slot >= now() - interval '7 days'
      order by slot desc limit 100) a;
    return result;
  end if;
  -- Row lock prevents a second phone/tab from changing an already-made decision.
  select * into saved from public.sms_approvals where id = p_request_id for update;
  if not found then raise exception 'APPROVAL_NOT_FOUND'; end if;
  if saved.status = 'pending' and saved.expires_at > clock_timestamp() then
    update public.sms_approvals set
      status = case when p_action = 'approve' then 'approved' else 'rejected' end,
      decided_at = clock_timestamp(), decided_by = p_id
      where id = saved.id returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.sms_approval_rpc(text,text,text,text) from public;
grant execute on function public.sms_approval_rpc(text,text,text,text) to anon, authenticated;
revoke all on function public.sms_approval_immutable() from public;
comment on table public.sms_approvals is 'Anonymous previews and immutable teacher decisions only; approval itself does not send SMS.';
-- Academy PC path: no service_role key on the PC. The PC holds a random token
-- (DPAPI-protected locally); only its sha256 is stored here, inserted
-- separately and never committed to the repository.
create table public.sms_approval_publishers (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  label text not null,
  created_at timestamptz not null default now()
);
alter table public.sms_approval_publishers enable row level security;
revoke all on public.sms_approval_publishers from public, anon, authenticated;

create function public.sms_approval_pc(p_token text, p_action text, p_row jsonb default null, p_id text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare saved public.sms_approvals%rowtype;
begin
  if p_token is null or length(p_token) < 32 or not exists (
    select 1 from public.sms_approval_publishers where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'PUBLISHER_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_action = 'create' then
    insert into public.sms_approvals (id, job, slot, created_at, expires_at, recipient_count, preview, plan_digest)
    values (p_row->>'id', p_row->>'job', (p_row->>'slot')::timestamptz, (p_row->>'created_at')::timestamptz,
      (p_row->>'expires_at')::timestamptz, (p_row->>'recipient_count')::integer, p_row->'preview', p_row->>'plan_digest')
    on conflict (job, slot) do nothing;
    select * into saved from public.sms_approvals where id = p_row->>'id';
  elsif p_action = 'get' then
    select * into saved from public.sms_approvals where id = p_id;
  elsif p_action = 'expire' then
    update public.sms_approvals set status = 'expired'
      where id = p_id and status = 'pending' and expires_at <= clock_timestamp();
    select * into saved from public.sms_approvals where id = p_id;
  else
    raise exception 'APPROVAL_ACTION_INVALID';
  end if;
  if not found then return null; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.sms_approval_pc(text,text,jsonb,text) from public;
grant execute on function public.sms_approval_pc(text,text,jsonb,text) to anon, authenticated;

-- Push queue is intentionally not written by this migration or RPC. Existing
-- push_queue is broadly writable; teacher-only delivery needs separate review.
commit;
