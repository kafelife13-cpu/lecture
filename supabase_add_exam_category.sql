-- 모의고사 인증 코너 추가를 위한 스키마 변경
-- Supabase 대시보드 > SQL Editor 에서 실행하세요.

alter table exams add column if not exists category text default 'school';
update exams set category = 'school' where category is null;
