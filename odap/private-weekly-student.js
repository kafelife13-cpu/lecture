(function(){
 'use strict';
 const BASE='https://zniwzwanlvvmzkkcmikh.supabase.co',KEY='sb_publishable_IbfVcXs5TmXfumrnK4Somg_7MzygCdh';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let credentials=null,root=null,active=null,busy=false;
 function lock(value){busy=value;root.querySelectorAll('[data-weekly]').forEach(button=>{button.disabled=value;});}
 async function request(action,payload={}){
  const response=await fetch(BASE+'/functions/v1/odap-private-weekly',{method:'POST',signal:AbortSignal.timeout(60000),headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({credentials,action,payload})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error)throw Error(response.status===404?'개인 주간 테스트 서버를 준비하고 있어요.':data.error?.message||data.error||'주간 테스트를 불러오지 못했어요.');
  return data;
 }
 function message(text){root.querySelector('[role=status]').textContent=text;}
 function result(attempt){
  const results=new Map(attempt.results.map(r=>[r.id,r]));
  root.querySelector('[data-content]').innerHTML=`<h3>제출 완료 · ${attempt.correct} / ${attempt.total}문항</h3><p>이번 주 테스트를 마쳤어요. 정답과 해설로 틀린 개념을 복습하세요.</p>`+active.packet.items.map((q,i)=>{const r=results.get(q.id);return `<article class="list-item"><h4>${i+1}. ${esc(q.text)}</h4><p>${r?.correct?'정답':'오답'} · 정답 ${esc(r?.answer)}</p><p class="passage">${esc(r?.explanation)}</p></article>`;}).join('');
 }
 async function open(id){
  message('문항을 불러오는 중이에요.');active=await request('open',{id});
  if(active.attempt){result(active.attempt);message('이미 제출한 테스트입니다.');return;}
  root.querySelector('[data-content]').innerHTML=`<h3>${esc(active.packet.title)}</h3><p>객관식 20문항 · OX 20문항. 제출은 주차별 한 번이며, 제출 후 정답과 해설을 볼 수 있어요.</p><form data-attempt>`+active.packet.items.map((q,i)=>`<fieldset class="card"><legend>${i+1}. ${esc(q.text)}</legend>${q.passage?`<p class="passage">${esc(q.passage)}</p>`:''}${(q.images||[]).filter(x=>/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(x.data||'')).map(x=>`<img style="max-width:100%;height:auto" src="${x.data}" alt="${esc(x.alt||'문제 원문')}">`).join('')}${(q.type==='mcq'?q.choices:['O','X']).map((choice,j)=>`<label style="display:block;margin:12px 0"><input type="radio" name="${esc(q.id)}" value="${q.type==='mcq'?j+1:choice}" required> ${q.type==='mcq'?`${j+1}. `:''}${esc(choice)}</label>`).join('')}</fieldset>`).join('')+'<label class="check"><input type="checkbox" required>40문항의 답을 확인했어요. 제출 후에는 답을 바꿀 수 없어요.</label><button class="primary" type="submit">답안 제출 · 채점하기</button></form>';
  root.querySelector('form').onsubmit=async event=>{
   event.preventDefault();if(busy)return;const button=event.submitter,assignment=active;button.disabled=true;lock(true);
   const values=new FormData(event.target),answers=Object.fromEntries(assignment.packet.items.map(q=>[q.id,values.get(q.id)]));
   try{message('답안을 제출하고 있어요.');const attempt=await request('submit',{id:assignment.id,answers});result(attempt);message('답안 제출을 완료했어요.');}
   catch(error){try{const saved=await request('open',{id:assignment.id});if(saved.attempt){active=saved;result(saved.attempt);message('저장된 제출 결과를 복구했어요.');}else{message(error.message);button.disabled=false;}}catch{message(error.message);button.disabled=false;}}
   finally{lock(false);}
  };message('40문항을 모두 풀어 주세요.');
 }
 window.mountPrivateWeekly=async(auth,container)=>{
  credentials={id:auth.id,pw:auth.pw,role:'student'};root=container;
  root.innerHTML='<section class="card"><h2>나의 주간 테스트</h2><p role="status" aria-live="polite">테스트 목록을 불러오는 중이에요.</p><div data-list></div><div data-content></div></section>';
  try{const rows=await request('list');root.querySelector('[data-list]').innerHTML=rows.map(row=>`<button data-weekly="${esc(row.id)}">${esc(row.week_start)} · ${esc(row.title)} · ${row.submitted_at?'결과 보기':'풀기'}</button>`).join('');message(rows.length?'나에게 배정된 테스트를 선택하세요.':'아직 배정된 주간 테스트가 없어요.');root.querySelectorAll('[data-weekly]').forEach(button=>button.onclick=async()=>{if(busy)return;lock(true);try{await open(button.dataset.weekly);}catch(error){message(error.message);}finally{lock(false);}});}
  catch(error){message(error.message);}
 };
 window.addEventListener('pagehide',()=>{credentials=null;active=null;});
})();
