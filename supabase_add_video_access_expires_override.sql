-- 특정 학생만 예외적으로 마감 시각을 다르게 주기 위한 컬럼.
-- 값이 있으면 평소 규칙(부여 시점 기준 금요일 밤 12시) 대신 이 값을
-- 그대로 마감 시각으로 씁니다.
-- Supabase 대시보드 → SQL Editor → New query에 붙여넣고 실행하세요.
alter table video_access add column if not exists expires_at timestamptz;
