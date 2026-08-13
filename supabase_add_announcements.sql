-- 과제 안내(공지) 기능. 텍스트 + 선택적으로 이미지 1장을 첨부해 올리고,
-- 학생들이 앱 안에서 확인하도록 합니다(문자로는 잘 안 보는 문제 보완용).
-- Supabase 대시보드 → SQL Editor → New query에 붙여넣고 실행하세요.
create table if not exists announcements (
  id         text primary key,       -- 'an_'+Date.now()
  title      text,
  content    text,
  image_url  text,                   -- 선택: 첨부 이미지 공개 URL
  created_at timestamptz default now()
);
create table if not exists announcement_reads (
  id              text primary key,  -- 'anr_'+Date.now()
  announcement_id text not null,
  student_id      text not null,
  read_at         timestamptz default now(),
  unique (announcement_id, student_id)
);
alter table announcements       enable row level security;
alter table announcement_reads  enable row level security;
create policy "public full access" on announcements      for all using (true) with check (true);
create policy "public full access" on announcement_reads for all using (true) with check (true);
