/* Current remediation, cumulative originals, private teacher drafts. */
let homeworkBusy=false,homeworkStop=false,homeworkRows=[],homeworkStudents=[],homeworkLog=[],homeworkRequests=new Map();
const homeworkRPC=(action,payload={})=>api('/api/homework',{action,...payload});
async function homeworkPage(){
 const [status,rows]=await Promise.all([api('/api/input-status'),homeworkRPC('list')]);homeworkStudents=status.items;homeworkRows=rows;
 const eligible=status.items.filter(s=>s.status==='active'&&s.submissions>0);
 $('main').innerHTML=heading('학생별 단계별 맞춤 과제','오답 진단 → 개념 보완 OX → 개념·확장·고난도 → 누적 오답 모음')+
 `<section class="card"><p>최신 답안 기준 · 재원 학생 중 제출 기록 ${eligible.length}명. 학생별로 순서대로 저장합니다. 자동 배부하지 않습니다.</p><p class="notice">현재 오답의 세부 개념·문제 유형과 일치하는 검수 문항을 난도별 최대 5개씩 담습니다. 과거에 틀렸다가 맞힌 문제는 누적 모음집에 보존합니다. 문항·근거가 부족하면 부족분을 표시합니다. OX는 근거 기반 AI 초안이며 정답·해설 확인이 필요합니다.</p><div class="row"><button class="primary" id="homework-all" ${homeworkBusy?'disabled':''}>전체 재원생 맞춤 과제 생성</button><button id="homework-stop" ${homeworkBusy?'':'disabled'}>현재 학생 완료 후 중단</button><button id="homework-refresh" ${homeworkBusy?'disabled':''}>현황 새로고침</button></div><p id="homework-progress" role="status">${homeworkBusy?'생성 중…':''}</p><div id="homework-log">${homeworkLog.map(x=>`<p>${E(x)}</p>`).join('')}</div></section>`+
 `<section class="card"><h2>학생별 제작 상태</h2><div class="table-wrap"><table><thead><tr><th>학생</th><th>현재 오답</th><th>개념 / 확장 / 고난도</th><th>보완 OX</th><th>작업</th></tr></thead><tbody>${eligible.map(s=>{const r=rows.find(r=>r.student_id===s.id);return `<tr><td>${E(s.name)}<br><small>${E(s.school)}</small></td><td>${N(s.wrong)}</td><td>${r?r.stages.map(x=>`${x.items.length}/${x.target}`).join(' · '):'미생성'}</td><td>${r?N(r.ox_count):'—'}</td><td><button data-homework-make="${E(s.id)}" ${homeworkBusy?'disabled':''}>${r?'최신 답안으로 재생성':'생성'}</button>${r?`<button data-homework-open="${E(r.id)}" data-student="${E(s.id)}">결과 · 인쇄</button><button data-homework-ox="${E(r.id)}" data-student="${E(s.id)}" ${homeworkBusy?'disabled':''}>OX 확인·생성</button>`:''}</td></tr>`;}).join('')}</tbody></table></div></section>`;
 on('homework-all',()=>homeworkGenerate(eligible));on('homework-stop',()=>{homeworkStop=true;});on('homework-refresh',homeworkPage);
 document.querySelectorAll('[data-homework-make]').forEach(b=>b.onclick=()=>action(()=>homeworkGenerate([homeworkStudents.find(s=>s.id===b.dataset.homeworkMake)]),b));
 document.querySelectorAll('[data-homework-open]').forEach(b=>b.onclick=()=>action(()=>homeworkPreview(b.dataset.homeworkOpen,b.dataset.student),b));
 document.querySelectorAll('[data-homework-ox]').forEach(b=>b.onclick=()=>action(async()=>{await api('/api/homework-ox',{id:b.dataset.homeworkOx,student_id:b.dataset.student});await homeworkPage();},b));
}
async function homeworkGenerate(students){
 if(homeworkBusy)return;homeworkBusy=true;homeworkStop=false;homeworkLog=[];
 document.querySelectorAll('#homework-all,#homework-refresh,[data-homework-make],[data-homework-ox]').forEach(b=>b.disabled=true);$('homework-stop').disabled=false;
 let done=0;
 try{for(const s of students){
  if(homeworkStop)break;$('homework-progress').textContent=`${done+1}/${students.length} · ${s.name}의 최신 오답·근거 확인 중…`;
  try{
   const request=homeworkRequests.get(s.id)||crypto.randomUUID();homeworkRequests.set(s.id,request);
   const r=await homeworkRPC('generate',{student_id:s.id,request_id:request});homeworkRequests.delete(s.id);
   let oxStatus='';try{await api('/api/homework-ox',{id:r.id,student_id:s.id});}catch(e){oxStatus=' · OX 생성 재시도 필요: '+e.message;}
   homeworkLog.push(`${s.name}: 과제·오답 모음 저장 · ${r.body.stages.map(x=>x.name+' '+x.items.length+'/'+x.target).join(', ')}${oxStatus}`);
  }catch(e){homeworkLog.push(`${s.name}: 미완료 · ${e.message}`);}
  done++;$('homework-log').innerHTML=homeworkLog.map(x=>`<p>${E(x)}</p>`).join('');
 }
 }finally{homeworkBusy=false;await homeworkPage();$('homework-progress').textContent=`${done}/${students.length}명 처리${homeworkStop?' · 중단됨':' · 완료'}. 부족 내역과 교사 검수 상태를 확인하세요.`;}
}
async function homeworkPreview(id,student_id){
 const r=await homeworkRPC('get',{id,student_id}),b=r.body,c=r.clinic;
 const current=new Set(b.current_wrongs.map(q=>q.exam_id+':'+q.question_index));
 const qhtml=(q,i)=>`<section class="q"><h3>${i+1}. ${E(q.source_title||q.evidence?.source_title||'개념 보완')}</h3>${q.match_reason?`<p>${E(q.origin_exam)} 연계 · ${E(q.match_reason)}</p>`:''}${questionMarkup(q,false)}</section>`;
 const keys=items=>`<section class="answers"><h2>교사용 정답·해설</h2>${items.map((q,i)=>`<section class="q"><b>${i+1}. ${E(q.answer||'확인 필요')}</b><p>${E(q.explanation||'해설 확인 필요')}</p>${q.evidence?`<p>근거: ${E(q.evidence.source_title)} ${E(q.evidence.page)}쪽<br>${E(q.evidence.quote)}</p>`:''}${questionImagesMarkup(q.explanation_images)}</section>`).join('')}</section>`;
 const stages=b.stages.map(s=>`<section class="clinic-print-part"><h1>${E(s.name)} 단계</h1><p>${s.items.length}/${s.target}문항${s.missing?' · 일치하는 검수 문항 '+s.missing+'개 부족':''}</p>${s.items.map(qhtml).join('')}${keys(s.items)}</section>`).join('');
 modal('학생별 맞춤 과제',`<div class="row no-print"><button id="homework-print">전체 인쇄 · PDF 저장</button><button id="homework-json">자료 JSON 저장</button><span>교사 검수 전 · 학생 미공개</span></div><div class="paper"><h1>${E(b.student_name)} · 맞춤 과제</h1><p>${E(new Date(r.created_at).toLocaleString('ko-KR'))}</p><p>${E(b.notice)}</p><h2>1. 오답 진단과 보완 순서</h2><p>현재 오답 ${b.current_wrong_count}개 · 누적 모음 ${c.wrongs.length}개 · 세부 개념 미분류 ${b.missing.unclassified}개</p><p>${b.needs.map(n=>E(n.concept)+' '+n.wrong+'회').join(' / ')||'세부 개념 분류가 필요합니다.'}</p>${c.diagnosis.map((d,i)=>`<section><p>${current.has(c.wrongs[i].exam_id+':'+c.wrongs[i].question_index)?'현재 보완 대상':'누적 이력 · 현재 답안 별도 확인'}</p>${clinicDiagnosisMarkup(d)}</section>`).join('')}<section class="clinic-print-part"><h1>2. 개념 보완 OX</h1>${b.ox.length?b.ox.map(qhtml).join('')+keys(b.ox):'<p>일치하는 검수 근거가 없거나 OX가 아직 생성되지 않았습니다. 근거를 확인한 뒤 보완하세요.</p>'}</section>${stages}<section class="clinic-print-part"><h1>3. 누적 오답 문제 모음</h1>${clinicKeyWarnings(c)}${c.wrongs.map(qhtml).join('')}${keys(c.wrongs)}</section></div>`);
 on('homework-print',()=>window.print());on('homework-json',()=>download(b.student_name+'-맞춤과제.json',JSON.stringify(r,null,2)));
}
titles.homework='학생별 단계별 맞춤 과제';const homeworkNavigate=navigate;navigate=async function(name){if(homeworkBusy){toast('현재 학생의 과제를 저장 중입니다. 중단 버튼을 누른 뒤 이동하세요.');return;}if(name!=='homework')return homeworkNavigate(name);page=name;charts.forEach(c=>c.destroy());charts=[];$('breadcrumb').textContent=titles.homework;document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));try{await homeworkPage();}catch(e){$('main').innerHTML=empty('맞춤 과제를 불러오지 못했습니다',e.message);}};
const homeworkNav=document.createElement('button');homeworkNav.dataset.page='homework';homeworkNav.textContent='▦ 단계별 맞춤 과제';homeworkNav.onclick=()=>action(()=>navigate('homework'),homeworkNav);document.querySelector('nav').append(homeworkNav);
const homeworkOldBlock=syncBlocked;syncBlocked=()=>homeworkBusy||page==='homework'||homeworkOldBlock();
window.addEventListener('beforeunload',e=>{if(homeworkBusy){e.preventDefault();e.returnValue='';}});
