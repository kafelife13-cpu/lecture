insert into public.consultation_slots(starts_at,ends_at)
select t,t+interval '15 minutes' from (
select generate_series('2026-10-22 22:00+09'::timestamptz,'2026-10-22 22:45+09',interval '15 minutes') t
union all select generate_series('2026-10-23 22:00+09'::timestamptz,'2026-10-23 22:45+09',interval '15 minutes')
union all select generate_series('2026-10-25 22:00+09'::timestamptz,'2026-10-25 22:45+09',interval '15 minutes')
) s on conflict (starts_at) do nothing;
