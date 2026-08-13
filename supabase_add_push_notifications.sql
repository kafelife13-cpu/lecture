-- 웹 푸시 알림 기능에 필요한 테이블 두 개.
-- Supabase 대시보드 → SQL Editor → New query에 붙여넣고 실행하세요.

-- 학생이 "🔔 알림 받기"를 누르면 그 브라우저(기기)의 구독 정보가 여기 저장됩니다.
-- 같은 학생이 여러 기기에서 눌러도 각각 별도 행으로 쌓여서(endpoint가 기기별로 다름) 다 알림이 가요.
create table if not exists push_subscriptions (
  id          text primary key,
  student_id  text not null,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy "public full access" on push_subscriptions for all using (true) with check (true);

-- 선생님이 "알림 보내기" 화면에서 만든 발송 요청. GitHub Actions가 5분마다
-- sent_at이 비어있는 행을 찾아서 실제로 웹 푸시를 보내고 sent_at을 채웁니다.
-- target_ids가 null이면 전체 학생, 배열이면 그 학생들에게만 보냅니다.
create table if not exists push_queue (
  id          text primary key,
  title       text not null,
  body        text not null,
  target_ids  jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
alter table push_queue enable row level security;
create policy "public full access" on push_queue for all using (true) with check (true);
