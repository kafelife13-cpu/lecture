alter table public.users add column if not exists student_phone text;

create table if not exists public.video_watch_reminders (
  id text primary key,
  access_id text not null unique,
  student_id text not null,
  video_id text not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','skipped','failed')),
  recipient_count integer not null default 0,
  provider_reference text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists video_watch_reminders_due_idx
  on public.video_watch_reminders(status,due_at);

alter table public.video_watch_reminders enable row level security;
drop policy if exists "video reminder worker access" on public.video_watch_reminders;
create policy "video reminder worker access" on public.video_watch_reminders
  for all using (true) with check (true);

