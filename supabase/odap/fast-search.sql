-- Search text separately from embedded images and source metadata.
alter table public.odap_questions add column if not exists search_text text generated always as (
 coalesce(body->>'text','')||' '||coalesce(body->>'passage','')||' '||coalesce(body->>'choices','')||' '||coalesce(body->>'explanation','')||' '||coalesce(body->>'concepts','')||' '||coalesce(body->>'source_title','')||' '||coalesce(body->>'school','')
) stored;
do $$declare definition text;begin
 select pg_get_functiondef('public.odap_rpc(text,text,text,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'q.body::text ilike','q.search_text ilike');
 execute definition;
end $$;
analyze public.odap_questions;
