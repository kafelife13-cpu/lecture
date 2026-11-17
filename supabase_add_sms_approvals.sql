-- LOCAL REVIEW ONLY: do not execute on production until the supervisor releases it.
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
-- Push queue is intentionally not written by this migration or RPC. Existing
-- push_queue is broadly writable; teacher-only delivery needs separate review.
commit;
