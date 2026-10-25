-- Run once in the same Supabase project's SQL editor as ox_attempts.
-- Inspect the live source policy/ACL first; copy it rather than guess access.
begin;
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename='ox_attempts';
select grantee, privilege_type, is_grantable from information_schema.table_privileges
where table_schema='public' and table_name='ox_attempts';

create table if not exists public.grammar_ox_attempts (
 id text primary key,
 student_id text not null,
 set_id text not null,
 question_id text not null,
 topic text not null,
 choice smallint not null check (choice in (0,1)),
 is_correct boolean not null,
 submitted_at timestamptz not null default now(),
 unique(set_id,question_id)
);
create index if not exists grammar_ox_student_submitted_idx
 on public.grammar_ox_attempts(student_id, submitted_at desc);

do $$
declare src record; p record; a record; role_names text; command_name text;
begin
 select * into src from pg_class where oid=to_regclass('public.ox_attempts');
 if not found then raise exception 'ox_attempts missing: cannot verify existing access policy'; end if;
 if exists(select 1 from pg_attribute where attrelid=src.oid and attacl is not null) then
  raise exception 'ox_attempts has column-specific grants: inspect these before migrating';
 end if;
 -- Clear only this new table's policies and default grants before matching source.
 for p in select polname from pg_policy where polrelid='public.grammar_ox_attempts'::regclass loop
  execute format('drop policy %I on public.grammar_ox_attempts',p.polname);
 end loop;
 for a in select distinct grantee from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) where c.oid='public.grammar_ox_attempts'::regclass loop
  execute format('revoke all on public.grammar_ox_attempts from %s',case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end);
 end loop;
 for a in select * from aclexplode(coalesce(src.relacl,acldefault('r',src.relowner))) loop
  execute format('grant %s on public.grammar_ox_attempts to %s%s',a.privilege_type,case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,case when a.is_grantable then ' with grant option' else '' end);
 end loop;
 for p in select *,pg_get_expr(polqual,polrelid) as using_expr,pg_get_expr(polwithcheck,polrelid) as check_expr from pg_policy where polrelid=src.oid loop
  select string_agg(case when r=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(r)) end,',') into role_names from unnest(p.polroles) r;
  command_name=case p.polcmd when '*' then 'ALL' when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' end;
  -- A policy referring to old-table-only columns will fail and roll back safely.
  execute format('create policy %I on public.grammar_ox_attempts as %s for %s to %s%s%s',p.polname,case when p.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,command_name,role_names,case when p.using_expr is null then '' else ' using ('||p.using_expr||')' end,case when p.check_expr is null then '' else ' with check ('||p.check_expr||')' end);
 end loop;
 execute 'alter table public.grammar_ox_attempts '||case when src.relrowsecurity then 'enable' else 'disable' end||' row level security';
 execute 'alter table public.grammar_ox_attempts '||case when src.relforcerowsecurity then 'force' else 'no force' end||' row level security';
end $$;
notify pgrst, 'reload schema';
commit;
