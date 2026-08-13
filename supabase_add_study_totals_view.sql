-- 공부 타이머 확장성 대비: 학생별 "누적" 총 공부시간을 서버에서 미리
-- 합산해두는 뷰. 학생이 많아지고 기록이 쌓여도(수천~수만 행) 이 뷰를
-- 조회하면 항상 "학생 수" 만큼의 행만 돌아오므로 가볍습니다.
-- Supabase 대시보드 → SQL Editor → New query에 붙여넣고 실행하세요.
create or replace view study_totals as
select
  student_id,
  extract(epoch from sum(coalesce(end_time, now()) - start_time))::bigint as total_seconds,
  count(*) as session_count
from study_sessions
group by student_id;

grant select on study_totals to anon, authenticated;
