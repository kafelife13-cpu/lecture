-- Apply after migration.sql in the existing Supabase project.
insert into storage.buckets(id,name,public,file_size_limit)
values('odap-private','odap-private',false,41943040)
on conflict(id) do nothing;

create or replace function public.odap_scheduled_daily() returns void language plpgsql security definer set search_path=public as $$
declare s record;
begin
 if not coalesce((select value::text::boolean from public.odap_settings where key='daily'),false) then return;end if;
 for s in select id::text id from public.users where role='student' and status='active' loop
  begin perform public.odap_daily(s.id);
  exception when others then insert into public.odap_audit(actor,action,detail) values('scheduler','generation_error',jsonb_build_object('student_id',s.id,'error',left(sqlerrm,200)));end;
 end loop;
end $$;
revoke all on function public.odap_scheduled_daily() from public,anon,authenticated;
-- pg_cron must be enabled for persistent daily generation, independent of the teacher PC.
create extension if not exists pg_cron;
select cron.schedule('odap-daily-generation','0 19 * * *','select public.odap_scheduled_daily();');
-- 19:00 UTC = 04:00 Asia/Seoul. odap_runs uniqueness makes retries idempotent.
