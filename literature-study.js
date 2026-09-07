(function(root){
 'use strict';
 const LIMIT=1800000,STALE=45000;
 function elapsed(s,now){return Math.min(LIMIT,(s?.segments||[]).reduce((n,p)=>n+Math.max(0,(s.running&&p===s.segments.at(-1)?Math.max(p.end,now):p.end)-p.start),0));}
 function advance(s,now){if(!s?.running)return s;const p=s.segments.at(-1),prior=s.segments.slice(0,-1).reduce((n,p)=>n+p.end-p.start,0);p.end=Math.max(p.end,Math.min(now,p.start+LIMIT-prior));s.beat=now;if(elapsed(s,now)>=LIMIT)s.running=false;return s;}
 function payload(s,p){return {id:p.id,student_id:s.student,start_time:new Date(p.start).toISOString(),end_time:new Date(p.end).toISOString(),away_seconds:0,away_log:JSON.stringify([{kind:'literature',exam_id:s.exam,title:s.title,running:s.running&&p===s.segments.at(-1),sec:0}])};}
 if(typeof module!=='undefined')module.exports={elapsed,advance,payload,LIMIT};
 if(typeof document==='undefined')return;
 let busy=false,lastError='';
 const key=()=>session?'literature_study_v1_'+session.id:null;
 function read(){const k=key();if(!k)return null;return JSON.parse(localStorage.getItem(k)||'null');}
 function put(s){localStorage.setItem(key(),JSON.stringify(s));}
 const allowed=()=>session?.role==='student'&&!studentPreviewMode&&!padMode;
 async function locked(fn){if(busy)return;busy=true;try{if(!navigator.locks)throw Error('타이머는 최신 Chrome, Edge 또는 Safari에서 이용해주세요.');return await navigator.locks.request(key(),fn);}catch(e){lastError=e.message;notify(e.message,'error');return false;}finally{busy=false;root.renderLiteratureStudy?.();}}
 async function save(s){
  if(session?.id!==s.student)throw Error('학습시간을 저장하려면 같은 학생으로 로그인해주세요.');
  put(s);
  for(const p of s.segments){if(p.saved===p.end&&p.savedRunning===(s.running&&p===s.segments.at(-1)))continue;
   const res=await sb.from('study_sessions').upsert(payload(s,p),{onConflict:'id'});if(res.error)throw res.error;
   p.saved=p.end;p.savedRunning=s.running&&p===s.segments.at(-1);if(session?.id===s.student)put(s);
  }
  lastError='';if(typeof studyDb!=='undefined'&&session?.id===s.student){for(const p of s.segments){const row=payload(s,p),i=studyDb.sessions.findIndex(x=>x.id===p.id);if(i<0)studyDb.sessions.push(row);else studyDb.sessions[i]=row;}}
  if(!s.running&&typeof loadStudyTotals==='function')await loadStudyTotals();
 }
 async function current(){const s=read();if(s?.running&&Date.now()-s.beat>STALE){s.running=false;put(s);await save(s);lastError='연결이 끊겨 마지막 기록 시점에 일시정지했어요. 다시 시작해주세요.';}return s;}
 root.literatureStudyBusy=async function(){
  if(read()?.running)return true;
  const r=await sb.from('study_sessions').select('id,away_log,end_time').eq('student_id',session.id).like('id','lit_%').gte('end_time',new Date(Date.now()-STALE).toISOString());if(r.error)throw r.error;
  return (r.data||[]).some(x=>{try{return JSON.parse(x.away_log||'[]').some(e=>e.kind==='literature'&&e.running);}catch(e){return false;}});
 };
 root.startLiteratureStudy=()=>locked(async()=>{
  if(!allowed()||!isLiteratureExam(sExamData))return;
  let s=await current();if(s?.running){if(s.exam!==sExamData.id)throw Error('진행 중인 다른 회차 타이머를 먼저 일시정지해주세요.');return;}
  if(s)await save(s);
  const active=await sb.from('study_sessions').select('id').eq('student_id',session.id).is('end_time',null);if(active.error)throw active.error;if(active.data?.length)throw Error('진행 중인 과제 타이머를 먼저 종료해주세요.');
  if(await literatureStudyBusy())throw Error('다른 기기에서 문학 타이머가 실행 중이에요. 먼저 일시정지해주세요.');
  if(!s||s.exam!==sExamData.id)s={student:session.id,exam:sExamData.id,title:sExamData.name,segments:[],running:false};
  if(elapsed(s,Date.now())>=LIMIT)throw Error('30분 풀이를 마쳤어요. 답안을 제출해주세요.');
  const now=Date.now();s.segments.push({id:'lit_'+crypto.randomUUID(),start:now,end:now});s.running=true;s.beat=now;
  try{await save(s);}catch(e){s.running=false;put(s);throw e;}
 });
 root.pauseLiteratureStudy=()=>locked(async()=>{if(!allowed())return;const s=await current();if(!s)return;advance(s,Date.now());s.running=false;await save(s);});
 root.finishLiteratureStudy=async function(){if(!allowed())return true;return await root.pauseLiteratureStudy();};
 root.retryLiteratureStudy=()=>locked(async()=>{if(!allowed())return;const s=await current();if(s)await save(s);});
 root.renderLiteratureStudy=function(){
  const host=document.querySelector('.lit-exam-tools');if(!host||!isLiteratureExam(sExamData))return;
  let box=host.querySelector('.lit-study');if(!box){box=document.createElement('div');box.className='lit-study';host.append(box);}
  let s;try{s=read();}catch(e){lastError='이 브라우저에서 임시 저장을 사용할 수 없어요.';}
  const mine=s?.exam===sExamData.id,ms=mine?elapsed(s,Date.now()):0,remaining=Math.max(0,Math.ceil((LIMIT-ms)/1000)),clock=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
  const result=document.getElementById('s-exam-result').style.display!=='none';
  const signature=JSON.stringify([mine,!!s?.running,result,busy,allowed(),lastError,ms>=LIMIT]);
  const label='풀이 시간 '+Math.floor(ms/60000)+'분 '+Math.floor(ms/1000)%60+'초 · '+(mine&&s.running?'진행 중':'일시정지');
  if(box.dataset.state===signature){box.querySelector('[role=timer]').textContent=clock;box.querySelector('.lit-study-elapsed').textContent=label;return;}box.dataset.state=signature;
  box.innerHTML='<strong>30분 풀이 타이머 · <span role="timer">'+clock+'</span></strong><p class="lit-study-elapsed">'+label+'</p><div class="lit-actions">'+(!result?'<button class="btn blue" onclick="startLiteratureStudy()" '+(!allowed()||busy||mine&&s.running||ms>=LIMIT?'disabled':'')+'>'+(ms?'계속 풀기':'타이머 시작')+'</button><button class="btn" onclick="pauseLiteratureStudy()" '+(!allowed()||busy||!mine||!s.running?'disabled':'')+'>일시정지·시간 저장</button>':'')+'<button class="btn" onclick="retryLiteratureStudy()" '+(!allowed()||busy||!mine?'disabled':'')+'>학습시간 저장 확인</button></div><p role="status">'+(lastError?lastError.replace(/[<>]/g,''):'실제로 작동한 시간만 누적 학습시간에 저장됩니다. 30분에 자동 정지하며, 답안은 직접 제출하세요. PDF를 보러 가도 타이머는 계속됩니다.')+'</p>';
 };
 setInterval(()=>{
  if(!allowed())return;
  root.renderLiteratureStudy();
  const s=read();if(!s?.running||Date.now()-s.beat<15000||busy)return;
  locked(async()=>{const fresh=await current();if(!fresh?.running)return;advance(fresh,Date.now());try{await save(fresh);}catch(e){fresh.running=false;put(fresh);throw Error('학습시간 저장 실패로 일시정지했어요. 저장 확인을 눌러 다시 시도해주세요.');}});
 },1000);
 window.addEventListener('storage',()=>root.renderLiteratureStudy());
})(typeof window==='undefined'?globalThis:window);
