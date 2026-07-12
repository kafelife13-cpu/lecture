-- 성적표(리포트) 기능 추가를 위한 스키마 변경
-- Supabase 대시보드 > SQL Editor 에서 실행하세요.

alter table exams add column if not exists grade_cuts jsonb default '[]'::jsonb;
alter table exam_responses add column if not exists points_earned numeric;
alter table exam_responses add column if not exists points_total numeric;
