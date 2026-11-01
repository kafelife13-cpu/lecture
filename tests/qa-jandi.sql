-- Run in SQL Editor. pg_net only sends after commit, so this test sends nothing.
begin;
create temp table qa_jandi_check (like public.qa_questions including defaults);
create trigger qa_jandi_check_trigger after insert or update on qa_jandi_check
  for each row execute function public.notify_qa_jandi();
do $$
declare n bigint;
begin
  select count(*) into n from net.http_request_queue;
  insert into qa_jandi_check(id,school_id,week_id,student_id,student_name,question,status,created_at)
    values('qa_jandi_check','sc_hanbaek','free','test','연동 점검','새 질문 점검','pending',now());
  if (select count(*) from net.http_request_queue) <> n+1 then raise exception 'new question must enqueue once'; end if;
  update qa_jandi_check set question=question;
  if (select count(*) from net.http_request_queue) <> n+1 then raise exception 'identical retry must not enqueue'; end if;
  update qa_jandi_check set status='answered',teacher_reply='답변';
  if (select count(*) from net.http_request_queue) <> n+1 then raise exception 'teacher reply must not enqueue'; end if;
  update qa_jandi_check set status='pending',question='추가 질문';
  if (select count(*) from net.http_request_queue) <> n+2 then raise exception 'new follow-up must enqueue'; end if;
  insert into qa_jandi_check(id,school_id,week_id,student_id,student_name,question,status,created_at)
    values('old_check','sc_hanbaek','free','test','연동 점검','과거 질문','pending','2026-10-01');
  if (select count(*) from net.http_request_queue) <> n+2 then raise exception 'historical question must not enqueue'; end if;
end $$;
rollback;
select 'PASS: new/follow-up once, duplicate/reply/history ignored; no messages sent' as result;
