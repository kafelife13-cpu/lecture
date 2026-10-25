(function(root){
 'use strict';
 const DAY=86400000,intervals=[1,3,7,14,30];
 const elementNames=['높임 표현','시간 표현','피동·사동','부정 표현','종결 표현','인용 표현','기타'];
 const tips={phonology:'음운 변동은 교체·탈락·첨가·축약 중 무엇인지부터 정하고 보세요.',words:'자립성과 실질적 의미는 서로 다른 기준이에요. 하나씩 따로 따져 보세요.',parts:'품사는 단어의 갈래, 문장 성분은 문장 속 역할이에요. 둘을 섞지 마세요.',sentences:'주어-서술어 관계가 몇 번 나오는지 세면 홑문장·겹문장이 갈려요.',expression:'누구를 높이는지, 언제 일인지, 누가 하는 행동인지 먼저 표시해 보세요.',spelling:'소리대로 적는지, 원형을 밝혀 적는지부터 판단해요.',medieval:'현대국어와 다른 글자·표기·조사 형태에 먼저 표시해 보세요.'};
 const bank=q=>q.id.startsWith('kh-')?'kimhayan':'seoro';
 function normalize(text){return String(text).normalize('NFKC').replace(/[\s'"‘’“”「」『』]/g,'');}
 function mergeBanks(seoro,kh){const seen=new Set(seoro.map(q=>normalize(q.prompt)));return seoro.concat(kh.filter(q=>!seen.has(normalize(q.prompt))));}
 function grammarElementTags(q){
  if(q.topic!=='expression')return [];
  const text=bank(q)==='kimhayan'?q.skill||'':[q.prompt,q.passage,q.explanation].join(' ');
  const patterns=bank(q)==='kimhayan'?[/높임/,/시제|동작상|겠/,/피동|사동/,/부정/,/종결/,/인용/]:[/높임|높이|-시-|께서|께|여쭙|드리|모시|하십시오|해요체|해체/,/시제|과거|현재|미래|-었-|-겠-|-더-|동작상|진행|완료/,/피동|사동|-이-|-히-|-리-|-기-|-우-|-구-|-추-|-게 하다|-어지다|당하다/,/부정|안 |못 |-지 않|-지 못|-지 말/,/종결|평서|의문|명령|청유|감탄/,/인용|-고 했|-라고/];
  const tags=elementNames.filter((_,i)=>patterns[i]?.test(text));return tags.length?tags:['기타'];
 }
 function reviewCards(attempts,now=Date.now()){
  const cards={};
  for(const a of attempts.slice().sort((a,b)=>Date.parse(a.submitted_at)-Date.parse(b.submitted_at)||String(a.id).localeCompare(String(b.id)))){
   const at=Date.parse(a.submitted_at);if(!Number.isFinite(at)||at>now)continue;
   const id=a.target_question_id||a.question_id,old=cards[id];let stage,due;
   if(!a.is_correct){stage=0;due=at+DAY;}
   else if(!old){stage=1;due=at+DAY;}
   else if(at>=old.due&&at-old.lastSeen>=DAY){stage=Math.min(5,Math.max(2,old.stage+1));due=at+intervals[stage-1]*DAY;}
   else {stage=old.stage;due=old.due;}
   cards[id]={stage,due,lastSeen:at};
  }return cards;
 }
 function dueQuestions(Q,rows,now=Date.now(),topic){const cards=reviewCards(rows,now);return Q.filter(q=>(!topic||q.topic===topic)&&cards[q.id]&&cards[q.id].due<=now&&now-cards[q.id].lastSeen>=DAY).sort((a,b)=>cards[a.id].due-cards[b.id].due);}
 function reviewSuccess(rows,target,now=Date.now()){const c=reviewCards(rows,now)[target];return !!c&&c.due<=now&&now-c.lastSeen>=DAY;}
 function replacementQuestion(q,Q,rows,used=new Set()){
  const seen=new Set(rows.map(r=>r.question_id)),tags=grammarElementTags(q);
  const available=Q.filter(x=>x.id!==q.id&&!used.has(x.id));
  const groups=[available.filter(x=>(x.variantOf||[]).includes(q.id)),available.filter(x=>q.objectiveId&&x.objectiveId===q.objectiveId),available.filter(x=>x.topic===q.topic&&(q.topic==='expression'?grammarElementTags(x).some(t=>tags.includes(t)):x.concept===q.concept))];
  for(const g of groups){if(g.length)return g.find(x=>!seen.has(x.id))||g[0];}return q;
 }
 function reviewSet(Q,rows,now=Date.now(),topic){const used=new Set(),targets={},items=[];for(const q of dueQuestions(Q,rows,now,topic).slice(0,10)){let x=replacementQuestion(q,Q,rows,used);if(used.has(x.id))x=q;if(used.has(x.id))continue;used.add(x.id);items.push(x);targets[x.id]=q.id;}return {items,targets};}
 function validateQuestion(body,rows,studentId,questionId){const clean=String(body||'').trim();if(!clean||Array.from(clean).length>300)throw Error('질문은 1~300자로 입력해 주세요.');if(rows.some(r=>r.student_id===studentId&&r.question_id===questionId&&!r.seen_at))throw Error('선생님이 아직 확인하지 않은 질문이 있습니다.');return clean;}
 function csv(students,rows,Q,classes,now=Date.now()){
  const escape=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
  const data=[['이름','반','푼 문항','풀이 횟수','정답 횟수','정답률','오답 문항 수','복습 대기','최근 공부']];
  for(const s of students){const r=rows.filter(a=>a.student_id===s.id).sort((a,b)=>Date.parse(a.submitted_at)-Date.parse(b.submitted_at)),latest=new Map();r.forEach(a=>latest.set(a.question_id,a));const correct=r.filter(a=>a.is_correct).length;data.push([s.name,classes.find(c=>c.id===s.group_id)?.label||'반 미배정',latest.size,r.length,correct,r.length?Math.round(correct/r.length*100):0,[...latest.values()].filter(a=>!a.is_correct).length,dueQuestions(Q,r,now).length,r.at(-1)?.submitted_at||'']);}
  return '\ufeff'+data.map(r=>r.map(escape).join(',')).join('\r\n');
 }
 const api={DAY,elementNames,tips,bank,mergeBanks,grammarElementTags,reviewCards,dueQuestions,reviewSuccess,replacementQuestion,reviewSet,validateQuestion,csv};
 if(typeof module!=='undefined')module.exports=api;root.GrammarReview=api;
})(typeof window==='undefined'?globalThis:window);
