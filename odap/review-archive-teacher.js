let reviewArchiveBusy=false,reviewArchiveDispose=null;
async function reviewArchiveTeacherPage(){
 await getStudents();
 const root=$('main');
 root.innerHTML=heading('주차별 오답 다시보기','학생이 자기 앱에서 원래 오답과 개별 보완 PDF를 주차별로 다시 봅니다.')+`<section class="card">${studentPicker()}<label>학생별 주차 자료<input id="ra-file" type="file" accept=".json,application/json"></label><button id="ra-preview">불러오기 · 미리보기</button><button id="ra-save" disabled>비공개 저장</button><button id="ra-publish" disabled>이 학생 앱에 공개</button><p id="ra-status" role="status"></p></section><section class="card"><h2>저장된 주차</h2><div data-review-saved></div></section><div data-review-preview></div>`;
 wireStudent();const studentId=String(sid),student=students.find(s=>String(s.id)===studentId),reader=window.reviewArchiveReader(root.querySelector('[data-review-preview]'));
 reviewArchiveDispose=reader.dispose;let packet=null,row=null;
 const call=(action,payload={})=>api('/api/review-archive',{action,payload});
 const valid=()=>page==='review-archive'&&String(sid)===studentId&&root.querySelector('#ra-file');
 const buttons=()=>{if(!valid())return;$('ra-save').disabled=!packet||!!row||reviewArchiveBusy;$('ra-publish').disabled=!row||row.status==='published'||reviewArchiveBusy;};
 const run=fn=>async()=>{if(reviewArchiveBusy)return;reviewArchiveBusy=true;const controls=[...root.querySelectorAll('input,select,button')],previous=controls.map(x=>x.disabled);controls.forEach(x=>x.disabled=true);try{await fn();}catch(error){if(valid())$('ra-status').textContent=error.message;}finally{reviewArchiveBusy=false;controls.forEach((x,i)=>x.disabled=previous[i]);buttons();}};
 const list=async()=>{if(!student)return;const rows=await call('list',{student_id:studentId});if(!valid())return;const target=root.querySelector('[data-review-saved]');target.innerHTML=rows.map(r=>`<p>${E(r.week_label)} · ${E(r.week_start)} · ${r.original_count}개 오답 / 보완 ${r.practice_count}문항 · ${r.status==='published'?'학생 공개':'비공개'} <button data-review-resume="${E(r.id)}">열기</button></p>`).join('')||'<p>등록된 주차별 자료가 없습니다.</p>';target.querySelectorAll('button').forEach(b=>b.onclick=run(async()=>{$('ra-status').textContent='저장된 자료를 열고 있습니다.';const data=await call('open',{id:b.dataset.reviewResume});if(!valid())return;packet=data.packet;row=data;reader.show(packet);$('ra-status').textContent=student.name+' · '+packet.week_label+' · '+(row.status==='published'?'공개된 자료입니다.':'미리보기를 확인하고 공개하세요.');}));};
 $('ra-preview').onclick=run(async()=>{
  packet=null;row=null;reader.clear();if(!student)throw Error('학생을 선택하세요.');
  const file=$('ra-file').files[0];if(!file||file.size>8*1024*1024)throw Error('8MB 이하의 학생별 자료 JSON을 선택하세요.');
  const {validateArchive}=await import('./review-archive-core.mjs');const candidate=validateArchive(JSON.parse(await file.text()));
  const school=schools.find(s=>String(s.id)===String(student.school_id))?.name;
  if(candidate.student_id!==studentId||candidate.school!==school)throw Error('파일의 학생·학교와 선택한 학생이 다릅니다.');
  packet=candidate;reader.show(packet);$('ra-status').textContent=student.name+' · '+packet.week_label+' · 원래 오답과 PDF를 확인한 뒤 저장하세요.';
 });
 $('ra-save').onclick=run(async()=>{if(!packet||packet.student_id!==studentId)throw Error('학생 자료를 먼저 불러오세요.');$('ra-status').textContent='비공개로 저장 중입니다.';row=await call('create',{packet});if(valid()){$('ra-status').textContent='저장 완료. 확인한 자료를 학생 앱에 공개할 수 있습니다.';await list();}});
 $('ra-publish').onclick=run(async()=>{if(!row||!packet||packet.student_id!==studentId)throw Error('학생 자료를 먼저 확인하세요.');$('ra-status').textContent='학생 앱에 연결 중입니다.';row=await call('publish',{id:row.id,confirmed:true});if(valid()){$('ra-status').textContent=student.name+' 학생 앱에 '+packet.week_label+' 자료를 공개했습니다.';await list();}});
 await list();buttons();
}
titles['review-archive']='주차별 오답 다시보기';
const reviewArchiveNavigate=navigate;
navigate=async function(name){
 if(reviewArchiveBusy){toast('자료 저장·공개가 끝난 뒤 이동하세요.');return;}
 if(name!=='review-archive'){reviewArchiveDispose?.();reviewArchiveDispose=null;return reviewArchiveNavigate(name);}
 if(privateWeeklyBusy||weeklyFeedbackBusy||homeworkBusy){toast('현재 처리가 끝난 뒤 이동하세요.');return;}
 reviewArchiveDispose?.();reviewArchiveDispose=null;page=name;charts.forEach(c=>c.destroy());charts=[];$('breadcrumb').textContent=titles[name];document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));await reviewArchiveTeacherPage();
};
const reviewArchiveNav=document.createElement('button');reviewArchiveNav.dataset.page='review-archive';reviewArchiveNav.textContent='▣ 주차별 오답 다시보기';reviewArchiveNav.onclick=()=>action(()=>navigate('review-archive'),reviewArchiveNav);document.querySelector('nav').append(reviewArchiveNav);
const reviewArchiveSyncBlocked=syncBlocked;syncBlocked=()=>reviewArchiveBusy||page==='review-archive'||reviewArchiveSyncBlocked();
