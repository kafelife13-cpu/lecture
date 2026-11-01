-- Store the existing personal-room webhook in Vault as qa_jandi_webhook first.
-- No historical questions are replayed. Enable after the rollback-only check.
create or replace function public.notify_qa_jandi()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  webhook text;
  school_name text;
  week_name text;
begin
  if new.status is distinct from 'pending'
     or new.school_id is null or new.school_id not in ('sc_hanbaek','sc_chidong')
     or new.created_at is null
     or new.created_at < timestamptz '2026-11-01 13:13:41+00' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if row(new.id,new.question,new.status,new.created_at)
       is not distinct from row(old.id,old.question,old.status,old.created_at) then
      return new;
    end if;
  end if;
  select decrypted_secret into webhook from vault.decrypted_secrets
    where name = 'qa_jandi_webhook';
  if webhook is null then raise exception 'qa_jandi_webhook is not configured'; end if;
  select name into school_name from public.qa_schools where id = new.school_id;
  select name into week_name from public.qa_weeks where id = new.week_id;
  perform net.http_post(
    url := webhook,
    headers := jsonb_build_object('Content-Type','application/json',
      'Accept','application/vnd.tosslab.jandi-v2+json'),
    body := jsonb_build_object(
      'body','[국어왕 새 과제 QnA] ' || coalesce(nullif(new.student_name,''),'학생') || E'\nhttps://kafelife13-cpu.github.io/lecture/',
      'connectColor','#4F7CFF',
      'connectInfo',jsonb_build_array(
        jsonb_build_object('title','학교 · 과제 · 문항','description',
          coalesce(school_name,new.school_id) || ' · ' || coalesce(week_name,'자유질문') ||
          case when new.prob_num is null then '' else ' · ' || new.prob_num::text || '번' end),
        jsonb_build_object('title','질문','description',left(coalesce(new.question,''),800))
      )
    ), timeout_milliseconds := 10000
  );
  return new;
exception when others then
  -- A notification outage must not prevent a student's question being saved.
  raise warning 'QnA JANDI enqueue failed for question %, SQLSTATE %',new.id,sqlstate;
  return new;
end;
$$;
revoke all on function public.notify_qa_jandi() from public, anon, authenticated;
drop trigger if exists qa_jandi_notify on public.qa_questions;
create trigger qa_jandi_notify after insert or update on public.qa_questions
  for each row execute function public.notify_qa_jandi();
alter table public.qa_questions disable trigger qa_jandi_notify;
