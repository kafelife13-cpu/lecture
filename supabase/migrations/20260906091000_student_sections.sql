begin;
alter table public.video_access add column if not exists expires_at timestamptz;
alter table public.video_access add column if not exists access_kind text not null default 'review' check(access_kind in ('review','replacement','clinic'));
alter table public.video_access add column if not exists absence_date date;
alter table public.video_access_log add column if not exists access_kind text not null default 'review' check(access_kind in ('review','replacement','clinic'));
alter table public.video_access_log add column if not exists absence_date date;
alter table public.announcements add column if not exists notice_kind text not null default 'general' check(notice_kind in ('general','clinic'));
-- Legacy grants/announcements stay in their existing category until a teacher explicitly changes them.
commit;
