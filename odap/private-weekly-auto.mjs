// Deterministic source selection. Claude reviews selected real questions; it does not invent MCQ sources.
const overlap=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.some(x=>b.includes(x));
const stop=m=>{throw Error(m);};
export function autoSources(context){
 const year=Number(context.week_start.slice(0,4))-1;
 const sources=(context.evidence||[]).filter(e=>e.approved===true&&e.school===context.school&&e.source_id&&e.page&&e.quote&&(e.kind==='학교 프린트'||(['학교 기출','내신 기출'].includes(e.kind)&&e.year===year))).map(e=>({...e,page:String(e.page)}));
 if(!sources.some(e=>e.kind==='학교 프린트')||!sources.some(e=>['학교 기출','내신 기출'].includes(e.kind)))stop('학교 프린트와 작년 기출의 확인된 원문 근거가 부족합니다.');
 return sources;
}
export function autoMCQ(context){
 if(!context.school||!/^\d{4}-\d{2}-\d{2}$/.test(context.week_start))stop('학교·주차 정보가 없습니다.');
 const wrongs=(context.wrongs||[]).slice(0,10),used=new Set(),texts=new Set(),items=[];
 if(!wrongs.length)stop('이번 주 판정 가능한 클리닉 오답이 없습니다.');
 const originalIds=new Set(wrongs.map(w=>w.question?.id).filter(Boolean));
 const normalized=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');
 const originalTexts=new Set(wrongs.map(w=>normalized(w.question?.text)).filter(Boolean));
 const eligible=q=>q.status==='approved'&&!used.has(q.id)&&!originalIds.has(q.id)&&!texts.has(normalized(q.text))&&!originalTexts.has(normalized(q.text))&&Array.isArray(q.choices)&&q.choices.length===5&&/^[1-5]$/.test(String(q.answer))&&q.explanation&&q.evidence?.length&&q.evidence.every(e=>e.approved===true&&e.source_id&&e.page&&e.quote);
 const take=(q,role)=>{used.add(q.id);texts.add(normalized(q.text));items.push({id:'mcq_'+String(items.length+1).padStart(2,'0'),type:'mcq',text:q.text,passage:q.passage||'',choices:q.choices,answer:String(q.answer),explanation:q.explanation,images:q.images||[],reviewed:false,origin_type:'existing',bank_id:q.id,selection_role:role,evidence:q.evidence.map(e=>({...e,page:String(e.page)}))});};
 for(const w of wrongs){
  if(!w.concepts?.length)stop('오답의 세부 개념이 연결되지 않았습니다.');
  for(const role of ['similar','concept']){
   const q=(context.candidates||[]).find(q=>eligible(q)&&overlap(q.concepts,w.concepts)&&(role!=='similar'||overlap(q.question_types,w.question_types)));
   if(!q)stop('실제 원문과 근거가 있는 '+(role==='similar'?'유사':'개념')+' 문항이 부족합니다.');
   take(q,role);
  }
 }
 const concepts=[...new Set(wrongs.flatMap(w=>w.concepts||[]))];
 for(const q of context.candidates||[]){if(items.length===20)break;if(eligible(q)&&overlap(q.concepts,concepts))take(q,'core');}
 if(items.length!==20)stop('이번 범위의 객관식 보충 문항이 부족합니다.');
 return {schema:1,title:'주간 개별 복습 · 객관식 인쇄 / OX 앱',items};
}
