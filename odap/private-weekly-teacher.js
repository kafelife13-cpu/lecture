/* Private packet import; content is sent only to the authenticated Drive gateway. */
let privateWeeklyBusy=false;
async function privateWeeklyTeacherPage(){
 await getStudents();
 $('main').innerHTML=heading('개인 주간 테스트 게시','객관식 20문항과 OX 20문항을 검수하고 선택한 학생에게 배정합니다.')+`<section class="card">${studentPicker()}<label>주차 시작일<input id="pw-week" type="date"></label><label>검수 자료 JSON<input id="pw-file" type="file" accept="application/json,.json"></label><p>문항 본문은 비공개 드라이브에 저장하며 학생과 주차별로 한 번만 제출할 수 있습니다.</p><button id="pw-preview">파일 검토</button><div id="pw-preview-body"></div><label class="check"><input id="pw-confirm" type="checkbox">대상 학생·주차·원문·정답·해설과 학교 프린트·작년 기출 근거를 확인했습니다.</label><button id="pw-create" disabled>검수 자료 저장</button><button id="pw-publish" disabled>이 학생에게 게시</button><p id="pw-status" role="status"></p></section>`;
 wireStudent();let packet=null,assignment=null;
 const call=(action,payload)=>api('/api/private-weekly',{action,payload});
 const guarded=async fn=>{if(privateWeeklyBusy)return;const picker=$('student-picker'),wasDisabled=picker?.disabled;privateWeeklyBusy=true;if(picker)picker.disabled=true;try{return await fn();}finally{privateWeeklyBusy=false;if(picker)picker.disabled=wasDisabled;}};
 on('pw-preview',()=>guarded(async()=>{$('pw-confirm').checked=false;$('pw-create').disabled=true;$('pw-publish').disabled=true;const file=$('pw-file').files[0];if(!file)throw Error('자료 JSON 파일을 선택하세요.');const data=JSON.parse(await file.text());packet=data.packet||data;assignment=null;$('pw-create').disabled=true;$('pw-publish').disabled=true;if(data.week_start)$('pw-week').value=data.week_start;if(data.student_id&&String(data.student_id)!==String(sid))throw Error('파일의 학생과 선택한 학생이 다릅니다.');if(!Array.isArray(packet.items)||packet.items.length!==40)throw Error('40문항 파일이 필요합니다.');$('pw-preview-body').innerHTML=`<h3>${E(packet.title)}</h3><p>${packet.items.filter(q=>q.type==='mcq').length} 객관식 · ${packet.items.filter(q=>q.type==='ox').length} OX</p>`+packet.items.map((q,i)=>`<details><summary>${i+1}. ${E(q.text)}</summary><p class="passage">${E(q.passage||'')}</p>${(q.images||[]).filter(x=>/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(x.data||'')).map(x=>`<img style="max-width:100%" src="${x.data}" alt="문제 원문">`).join('')}<ol>${(q.choices||[]).map(c=>`<li>${E(c)}</li>`).join('')}</ol><p>정답 ${E(q.answer)}</p><p>${E(q.explanation)}</p><p>${E(JSON.stringify(q.evidence||[]))}</p></details>`).join('');$('pw-create').disabled=false;$('pw-confirm').checked=false;$('pw-week').disabled=false;}));
 on('pw-create',async()=>{
  if(privateWeeklyBusy)return;
  if(!sid||!packet||!$('pw-confirm').checked)throw Error('학생과 파일을 선택하고 검수 확인을 체크하세요.');
  const studentId=String(sid),weekStart=$('pw-week').value,content=structuredClone(packet),student=students.find(s=>String(s.id)===studentId);
  const controls=[...$('main').querySelectorAll('input,select,button')],disabled=controls.map(el=>el.disabled);privateWeeklyBusy=true;controls.forEach(el=>{el.disabled=true;});let approved=false;
  try{
   $('pw-status').textContent='비공개 자료를 저장하는 중입니다.';
   const rows=await call('list',{student_id:studentId}),existing=rows.find(r=>r.week_start===weekStart);
   if(existing){if(existing.status!=='draft')throw Error('이 주차는 이미 승인 또는 게시되었습니다. 저장된 자료에서 이어서 진행하세요.');assignment=existing.id;await call('revise',{id:assignment,packet:content});}
   else{const created=await call('create',{student_id:studentId,school:student.school,week_start:weekStart,packet:content});assignment=created.id;}
   await call('approve',{id:assignment,confirmed:true});approved=true;$('pw-status').textContent='저장 및 검수 승인 완료. 학생에게 게시할 수 있습니다.';
  }finally{privateWeeklyBusy=false;controls.forEach((el,i)=>{el.disabled=disabled[i];});if(approved){$('pw-publish').disabled=false;$('pw-create').disabled=true;$('pw-week').disabled=true;}}
 });
 on('pw-publish',()=>guarded(async()=>{if(!assignment||!$('pw-confirm').checked)throw Error('검수 저장을 먼저 완료하세요.');await call('publish',{id:assignment,confirmed:true});$('pw-publish').disabled=true;$('pw-status').textContent='게시 완료. 해당 학생의 나의 오답정리 → 나의 주간 테스트에서 응시할 수 있습니다.';}));
 const saved=document.createElement('section');saved.className='card';saved.innerHTML='<h2>저장된 주간 테스트</h2><div id="pw-existing">학생을 선택하세요.</div>';$('main').append(saved);
 const listStudentId=String(sid);if(sid)try{const rows=await call('list',{student_id:listStudentId});if(!saved.isConnected||String(sid)!==listStudentId)return;$('pw-existing').innerHTML=rows.map(r=>`<p>${E(r.week_start)} · ${E(r.title)} · ${E(r.status)} ${r.status==='approved'?`<button data-resume-weekly="${E(r.id)}">승인 자료 불러오기</button>`:''}</p>`).join('')||'저장된 자료가 없습니다.';saved.querySelectorAll('[data-resume-weekly]').forEach(b=>b.onclick=()=>action(()=>guarded(async()=>{const loaded=await call('open',{id:b.dataset.resumeWeekly});packet=loaded.packet;assignment=loaded.id;$('pw-week').value=loaded.week_start;$('pw-week').disabled=true;$('pw-preview-body').textContent=packet.title+' · 승인된 40문항';$('pw-create').disabled=true;$('pw-publish').disabled=false;$('pw-confirm').checked=false;}),b));}catch(error){if(saved.isConnected&&String(sid)===listStudentId)$('pw-existing').textContent=error.message;}
}
titles['private-weekly']='개인 주간 테스트';
const privateWeeklyNavigate=navigate;
navigate=async function(name){if(privateWeeklyBusy){toast('개인 테스트 저장이 끝난 뒤 이동하세요.');return;}if(name!=='private-weekly')return privateWeeklyNavigate(name);if(weeklyFeedbackBusy||homeworkBusy)throw Error('생성 완료 후 이동하세요.');page=name;charts.forEach(c=>c.destroy());charts=[];$('breadcrumb').textContent=titles[name];document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));await privateWeeklyTeacherPage();};
const privateWeeklyNav=document.createElement('button');privateWeeklyNav.dataset.page='private-weekly';privateWeeklyNav.textContent='▦ 개인 주간 테스트';privateWeeklyNav.onclick=()=>action(()=>navigate('private-weekly'),privateWeeklyNav);document.querySelector('nav').append(privateWeeklyNav);
const privateWeeklySyncBlocked=syncBlocked;syncBlocked=()=>privateWeeklyBusy||page==='private-weekly'||privateWeeklySyncBlocked();
