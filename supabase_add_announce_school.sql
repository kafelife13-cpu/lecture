-- 과제 안내를 학교별로 다르게 올릴 수 있도록 school_id 컬럼 추가.
-- Supabase 대시보드 → SQL Editor → New query에 붙여넣고 실행하세요.
alter table announcements add column if not exists school_id text; -- null = 전체 공지(모든 학교)
