begin;
select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='qa_questions';
alter table public.grammar_ox_attempts add column if not exists target_question_id text;
alter table public.grammar_ox_attempts add column if not exists is_review_success boolean not null default false;
create table if not exists public.grammar_ox_questions (
 id text primary key,
 student_id text not null,
 question_id text not null,
 body text not null check (char_length(btrim(body)) between 1 and 300),
 created_at timestamptz not null default now(),
 seen_at timestamptz,
 reply text check (reply is null or char_length(reply)<=3000)
);
create unique index if not exists grammar_ox_questions_one_unseen on public.grammar_ox_questions(student_id,question_id) where seen_at is null;
create index if not exists grammar_ox_questions_student_date on public.grammar_ox_questions(student_id,created_at desc);
do $$
declare src record; p record; a record; role_names text; command_name text;
begin
 select * into src from pg_class where oid=to_regclass('public.qa_questions');
 if not found then raise exception 'qa_questions missing: cannot verify existing access policy'; end if;
 if exists(select 1 from pg_attribute where attrelid=src.oid and attacl is not null) then
  raise exception 'qa_questions has column-specific grants: inspect these before migrating';
 end if;
 -- Clear only this new table's policies and default grants before matching source.
 for p in select polname from pg_policy where polrelid='public.grammar_ox_questions'::regclass loop
  execute format('drop policy %I on public.grammar_ox_questions',p.polname);
 end loop;
 for a in select distinct grantee from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) where c.oid='public.grammar_ox_questions'::regclass loop
  execute format('revoke all on public.grammar_ox_questions from %s',case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end);
 end loop;
 for a in select * from aclexplode(coalesce(src.relacl,acldefault('r',src.relowner))) loop
  execute format('grant %s on public.grammar_ox_questions to %s%s',a.privilege_type,case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end,case when a.is_grantable then ' with grant option' else '' end);
 end loop;
 for p in select *,pg_get_expr(polqual,polrelid) as using_expr,pg_get_expr(polwithcheck,polrelid) as check_expr from pg_policy where polrelid=src.oid loop
  select string_agg(case when r=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(r)) end,',') into role_names from unnest(p.polroles) r;
  command_name=case p.polcmd when '*' then 'ALL' when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' end;
  -- A policy referring to old-table-only columns will fail and roll back safely.
  execute format('create policy %I on public.grammar_ox_questions as %s for %s to %s%s%s',p.polname,case when p.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,command_name,role_names,case when p.using_expr is null then '' else ' using ('||p.using_expr||')' end,case when p.check_expr is null then '' else ' with check ('||p.check_expr||')' end);
 end loop;
 execute 'alter table public.grammar_ox_questions '||case when src.relrowsecurity then 'enable' else 'disable' end||' row level security';
 execute 'alter table public.grammar_ox_questions '||case when src.relforcerowsecurity then 'force' else 'no force' end||' row level security';
end $$;
notify pgrst, 'reload schema';
commit;
