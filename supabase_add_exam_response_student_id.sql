-- 학생별 약점 분석의 동명이인 분리를 위한 안전한 보강입니다.
-- 기존 채점 기록은 삭제하거나 덮어쓰지 않습니다.

alter table public.exam_responses
  add column if not exists student_id text;

-- 이름이 정확히 한 명에게만 대응하는 기존 기록만 자동 연결합니다.
update public.exam_responses r
set student_id = u.id::text
from public.users u
where r.student_id is null
  and u.role = 'student'
  and u.name = r.student_name
  and 1 = (
    select count(*)
    from public.users u2
    where u2.role = 'student'
      and u2.name = r.student_name
  );

create index if not exists exam_responses_student_id_idx
  on public.exam_responses (student_id);

create index if not exists exam_responses_submitted_at_idx
  on public.exam_responses (submitted_at desc);

