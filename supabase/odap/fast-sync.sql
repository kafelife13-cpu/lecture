-- Constant-time revision reads; statement triggers cover edits, additions and removals.
create table if not exists public.odap_revisions(key text primary key, revision uuid not null default gen_random_uuid());
alter table public.odap_revisions enable row level security;
revoke all on public.odap_revisions from anon,authenticated;
insert into public.odap_revisions(key) values('shared') on conflict do nothing;
create or replace function public.odap_touch_revision() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.odap_revisions set revision=gen_random_uuid() where key='shared';
 return null;
end $$;
revoke all on function public.odap_touch_revision() from public,anon,authenticated;
do $$declare t text;begin
 foreach t in array array['users','qa_schools','exams','exam_responses','qa_materials','qa_questions','weekly_homework','weekly_homework_work','ox_questions','ox_attempts','vocab_units','vocab_responses','special_tests','special_test_results','odap_sources','odap_questions','odap_evidence','odap_mappings','odap_notes','odap_generated','odap_packets'] loop
  if to_regclass('public.'||t) is not null then
   execute format('drop trigger if exists odap_revision_changed on public.%I',t);
   execute format('create trigger odap_revision_changed after insert or update or delete or truncate on public.%I for each statement execute function public.odap_touch_revision()',t);
  end if;
 end loop;
end $$;
create or replace function public.odap_external_revision() returns text language sql security definer set search_path=public as $$select revision::text from public.odap_revisions where key='shared'$$;
revoke all on function public.odap_external_revision() from public,anon,authenticated;
-- Upgrade older installations without copying or scanning existing question bodies.
do $$declare definition text;begin
 select pg_get_functiondef('public.odap_rpc(text,text,text,text,jsonb)'::regprocedure) into definition;
 definition:=regexp_replace(definition,'return to_jsonb\(md5\(concat\([\s\S]*?\)\)\);','return to_jsonb(public.odap_external_revision());');
 definition:=replace(definition,'jsonb_agg(body order by archived_at)','jsonb_agg(odap_attempts.body order by archived_at)');
 definition:=replace(definition,'to_jsonb(n)','to_jsonb(n.*)');
 execute definition;
end $$;
