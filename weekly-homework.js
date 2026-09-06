/* Six required tasks share one server-calculated status for students and teachers. */
(function(root){
 'use strict';
 const tasks=[['vocab','이번 주 어휘','오늘의 어휘 시험을 모두 제출해요.','vocab'],['omr','과제 OMR 입력','지정된 필수 과제의 답안을 입력해요.','exam'],['qa','과제 질문 5개 골라서 하기','서로 다른 문제 5개를 골라 질문해요.','qa'],['notebook','클리닉 오답 노트','오답을 정리하고 사진으로 인증해요.','weekly-notebook'],['study','공부시간 확보','과제와 오답 정리를 함께 하고 회당 40분 이상 인증해요.','study'],['concept','개념 복습 OX','수업에서 배운 개념을 OX로 확인해요.','weekly-concept']];
 const labels={todo:'미완료',retry:'다시 풀기',pending:'선생님 확인 대기',rejected:'다시 제출',done:'완료',approved:'완료',unassigned:'등록 대기'};
 function complete(row){return tasks.every(([key])=>['done','approved'].includes(row.states[key]?.status));}
 function progress(row){return tasks.filter(([key])=>['done','approved'].includes(row.states[key]?.status)).length;}
 function parseQuestions(text){
  if(!text.trim())return [];
  return text.trim().split('\n').map((line,i)=>{const [prompt,answer,...explanation]=line.split('|').map(x=>x.trim());if(!prompt||!['O','X'].includes(answer))throw Error((i+1)+'번째 줄을 문항 | O 또는 X | 해설 형식으로 입력해주세요.');return {prompt,answer,explanation:explanation.join(' | ')};});
 }
 if(typeof module!=='undefined')module.exports={tasks,complete,progress,parseQuestions};
 if(typeof document==='undefined')return;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let plans=[],selected=null,week='',loadRun=0,busy=false;
 const el=id=>document.getElementById(id);
 const teacher=()=>session?.role==='teacher';
 const prefix=()=>teacher()?'t':'s';
 const dateKey=d=>{const x=new Date(d);const day=x.getDay();x.setDate(x.getDate()-(day===0?6:day-1));return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
 const badge=state=>'<span class="weekly-status '+esc(state.status)+'">'+esc(labels[state.status]||'확인 필요')+(state.total?' · '+Math.min(state.done||0,state.total)+'/'+state.total:'')+'</span>';
 async function rpc(action,payload){
  if(!weeklyLogin||padMode||studentPreviewMode)throw Error('이 기능은 본인 계정으로 로그인한 뒤 이용해주세요.');
  const r=await sb.rpc('weekly_homework_rpc',{p_id:weeklyLogin.id,p_password:weeklyLogin.pw,p_role:weeklyLogin.role,p_action:action,p_payload:payload});
  if(r.error)throw Error(r.error.code==='PGRST202'?'주간 과제 기능의 서버 설정이 아직 적용되지 않았어요.':r.error.message||'저장에 실패했습니다.');
  return r.data;
 }
 function myRow(plan){return plan.students.find(s=>s.id===session.id);}
 function planById(id){return plans.find(p=>p.id===id);}
 const actionButton=(action,text,attrs='')=>'<button class="btn" data-weekly-action="'+action+'" '+attrs+'>'+text+'</button>';
 function availableTasks(){
  return '<section class="weekly-plan"><h2>과제수행</h2><p>아래에서 등록된 과제를 확인하고 수행하세요. 주간 완료 현황은 선생님이 과제를 묶어 배정하면 표시돼요.</p><div class="weekly-tasks">'+tasks.map(([key,title,desc],i)=>'<button class="weekly-task" data-weekly-action="browse-task" data-task="'+key+'"><span class="weekly-number">'+(i+1)+'</span><span class="weekly-task-copy"><strong>'+esc(title)+'</strong><small>'+esc(desc)+'</small><span class="weekly-status">'+(['notebook','concept'].includes(key)?'주간 과제 배정 필요':'등록된 과제 보기')+'</span></span><span aria-hidden="true">→</span></button>').join('')+'</div></section>';
 }
 root.renderWeeklyHomework=async function(){
  const run=++loadRun,who=session?.id,host=el(prefix()+'-weekly-body');
  if(!host)return;
  if(!week)week=dateKey(new Date());
  el(prefix()+'-weekly-date').value=week;
  host.innerHTML='<p role="status">제출 기록을 확인하고 있어요…</p>';
  try{
   const data=await rpc('list',{week_start:week});
   if(run!==loadRun||session?.id!==who)return;
   plans=data||[];render();
  }catch(e){if(run===loadRun&&session?.id===who)host.innerHTML='<div class="weekly-empty" role="alert">'+esc(e.message)+'<p>확인하지 못한 기록은 미완료로 처리하지 않아요.</p>'+actionButton('refresh','다시 확인')+'</div>'+(!teacher()?availableTasks():'');}
 };
 function render(){
  const host=el(prefix()+'-weekly-body');
  if(!plans.length){host.innerHTML=teacher()?'<div class="weekly-empty">이 주에 등록된 필수 과제가 없어요.<p>반과 과제 목록을 지정해 등록해주세요.</p></div>':availableTasks();return;}
  host.innerHTML=plans.map(plan=>{
   const heading=(teacher()?actionButton('edit','과제 설정 수정','data-plan="'+plan.id+'"'):'')+'<div class="weekly-plan-head"><div><h2>'+esc(plan.title)+'</h2><p>'+esc(plan.week_start)+' 주간 · '+esc((STUDENT_CLASSES.find(c=>c.id===plan.group_id)||{}).label||plan.group_id)+'</p></div></div>';
   if(teacher())return '<section class="weekly-plan">'+heading+'<div class="weekly-table-wrap"><table class="weekly-table"><thead><tr><th>학생</th>'+tasks.map(t=>'<th>'+esc(t[1])+'</th>').join('')+'<th>전체</th></tr></thead><tbody>'+plan.students.map(row=>'<tr><th>'+esc(row.name)+'</th>'+tasks.map(([key])=>'<td>'+badge(row.states[key])+(key==='notebook'&&row.work.notebook?'<br>'+actionButton('review','사진 확인','data-plan="'+plan.id+'" data-student="'+esc(row.id)+'"'):'')+'</td>').join('')+'<td><strong>'+progress(row)+'/6</strong><br>'+(complete(row)?'전체 완료':'진행 중')+'</td></tr>').join('')+'</tbody></table></div></section>';
   const row=myRow(plan);if(!row)return '';
   return '<section class="weekly-plan">'+heading+'<div class="weekly-total"><strong>'+progress(row)+' / 6 완료</strong><span>'+(complete(row)?'이번 주 필수 과제를 모두 마쳤어요!':'여섯 가지를 모두 마치면 이번 주 과제 완료예요.')+'</span><progress value="'+progress(row)+'" max="6" aria-label="필수 과제 완료 수"></progress></div><div class="weekly-tasks">'+tasks.map(([key,title,desc,panel],i)=>'<button class="weekly-task" data-weekly-action="task" data-plan="'+plan.id+'" data-task="'+key+'"><span class="weekly-number">'+(i+1)+'</span><span class="weekly-task-copy"><strong>'+esc(title)+'</strong><small>'+esc(desc)+'</small>'+badge(row.states[key])+'</span><span aria-hidden="true">→</span></button>').join('')+'</div></section>';
  }).join('');
 }
 async function openTask(plan,key){
  selected=plan.id;
  if(myRow(plan).states[key].status==='unassigned'){notify('선생님이 이번 주 과제를 준비하고 있어요.','info');return;}
  if(key==='notebook'){sNav('weekly-notebook');renderNotebook();return;}
  if(key==='concept'){sNav('weekly-concept');renderConcept();return;}
  const t=tasks.find(t=>t[0]===key);sNav(t[3],key==='omr'?'homework':undefined);
  if(key==='qa'){const assigned=qaDb.weeks.find(w=>w.id===plan.config.qa_week_id);if(assigned){selectSQaSchool(assigned.school_id);selectSQaWeek(assigned.id);}}
  if(key==='vocab'){
   let target=el('s-weekly-vocab-links');
   if(!target){target=document.createElement('div');target.id='s-weekly-vocab-links';target.className='weekly-detail';document.querySelector('#page-student #panel-vocab').prepend(target);}
   target.innerHTML='<strong>'+esc(plan.title)+' · 지정된 어휘</strong><p>아래 강 번호의 시험을 모두 제출해요.</p>'+plan.config.vocab_units.map(n=>actionButton('vocab-unit',esc(n)+'강 시험 보기','data-unit="'+Number(n)+'"')).join(' ');target.hidden=false;
  }
  // Show the exact assigned links instead of leaving students to guess a homework list.
  if(key==='omr'){
   const target=el('s-weekly-links');
   target.innerHTML='<strong>이번 주 과제 OMR 입력</strong>';
   const r=await sb.from('exams').select('id,name,category,total_q').in('id',plan.config.exam_ids);
   if(r.error){target.textContent='필수 과제 목록을 불러오지 못했어요.';return;}
   target.innerHTML+=renderHomeworkEntry(r.data||[],sExamRespCache);target.hidden=false;
  }
 }
 function renderNotebook(){
  const plan=planById(selected),host=el('s-weekly-notebook');if(!plan){host.textContent='필수 과제 목록에서 오답 노트를 선택해주세요.';return;}
  const row=myRow(plan),work=row.work.notebook;
  host.innerHTML='<h2>'+esc(plan.title)+'</h2><p>클리닉에서 오답을 정리했으면 바로 촬영해 올려요. 집에서 정리하는 경우에는 지정된 해설 강의를 끝까지 듣고 촬영해 올려요.</p>'+badge(row.states.notebook)+
   (work?.data.feedback?'<p class="weekly-feedback">선생님: '+esc(work.data.feedback)+'</p>':'')+
   (work?photoLinks(work.data.photos):'')+
   (['approved','pending'].includes(work?.status)?'<p>제출한 사진을 선생님이 확인해요.</p>':'<form id="weekly-note-form"><fieldset><legend>어디에서 오답을 정리했나요?</legend><label><input type="radio" name="note-mode" value="clinic" checked> 클리닉에서 정리했어요</label><label><input type="radio" name="note-mode" value="home"> 집에서 해설 강의를 듣고 정리했어요</label></fieldset>'+ (plan.config.video_id?actionButton('video','지정된 클리닉 해설 보기','data-video="'+esc(plan.config.video_id)+'"'):'<p>집에서 제출할 해설 강의는 아직 지정되지 않았어요.</p>')+'<label class="weekly-file">오답 노트 사진 (최대 10장, 장당 10MB)<input id="weekly-note-files" type="file" accept="image/jpeg,image/png,image/webp" multiple required></label><button class="btn blue" type="submit">사진 제출하기</button></form>');
 }
 function photoLinks(paths){return '<div class="weekly-photos">'+(paths||[]).map(path=>{const url=sb.storage.from('exam-photos').getPublicUrl(path).data.publicUrl;return '<a href="'+esc(url)+'" target="_blank" rel="noopener"><img src="'+esc(url)+'" alt="제출한 오답 노트 사진" loading="lazy"></a>';}).join('')+'</div>';}
 async function submitNotebook(form){
  const plan=planById(selected),files=Array.from(el('weekly-note-files').files);
  if(!files.length||files.length>10)throw Error('사진을 1~10장 선택해주세요.');
  for(const f of files)if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10*1024*1024)throw Error('사진은 JPG·PNG·WEBP, 장당 10MB 이하여야 해요.');
  const paths=[];
  for(const f of files){const path='weekly-notes/'+session.id+'/'+plan.id+'/'+crypto.randomUUID()+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[f.type]);const r=await sb.storage.from('exam-photos').upload(path,f,{contentType:f.type});if(r.error)throw r.error;paths.push(path);}
  await rpc('notebook',{plan_id:plan.id,mode:new FormData(form).get('note-mode'),photos:paths});
  await root.renderWeeklyHomework();renderNotebook();notify('사진이 제출됐어요. 선생님 확인 후 완료돼요.','success');
 }
 function renderConcept(result){
  const plan=planById(selected),host=el('s-weekly-concept');if(!plan){host.textContent='필수 과제 목록에서 개념 OX를 선택해주세요.';return;}
  const work=myRow(plan).work.concept,qs=plan.config.questions;
  host.innerHTML='<h2>'+esc(plan.title)+'</h2><p>모든 문항을 맞히면 완료예요. 틀린 개념은 해설을 읽고 다시 풀어요.</p>'+(result?'<p role="status"><strong>'+result.score+' / '+result.total+' 정답</strong></p>':'')+(work?badge(myRow(plan).states.concept):'');
  if(!qs.length){host.innerHTML+='<p>선생님이 개념 OX를 준비하고 있어요.</p>';return;}
  if(work?.status==='approved'){host.innerHTML+='<p>개념 복습 OX를 모두 맞혔어요!</p>';return;}
  host.innerHTML+='<form id="weekly-concept-form">'+qs.map((q,i)=>'<fieldset class="weekly-question"><legend>'+(i+1)+'. '+esc(q.prompt)+'</legend><label><input type="radio" name="q'+i+'" value="O" required> O · 맞다</label><label><input type="radio" name="q'+i+'" value="X" required> X · 아니다</label>'+(result?'<p class="weekly-feedback">정답 '+esc(result.questions[i].answer)+' · '+esc(result.questions[i].explanation||'')+'</p>':'')+'</fieldset>').join('')+'<button type="submit" class="btn blue">채점하고 제출하기</button></form>';
 }
 async function submitConcept(form){
  const plan=planById(selected),fd=new FormData(form),answers=plan.config.questions.map((_,i)=>fd.get('q'+i));
  const result=await rpc('concept',{plan_id:plan.id,answers});await root.renderWeeklyHomework();renderConcept(result);
 }
 async function editor(plan){
  const host=el('t-weekly-editor');host.hidden=false;host.innerHTML='<p>과제 목록을 불러오는 중…</p>';
  const [exams,weeks]=await Promise.all([sb.from('exams').select('id,name,category,clinic_school').eq('category','homework'),sb.from('qa_weeks').select('id,name,school_id')]);
  if(exams.error||weeks.error)throw Error('과제 목록을 불러오지 못했어요. 다시 시도해주세요.');
  const options=(arr,label)=>arr.map(x=>'<option value="'+esc(x.id)+'">'+esc(label(x))+'</option>').join('');
  host.innerHTML='<form id="weekly-create-form"><h2>필수 과제 등록</h2><p>선택한 반의 학생들에게 6개 항목이 함께 배정돼요. 실제 수업 OX 문항과 해설을 입력해주세요.</p><label>과제 제목<input name="title" required maxlength="100" value="이번 주 필수 과제"></label><label>반<select name="group_id" required><option value="">반 선택</option>'+options(STUDENT_CLASSES,c=>c.label)+'</select></label><label>과제 OMR (여러 개 선택 가능)<select name="exam_ids" multiple size="5">'+options(exams.data,e=>(e.clinic_school?e.clinic_school+' · ':'')+e.name)+'</select></label><label>질문할 과제 주차<select name="qa_week_id" required><option value="">주차 선택</option>'+options(weeks.data,w=>schoolName(w.school_id)+' · '+w.name)+'</select></label><label>어휘 강 번호 (쉼표로 구분)<input name="vocab_units" placeholder="예: 1, 2, 3" value="'+esc(vocabCurrentWeekUnits().join(', '))+'"></label><label>집에서 오답할 때 들을 클리닉 해설<select name="video_id"><option value="">아직 지정하지 않음</option>'+options(clinicVideos(),v=>v.title)+'</select></label><label>개념 복습 OX (한 줄에 한 문항)<textarea name="questions" rows="8" placeholder="문항 내용 | O 또는 X | 정답 해설"></textarea></label><p>완료 기준: 질문 5개 · 과제와 오답을 합쳐 회당 40분 이상, 주 2회 · 오답 노트 교사 승인 · OX 전 문항 정답. 등록한 배정은 해당 주에 유지됩니다.</p><button class="btn blue" type="submit">'+esc(week)+' 주간 과제 등록</button></form>';
  if(plan){
   const form=el('weekly-create-form');form.dataset.plan=plan.id;
   form.elements.title.value=plan.title;form.elements.group_id.value=plan.group_id;form.elements.group_id.disabled=true;
   form.elements.qa_week_id.value=plan.config.qa_week_id;form.elements.video_id.value=plan.config.video_id||'';
   form.elements.vocab_units.value=plan.config.vocab_units.join(', ');
   Array.from(form.elements.exam_ids.options).forEach(o=>o.selected=plan.config.exam_ids.includes(o.value));
   form.elements.questions.value=plan.config.questions.map(q=>[q.prompt,q.answer,q.explanation||''].join(' | ')).join('\n');
   form.querySelector('[type="submit"]').textContent='과제 설정 저장';
  }

 }
 async function create(form){
  const fd=new FormData(form),units=String(fd.get('vocab_units')).split(',').map(x=>x.trim()).filter(Boolean).map(Number);
  if(units.some(x=>!Number.isInteger(x)||x<1))throw Error('어휘 강 번호는 양의 정수로 입력해주세요.');
  const questions=parseQuestions(String(fd.get('questions')));
  await rpc(form.dataset.plan?'update':'create',{plan_id:form.dataset.plan,week_start:week,title:fd.get('title'),group_id:form.elements.group_id.value,config:{exam_ids:fd.getAll('exam_ids'),qa_week_id:fd.get('qa_week_id'),vocab_units:[...new Set(units)],video_id:fd.get('video_id'),questions,question_target:5,study_count:2,study_minutes:40}});
  el('t-weekly-editor').hidden=true;await root.renderWeeklyHomework();notify('필수 과제를 등록했어요.','success');
 }
 function review(plan,studentId){
  const student=plan.students.find(s=>s.id===studentId),host=el('t-weekly-review');
  host.hidden=false;host.innerHTML='<h2>'+esc(student.name)+' · 클리닉 오답 노트</h2><p>'+esc(student.work.notebook.data.mode==='home'?'집에서 해설 시청 후 제출':'클리닉에서 제출')+'</p>'+photoLinks(student.work.notebook.data.photos)+'<label>학생에게 전할 말<textarea id="weekly-review-feedback" maxlength="1000">'+esc(student.work.notebook.data.feedback||'')+'</textarea></label>'+actionButton('approve','확인 완료','data-plan="'+plan.id+'" data-student="'+esc(studentId)+'"')+' '+actionButton('reject','다시 제출 요청','data-plan="'+plan.id+'" data-student="'+esc(studentId)+'"');host.scrollIntoView({block:'start'});
 }
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-weekly-action]');if(!b||busy)return;
  const a=b.dataset.weeklyAction;
  busy=true;b.disabled=true;
  try{
   if(a==='refresh')await root.renderWeeklyHomework();
   if(a==='create')await editor();
   if(a==='edit')await editor(planById(b.dataset.plan));
   if(a==='task')await openTask(planById(b.dataset.plan),b.dataset.task);
   if(a==='browse-task'){
    const task=tasks.find(t=>t[0]===b.dataset.task);if(!task)return;
    if(['notebook','concept'].includes(task[0]))notify('이 항목은 선생님이 주간 과제에 배정하면 제출할 수 있어요.','info');
    else sNav(task[3],task[0]==='omr'?'homework':undefined);
   }
   if(a==='review')review(planById(b.dataset.plan),b.dataset.student);
   if(a==='approve'||a==='reject'){await rpc('review',{plan_id:b.dataset.plan,student_id:b.dataset.student,status:a==='approve'?'approved':'rejected',feedback:el('weekly-review-feedback').value});el('t-weekly-review').hidden=true;await root.renderWeeklyHomework();}
   if(a==='video'){sNav('clinic-lectures');openPlay(b.dataset.video);}
   if(a==='exam')await sExamOpenForGrading(b.dataset.exam);
   if(a==='vocab-unit')await startVocabUnit(Number(b.dataset.unit));
  }catch(err){notify(err.message,'error');}finally{busy=false;b.disabled=false;}
 });
 document.addEventListener('submit',async e=>{
  const form=e.target;if(!['weekly-note-form','weekly-concept-form','weekly-create-form'].includes(form.id))return;
  e.preventDefault();if(busy)return;busy=true;const b=form.querySelector('[type="submit"]');b.disabled=true;
  try{if(form.id==='weekly-note-form')await submitNotebook(form);if(form.id==='weekly-concept-form')await submitConcept(form);if(form.id==='weekly-create-form')await create(form);}catch(err){notify(err.message,'error');}finally{busy=false;b.disabled=false;}
 });
 document.addEventListener('change',e=>{if(e.target.matches('[data-weekly-date]')){week=dateKey(e.target.value+'T12:00:00');root.renderWeeklyHomework();}});
 root.weeklyHomeReset=function(){plans=[];selected=null;week='';loadRun++;};
})(typeof window==='undefined'?globalThis:window);
