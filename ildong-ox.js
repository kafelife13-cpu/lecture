(function(root){
 'use strict';
 // 한백고 전용 고전시가 해석 OX(「일동장유가」·「연행가」): 작품 선택 후 한 판 10문항.
 // 기록은 문법 OX와 같은 grammar_ox_attempts에 topic='ildong' / 'yeonhaeng'으로 저장(문법 통계에서는 제외).
 const SIZE=10,TOPICS=['ildong','yeonhaeng'];
 const WORKS={ildong:'「일동장유가」',yeonhaeng:'「연행가」',mix:'두 작품 섞기'};
 function isHanbaek(s){return !!s&&(s.school_id==='sc_hanbaek'||String(s.group_id||'').startsWith('hanbaek_'));}
 function shuffle(xs,random=Math.random){const a=xs.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 function makeRound(pool,n=SIZE,random=Math.random){return shuffle(pool,random).slice(0,Math.max(0,Math.min(n,pool.length)));}
 function poolFor(work,all){return work==='mix'?all:all.filter(q=>q.work===work);}
 if(typeof module!=='undefined')module.exports={SIZE,TOPICS,WORKS,isHanbaek,shuffle,makeRound,poolFor};
 if(typeof document==='undefined')return;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const all=()=>(root.ILDONG_OX||[]).concat(root.YEONHAENG_OX||[]);
 // session·padMode·studentPreviewMode는 index.html의 전역 변수(선생님 학생 화면 보기도 학생 session으로 들어옴).
 const preview=()=>!!studentPreviewMode;
 const allowed=()=>!!session&&!padMode&&session.role==='student'&&isHanbaek(session);
 const host=()=>document.getElementById('s-ildong-ox-body');
 let run=null,serial=0;
 root.syncIldongOxNav=function(){const show=allowed();document.querySelectorAll('#page-student [data-p="ildong-ox"],#s-tabbar [data-ms="ildong-ox"]').forEach(el=>{el.style.display=show?'':'none';});};
 function btn(action,label,cls,work){return '<button class="btn'+(cls?' '+cls:'')+'" data-ildong="'+action+'"'+(work?' data-work="'+work+'"':'')+'>'+label+'</button>';}
 function passage(q){return '<p class="gox-meta">'+esc(WORKS[q.work])+' · '+esc(q.section)+'</p><div class="gox-passage"><strong>원문</strong><p>'+esc(q.line)+'</p></div><p>해석</p><h2 class="gox-prompt">'+esc(q.say)+'</h2>';}
 async function loadHistory(){
  const el=document.getElementById('ildong-history');if(!el)return;
  if(preview()){el.textContent='미리보기: 풀이 기록은 저장되지 않습니다.';return;}
  const sid=session.id,token=++serial;
  try{const r=await sb.from('grammar_ox_attempts').select('set_id,topic,is_correct,submitted_at').eq('student_id',sid).in('topic',TOPICS).order('submitted_at',{ascending:false}).range(0,199);if(r.error)throw r.error;if(token!==serial||session?.id!==sid||!el.isConnected)return;
   const sets=new Map();for(const x of r.data||[]){if(!sets.has(x.set_id))sets.set(x.set_id,[]);sets.get(x.set_id).push(x);}
   el.innerHTML=sets.size?'<h3>최근 기록</h3>'+[...sets.values()].slice(0,5).map(rs=>{const t=[...new Set(rs.map(x=>x.topic))],name=t.length>1?WORKS.mix:WORKS[t[0]]||'';return '<p>'+esc(new Date(rs[0].submitted_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+' · '+esc(name)+' · '+rs.length+'문항 중 '+rs.filter(x=>x.is_correct).length+'개 정답</p>';}).join(''):'<p>아직 풀이 기록이 없어요.</p>';
  }catch(e){if(token===serial&&el.isConnected)el.textContent='기록을 불러오지 못했어요. 풀이는 그대로 할 수 있어요.';}
 }
 function home(){
  const Q=all(),count=w=>poolFor(w,Q).length;
  host().innerHTML='<div class="card gox"><h2>고전시가 해석 OX</h2><p>학교 프린트 범위의 원문 구절과 해석을 보고, 해석이 맞으면 O, 틀리면 X를 누르세요. 누르면 바로 정답과 해설이 나와요.</p><p>작품을 고르면 무작위 '+SIZE+'문항이 나와요.</p>'+(preview()?'<p role="status">미리보기: 풀이 기록은 저장되지 않습니다.</p>':'')+'<div class="gox-actions">'+['ildong','yeonhaeng','mix'].map(w=>btn('start',WORKS[w]+' ('+count(w)+'문항 중 10)','blue',w)).join('')+'</div><div id="ildong-history" role="status"></div></div>';
  loadHistory();
 }
 function startRun(items,work){if(!items.length)return;serial++;run={sid:session.id,preview:preview(),id:crypto.randomUUID(),work,items,index:0,answers:[]};renderQuestion();}
 function feedback(q,a){return '<h3>'+(a.correct?'정답입니다':'틀렸어요 · 정답 '+q.answer)+'</h3><p class="gox-explanation">'+esc(q.why)+'</p>'+(a.saveError?'<p role="alert">기록 저장에 실패했어요. 풀이는 계속할 수 있어요.</p>':'');}
 function renderQuestion(){
  const r=run;if(!r||!host())return;
  if(r.index>=r.items.length){
   const right=r.answers.filter(a=>a.correct).length,wrong=r.answers.filter(a=>!a.correct);
   host().innerHTML='<div class="card gox"><p>'+esc(WORKS[r.work]||'')+'</p><h2>'+r.items.length+'문항 중 '+right+'개 정답 · '+Math.round(right/r.items.length*100)+'점</h2>'+(r.preview?'<p>미리보기 · 기록 저장 안 함</p>':'')+'<h3>틀린 문항 다시 보기</h3>'+(wrong.map(a=>{const q=a.q;return '<details><summary>'+esc(q.line)+'</summary>'+passage(q)+'<p>내 답: '+a.choice+' · 정답: '+q.answer+'</p><p class="gox-explanation">'+esc(q.why)+'</p></details>';}).join('')||'<p>모두 맞혔어요!</p>')+'<div class="gox-actions">'+(wrong.length?btn('retry-wrong','틀린 문항만 다시 풀기'):'')+btn('start','다시 풀기 (새 10문항)','blue',r.work)+btn('home','작품 다시 고르기')+'</div></div>';
   return;
  }
  const q=r.items[r.index],a=r.answers[r.index];
  host().innerHTML='<div class="card gox"><p>'+(r.index+1)+' / '+r.items.length+'문항'+(r.preview?' · 미리보기':'')+'</p><p>이 해석이 맞으면 O, 틀리면 X</p>'+passage(q)+'<div class="gox-choices">'+['O','X'].map(c=>'<button class="btn" data-ildong="answer" data-choice="'+c+'" aria-label="'+(c==='O'?'O 맞다':'X 틀리다')+'"'+(a?' disabled':'')+'>'+c+'</button>').join('')+'</div><div aria-live="polite">'+(a?feedback(q,a)+btn('next',r.index+1<r.items.length?'다음 문항':'결과 보기','blue'):'')+'</div>'+btn('leave','그만 풀기')+'</div>';
 }
 async function answer(choice){
  const r=run;if(!r||r.answers[r.index]||!['O','X'].includes(choice)||session?.id!==r.sid)return;
  const q=r.items[r.index],a={q,choice,correct:choice===q.answer};r.answers[r.index]=a;renderQuestion();
  if(r.preview)return;
  const row={id:r.id+':'+q.id,student_id:r.sid,set_id:r.id,question_id:q.id,topic:q.work,choice:choice==='O'?0:1,is_correct:a.correct,submitted_at:new Date().toISOString()};
  try{const res=await sb.from('grammar_ox_attempts').upsert(row,{onConflict:'set_id,question_id',ignoreDuplicates:true});if(res.error)throw res.error;}
  catch(e){a.saveError=true;console.warn('고전시가 OX 기록 저장 실패',e?.message);if(run===r&&r.items[r.index]===q)renderQuestion();}
 }
 root.renderIldongOx=function(){
  root.syncIldongOxNav();if(!host())return;
  if(!allowed()){run=null;host().innerHTML='<div class="card gox"><p>한백고 학생에게 열리는 학습이에요.</p></div>';return;}
  if(run&&(run.sid!==session.id||run.preview!==preview()))run=null;
  if(run)renderQuestion();else home();
 };
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-ildong]');if(!b||!allowed())return;const act=b.dataset.ildong;
  if(act==='start'&&WORKS[b.dataset.work])startRun(makeRound(poolFor(b.dataset.work,all())),b.dataset.work);
  else if(act==='answer')answer(b.dataset.choice);
  else if(act==='next'&&run?.answers[run.index]){run.index++;renderQuestion();}
  else if(act==='retry-wrong'&&run)startRun(shuffle(run.answers.filter(a=>!a.correct).map(a=>a.q)),run.work);
  else if(act==='home'||act==='leave'){if(act==='leave'&&!confirm('그만 풀까요? 푼 문항은 기록에 남아요.'))return;run=null;home();}
 });
})(typeof window==='undefined'?globalThis:window);
