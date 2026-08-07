-- 공부 타이머 세션에 "이탈 감지" 기록을 추가합니다.
-- Supabase 대시보드 → SQL Editor → New query에 붙여넣고 실행하세요.
alter table study_sessions add column if not exists away_log text;       -- JSON: [{start,end,sec}, ...]
alter table study_sessions add column if not exists away_seconds integer default 0;
