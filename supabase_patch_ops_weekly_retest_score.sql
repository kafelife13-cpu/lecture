-- 2026-11-21 이번 주 명단 학생별 재시험 점수(retest_score) 허용. 현재 운영 정의(video_weeks 포함)에 칸 하나만 추가.
begin;
CREATE OR REPLACE FUNCTION public.ops_valid_weekly(p_value jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare c jsonb; s jsonb; item jsonb; w jsonb;
begin
  if (jsonb_typeof(p_value) = 'object') is not true then return false; end if;
  if octet_length(p_value::text) > 1048576 then return false; end if;
  if regexp_replace(p_value::text, '\\[nrt]', ' ', 'g') ~ '(^|[^0-9])(0[0-9]{1,2}[[:space:].()+-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4}|[+]82[[:space:].()-]*0?[0-9]{1,2}[[:space:].()-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4})([^0-9]|$)' then return false; end if;
  if (p_value - 'label' - 'at' - 'blocked' - 'issues' - 'classes' = '{}'::jsonb
    and jsonb_typeof(p_value->'label') = 'string' and length(btrim(p_value->>'label')) between 1 and 100
    and jsonb_typeof(p_value->'at') = 'string'
    and p_value->>'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and jsonb_typeof(p_value->'blocked') = 'boolean'
    and jsonb_typeof(p_value->'issues') = 'array'
    and jsonb_typeof(p_value->'classes') = 'array') is not true then return false; end if;
  perform (p_value->>'at')::timestamptz;
  if jsonb_array_length(p_value->'issues') > 200 or jsonb_array_length(p_value->'classes') > 200 then return false; end if;
  for item in select value from jsonb_array_elements(p_value->'issues') loop
    if (jsonb_typeof(item) = 'string' and length(btrim(item #>> '{}')) between 1 and 2000) is not true then return false; end if;
  end loop;
  if (select count(*) <> count(distinct value->>'class_id') from jsonb_array_elements(p_value->'classes')) then return false; end if;
  for c in select value from jsonb_array_elements(p_value->'classes') loop
    if (jsonb_typeof(c) = 'object') is not true then return false; end if;
    if (c - 'class_id' - 'label' - 'students' = '{}'::jsonb
      and jsonb_typeof(c->'class_id') = 'string' and length(btrim(c->>'class_id')) between 1 and 100
      and jsonb_typeof(c->'label') = 'string' and length(btrim(c->>'label')) between 1 and 100
      and jsonb_typeof(c->'students') = 'array') is not true then return false; end if;
    if jsonb_array_length(c->'students') > 1000 then return false; end if;
    for s in select value from jsonb_array_elements(c->'students') loop
      if (jsonb_typeof(s) = 'object') is not true then return false; end if;
      if (s - 'name' - 'attendance' - 'clinic' - 'score' - 'retest' - 'homework' - 'absence_dates' - 'video' - 'video_percent' - 'video_weeks' - 'retest_score' = '{}'::jsonb
        and jsonb_typeof(s->'name') = 'string' and length(btrim(s->>'name')) between 1 and 100
        and s->>'attendance' in ('등원','미등원','시험지만 수령','확인 불가')
        and s->>'clinic' in ('입력완료','미입력','확인 불가')
        and jsonb_typeof(s->'score') in ('number','null')
        and jsonb_typeof(s->'retest') = 'boolean'
        and s->>'homework' in ('완료','미완','없음')
        and jsonb_typeof(s->'absence_dates') = 'array') is not true then return false; end if;
      -- 구형 업로드는 두 칸 모두 생략 가능. 하나만 존재하면 거부한다.
      if s ? 'video' or s ? 'video_percent' then
        if (s ? 'video' and s ? 'video_percent'
          and jsonb_typeof(s->'video') = 'string' and s->>'video' in ('완료','미완','없음')
          and jsonb_typeof(s->'video_percent') in ('number','null')) is not true then return false; end if;
        if jsonb_typeof(s->'video_percent') = 'number' then
          if (s->>'video_percent')::numeric < 0 or (s->>'video_percent')::numeric > 100
            or trunc((s->>'video_percent')::numeric) <> (s->>'video_percent')::numeric then return false; end if;
        end if;
        if s->>'video' = '없음' and s->'video_percent' <> 'null'::jsonb then return false; end if;
      end if;
      -- 주차별 영상: [{week:1~20 정수, video:완료/미완/없음, percent:0~100 정수 또는 없음이면 null}] 최대 20개, 주차 중복 금지.
      if s ? 'video_weeks' then
        if (jsonb_typeof(s->'video_weeks') = 'array' and jsonb_array_length(s->'video_weeks') <= 20) is not true then return false; end if;
        if (select count(*) <> count(distinct value->>'week') from jsonb_array_elements(s->'video_weeks')) then return false; end if;
        for w in select value from jsonb_array_elements(s->'video_weeks') loop
          if (jsonb_typeof(w) = 'object' and w - 'week' - 'video' - 'percent' = '{}'::jsonb
            and jsonb_typeof(w->'week') = 'number' and jsonb_typeof(w->'video') = 'string'
            and w->>'video' in ('완료','미완','없음')
            and jsonb_typeof(w->'percent') in ('number','null')) is not true then return false; end if;
          if trunc((w->>'week')::numeric) <> (w->>'week')::numeric or (w->>'week')::numeric < 1 or (w->>'week')::numeric > 20 then return false; end if;
          if w->>'video' = '없음' then
            if w->'percent' <> 'null'::jsonb then return false; end if;
          else
            if jsonb_typeof(w->'percent') <> 'number' or trunc((w->>'percent')::numeric) <> (w->>'percent')::numeric
              or (w->>'percent')::numeric < 0 or (w->>'percent')::numeric > 100 then return false; end if;
          end if;
        end loop;
      end if;
      -- 11/21 재시험 점수: 생략 가능, 있으면 0~100 숫자 또는 null.
      if s ? 'retest_score' then
        if jsonb_typeof(s->'retest_score') not in ('number','null') then return false; end if;
        if jsonb_typeof(s->'retest_score') = 'number' and ((s->>'retest_score')::numeric < 0 or (s->>'retest_score')::numeric > 100) then return false; end if;
      end if;
      if jsonb_array_length(s->'absence_dates') > 366 then return false; end if;
      for item in select value from jsonb_array_elements(s->'absence_dates') loop
        if (jsonb_typeof(item) = 'string' and item #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') is not true then return false; end if;
        perform (item #>> '{}')::date;
      end loop;
    end loop;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$function$;
revoke all on function public.ops_valid_weekly(jsonb) from public, anon, authenticated;
commit;
