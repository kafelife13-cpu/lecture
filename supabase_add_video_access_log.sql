-- 복습영상 시청 권한을 "언제 누구한테 부여했는지" 영구 기록하는 로그 테이블.
-- 기존 video_access 테이블은 권한 해제 시 행이 삭제되고, 같은 학생에게
-- 같은 영상을 다시 부여하면 이전 기록을 덮어써서(upsert) 주차별 이력이
-- 남지 않는 문제가 있었습니다. 이 테이블은 절대 삭제/덮어쓰기 없이
-- 매 부여마다 새 행을 추가만 합니다(해제 시엔 revoked_at만 채움).
-- Supabase 대시보드 → SQL Editor → New query에 붙여넣고 실행하세요.
create table if not exists video_access_log (
  id          text primary key,
  student_id  text not null,
  video_id    text not null,
  granted_at  timestamptz not null,
  revoked_at  timestamptz
);
alter table video_access_log enable row level security;
create policy "public full access" on video_access_log for all using (true) with check (true);
