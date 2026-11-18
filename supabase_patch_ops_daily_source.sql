-- Prepared only; not executed. Apply after supabase_add_ops_daily.sql.
-- Existing reviewed snapshots are preserved; no tables, RPCs or grants are widened.
begin;

create or replace function public.ops_valid_daily(p_value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public as $$
declare s jsonb; item jsonb;
begin
  if (jsonb_typeof(p_value) = 'object') is not true then return false; end if;
  if octet_length(p_value::text) > 1048576 then return false; end if;
  if regexp_replace(p_value::text, '\\[nrt]', ' ', 'g') ~ '(^|[^0-9])(0[0-9]{1,2}[[:space:].()+-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4}|[+]82[[:space:].()-]*0?[0-9]{1,2}[[:space:].()-]*[0-9]{3,4}[[:space:].()-]*[0-9]{4})([^0-9]|$)' then return false; end if;
  if (p_value - 'label' - 'at' - 'issues' - 'scheduled' - 'unresolved' - 'sms' = '{}'::jsonb
    and jsonb_typeof(p_value->'label') = 'string' and length(btrim(p_value->>'label')) between 1 and 100
    and jsonb_typeof(p_value->'at') = 'string'
    and p_value->>'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and jsonb_typeof(p_value->'unresolved') = 'number' and p_value->>'unresolved' ~ '^[0-9]{1,6}$'
    and jsonb_typeof(p_value->'issues') = 'array'
    and jsonb_typeof(p_value->'scheduled') = 'array'
    and jsonb_typeof(p_value->'sms') = 'array') is not true then return false; end if;
  perform (p_value->>'at')::timestamptz;
  if jsonb_array_length(p_value->'issues') > 200 or jsonb_array_length(p_value->'scheduled') > 10000
    or jsonb_array_length(p_value->'sms') > 10000 then return false; end if;
  for item in select value from jsonb_array_elements(p_value->'issues') loop
    if (jsonb_typeof(item) = 'string' and length(btrim(item #>> '{}')) between 1 and 2000) is not true then return false; end if;
  end loop;
  for s in select value from jsonb_array_elements(p_value->'scheduled') loop
    if (jsonb_typeof(s) = 'object') is not true then return false; end if;
    if (s - 'name' - 'class_label' - 'start' - 'arrived' - 'arrived_at' - 'arrived_by' - 'macgai_record' - 'exam_done' = '{}'::jsonb
      and jsonb_typeof(s->'name') = 'string' and length(btrim(s->>'name')) between 1 and 100
      and jsonb_typeof(s->'class_label') = 'string' and length(btrim(s->>'class_label')) between 1 and 100
      and jsonb_typeof(s->'start') = 'string' and s->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and jsonb_typeof(s->'arrived') = 'boolean' and jsonb_typeof(s->'exam_done') = 'boolean'
      and (s->'arrived_at' = 'null'::jsonb or (jsonb_typeof(s->'arrived_at') = 'string'
        and s->>'arrived_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$')))
      is not true then return false; end if;
    if ((s->'arrived' = 'true'::jsonb) = (s->'arrived_at' <> 'null'::jsonb)) is not true then return false; end if;
    if s ? 'arrived_by' or s ? 'macgai_record' then
      if (s ? 'arrived_by' and s ? 'macgai_record'
        and jsonb_typeof(s->'macgai_record') = 'boolean'
        and (s->'arrived_by' = 'null'::jsonb or s->>'arrived_by' in ('맥가이','패드'))
        and ((s->'arrived' = 'true'::jsonb) = (s->'arrived_by' <> 'null'::jsonb))
        and (s->>'arrived_by' is distinct from '맥가이' or s->'macgai_record' = 'true'::jsonb))
        is not true then return false; end if;
    end if;
    if s->'arrived_at' <> 'null'::jsonb then perform (s->>'arrived_at')::timestamptz; end if;
  end loop;
  for s in select value from jsonb_array_elements(p_value->'sms') loop
    if (jsonb_typeof(s) = 'object') is not true then return false; end if;
    if (s - 'name' - 'class_label' - 'recipients' = '{}'::jsonb
      and jsonb_typeof(s->'name') = 'string' and length(btrim(s->>'name')) between 1 and 100
      and jsonb_typeof(s->'class_label') = 'string' and length(btrim(s->>'class_label')) between 1 and 100
      and jsonb_typeof(s->'recipients') = 'array') is not true then return false; end if;
    if jsonb_array_length(s->'recipients') not between 1 and 2 or not (s->'recipients' <@ '["student","parent"]'::jsonb)
      or (select count(*) <> count(distinct value) from jsonb_array_elements(s->'recipients')) then return false; end if;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function public.ops_valid_daily(jsonb) from public, anon, authenticated;

commit;
