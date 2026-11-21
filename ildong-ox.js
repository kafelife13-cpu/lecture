(function(root){
 'use strict';
 // 한백고 전용 고전시가 퀴즈(「일동장유가」·「연행가」): 작품 × 유형 선택 후 무작위 10문항.
 // 유형: 해석 OX(ox) · 해석 고르기(mc) · 표현기법 고르기(tmc) · 표현기법 OX(tox) · 순서 맞히기(ord 누르기 / ordmc 객관식).
 // 기록은 grammar_ox_attempts에 topic=작품(ildong·yeonhaeng), question_id에 유형이 들어가게 저장(문법 통계에서는 제외).
 // choice: O/X 유형은 O=0·X=1, 그 밖의 유형은 정답=0·오답=1 (표의 choice는 0·1만 허용).
 const SIZE=10,TOPICS=['ildong','yeonhaeng'];
 const WORKS={ildong:'「일동장유가」',yeonhaeng:'「연행가」',mix:'두 작품 섞기'};
 const TYPES={ox:'해석 OX',mc:'해석 고르기',tmc:'표현기법 고르기',tox:'표현기법 OX',ord:'순서 맞히기',all:'전체 섞기'};
 const LABELS=['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ'];
 function isHanbaek(s){return !!s&&(s.school_id==='sc_hanbaek'||String(s.group_id||'').startsWith('hanbaek_'));}
 function shuffle(xs,random=Math.random){const a=xs.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
 function makeRound(pool,n=SIZE,random=Math.random){return shuffle(pool,random).slice(0,Math.max(0,Math.min(n,pool.length)));}
 const typeOf=q=>q.type||'ox',groupOf=q=>typeOf(q)==='ordmc'?'ord':typeOf(q),isOx=q=>['ox','tox'].includes(typeOf(q));
 function poolFor(work,all,type='ox'){return all.filter(q=>(work==='mix'||q.work===work)&&(type==='all'||groupOf(q)===type));}
 // 한 판에 낼 때마다 보기·구절 순서를 새로 섞는다(정답 번호가 고정되지 않게).
 function prepare(q,random=Math.random){
  const t=typeOf(q),n=q.options?.length||q.parts?.length||0,idx=[...Array(n).keys()];
  if(t==='mc'||t==='tmc')return {...q,order:shuffle(idx,random)};
  if(t==='ord'||t==='ordmc'){
   let show=shuffle(idx,random);for(let k=0;k<5&&show.every((v,i)=>v===i);k++)show=shuffle(idx,random);
   if(show.every((v,i)=>v===i))show=idx.slice(1).concat(0);
   const p={...q,show,pick:[]};
   if(t==='ordmc'){const label=i=>LABELS[show.indexOf(i)],right=idx.map(label).join(' → '),seqs=new Set([right]);for(let k=0;seqs.size<4&&k<50;k++)seqs.add(shuffle(idx,random).map(label).join(' → '));p.seqs=shuffle([...seqs],random);p.right=right;}
   return p;
  }
  return {...q};
 }
 function isCorrect(q,choice){const t=typeOf(q);if(t==='ox'||t==='tox')return choice===q.answer;if(t==='mc'||t==='tmc')return q.order[choice]===q.answer;if(t==='ordmc')return q.seqs[choice]===q.right;if(t==='ord')return Array.isArray(choice)&&choice.length===q.parts.length&&choice.every((v,i)=>v===i);return false;}
 if(typeof module!=='undefined')module.exports={SIZE,TOPICS,WORKS,TYPES,isHanbaek,shuffle,makeRound,poolFor,prepare,isCorrect};
 if(typeof document==='undefined')return;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let cache=null;
 function all(){
  if(cache)return cache;
  const C=root.ClassicalQuiz,list=[];
  for(const [w,items] of [['ildong',root.ILDONG_OX||[]],['yeonhaeng',root.YEONHAENG_OX||[]]]){list.push(...items);if(C){const b=C.build(w,items);list.push(...b.mc,...b.tmc,...b.tox,...b.ord);}}
  return cache=list;
 }
 // session·padMode·studentPreviewMode는 index.html의 전역 변수(선생님 학생 화면 보기도 학생 session으로 들어옴).
 const preview=()=>!!studentPreviewMode;
 const allowed=()=>!!session&&!padMode&&session.role==='student'&&isHanbaek(session);
 const host=()=>document.getElementById('s-ildong-ox-body');
 const BIG=' style="display:block;width:100%;text-align:left;margin:8px 0;min-height:48px;white-space:normal"';
 let run=null,serial=0;const sel={work:'ildong',type:'ox'};
 root.syncIldongOxNav=function(){const show=allowed();document.querySelectorAll('#page-student [data-p="ildong-ox"],#s-tabbar [data-ms="ildong-ox"]').forEach(el=>{el.style.display=show?'':'none';});};
 function btn(action,label,cls,attrs){return '<button class="btn'+(cls?' '+cls:'')+'" data-ildong="'+action+'"'+(attrs||'')+'>'+label+'</button>';}
 function head(q){return '<p class="gox-meta">'+esc(WORKS[q.work])+' · '+esc(TYPES[groupOf(q)])+' · '+esc(q.section)+'</p>';}
 function body(q){
  const t=typeOf(q);
  if(t==='ord'||t==='ordmc')return head(q)+'<h2 class="gox-prompt">'+esc(q.prompt)+'</h2>';
  return head(q)+'<div class="gox-passage"><strong>원문</strong><p>'+esc(q.line)+'</p></div>'+(t==='ox'?'<p>해석</p><h2 class="gox-prompt">'+esc(q.say)+'</h2>':'<h2 class="gox-prompt">'+esc(t==='tox'?q.say:q.prompt)+'</h2>');
 }
 function orderAnswer(q){return '<ol>'+q.parts.map(p=>'<li><strong>'+esc(p.line)+'</strong><br>'+esc(p.modern)+(q.kind==='trip'?'<br><small>'+esc(p.section)+'</small>':'')+'</li>').join('')+'</ol><p><small>'+(q.kind==='para'?'단락: '+esc(q.section)+' (학교 프린트 원문 순서)':'여정: 학교 프린트 ①~⑥ 단락 순서')+'</small></p>';}
 function explain(q,a){
  const t=typeOf(q);
  if(t==='ox'||t==='tox')return '<p class="gox-explanation">'+esc(q.why)+'</p>';
  if(t==='mc'||t==='tmc')return '<p>정답: <strong>'+esc(q.options[q.answer])+'</strong>'+(a&&!a.correct?' · 내 답: '+esc(q.options[q.order[a.choice]]):'')+'</p><p class="gox-explanation">'+esc(q.why)+'</p>';
  return (t==='ordmc'?'<p>정답: <strong>'+esc(q.right)+'</strong>'+(a&&!a.correct?' · 내 답: '+esc(q.seqs[a.choice]):'')+'</p>':'')+'<p>원래 순서</p>'+orderAnswer(q);
 }
 function controls(q,a){
  const t=typeOf(q),dis=a?' disabled':'';
  if(t==='ox'||t==='tox')return '<div class="gox-choices">'+['O','X'].map(c=>'<button class="btn" data-ildong="answer" data-choice="'+c+'" aria-label="'+(c==='O'?'O 맞다':'X 틀리다')+'"'+dis+'>'+c+'</button>').join('')+'</div>';
  if(t==='mc'||t==='tmc')return q.order.map((o,i)=>'<button class="btn"'+BIG+' data-ildong="answer" data-choice="'+i+'"'+dis+'>'+(i+1)+'. '+esc(q.options[o])+'</button>').join('');
  if(t==='ordmc')return q.show.map((p,i)=>'<p><strong>'+LABELS[i]+'.</strong> '+esc(q.parts[p].line)+'</p>').join('')+q.seqs.map((s,i)=>'<button class="btn"'+BIG+' data-ildong="answer" data-choice="'+i+'"'+dis+'>'+(i+1)+'. '+esc(s)+'</button>').join('');
  // ord: 누른 순서대로 번호가 붙고, 다 고르면 제출.
  const pick=a?a.choice:q.pick;
  return '<p>원래 순서대로 구절을 차례로 누르세요.</p>'+q.show.map(p=>{const k=pick.indexOf(p);return '<button class="btn'+(k>=0?' blue':'')+'"'+BIG+' data-ildong="tap" data-part="'+p+'"'+(a||k>=0?' disabled':'')+'>'+(k>=0?'<strong>'+(k+1)+'번</strong> · ':'')+esc(q.parts[p].line)+'</button>';}).join('')+(a?'':'<div class="gox-actions">'+btn('reset-order','다시 고르기')+btn('submit-order','제출','blue',pick.length<q.parts.length?' disabled':'')+'</div>');
 }
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
  const n=poolFor(sel.work,all(),sel.type).length,pick=(key,map)=>Object.entries(map).map(([k,v])=>btn('pick-'+key,esc(v),sel[key]===k?'blue':'',' data-value="'+k+'" aria-pressed="'+(sel[key]===k)+'"')).join('');
  host().innerHTML='<div class="card gox"><h2>고전시가 퀴즈</h2><p>작품과 문제 유형을 고르면 무작위 '+SIZE+'문항이 나와요. 답을 누르면 바로 정답과 해설이 나와요.</p>'+(preview()?'<p role="status">미리보기: 풀이 기록은 저장되지 않습니다.</p>':'')+'<h3>작품</h3><div class="gox-actions">'+pick('work',WORKS)+'</div><h3>유형</h3><div class="gox-actions">'+pick('type',TYPES)+'</div>'+btn('start','시작 ('+n+'문항 중 '+Math.min(SIZE,n)+'문항)','blue',n?'':' disabled')+'<div id="ildong-history" role="status"></div></div>';
  loadHistory();
 }
 function startRun(items,work,type){if(!items.length)return;serial++;run={sid:session.id,preview:preview(),id:crypto.randomUUID(),work,type,items:items.map(q=>prepare(q)),index:0,answers:[]};renderQuestion();}
 function renderQuestion(){
  const r=run;if(!r||!host())return;
  if(r.index>=r.items.length){
   const right=r.answers.filter(a=>a.correct).length,wrong=r.answers.filter(a=>!a.correct);
   host().innerHTML='<div class="card gox"><p>'+esc(WORKS[r.work]||'')+' · '+esc(TYPES[r.type]||'')+'</p><h2>'+r.items.length+'문항 중 '+right+'개 정답 · '+Math.round(right/r.items.length*100)+'점</h2>'+(r.preview?'<p>미리보기 · 기록 저장 안 함</p>':'')+'<h3>틀린 문항 다시 보기</h3>'+(wrong.map(a=>{const q=a.q,t=typeOf(q);return '<details><summary>'+esc(t==='ord'||t==='ordmc'?q.prompt+' · '+q.section:q.line)+'</summary>'+body(q)+(isOx(q)?'<p>내 답: '+a.choice+' · 정답: '+q.answer+'</p>':'')+explain(q,a)+'</details>';}).join('')||'<p>모두 맞혔어요!</p>')+'<div class="gox-actions">'+(wrong.length?btn('retry-wrong','틀린 문항만 다시 풀기'):'')+btn('start','다시 풀기 (새 10문항)','blue')+btn('home','작품·유형 다시 고르기')+'</div></div>';
   return;
  }
  const q=r.items[r.index],a=r.answers[r.index];
  host().innerHTML='<div class="card gox"><p>'+(r.index+1)+' / '+r.items.length+'문항'+(r.preview?' · 미리보기':'')+'</p>'+body(q)+controls(q,a)+'<div aria-live="polite">'+(a?'<h3>'+(a.correct?'정답입니다':'틀렸어요'+(isOx(q)?' · 정답 '+q.answer:''))+'</h3>'+explain(q,a)+(a.saveError?'<p role="alert">기록 저장에 실패했어요. 풀이는 계속할 수 있어요.</p>':'')+btn('next',r.index+1<r.items.length?'다음 문항':'결과 보기','blue'):'')+'</div>'+btn('leave','그만 풀기')+'</div>';
 }
 async function answer(choice){
  const r=run;if(!r||r.answers[r.index]||session?.id!==r.sid)return;
  const q=r.items[r.index];if(isOx(q)&&!['O','X'].includes(choice))return;
  const a={q,choice,correct:isCorrect(q,choice)};r.answers[r.index]=a;renderQuestion();
  if(r.preview)return;
  const row={id:r.id+':'+q.id,student_id:r.sid,set_id:r.id,question_id:q.id,topic:q.work,choice:isOx(q)?(choice==='O'?0:1):(a.correct?0:1),is_correct:a.correct,submitted_at:new Date().toISOString()};
  try{const res=await sb.from('grammar_ox_attempts').upsert(row,{onConflict:'set_id,question_id',ignoreDuplicates:true});if(res.error)throw res.error;}
  catch(e){a.saveError=true;console.warn('고전시가 퀴즈 기록 저장 실패',e?.message);if(run===r&&r.items[r.index]===q)renderQuestion();}
 }
 root.renderIldongOx=function(){
  root.syncIldongOxNav();if(!host())return;
  if(!allowed()){run=null;host().innerHTML='<div class="card gox"><p>한백고 학생에게 열리는 학습이에요.</p></div>';return;}
  if(run&&(run.sid!==session.id||run.preview!==preview()))run=null;
  if(run)renderQuestion();else home();
 };
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-ildong]');if(!b||!allowed()||b.disabled)return;const act=b.dataset.ildong,q=run?.items[run.index];
  if(act==='pick-work'&&WORKS[b.dataset.value]){sel.work=b.dataset.value;home();}
  else if(act==='pick-type'&&TYPES[b.dataset.value]){sel.type=b.dataset.value;home();}
  else if(act==='start'){if(run){sel.work=run.work;sel.type=run.type;}startRun(makeRound(poolFor(sel.work,all(),sel.type)),sel.work,sel.type);}
  else if(act==='answer'&&q)answer(isOx(q)?b.dataset.choice:Number(b.dataset.choice));
  else if(act==='tap'&&q&&!run.answers[run.index]){const p=Number(b.dataset.part);if(!q.pick.includes(p))q.pick.push(p);renderQuestion();}
  else if(act==='reset-order'&&q&&!run.answers[run.index]){q.pick=[];renderQuestion();}
  else if(act==='submit-order'&&q&&q.pick.length===q.parts.length)answer(q.pick.slice());
  else if(act==='next'&&run?.answers[run.index]){run.index++;renderQuestion();}
  else if(act==='retry-wrong'&&run)startRun(shuffle(run.answers.filter(a=>!a.correct).map(a=>a.q)),run.work,run.type);
  else if(act==='home'||act==='leave'){if(act==='leave'&&!confirm('그만 풀까요? 푼 문항은 기록에 남아요.'))return;run=null;home();}
 });
})(typeof window==='undefined'?globalThis:window);
