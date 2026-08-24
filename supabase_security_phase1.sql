-- 1단계: 기존 로그인을 유지하면서 비밀번호 검증을 서버로 이동합니다.
create extension if not exists pgcrypto;

alter table public.users
  add column if not exists pw_hash text;

update public.users
set pw_hash = crypt(pw, gen_salt('bf', 10))
where pw is not null
  and pw <> ''
  and (pw_hash is null or pw_hash = '');

create or replace function public.sync_user_password_hash()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'INSERT' and new.pw is not null and new.pw <> '' then
    new.pw_hash := crypt(new.pw, gen_salt('bf', 10));
  elsif tg_op = 'UPDATE' and new.pw is distinct from old.pw and new.pw is not null and new.pw <> '' then
    new.pw_hash := crypt(new.pw, gen_salt('bf', 10));
  end if;
  return new;
end;
$$;

drop trigger if exists users_sync_password_hash on public.users;
create trigger users_sync_password_hash
before insert or update of pw on public.users
for each row execute function public.sync_user_password_hash();

create or replace function public.authenticate_user(
  p_id text,
  p_password text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  matched_user public.users%rowtype;
begin
  if p_id is null or p_password is null or p_role not in ('teacher','student') then
    return null;
  end if;

  select * into matched_user
  from public.users
  where id = p_id
    and role = p_role
    and pw_hash is not null
    and pw_hash = crypt(p_password, pw_hash)
  limit 1;

  if not found then
    return null;
  end if;

  return to_jsonb(matched_user) - 'pw' - 'pw_hash' - 'parent_phone';
end;
$$;

revoke all on function public.authenticate_user(text,text,text) from public;
grant execute on function public.authenticate_user(text,text,text) to anon, authenticated;

comment on function public.authenticate_user(text,text,text)
is 'Validates a legacy app account server-side and never returns password fields.';
