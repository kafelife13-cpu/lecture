-- 학생 계정(users)에 학부모 연락처 칸을 추가합니다.
-- 시험 결과 화면의 "📨 학부모 발송" 탭에서 이 번호로 문자 문구를 만들고,
-- 발송용 엑셀을 내보낼 때도 이 칸의 값을 씁니다.
-- Supabase 대시보드 → SQL Editor → New query에 붙여넣고 실행하세요.
alter table users add column if not exists parent_phone text;
