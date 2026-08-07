-- 과제 안내에 이미지를 여러 장(2장 이상) 첨부할 수 있도록 컬럼 추가.
-- 기존 image_url(단일)은 그대로 두고 호환용으로 유지, 새로 image_urls
-- (JSON 배열 문자열)를 추가해서 여러 장을 저장합니다.
-- Supabase 대시보드 → SQL Editor → New query에 붙여넣고 실행하세요.
alter table announcements add column if not exists image_urls text; -- JSON: ["url1","url2",...]
