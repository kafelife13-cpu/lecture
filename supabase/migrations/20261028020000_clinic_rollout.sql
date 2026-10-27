begin;
-- Start with papers newly registered this week. Historical papers never become pickup targets.
create or replace function public.clinic_home_weeks(sid text) returns jsonb
language sql stable security definer set search_path=public as $$
 with papers as (
 select e.id::text id,e.name,
 case when e.clinic_week ~ '[0-9]+\s*주차' then substring(e.clinic_week from '([0-9]+)\s*주차')::integer::text||'주차 클리닉'
 when e.clinic_week ~ '^\s*[0-9]+\s*$' then trim(e.clinic_week)::integer::text||'주차 클리닉'
 else trim(e.clinic_week)||case when e.clinic_week like '%클리닉%' then '' else ' 클리닉' end end week
 from public.exams e join public.users u on u.id::text=sid
 left join public.qa_schools s on s.id=u.school_id
 where e.created_at >= timestamptz '2026-10-26 00:00:00+09' and e.category='school' and nullif(trim(e.clinic_week),'') is not null
 and (e.clinic_school=u.school_id or e.clinic_school=s.name
 or (u.school_id='sc_hanbaek' and e.clinic_school like '%한백%')
 or (u.school_id='sc_chidong' and e.clinic_school like '%치동%'))
 ), weeks as (select week,jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) exams from papers group by week)
 select coalesce(jsonb_agg(jsonb_build_object('week',week,'exams',exams) order by coalesce(substring(week from '^([0-9]+)')::integer,99999),week),'[]') from weeks;
$$;
revoke all on function public.clinic_home_weeks(text) from public,anon,authenticated;
commit;
