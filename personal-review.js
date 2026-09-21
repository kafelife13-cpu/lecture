(function(root){
 'use strict';
 // ponytail: summarize recorded answers only; missing submissions are not evidence of weakness.
 function summarize(responses,exams,isWrong){
  const latest=new Map(),types=new Map(),wrong=[];
  for(const r of responses){
   const e=exams[r.exam_id];
   if(!e||!['homework','school'].includes(e.category||'school')||!r.answers||!Object.keys(r.answers).length)continue;
   const previous=latest.get(r.exam_id);
   if(!previous||String(r.submitted_at||r.created_at||'')>String(previous.submitted_at||previous.created_at||''))latest.set(r.exam_id,r);
  }
  for(const r of latest.values()){
   const e=exams[r.exam_id];
   (e.questions||[]).forEach((q,i)=>{
    if(!Object.prototype.hasOwnProperty.call(r.answers,i)||!isWrong(r,i,e))return;
    const type=String(q.type||q.domain||'미분류'),item=types.get(type)||{type,count:0,exams:new Set()};
    item.count++;item.exams.add(e.id||r.exam_id);types.set(type,item);
    wrong.push({exam:e.name,num:q.num||i+1,type,explanation:q.explanation||'',responseId:r.id});
   });
  }
  return {submitted:latest.size,wrong,types:[...types.values()].map(x=>({type:x.type,count:x.count,examCount:x.exams.size})).sort((a,b)=>b.examCount-a.examCount||b.count-a.count)};
 }
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function render(data){
  return '<section class="weekly-plan"><h2>내 오답·취약 유형 분석</h2><p>과제·클리닉별 최근 제출 1건을 기준으로 분석합니다. 미입력 과제는 오답으로 계산하지 않습니다.</p>'+
   (!data.submitted?'<p>아직 분석할 답안 기록이 없어요. 과제를 입력하면 복습할 유형을 확인할 수 있어요.</p>':
   '<p>답안 기록 '+data.submitted+'개 · 확인된 오답 '+data.wrong.length+'문항</p>'+
   (!data.wrong.length?'<p>입력된 답안에서 확인된 오답이 없습니다. 기록하지 않은 문제의 정답 여부는 알 수 없어요.</p>':
   '<h3>먼저 복습할 유형</h3><ul>'+data.types.slice(0,5).map(t=>'<li><strong>'+esc(t.type)+'</strong> — '+t.count+'문항 · '+t.examCount+'개 과제/시험'+(t.type==='미분류'?' · 유형 확인 필요':t.examCount>1?' · 반복 오답':' · 복습 권장')+'</li>').join('')+'</ul><details><summary>오답 문제와 해설 확인 ('+data.wrong.length+'문항)</summary>'+data.wrong.map(w=>'<article style="padding:12px 0;border-bottom:1px solid var(--border)"><strong>'+esc(w.exam)+' · '+esc(w.num)+'번</strong><p>'+esc(w.type)+'</p><p style="white-space:pre-wrap">'+esc(w.explanation||'등록된 해설이 없습니다. 선생님께 질문해 주세요.')+'</p></article>').join('')+'</details>'))+
   '<p>아래 성적표에서 시험별 결과를 확인하세요. 기록이 적으면 취약 유형이 달라질 수 있습니다.</p></section>';
 }
 root.PersonalReview={summarize,render};
 if(typeof module!=='undefined')module.exports=root.PersonalReview;
})(typeof window==='undefined'?globalThis:window);
