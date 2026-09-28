-- Source-grounded practice drafts. These do not approve or replace bank questions.
create table if not exists public.odap_homework_templates(id text primary key,concept text not null,statement text not null,stage text not null,body jsonb not null);
alter table public.odap_homework_templates enable row level security;
revoke all on public.odap_homework_templates from public,anon,authenticated;
insert into public.odap_homework_templates values
('adnominal-basic','관형절','관형절은 문장에서 관형어로 기능한다.','개념','{"text":"다음 문장에서 관형절과 그 관형절이 꾸미는 말을 각각 쓰시오.\n나는 [동생이 만든] 모형을 보았다.","answer":"관형절: 동생이 만든 / 꾸미는 말: 모형","explanation":"동생이 만든은 명사 모형을 꾸미는 관형어 구실을 하는 절이다. 절 안의 주어 동생이와 서술어 만든을 함께 확인한다.","choices":[]}'),
('adnominal-extension','관형절','관형절은 문장에서 관형어로 기능한다.','확장','{"text":"㉠과 ㉡ 중 안긴절이 관형어로 기능하는 문장을 고르고, 다른 문장의 안긴절이 담당하는 기능을 설명하시오.\n㉠ 나는 [친구가 추천한] 책을 읽었다.\n㉡ 나는 [친구가 추천했음]을 알았다.","answer":"㉠ / ㉡의 명사절은 목적어로 기능한다.","explanation":"㉠의 친구가 추천한은 책을 꾸민다. ㉡의 친구가 추천했음은 명사절이며 목적격 조사 을과 결합해 알았다의 목적어가 된다. 발문에 비슷한 서술어가 있어도 문장에서 맡는 기능으로 구분한다.","choices":[]}'),
('adverb-basic','부사어','부사어는 부사, 체언과 부사격 조사의 결합, 용언의 활용형 등으로 실현될 수 있다.','개념','{"text":"각 문장의 부사어와 그 실현 방식을 쓰시오.\n㉠ 아이가 빨리 달렸다.\n㉡ 아이가 운동장에서 달렸다.\n㉢ 아이가 힘차게 달렸다.","answer":"㉠ 빨리: 부사 / ㉡ 운동장에서: 체언과 부사격 조사 / ㉢ 힘차게: 용언의 활용형","explanation":"부사어는 문장 성분 이름이며 부사는 품사 이름이다. 빨리뿐 아니라 운동장에서와 힘차게도 달렸다를 수식하는 부사어이다.","choices":[]}'),
('adverb-extension','부사어','부사어는 용언뿐 아니라 다른 부사어나 관형어를 수식하기도 한다.','확장','{"text":"매우 또는 바로가 수식하는 말과 그 말의 문장 성분을 각각 쓰시오.\n㉠ 꽃이 매우 아름답다.\n㉡ 아이가 매우 빨리 달린다.\n㉢ 그는 바로 그 책을 샀다.","answer":"㉠ 아름답다: 서술어 / ㉡ 빨리: 부사어 / ㉢ 그: 관형어","explanation":"부사어는 용언만 수식하지 않는다. ㉡에서는 다른 부사어 빨리를, ㉢에서는 관형어 그를 수식한다. 수식받는 단어의 품사와 문장 성분을 혼동하지 않도록 한다.","choices":[]}'),
('valency-basic','서술어의 자릿수','서술어가 필요로 하는 문장 성분의 개수를 서술어의 자릿수라고 한다.','개념','{"text":"서술어의 자릿수를 셀 때 포함할 대상을 고르고 이유를 쓰시오.","choices":["문장에 실제 나타난 모든 성분","서술어의 의미가 필수적으로 요구하는 성분","주어를 제외한 모든 성분"],"answer":"2","explanation":"서술어의 자릿수는 필수적으로 요구되는 성분의 개수다. 꾸미는 말이 추가됐다고 자릿수가 늘어나는 것은 아니며, 주어도 필수 성분에 포함된다.","choices_note":"단일 개념 확인"}'),
('valency-extension','서술어의 자릿수','두 자리 서술어는 주어 이외에 목적어, 필수적 부사어, 보어 중 하나를 요구한다.','확장','{"text":"세 문장의 서술어가 주어 이외에 요구하는 성분을 각각 쓰고, 서술어의 자릿수가 같은지 판단하시오.\n㉠ 민수가 책을 읽는다.\n㉡ 민수가 형과 닮았다.\n㉢ 민수가 의사가 되었다.","answer":"㉠ 목적어 책을 / ㉡ 필수적 부사어 형과 / ㉢ 보어 의사가 / 모두 두 자리","explanation":"읽는다는 목적어, 닮았다는 비교 대상을 나타내는 필수적 부사어, 되었다는 보어를 요구한다. 주어 이외의 필수 성분 종류가 달라도 각각 두 자리 서술어이다.","choices":[]}'),
('essential-basic','필수적 부사어','필수적 부사어의 필요 여부는 서술어가 되는 용언의 개별적 의미 특질과 관련된다.','개념','{"text":"철수는 영희와 닮았다에서 영희와가 필수적 부사어인지 판단하고, 판단할 때 확인해야 할 것을 쓰시오.","answer":"필수적 부사어 / 서술어 닮다의 의미가 비교 대상을 요구하는지 확인한다.","explanation":"닮다는 누구와 닮았는지에 해당하는 비교 대상을 요구한다. 부사어라는 이름만으로 항상 생략 가능한 수식어라고 판단해서는 안 된다.","choices":[]}'),
('essential-extension','필수적 부사어','필수적 부사어의 필요 여부는 서술어가 되는 용언의 개별적 의미 특질과 관련된다.','확장','{"text":"두 문장의 영희와는 형태가 같지만 필수성이 다르다. 이를 서술어의 의미와 관련지어 설명하시오.\n㉠ 철수는 영희와 닮았다.\n㉡ 철수는 영희와 걸었다.","answer":"㉠은 닮다가 요구하는 비교 대상이므로 필수적이다. ㉡은 함께 걷는 상대를 덧붙인 것으로 걷다의 필수 성분은 아니다.","explanation":"조사 와가 붙었다는 공통점만으로 필수성을 결정할 수 없다. 서술어가 해당 성분을 의미상 반드시 요구하는지를 확인해야 한다.","choices":[]}')
on conflict(id) do nothing;
create or replace function public.odap_homework_enrich(b jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare stages jsonb:='[]';s jsonb;drafts jsonb;t record;
begin
 for s in select value from jsonb_array_elements(b->'stages') loop
  drafts:='[]';
  for t in select x.*,e evidence from public.odap_homework_templates x join lateral(select e from jsonb_array_elements(b->'evidence')e where e->>'concept'=x.concept and e->>'statement'=x.statement and exists(select 1 from public.odap_evidence v where v.id=(e->>'id')::uuid and v.approved and v.quote=e->>'quote' and v.statement=e->>'statement')limit 1)src on true where x.stage=s->>'name' order by x.id loop
   exit when jsonb_array_length(drafts)>=greatest(0,(s->>'target')::integer-jsonb_array_length(s->'items'));
   drafts:=drafts||jsonb_build_array(t.body||jsonb_build_object('id',t.id,'stage',t.stage,'concepts',jsonb_build_array(t.concept),'source_title','근거 기반 새 연습문항 · 검수 초안','evidence',t.evidence,'reviewed',false,'selection_type','grounded_draft','match_reason','현재 오답의 개념을 보완하는 새 연습문항 · 난도·표현 교사 확인 필요'));
  end loop;
  stages:=stages||jsonb_build_array(s||jsonb_build_object('drafts',drafts,'missing',greatest(0,(s->>'target')::integer-jsonb_array_length(s->'items')-jsonb_array_length(drafts))));
 end loop;
 return jsonb_set(b,'{stages}',stages);
end $$;
revoke all on function public.odap_homework_enrich(jsonb) from public,anon,authenticated;
do $patch$ declare d text;n text;begin
 select pg_get_functiondef('public.odap_homework(text,text,text,jsonb)'::regprocedure)into d;
 if position('report:=public.odap_homework_enrich(report)' in d)=0 then
  n:=replace(d,'insert into public.odap_homeworks(student_id,request_id,body)','report:=public.odap_homework_enrich(report); insert into public.odap_homeworks(student_id,request_id,body)');
  if n=d then raise exception 'homework insert marker missing';end if;execute n;
 end if;
end $patch$;
update public.odap_homeworks set body=public.odap_homework_enrich(body);
