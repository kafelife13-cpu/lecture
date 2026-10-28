/* Teacher packets stay private; the server exposes only OX items to students. */
let privateWeeklyBusy=false;
const privateWeeklyImages=q=>(q.images||[]).filter(i=>/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(i.data||'')).map(i=>`<img src="${i.data}" alt="${E(i.alt||'문항 원문')}">`).join('');
function privateWeeklyPrintDocument(packet,student,week,answers=false){
 const items=packet.items.filter(q=>q.type==='mcq');
 if(items.length!==20||packet.review?.provider!=='anthropic'||packet.review?.state!=='passed')throw Error('Claude 검수를 통과한 객관식 20문항만 인쇄할 수 있습니다.');
 const font=new URL('../assets/fonts/NotoSansOldHangul-Regular.woff2',window.location.href).href;
 return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>객관식 ${answers?'정답·해설':'문제지'}</title><style>@font-face{font-family:OldHangul;src:url('${font}')}@page{size:A4;margin:16mm}body{font:11pt/1.65 OldHangul,'Malgun Gothic',sans-serif;color:#111}h1{font-size:18pt}header{border-bottom:2px solid #222;margin-bottom:18px}article{break-inside:avoid;margin-bottom:24px}h2{font-size:12pt;white-space:pre-wrap}p{white-space:pre-wrap;overflow-wrap:anywhere}img{display:block;max-width:100%;max-height:220mm;object-fit:contain}li{white-space:pre-wrap;padding-bottom:4px}.blank{height:24px}.toolbar{font-family:sans-serif}@media print{.toolbar{display:none}}</style><div class="toolbar"><button onclick="window.print()">인쇄</button></div><header><h1>국어왕 · 객관식 ${answers?'정답·해설':'문제지'}</h1><p>${E(student)} · ${E(week)} 주차 · 20문항</p></header>${items.map((q,i)=>answers?`<article><h2>${i+1}번 · 정답 ${E(q.answer)}</h2><p>${E(q.explanation)}</p></article>`:`<article><h2>${i+1}. ${E(q.text)}</h2>${q.passage?`<p>${E(q.passage)}</p>`:''}${privateWeeklyImages(q)}<ol>${(q.choices||[]).map(c=>`<li>${E(c)}</li>`).join('')}</ol><div class="blank">답: __________</div></article>`).join('')}</html>`;
}
async function privateWeeklyTeacherPage(){
 await getStudents();
 $('main').innerHTML=heading('개인 주간 자료','Claude가 문항을 검수합니다. 객관식은 인쇄용, OX만 학생 앱에 게시됩니다.')+`<section class="card">${studentPicker()}<label>주차 시작일<input id="pw-week" type="date"></label><label>문항·출처 자료 JSON<input id="pw-file" type="file" accept="application/json,.json"></label><p>학교 프린트·작년 기출 근거로 OX를 생성하고 객관식과 함께 Claude가 검수합니다. 모든 문항이 통과해야 OX가 게시됩니다. 불명확한 근거나 검수 오류는 게시를 보류합니다.</p><button id="pw-preview">파일 불러오기</button><div id="pw-preview-body"></div><button id="pw-create" disabled>저장 · OX 자동 생성 · Claude 검수</button><button id="pw-generate" disabled>OX 다시 생성 · Claude 검수</button><button id="pw-publish" disabled>현재 문항 Claude 검수 · OX 게시</button><button id="pw-print" disabled>객관식 문제지 인쇄</button><button id="pw-print-answers" disabled>객관식 정답·해설 인쇄</button><p id="pw-status" role="status"></p></section>`;
 wireStudent();let packet=null,assignment=null,assignmentStatus=null,loadedStudent=String(sid),week='';
 const call=(action,payload)=>api('/api/private-weekly',{action,payload});
 const buttons=()=>{
  const draft=!!assignment&&assignmentStatus==='draft';
  $('pw-create').disabled=!packet||!!assignment;
  $('pw-generate').disabled=!draft;
  $('pw-publish').disabled=!assignment||assignmentStatus==='published'||(assignmentStatus==='approved'&&packet?.review?.state!=='passed');
  const printable=packet?.review?.provider==='anthropic'&&packet?.review?.state==='passed'&&packet.items.filter(q=>q.type==='mcq').length===20;
  $('pw-print').disabled=!printable;$('pw-print-answers').disabled=!printable;
  $('pw-week').disabled=!!assignment;
 };
 const guarded=async fn=>{
  if(privateWeeklyBusy)return;
  const controls=[...$('main').querySelectorAll('input,select,button')],disabled=controls.map(el=>el.disabled);
  privateWeeklyBusy=true;controls.forEach(el=>el.disabled=true);
  try{return await fn();}finally{privateWeeklyBusy=false;controls.forEach((el,i)=>el.disabled=disabled[i]);buttons();}
 };
 const preview=()=>{$('pw-preview-body').innerHTML=`<h3>${E(packet.title)}</h3><p>${packet.items.filter(q=>q.type==='mcq').length} 객관식(인쇄용) · ${packet.items.filter(q=>q.type==='ox').length} OX(학생 앱)</p>`+packet.items.map((q,i)=>`<details><summary>${i+1}. ${E(q.text)}</summary><p class="passage">${E(q.passage||'')}</p>${privateWeeklyImages(q)}<ol>${(q.choices||[]).map(c=>`<li>${E(c)}</li>`).join('')}</ol><p>정답 ${E(q.answer)}</p><p>${E(q.explanation)}</p><p>${E(JSON.stringify(q.evidence||[]))}</p></details>`).join('');};
 const load=async id=>{const result=await call('open',{id});packet=result.packet;assignment=result.id;assignmentStatus=result.status;week=result.week_start;$('pw-week').value=week;preview();};
 const review=async generate=>{
  if(!assignment)throw Error('저장된 자료를 먼저 선택하세요.');
  try{
   if(generate){$('pw-status').textContent='저장된 근거로 OX 20문항을 생성하고 있습니다.';await call('generate_ox',{id:assignment});}
   $('pw-status').textContent='Claude가 객관식과 OX를 검수하고 있습니다. 통과한 경우 OX만 자동 게시합니다.';
   await call('review_publish',{id:assignment});await load(assignment);
   $('pw-status').textContent='Claude 검수 통과 · OX 20문항 게시 완료. 객관식 20문항은 교사용 인쇄 버튼으로 출력하세요.';
  }catch(error){
   // Recover the durable state after a lost response; never announce a guessed success.
   let recovered=false;try{await load(assignment);recovered=assignmentStatus==='published'&&packet.review?.state==='passed';}catch{}
   if(recovered){$('pw-status').textContent='서버에 완료된 Claude 검수·OX 게시 결과를 복구했습니다. 객관식은 인쇄용으로만 제공됩니다.';return;}
   $('pw-status').textContent='자동 처리 미완료: '+error.message+' 저장된 자료를 불러와 다시 시도할 수 있습니다.';throw error;
  }
 };
 on('pw-preview',()=>guarded(async()=>{
  packet=null;assignment=null;assignmentStatus=null;$('pw-preview-body').innerHTML='';
  const file=$('pw-file').files[0];if(!file)throw Error('자료 JSON 파일을 선택하세요.');
  const data=JSON.parse(await file.text()),candidate=data.packet||data;
  if(data.student_id&&String(data.student_id)!==String(sid))throw Error('파일의 학생과 선택한 학생이 다릅니다.');
  if(!Array.isArray(candidate.items)||candidate.items.length!==40||candidate.items.filter(q=>q.type==='mcq').length!==20||candidate.items.filter(q=>q.type==='ox').length!==20)throw Error('객관식 20문항과 OX 20문항이 있는 자료가 필요합니다.');
  // A local JSON cannot assert a server review pass or enable printing.
  packet=structuredClone(candidate);delete packet.review;loadedStudent=String(sid);
  if(data.week_start)$('pw-week').value=data.week_start;preview();$('pw-status').textContent='자료를 불러왔습니다. 저장하면 OX 생성과 Claude 검수를 시작합니다.';
 }));
 on('pw-create',()=>guarded(async()=>{
  if(!sid||!packet||loadedStudent!==String(sid))throw Error('학생을 선택하고 해당 학생의 자료를 불러오세요.');
  const studentId=String(sid),weekStart=$('pw-week').value,content=structuredClone(packet),student=students.find(s=>String(s.id)===studentId);
  if(!student)throw Error('학생 정보를 확인하세요.');
  $('pw-status').textContent='비공개 자료를 저장하는 중입니다.';
  const rows=await call('list',{student_id:studentId}),existing=rows.find(r=>r.week_start===weekStart);
  if(existing){if(existing.status!=='draft')throw Error('이 주차의 승인·게시 자료를 아래 목록에서 불러오세요.');await call('revise',{id:existing.id,packet:content});assignment=existing.id;assignmentStatus='draft';}
  else{const created=await call('create',{student_id:studentId,school:student.school,week_start:weekStart,packet:content});assignment=created.id;assignmentStatus=created.status||'draft';}
  week=weekStart;await review(true);
 }));
 on('pw-generate',()=>guarded(()=>review(true)));
 on('pw-publish',()=>guarded(()=>review(false)));
 const print=answers=>{
  if(privateWeeklyBusy)throw Error('자동 처리가 끝난 뒤 인쇄하세요.');
  const student=students.find(s=>String(s.id)===loadedStudent);
  const html=privateWeeklyPrintDocument(packet,student?.name||loadedStudent,week,answers),popup=window.open('','_blank');
  if(!popup)throw Error('인쇄 창을 열 수 없습니다. 이 사이트의 팝업을 허용해 주세요.');
  popup.opener=null;popup.document.open();popup.document.write(html);popup.document.close();
  // The visible Print button remains available if automatic print is restricted.
  popup.onload=async()=>{await popup.document.fonts?.ready;await Promise.all([...popup.document.images].map(i=>i.complete?Promise.resolve():new Promise(resolve=>{i.onload=resolve;i.onerror=resolve;})));popup.print();};
 };
 on('pw-print',()=>print(false));on('pw-print-answers',()=>print(true));
 const autoSection=document.createElement('section');autoSection.className='card';autoSection.innerHTML='<h2>클리닉 입력 자동 처리</h2><p>입력된 클리닉 오답의 생성·검수 상태입니다. 보류된 자료는 학생에게 게시되지 않습니다. 근거를 보완하기 전에는 자동 재시도를 하지 않습니다.</p><button id="pw-auto-refresh">자동 처리 상태 새로고침</button><div id="pw-auto-status" role="status">학생을 선택하세요.</div>';$('main').append(autoSection);
 const statusStudentId=sid?String(sid):'';
 const refreshAuto=async()=>{
  if(!statusStudentId)return;
  try{
   const rows=await call('auto_status',{student_id:statusStudentId});
   if(!autoSection.isConnected||String(sid)!==statusStudentId)return;
   if(!Array.isArray(rows))throw Error('자동 처리 상태 응답이 올바르지 않습니다.');
   const labels={pending:'대기',processing:'처리 중',blocked:'보류',published:'OX 게시 완료'},phases={generate:'문항 생성',review:'Claude 검수'};
   $('pw-auto-status').innerHTML=rows.map(r=>`<div><strong>${E(r.week_start)} · ${E(labels[r.status]||r.status)}</strong><p>${E(phases[r.phase]||r.phase||'')} · ${E(r.updated_at||'')}</p>${r.error?`<p>보류 사유: ${E(r.error)}</p>`:''}</div>`).join('')||'이 학생의 자동 처리 기록이 없습니다.';
  }catch(error){if(autoSection.isConnected&&String(sid)===statusStudentId)$('pw-auto-status').textContent='자동 처리 상태를 불러오지 못했습니다. 서버 설치·연결을 확인하세요. '+error.message;}
 };
 on('pw-auto-refresh',()=>guarded(refreshAuto));
 await refreshAuto();
 const saved=document.createElement('section');saved.className='card';saved.innerHTML='<h2>저장된 주간 자료</h2><div id="pw-existing">학생을 선택하세요.</div>';$('main').append(saved);
 const listStudentId=String(sid);if(sid)try{
  const rows=await call('list',{student_id:listStudentId});if(!saved.isConnected||String(sid)!==listStudentId)return;
  $('pw-existing').innerHTML=rows.map(r=>`<p>${E(r.week_start)} · ${E(r.title)} · ${E(r.status)} <button data-resume-weekly="${E(r.id)}">자료 불러오기</button></p>`).join('')||'저장된 자료가 없습니다.';
  saved.querySelectorAll('[data-resume-weekly]').forEach(b=>b.onclick=()=>action(()=>guarded(async()=>{await load(b.dataset.resumeWeekly);loadedStudent=listStudentId;$('pw-status').textContent=assignmentStatus==='published'?'게시된 자료를 불러왔습니다. 학생에게는 OX만 제공됩니다.':'저장된 자료를 불러왔습니다. Claude 검수를 이어갈 수 있습니다.';}),b));
 }catch(error){if(saved.isConnected&&String(sid)===listStudentId)$('pw-existing').textContent=error.message;}
 buttons();
}

titles['private-weekly']='개인 주간 테스트';
const privateWeeklyNavigate=navigate;
navigate=async function(name){if(privateWeeklyBusy){toast('개인 자료 자동 처리가 끝난 뒤 이동하세요.');return;}if(name!=='private-weekly')return privateWeeklyNavigate(name);if(weeklyFeedbackBusy||homeworkBusy)throw Error('생성 완료 후 이동하세요.');page=name;charts.forEach(c=>c.destroy());charts=[];$('breadcrumb').textContent=titles[name];document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));await privateWeeklyTeacherPage();};
const privateWeeklyNav=document.createElement('button');privateWeeklyNav.dataset.page='private-weekly';privateWeeklyNav.textContent='▦ 개인 주간 테스트';privateWeeklyNav.onclick=()=>action(()=>navigate('private-weekly'),privateWeeklyNav);document.querySelector('nav').append(privateWeeklyNav);
const privateWeeklySyncBlocked=syncBlocked;syncBlocked=()=>privateWeeklyBusy||page==='private-weekly'||privateWeeklySyncBlocked();
