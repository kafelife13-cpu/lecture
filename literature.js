(function(root){
 'use strict';
 const base='assets/literature/', marker='literature-bible-high';
 const isLiteratureExam=e=>!!e&&e.questions?.[0]?.collection===marker;
 if(typeof module!=='undefined')module.exports={isLiteratureExam};
 root.isLiteratureExam=isLiteratureExam;
 if(typeof document==='undefined')return;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let manifestPromise,cache=new Map(),serial=0,importing=false;
 async function json(file){const r=await fetch(base+file);if(!r.ok)throw Error('자료를 불러오지 못했습니다 ('+r.status+').');return r.json();}
 function manifest(){if(!manifestPromise)manifestPromise=json('manifest.json').catch(e=>{manifestPromise=null;throw e;});return manifestPromise;}
 async function data(n){if(!Number.isInteger(n)||n<1||n>10)throw Error('회차를 확인해주세요.');if(!cache.has(n))cache.set(n,json('round-'+String(n).padStart(2,'0')+'.json').catch(e=>{cache.delete(n);throw e;}));return cache.get(n);}
 function links(n,solutions){const prefix=base+'round-'+String(n).padStart(2,'0');return '<a class="btn" target="_blank" rel="noopener" href="'+prefix+'-questions.pdf">문제지 PDF</a>'+(solutions?'<a class="btn" target="_blank" rel="noopener" href="'+prefix+'-explanations.pdf">정답·해설 PDF</a>':'');}
 root.renderLiterature=async function(){
  const teacher=session?.role==='teacher'&&!studentPreviewMode,container=document.getElementById(teacher?'t-literature-body':'s-literature-body');if(!container||!session)return;
  const other=document.getElementById(teacher?'s-literature-body':'t-literature-body');if(other)other.innerHTML='';
  const token=++serial,who=session.id;container.innerHTML='<p role="status">문학모의고사를 불러오고 있어요.</p>';
  try{
   const m=await manifest(),ids=m.rounds.map(r=>r.id);
   const exams=await sb.from('exams').select('id,total_q').in('id',ids);if(exams.error)throw exams.error;
   let responses=[];
   if(!teacher){const res=await sb.from('exam_responses').select('exam_id,score,correct_count,thoughts,regrade_approved').eq('student_name',session.name||session.id).in('exam_id',ids);if(res.error)throw res.error;responses=res.data||[];}
   if(token!==serial||session?.id!==who)return;
   const existing=new Set((exams.data||[]).map(e=>e.id));
   container.innerHTML=(teacher?'<div class="card lit-intro"><strong>10회 · 170문항 · 회당 30분</strong><p>문제지, 문항별 정답과 핵심 해설, 원문 해설, 문학 개념을 함께 등록합니다.</p><button class="btn blue" id="lit-register" onclick="registerLiterature()"'+(existing.size===10?' disabled':'')+'>'+ (existing.size===10?'10회 등록 완료':'미등록 회차 등록')+'</button><span id="lit-import-status" role="status"> '+existing.size+'/10회 등록됨</span></div>':'<p class="lit-intro">회당 17문항 · 30분 · 38점 만점 (성적은 100점 환산)<br>문제 풀기 → 답안 제출 → 오답 이유 쓰기 → 다시 풀고 해설 확인</p>')+
    '<div class="lit-round-grid">'+m.rounds.map(r=>{const res=responses.find(x=>x.exam_id===r.id),ready=existing.has(r.id);return '<article class="card lit-round"><span class="lit-round-number">'+String(r.round).padStart(2,'0')+'</span><h2>'+esc(r.name)+'</h2><p>17문항 · 30분'+(res?' · '+res.score+'점 / '+res.correct_count+'문항 정답':'')+'</p><div class="lit-actions">'+links(r.round,teacher||!!res)+'<button class="btn" onclick="showLiteratureText('+r.round+')">지문·문제 텍스트</button>'+(teacher?'<button class="btn" onclick="showLiteratureSolutions('+r.round+')">문항별 해설</button>':ready?'<button class="btn blue" onclick="openLiteratureExam('+r.round+','+!!res+')">'+(res?'결과·오답노트':'답안 입력·채점')+'</button>':'<span>선생님이 등록을 준비하고 있어요.</span>')+'</div></article>';}).join('')+'</div><details class="card lit-concepts"><summary>문학 개념 정리</summary><div id="lit-concepts-list"></div></details><div id="lit-detail" class="card lit-detail" hidden></div>';
   const c=await json('concepts.json');if(token!==serial||session?.id!==who)return;
   document.getElementById('lit-concepts-list').innerHTML=c.items.map(x=>'<details><summary>'+esc(x.title)+'</summary><p>'+esc(x.definition)+'</p></details>').join('')+'<small>참고: '+esc(c.sourceTitle)+'</small>';
  }catch(e){if(token===serial)container.innerHTML='<p role="alert">'+esc(e.message)+'</p><button class="btn" onclick="renderLiterature()">다시 불러오기</button>';}
 };
 root.registerLiterature=async function(){
  if(importing||!session||session.role!=='teacher'||studentPreviewMode||padMode)return;
  importing=true;const button=document.getElementById('lit-register'),status=document.getElementById('lit-import-status'),who=session.id;if(button)button.disabled=true;
  try{
   const m=await manifest();
   for(const r of m.rounds){
    if(session?.id!==who||session.role!=='teacher')throw Error('교사 로그인을 확인해주세요.');
    status.textContent=r.round+'회 확인 중…';
    const found=await sb.from('exams').select('id').eq('id',r.id).maybeSingle();if(found.error)throw found.error;if(found.data)continue;
    const d=await data(r.round),exam=JSON.parse(JSON.stringify(d.exam));
    if(exam.id!==r.id||exam.questions.length!==17||exam.questions.some((q,i)=>q.num!==i+1||! /^[1-5]$/.test(q.answer)||!q.explanation))throw Error(r.round+'회 자료 검증 실패');
    exam.teacher_id=who;
    const saved=await sb.from('exams').insert(exam);if(saved.error)throw saved.error;
   }
   const check=await sb.from('exams').select('id,total_q,questions').in('id',m.rounds.map(r=>r.id));if(check.error)throw check.error;
   if(check.data.length!==10||check.data.some(e=>e.total_q!==17||e.questions.length!==17))throw Error('등록 결과를 다시 확인해주세요.');
   for(const r of m.rounds){
    const expected=(await data(r.round)).exam,actual=check.data.find(e=>e.id===r.id);
    if(!actual||actual.questions.some((q,i)=>['num','answer','points','explanation','text'].some(k=>q[k]!==expected.questions[i][k])))throw Error(r.round+'회 저장 자료가 원본과 일치하지 않습니다.');
   }
   status.textContent='10회 170문항 등록·확인 완료';button.textContent='10회 등록 완료';notify('문학모의고사 10회를 등록했습니다.','success');
  }catch(e){if(status)status.textContent='등록 중단: '+e.message+' 이미 등록된 회차는 유지되며 다시 눌러 이어갈 수 있습니다.';if(button)button.disabled=false;}
  finally{importing=false;}
 };
 root.openLiteratureExam=async function(n,result){
  try{const m=await manifest(),r=m.rounds.find(x=>x.round===n);if(!r)return;
   // Show the existing exam panel without starting an overlapping exam-list fetch.
   sNav('literature-exam');
   if(result)await sExamViewResult(r.id);else {await sExamOpenForGrading(r.id);if(sExamData?.id===r.id&&document.getElementById('s-exam-check').style.display!=='none')sExamFullManualStart();}
   renderLiteratureExamTools();
  }catch(e){notify(e.message,'error');}
 };
 root.renderLiteratureExamTools=function(){
  document.querySelectorAll('.lit-exam-tools').forEach(x=>x.remove());if(!isLiteratureExam(sExamData))return;
  const n=Number(sExamData.name.match(/모의고사 (\d+)회/)?.[1]);if(!n)return;
  const view=document.getElementById(document.getElementById('s-exam-result').style.display!=='none'?'s-exam-result':'s-exam-check');
  const el=document.createElement('div');el.className='lit-exam-tools card';el.innerHTML='<div class="lit-actions"><button class="btn" onclick="sNav(\'literature\')">문학모의고사 목록</button>'+links(n,view.id==='s-exam-result')+'</div><p>문제지는 새 창에서 확대해서 볼 수 있어요.</p>';view.prepend(el);renderLiteratureStudy();
 };
 root.literatureQuestionResources=function(q){if(q?.collection!==marker)return '';return '<details class="lit-question"><summary>문제 원문 다시 보기 · '+q.sourcePage+'쪽</summary><p class="lit-ocr">'+esc(q.text)+'</p>'+q.images.map(x=>'<img loading="lazy" alt="'+q.num+'번 원본 문제" src="'+base+encodeURIComponent(x)+'">').join('')+'</details>'+(q.concepts||[]).map(c=>'<details class="lit-question"><summary>개념 확인 · '+esc(c.title)+'</summary><p>'+esc(c.definition)+'</p><small>더오름 문학개념어 참고</small></details>').join('');};
 root.renderLiteratureFeedback=function(wrong){
  document.getElementById('lit-feedback')?.remove();if(!isLiteratureExam(sExamData))return;
  const el=document.createElement('div');el.id='lit-feedback';el.className='card lit-detail';
  const types=new Map();wrong.forEach(w=>{const t=w.q.type||'문학 감상';types.set(t,(types.get(t)||0)+1);});
  el.innerHTML='<h3>문학 풀이 피드백</h3><p>'+(!wrong.length?'모든 문항을 맞혔어요. 해설의 근거와 내 풀이를 비교해 보세요.':wrong.length+'문항을 다시 확인해 보세요. '+wrong.filter(w=>w.my==='미선택').length+'문항은 답이 선택되지 않았어요.')+'</p>'+[...types].map(([t,n])=>'<p><strong>'+esc(t)+' · '+n+'문항</strong><br>'+(/표현|서술/.test(t)?'선택지의 표현 기법이 실제로 나타나는 구절을 찾고, 그 효과까지 지문과 맞는지 확인하세요.':/인물|사건/.test(t)?'누가 어떤 상황에서 말하고 행동했는지, 사건 전후의 변화를 함께 확인하세요.':/보기|감상|외적/.test(t)?'보기의 관점을 먼저 정리한 뒤, 선택지의 해석을 뒷받침하는 지문 근거를 찾으세요.':'선택지의 대상·상황·태도를 각각 지문과 비교하고, 틀린 선택지의 어긋난 표현을 짚어보세요.')+'</p>').join('')+'<details><summary>전체 문항 정답·핵심 해설 확인</summary>'+sExamData.questions.map((q,i)=>'<details><summary>'+q.num+'번 · '+(wrong.some(w=>w.idx===i)?'다시 확인':'정답')+' · 정답 '+q.answer+'</summary><p>'+esc(q.explanation)+'</p>'+literatureQuestionResources(q)+'</details>').join('')+'</details><p>아래 오답노트에 틀린 이유를 적고 다시 답을 선택한 뒤 저장하세요.</p>';
  document.querySelector('.lit-exam-tools')?.after(el);
 };
 root.showLiteratureText=async function(n){
  try{const d=await data(n),el=document.getElementById('lit-detail');el.hidden=false;el.innerHTML='<h2>'+n+'회 지문·문제 텍스트</h2><p>옛한글과 기호는 글자 인식에 오류가 남을 수 있습니다. 원본 PDF를 함께 확인해주세요.</p>'+d.problemPages.map(p=>'<details><summary>원본 '+p.page+'쪽</summary><pre>'+esc(p.text)+'</pre></details>').join('');el.scrollIntoView({behavior:'smooth'});}catch(e){notify(e.message,'error');}
 };
 root.showLiteratureSolutions=async function(n){
  if(session?.role!=='teacher'||studentPreviewMode)return;
  try{const d=await data(n),el=document.getElementById('lit-detail');el.hidden=false;el.innerHTML='<h2>'+n+'회 정답·해설</h2>'+d.exam.questions.map(q=>'<details><summary>'+q.num+'번 · 정답 '+q.answer+' · '+q.type+'</summary><p>'+esc(q.explanation)+'</p><details><summary>교재 전체 해설 글자 인식본 · '+q.explanationPage+'쪽</summary><pre>'+esc(q.fullExplanationOcr)+'</pre></details></details>').join('');el.scrollIntoView({behavior:'smooth'});}catch(e){notify(e.message,'error');}
 };
})(typeof window==='undefined'?globalThis:window);
