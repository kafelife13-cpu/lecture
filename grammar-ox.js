(function(root){
 'use strict';
 const topics={phonology:'음운',words:'형태소·단어',parts:'품사·용언',sentences:'문장',expression:'표현',spelling:'한글 맞춤법',medieval:'중세국어'};
 function filterQuestions(q,f={}){return q.filter(x=>(!f.era||x.era===f.era)&&(!f.topic||x.topic===f.topic)&&(!f.concept||x.concept===f.concept)&&(!f.difficulty||(f.difficulty==='hard'?x.difficulty==='상':['하','중'].includes(x.difficulty))));}
 function shuffle(xs,random=Math.random){const a=xs.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 function makeSet(q,f={},count=10,random=Math.random){const pool=filterQuestions(q,f),n=Math.min(Math.max(0,Math.floor(count)),pool.length),o=shuffle(pool.filter(x=>x.answer===0),random),x=shuffle(pool.filter(x=>x.answer===1),random);let on=Math.min(o.length,Math.floor(n/2)+(n%2&&random()<.5?1:0)),xn=Math.min(x.length,n-on);on=Math.min(o.length,n-xn);return shuffle(o.slice(0,on).concat(x.slice(0,xn)),random);}
 function latestAttempts(rows){const m=new Map();for(const r of rows){const old=m.get(r.question_id);if(!old||Date.parse(r.submitted_at)>Date.parse(old.submitted_at)||(r.submitted_at===old.submitted_at&&String(r.id)>String(old.id)))m.set(r.question_id,r);}return [...m.values()];}
 function wrongQuestions(q,rows){const wrong=new Set(latestAttempts(rows).filter(r=>!r.is_correct).map(r=>r.question_id));return q.filter(x=>wrong.has(x.id));}
 function stats(rows){return {count:rows.length,rate:rows.length?Math.round(rows.filter(r=>r.is_correct).length/rows.length*100):0};}
 if(typeof module!=='undefined')module.exports={topics,filterQuestions,makeSet,latestAttempts,wrongQuestions,stats};
 if(typeof document==='undefined')return;
 const Q=root.GRAMMAR_OX,byId=new Map(Q.map(q=>[q.id,q])),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const button=(action,label)=>'<button class="btn" data-gox="'+action+'">'+label+'</button>';
 let run=null,serial=0,teacherRows=[],teacherStudents=[],teacherOwner=null;
 const preview=()=>!!(padMode||studentPreviewMode);
 const student=()=>session&&(session.role==='student'||preview());
 const host=()=>document.getElementById('s-grammar-ox-body');
 const err=e=>'<p role="alert">불러오지 못했습니다. '+esc(e.message||e)+' 다시 시도해 주세요.</p>';
 async function readRows(sid,days){
  const all=[];
  // Supabase's default 1,000-row limit must not truncate class reports.
  for(let from=0;;from+=1000){let query=sb.from('grammar_ox_attempts').select('*').order('submitted_at',{ascending:false}).order('id',{ascending:false});if(sid)query=query.eq('student_id',sid);if(days)query=query.gte('submitted_at',new Date(Date.now()-days*86400000).toISOString());const r=await query.range(from,from+999);if(r.error)throw r.error;all.push(...r.data);if(r.data.length<1000)return all;}
 }
 const options=(pairs,value)=>pairs.map(([id,label])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(label)+'</option>').join('');
 root.renderGrammarOx=function(){
  if(!student())return;serial++;
  if(run&&(run.sid!==session.id||run.preview!==preview()))run=null;
  if(run){renderQuestion();return;}
  host().innerHTML='<div class="card gox"><p>360문항으로 익히는 고등문법 · 답을 고르면 바로 해설을 확인해요.</p>'+(preview()?'<p role="status">미리보기: 풀이 기록은 저장되지 않습니다.</p>':'')+'<div class="gox-filters"><label>범위<select id="gox-era"><option value="">전체</option><option value="modern">현대문법</option><option value="medieval">중세국어</option></select></label><label>단원<select id="gox-topic">'+options([['','전체'],...Object.entries(topics)],'')+'</select></label><label id="gox-concept-label" hidden>세부 유형<select id="gox-concept"></select></label><label>난이도<select id="gox-difficulty"><option value="normal">보통 (하·중)</option><option value="hard">어려움 (상)</option></select></label><label>문항 수<select id="gox-count"><option>5</option><option selected>10</option><option>20</option></select></label></div><p id="gox-pool" role="status"></p><div class="gox-actions"><button class="btn blue" id="gox-start" data-gox="start">훈련 시작</button>'+button('wrong','오답만 다시 풀기')+button('history','내 풀이 기록')+'</div><div id="gox-extra"></div></div>';
  updateFilters(true);
 };
 function filters(){return {era:document.getElementById('gox-era').value,topic:document.getElementById('gox-topic').value,concept:document.getElementById('gox-concept').value,difficulty:document.getElementById('gox-difficulty').value};}
 function updateFilters(reset){const f=filters();if(reset){const c=document.getElementById('gox-concept');c.innerHTML=options([['','전체'],...new Set(filterQuestions(Q,{era:f.era,topic:f.topic}).map(q=>q.concept))].map(x=>Array.isArray(x)?x:[x,x]),'');document.getElementById('gox-concept-label').hidden=!f.topic;f.concept='';}const n=filterQuestions(Q,f).length;document.getElementById('gox-pool').textContent='선택 조건: '+n+'문항 · 최대 '+Math.min(n,Number(document.getElementById('gox-count').value))+'문항 출제';document.getElementById('gox-start').disabled=!n;}
 function startRun(items){if(!items.length)return;serial++;run={sid:session.id,preview:preview(),id:crypto.randomUUID(),items,index:0,answers:[],busy:false,done:false,notified:false};renderQuestion();}
 function questionHtml(q){return '<p class="gox-meta">'+esc(topics[q.topic])+' · '+esc(q.concept)+' · '+q.difficulty+'</p><h2 class="gox-prompt">'+esc(q.prompt)+'</h2>'+(q.passage?'<div class="gox-passage"><strong>&lt;보기&gt;</strong><p>'+esc(q.passage)+'</p></div>':'');}
 function reviewHtml(q,choice){return '<details><summary>'+esc(q.prompt)+'</summary>'+questionHtml(q)+'<p>내 답: '+['O','X'][choice]+' · 정답: '+['O','X'][q.answer]+'</p><p class="gox-explanation">'+esc(q.choiceExplanations[choice]||q.explanation)+'</p><small>'+esc(q.src)+'</small></details>';}
 function renderQuestion(){
  if(!run||!student()||run.sid!==session.id)return;
  const r=run;
  if(r.index>=r.items.length){r.done=true;const correct=r.answers.filter(a=>a.is_correct).length,wrong=r.answers.filter(a=>!a.is_correct);host().innerHTML='<div class="card gox"><h2>훈련 완료 · '+Math.round(correct/r.items.length*100)+'점</h2><p>'+r.items.length+'문항 중 '+correct+'문항 정답'+(r.preview?' · 미리보기':'')+'</p><h3>틀린 문항 다시 보기</h3>'+(wrong.map(a=>reviewHtml(byId.get(a.question_id),a.choice)).join('')||'<p>모두 맞혔어요!</p>')+button('home','새 훈련 설정')+'</div>';if(!r.notified){r.notified=true;if(!r.preview)sendStudentActivity('문법 OX 훈련',[...new Set(r.items.map(q=>topics[q.topic]))].join(', ')+' · '+Math.round(correct/r.items.length*100)+'점');}return;}
  const q=r.items[r.index],a=r.answers[r.index];
  host().innerHTML='<div class="card gox"><p>'+ (r.index+1)+' / '+r.items.length+'문항'+(r.preview?' · 미리보기':'')+'</p><p>다음 설명이 맞으면 O, 틀리면 X</p>'+questionHtml(q)+'<div class="gox-choices">'+[0,1].map(c=>'<button class="btn" data-gox="answer" data-choice="'+c+'" aria-label="'+(c?'X 틀리다':'O 맞다')+'"'+(a||r.busy?' disabled':'')+'>'+['O','X'][c]+'</button>').join('')+'</div><div id="gox-feedback" aria-live="polite">'+(a?'<h3>'+ (a.is_correct?'정답입니다':'다시 확인해요 · 정답 '+['O','X'][q.answer])+'</h3><p class="gox-explanation">'+esc(q.choiceExplanations[a.choice])+'</p><small>출처: '+esc(q.src)+'</small><p>'+button('next',r.index===r.items.length-1?'결과 보기':'다음 문항')+'</p>':r.busy?'저장 중…':'')+'</div><p>'+button('leave','훈련 나가기')+'</p></div>';
 }
 async function answer(choice){
  const r=run;if(!r||r.busy||r.answers[r.index]||!student()||r.sid!==session.id||r.preview!==preview())return;
  const q=r.items[r.index];if(!q||byId.get(q.id)!==q||![0,1].includes(choice))return;
  r.busy=true;renderQuestion();
  // Keep payload stable across a retry after an ambiguous network failure.
  if(!r.pending)r.pending={id:r.id+':'+q.id,student_id:r.sid,set_id:r.id,question_id:q.id,topic:q.topic,choice,is_correct:choice===q.answer,submitted_at:new Date().toISOString()};
  try{
   let saved=r.pending;
   if(!r.preview){const result=await sb.from('grammar_ox_attempts').upsert(r.pending,{onConflict:'set_id,question_id',ignoreDuplicates:true});if(result.error)throw result.error;const check=await sb.from('grammar_ox_attempts').select('*').eq('set_id',r.id).eq('question_id',q.id).single();if(check.error)throw check.error;if(check.data.student_id!==r.sid)throw Error('저장된 학생 정보가 일치하지 않습니다.');saved=check.data;}
   r.answers.push(saved);r.pending=null;r.busy=false;if(run===r&&session?.id===r.sid&&r.preview===preview())renderQuestion();
  }catch(e){r.busy=false;if(run===r&&session?.id===r.sid){renderQuestion();document.getElementById('gox-feedback').innerHTML='<p role="alert">저장하지 못했습니다. 연결을 확인하고 답을 다시 눌러 주세요. 재시도 시 처음 선택한 '+['O','X'][r.pending.choice]+' 답을 저장합니다.</p>';}}
 }
 async function studentHistory(wrongOnly){
  if(!student())return;const sid=session.id,token=++serial,el=document.getElementById('gox-extra');el.innerHTML='<p role="status">기록을 불러오는 중…</p>';
  try{const rows=preview()?[]:await readRows(sid);if(token!==serial||session?.id!==sid)return;
   if(wrongOnly){const count=Number(document.getElementById('gox-count').value),items=makeSet(wrongQuestions(Q,rows),{},count);if(!items.length){el.innerHTML='<p>최신 기록이 오답인 문항이 없습니다.</p>';return;}startRun(items);return;}
   const sets=new Map();for(const r of rows){if(!sets.has(r.set_id))sets.set(r.set_id,[]);sets.get(r.set_id).push(r);}
   el.innerHTML='<h2>내 풀이 기록</h2><p>푼 문항 수는 반복 풀이를 포함합니다. 중간에 나간 세트도 저장된 문항까지 표시됩니다.</p>'+Object.entries(topics).map(([k,v])=>{const s=stats(rows.filter(r=>r.topic===k));return '<p>'+v+' · '+s.count+'문항 · '+s.rate+'%</p>';}).join('')+'<h3>최근 세트</h3>'+([...sets].slice(0,20).map(([,rs])=>{const s=stats(rs);return '<p>'+date(rs[0].submitted_at)+' · '+s.count+'문항 · '+s.rate+'%</p>';}).join('')||'<p>아직 풀이 기록이 없습니다.</p>');
  }catch(e){if(token===serial)el.innerHTML=err(e);}
 }
 const date=d=>d?esc(new Date(d).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})):'—';
 root.renderGrammarOxTeacher=function(){
  if(session?.role!=='teacher'||preview())return;
  document.getElementById('t-grammar-ox-body').innerHTML='<div class="card gox"><div class="gox-filters"><label>반<select id="gox-class">'+options([['','전체 반'],['unassigned','반 미배정'],...STUDENT_CLASSES.map(c=>[c.id,c.label])],'')+'</select></label><label>기간<select id="gox-days"><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="0">전체</option></select></label></div>'+button('teacher-refresh','새로고침')+'<div id="gox-report" aria-live="polite"></div><div id="gox-student-detail"></div></div>';loadTeacher();
 };
 async function loadTeacher(){
  if(session?.role!=='teacher'||preview())return;const who=session.id,token=++serial,el=document.getElementById('gox-report');teacherOwner=null;document.getElementById('gox-student-detail').innerHTML='';el.innerHTML='<p role="status">현황을 불러오는 중…</p>';
  try{const rows=await readRows(null,Number(document.getElementById('gox-days').value));if(token!==serial||session?.id!==who||session.role!=='teacher'||preview())return;teacherRows=rows;teacherStudents=activeStudents();teacherOwner=who;renderTeacherReport();}catch(e){if(token===serial)el.innerHTML=err(e);}
 }
 function renderTeacherReport(){
  if(!teacherOwner||session?.id!==teacherOwner||session.role!=='teacher'||preview())return;
  document.getElementById('gox-student-detail').innerHTML='';
  const cls=document.getElementById('gox-class').value,students=teacherStudents.filter(s=>!cls||(cls==='unassigned'?!STUDENT_CLASSES.some(c=>c.id===s.group_id):s.group_id===cls)),ids=new Set(students.map(s=>s.id)),rows=teacherRows.filter(r=>ids.has(r.student_id));
  const cells=students.map(s=>{const rs=rows.filter(r=>r.student_id===s.id),st=stats(rs);return '<tr><th><button class="btn" data-gox="student" data-sid="'+esc(s.id)+'">'+esc(s.name||s.id)+'</button></th><td>'+st.count+'</td><td>'+st.rate+'%</td>'+Object.keys(topics).map(t=>{const x=stats(rs.filter(r=>r.topic===t));return '<td'+(x.count<10?' class="gox-small-sample"':'')+'>'+ (x.count?x.rate+'%':'—')+' <small>('+x.count+')</small></td>';}).join('')+'<td>'+date(rs[0]?.submitted_at)+'</td></tr>';}).join('');
  const ranked=Q.map(q=>{const rs=rows.filter(r=>r.question_id===q.id);return {q,n:rs.length,wrong:rs.filter(r=>!r.is_correct).length};}).filter(x=>x.wrong).sort((a,b)=>b.wrong/b.n-a.wrong/a.n||b.n-a.n).slice(0,20);
  document.getElementById('gox-report').innerHTML='<p>반복 풀이 포함 · 단원별 괄호는 풀이 수 · 10문항 미만은 회색</p><div class="gox-table"><table><thead><tr><th>학생</th><th>푼 문항</th><th>정답률</th>'+Object.values(topics).map(t=>'<th>'+t+'</th>').join('')+'<th>최근 풀이일</th></tr></thead><tbody>'+cells+'</tbody></table></div><h3>문항별 오답률 상위 20개</h3>'+ (ranked.map(x=>'<details><summary>'+Math.round(x.wrong/x.n*100)+'% ('+x.wrong+'/'+x.n+') · '+esc(x.q.prompt)+'</summary>'+questionHtml(x.q)+'<p>정답 '+['O','X'][x.q.answer]+' · '+esc(x.q.explanation)+'</p><small>'+esc(x.q.src)+'</small></details>').join('')||'<p>해당 조건의 오답 기록이 없습니다.</p>');
 }
 document.addEventListener('change',e=>{if(['gox-era','gox-topic','gox-concept','gox-difficulty','gox-count'].includes(e.target.id))updateFilters(['gox-era','gox-topic'].includes(e.target.id));if(e.target.id==='gox-class')renderTeacherReport();if(e.target.id==='gox-days')loadTeacher();});
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-gox]');if(!b)return;const action=b.dataset.gox;
  if(action==='teacher-refresh'){loadTeacher();return;}
  if(action==='student'){if(session?.role!=='teacher'||preview()||session.id!==teacherOwner)return;const s=teacherStudents.find(s=>s.id===b.dataset.sid);if(!s)return;const wrong=latestAttempts(teacherRows.filter(r=>r.student_id===s.id)).filter(r=>!r.is_correct&&byId.has(r.question_id));document.getElementById('gox-student-detail').innerHTML='<h2>'+esc(s.name)+' · 선택 기간의 최신 오답</h2>'+ (wrong.map(r=>reviewHtml(byId.get(r.question_id),r.choice)).join('')||'<p>오답이 없습니다.</p>');return;}
  if(!student())return;
  if(action==='start')startRun(makeSet(Q,filters(),Number(document.getElementById('gox-count').value)));
  if(action==='answer')answer(Number(b.dataset.choice));
  if(action==='next'&&run?.answers[run.index]){run.index++;renderQuestion();}
  if(action==='home'||action==='leave'){if(run?.busy)return;if(action==='leave'&&!confirm('훈련을 나갈까요? 제출한 문항은 기록에 남습니다.'))return;run=null;root.renderGrammarOx();}
  if(action==='wrong'||action==='history')studentHistory(action==='wrong');
 });
})(typeof window==='undefined'?globalThis:window);
