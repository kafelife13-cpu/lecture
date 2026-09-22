-- Supabase PostgreSQL deployment: run after fast-search.sql.
-- PGlite fixture tests do not include the pg_trgm extension.
create extension if not exists pg_trgm with schema extensions;
do $$declare ext_schema text;begin
 select n.nspname into ext_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
 execute format('create index if not exists odap_questions_search_trgm_idx on public.odap_questions using gin(search_text %I.gin_trgm_ops)',ext_schema);
end $$;
