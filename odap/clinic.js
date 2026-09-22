/* One entry point, five independently inspectable results. All outputs stay private drafts. */
let clinicExam='all',clinicRun=null,clinicBusy=false,clinicRequest=null,clinicPoll=null,clinicViewSequence=0;
const clinicNames=['전체 누적 오답 모음 · 앞부분 유형 분석','취약점 분석 초안','학교 프린트 OX·빈칸','유형별 고난도 3문항씩','개념별 고난도 3문항씩'];
function clinicCounts(b){return [b.wrongs.length,b.diagnosis.length,b.generated.length,b.by_type.reduce((s,g)=>s+g.items.length,0),b.by_concept.reduce((s,g)=>s+g.items.length,0)];}
function clinicKeyWarnings(b){return (b.answer_key_conflicts||[]).map(x=>`<p class="notice">정답 대조 · ${E(x.exam)} ${E(x.num)}번: 김까까 등록 ${E(x.registered_answer)} / 검증 원본 ${E(String(x.verified_answer).replace('all:','모두 선택: '))}. 교사 정정 기록과 현재 등록 정답을 유지하며 기존 성적은 변경하지 않았습니다.</p>`).join('');}
function clinicDiagnosisMarkup(d){return `<section><h3>${E(d.exam)} · ${E(d.num)}번</h3><p>학생 답 ${E(d.student_answer)} → 등록 정답 ${E(d.correct)}</p><p>세부 개념: ${E(d.concepts.join(' / ')||'분류 필요')}</p><p>요구 사고 유형: ${E((d.question_types||[]).join(' / ')||'분류 필요')}</p><p>${E(d.cause)}</p>${d.review_focus?`<p><b>확인할 지점:</b> ${E(d.review_focus)}</p>`:''}${(d.print_references||[]).map(r=>`<p><b>복습할 프린트:</b> ${E(r.source_title)} · ${E(r.page)}쪽<br>${E(r.quote)}</p>`).join('')}</section>`;}
async function clinicPage(){
 await getStudents();const who=sid;
 const [records,history]=who?await Promise.all([api('/api/records?student_id='+encodeURIComponent(who)),api('/api/clinic?student_id='+encodeURIComponent(who))]):[null,[]];
 if(sid!==who)return;
 const submitted=records?[...records.responses].sort((a,b)=>String(b.submitted_at||'').localeCompare(String(a.submitted_at||''))):[];
 const examIds=[...new Set(submitted.map(r=>String(r.exam_id)))];
 if(!clinicExam||!examIds.includes(clinicExam)&&clinicExam!=='all')clinicExam='all';
 $('main').innerHTML=heading('맞춤 클리닉 전체 생성','실제 오답을 기준으로 3종 한글 자료 초안을 만들고, 부족한 근거는 따로 표시합니다.')+
 `<section class="card"><div class="filters">${studentPicker()}<label>시험·과제 범위<select id="clinic-exam">${examIds.map(id=>`<option value="${E(id)}" ${clinicExam===id?'selected':''}>${E(records.exams.find(e=>String(e.id)===id)?.name||id)}</option>`).join('')}<option value="all" ${clinicExam==='all'?'selected':''}>제출한 전체 시험·과제</option></select></label></div><p class="notice">새 문항은 교사 검수 전 공개하지 않습니다. 원문 모음은 김까까 등록 본문 기준 초안이며, 한글 출력은 연결된 제작 PC가 처리합니다. 현재 남은 제출 기록과 보관된 재응시 이력을 합칩니다. 같은 문항은 한 번 싣고 오답 이력을 보관합니다. 한글은 100문항씩 나눕니다.</p><button class="primary" id="clinic-generate" ${!who||!examIds.length||clinicBusy?'disabled':''}>맞춤 클리닉 전체 생성</button><p id="clinic-progress" role="status" aria-live="polite"></p></section><div id="clinic-results"></div><section class="card"><h2>저장한 제작 기록</h2>${history.map(r=>`<div class="source-row"><span>${E(r.title)} · ${r.wrong_count}개 오답 · ${E(new Date(r.created_at).toLocaleString('ko-KR'))}</span><button data-clinic-open="${E(r.id)}">결과 열기</button></div>`).join('')||empty('아직 제작 기록이 없습니다')}</section>`;
 $('student-picker').onchange=()=>{if(clinicBusy)return;sid=$('student-picker').value;clinicExam='all';clinicRun=null;clinicRequest=null;action(clinicPage);};
 $('clinic-exam').onchange=()=>{clinicExam=$('clinic-exam').value;clinicRequest=null;};
 on('clinic-generate',generateClinic);
 document.querySelectorAll('[data-clinic-open]').forEach(btn=>btn.onclick=()=>action(async()=>{clinicRun=await api('/api/clinic?action=get&student_id='+encodeURIComponent(sid)+'&id='+btn.dataset.clinicOpen);await showClinic();},btn));
 if(clinicRun?.student_id===sid)await showClinic();
}
async function generateClinic(){
 if(clinicBusy||!sid)return;clinicBusy=true;const who=sid,exam=clinicExam;
 clinicRequest=clinicRequest||crypto.randomUUID();
 $('student-picker').disabled=true;$('clinic-exam').disabled=true;
 $('clinic-progress').textContent='오답·근거를 확인하고 3종 결과를 저장하고 있습니다. 창을 닫지 마세요.';
 try{
  clinicRun=await api('/api/clinic',{action:'generate',student_id:who,exam_id:exam==='all'?'':exam,request_id:clinicRequest});
  clinicRequest=null;
  if(sid===who&&page==='clinic'){$('clinic-progress').textContent='초안을 저장했습니다. 아래 항목별 결과와 부족한 내용을 확인하세요.';await showClinic();}
 }catch(error){if($('clinic-progress'))$('clinic-progress').textContent='완료하지 못했습니다. '+error.message+' 다시 누르면 동일 요청을 확인해 중복 저장을 막습니다.';throw error;}
 finally{clinicBusy=false;if($('student-picker'))$('student-picker').disabled=false;if($('clinic-exam'))$('clinic-exam').disabled=false;}
}
async function showClinic(){
 if(!clinicRun||!$('clinic-results'))return;
 clearTimeout(clinicPoll);const run=clinicRun,who=sid,sequence=++clinicViewSequence;
 const selected=[...document.querySelectorAll('[data-clinic-part]:checked')].map(x=>Number(x.dataset.clinicPart));
 const hadSelection=!!document.querySelector('[data-clinic-part]');
 const b=run.body,c=clinicCounts(b),packetGroups=[b.packet_ids||[b.packet_id],[],[],b.type_packets||[],b.concept_packets||[]],packets=await Promise.all(packetGroups.flat().map(id=>api('/api/packet?id='+id))),jobs=await api('/api/clinic?action=jobs&student_id='+encodeURIComponent(sid));
 if(page!=='clinic'||clinicRun!==run||sid!==who||sequence!==clinicViewSequence)return;
 const activeJobs=jobs.filter(j=>packetGroups.flat().includes(j.packet_id)&&['pending','running'].includes(j.status));
 const verified=b.wrongs.filter(q=>q.original_source_verified===true).length;
 const native=packets.filter(p=>packetGroups[0].includes(p.id)).every(p=>p.files?.some(f=>String(f).toLowerCase().endsWith('.hwp')));
 const status=[native?'한글·PDF 제작됨 · 검수 필요':'초안 저장 · 한글 제작 대기','분석 초안 · 원인 확인 필요',c[2]?'생성됨 · 교사 검수 필요':'프린트 근거 부족',b.type_missing?`${b.type_missing}문항 부족`:'추천 초안 생성',b.concept_missing?`${b.concept_missing}문항 부족`:'추천 초안 생성'];
 $('clinic-results').innerHTML=`<section class="card"><h2>${E(b.title)}</h2><p>전체 응시 이력 판정 ${b.graded}건 · 오답 ${b.wrongs.length}문항 · 미응답/판정 불가 ${b.unknown}건</p><p>원본 연결 확인 ${verified}/${b.wrongs.length}문항${verified<b.wrongs.length?' · 나머지 문항은 원문 대조 필요':''}</p><p class="notice">${E(b.notice)}</p>${clinicKeyWarnings(b)}<div class="row"><button id="clinic-tags">문항 개념·유형 분류</button><button id="clinic-reload">제작 상태 새로고침</button><span id="clinic-job-status" role="status">${activeJobs.length?`한글 제작 ${activeJobs.some(j=>j.status==='running')?'중':'대기'} · 15초마다 자동 확인`:''}</span><button id="clinic-print-all">선택한 자료 묶어 인쇄 · PDF</button></div></section>`+
 [0,3,4].map(i=>{const name=clinicNames[i];return `<section class="card"><div class="card-head"><h2>${[0,3,4].indexOf(i)+1}. ${name}</h2>${badge(status[i],i===0&&native?'green':'amber')}</div><p>${c[i]}${i===1?'개 오답 분석':'문항'}</p>${i===0?'<p>원문 표·밑줄·옛한글과 정답을 확인한 뒤 배부하세요.</p>':i===1?`<p>세부 개념 미분류 ${b.unclassified}개. 학생 설명이 없는 원인은 임의로 확정하지 않았습니다.</p>`:i===2?'<p>학교가 일치하는 검수된 학교 프린트 근거만 사용합니다. 현재 규칙 OX는 참 명제이며, 빈칸은 근거 문장 속 지정어를 사용합니다.</p>':'<p>검수 완료·고난도·동일 태그 조건으로 선정하며 유형/개념 과제 사이의 문항 중복을 제외합니다.</p>'}<div class="row"><label class="check"><input type="checkbox" data-clinic-part="${i}" ${(hadSelection?selected.includes(i):c[i])?'checked':''}>묶음 출력에 포함</label><button data-clinic-view="${i}">결과 · 부족 내역 보기</button>${packets.filter(p=>packetGroups[i].includes(p.id)).flatMap(p=>(p.files||[]).map(f=>`<button data-clinic-packet="${p.id}" data-clinic-file="${E(f)}">${E(f.split('.').pop().toUpperCase())} 다운로드</button>`)).join('')}</div>${jobs.filter(j=>packetGroups[i].includes(j.packet_id)&&j.status==='failed').map(j=>`<p class="notice">한글 제작 실패: ${E(j.error)}</p>`).join('')}</section>`;}).join('');
 on('clinic-tags',clinicTagEditor);on('clinic-reload',showClinic);on('clinic-print-all',()=>clinicPreview([...document.querySelectorAll('[data-clinic-part]:checked')].map(x=>Number(x.dataset.clinicPart))));
 document.querySelectorAll('[data-clinic-view]').forEach(btn=>btn.onclick=()=>clinicPreview([Number(btn.dataset.clinicView)]));
 document.querySelectorAll('[data-clinic-file]').forEach(btn=>btn.onclick=()=>action(()=>window.researchDownloadFile(btn.dataset.clinicPacket,btn.dataset.clinicFile),btn));
 if(activeJobs.length)clinicPoll=setTimeout(()=>{if(page==='clinic'&&sid===who&&clinicRun===run&&!clinicBusy)showClinic().catch(()=>{const status=$('clinic-job-status');if(status)status.textContent='제작 상태를 확인하지 못했습니다. 새로고침을 눌러 확인하세요.';});},15000);
}
function clinicPreview(parts){
 if(!parts.length){toast('출력할 자료를 선택하세요.');return;}
 const b=clinicRun.body;
 const qs=(items,start=0)=>items.map((q,i)=>`<section class="q"><h3>${start+i+1}. ${E(q.source_title||'')}</h3>${questionMarkup(q,false)}${q.attempts?.length?`<p class="notice">오답 이력: ${q.attempts.map(a=>E(String(a.date||'날짜 미상').slice(0,10))+' · 선택 '+E(a.answer)).join(' / ')}</p>`:''}</section>`).join('');
 const keys=items=>`<section class="answers"><h2>교사용 정답·해설</h2>${items.map((q,i)=>`<section class="q"><b>${i+1}. 정답 ${E(q.answer||'확인 필요')}</b><p>${E(q.explanation||'해설 확인 필요')}</p></section>`).join('')}</section>`;
 const sections=parts.map(i=>{
  let text='';
  if(i===0)text='<h2>오답 유형 분석</h2>'+b.diagnosis.map(clinicDiagnosisMarkup).join('')+'<h2>전체 누적 오답 문제</h2>'+qs(b.wrongs)+keys(b.wrongs);
  if(i===1)text=b.diagnosis.map(d=>`<section class="q"><h3>${E(d.exam)} · ${E(d.num)}번</h3><p>학생 답 ${E(d.student_answer)} → 정답 ${E(d.correct)}</p><p>세부 개념: ${E(d.concepts.join(' / ')||'분류 필요')}</p><p>${E(d.basis)} · ${E(d.cause)}</p><p>확인 질문: ${E(d.question)}</p><p>보완 순서: ${E(d.next_step)}</p></section>`).join('');
  if(i===2){const items=b.generated.map(g=>({...g.body,source_title:g.source_title+' · p.'+g.page,explanation:g.body.explanation+'\n근거: '+g.quote}));text=items.length?qs(items)+keys(items):'<p>선택 범위와 일치하는 새 검수 명제가 없습니다. 원본·프린트 근거에서 학교, 페이지, 세부 개념, 핵심명제를 등록하고 검수하세요.</p>';}
  if(i>=3){const groups=i===3?b.by_type:b.by_concept;const all=groups.flatMap(g=>g.items);let offset=0;text=groups.map(g=>{const start=offset;offset+=g.items.length;return `<section class="q"><h3>${E(g.exam)} · ${E(g.num)}번 연계</h3><p>${E(g.reason)} ${g.missing?`${g.missing}문항 부족`:''}</p>${qs(g.items,start)}${g.review_candidates?.length?`<aside class="no-print"><h4>기존 DB 검수 대기 후보 · 확정 과제에 미포함</h4>${g.review_candidates.map(q=>`<p>${E(q.source_title)} · ${E(q.original_number||'')}번 — ${E(q.difficulty_basis||'난도 확인 필요')} <button data-clinic-review="${q.id}">원문·난도 검수</button></p>`).join('')}</aside>`:''}</section>`;}).join('')+keys(all);}
  return `<section class="clinic-print-part"><h1>${clinicNames[i]}</h1>${i===0?clinicKeyWarnings(b):''}${text}</section>`;
 }).join('');
 modal('맞춤 클리닉 초안',`<div class="row no-print"><button id="clinic-print">인쇄 · PDF 저장</button><span>교사 검수 전 · 학생 미공개</span></div><div class="paper"><h1>${E(b.title)}</h1><p>${E(b.student.school||'')} · ${E(new Date(clinicRun.created_at).toLocaleDateString('ko-KR'))}</p>${sections}</div>`);
 on('clinic-print',()=>window.print());document.querySelectorAll('[data-clinic-review]').forEach(btn=>btn.onclick=()=>action(()=>editQuestion(btn.dataset.clinicReview),btn));
}
titles.clinic='맞춤 클리닉 전체 생성';const navigateBeforeClinic=navigate;
navigate=async function(name){if(clinicBusy){toast('제작 결과를 저장 중입니다. 잠시 기다려 주세요.');return;}clearTimeout(clinicPoll);clinicViewSequence++;if(name!=='clinic')return navigateBeforeClinic(name);page=name;charts.forEach(c=>c.destroy());charts=[];$('breadcrumb').textContent=titles.clinic;document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));$('main').innerHTML='<div class="loading">학생의 제작 기록을 불러옵니다…</div>';try{await clinicPage();}catch(e){$('main').innerHTML=empty('제작 화면을 불러오지 못했습니다',e.message);}};
const clinicNav=document.createElement('button');clinicNav.dataset.page='clinic';clinicNav.textContent='✦ 맞춤 클리닉 전체 생성';clinicNav.onclick=()=>action(()=>navigate('clinic'),clinicNav);document.querySelector('nav').prepend(clinicNav);
const clinicOldBlock=syncBlocked;syncBlocked=()=>clinicBusy||page==='clinic'||clinicOldBlock();
window.addEventListener('beforeunload',e=>{if(clinicBusy){e.preventDefault();e.returnValue='';}});

function clinicTagEditor(){
 const wrongs=clinicRun.body.wrongs;
 modal('시험 문항 분류 · 같은 문항을 푼 모든 학생에 적용',`<p>원문 문항의 개념·요구 사고 유형입니다. 학생 개인의 오답 원인과 구분합니다. 저장 후 전체 생성을 다시 누르면 적용됩니다.</p>${wrongs.map((q,i)=>`<section class="card"><h3>${E(q.source_title)}</h3><p>${E(q.text)}</p><p class="notice">${E((q.source_issues||[]).join(' '))}</p><label>세부 개념 · 쉼표 구분<input id="clinic-concepts-${i}" value="${E((q.concepts||[]).join(', '))}"></label><label>요구 사고 유형 · 쉼표 구분<input id="clinic-types-${i}" value="${E((q.question_types||[]).join(', '))}" placeholder="예문 판별, 조건 적용, 분류 비교, 근거 추론"></label><button data-clinic-tag="${i}">이 문항 분류 저장</button></section>`).join('')}`);
 document.querySelectorAll('[data-clinic-tag]').forEach(btn=>btn.onclick=()=>action(async()=>{const i=Number(btn.dataset.clinicTag),q=wrongs[i];const concepts=$('clinic-concepts-'+i).value.split(',').map(x=>x.trim()).filter(Boolean),question_types=$('clinic-types-'+i).value.split(',').map(x=>x.trim()).filter(Boolean);await api('/api/clinic',{action:'tag',exam_id:q.exam_id,question_index:q.question_index,concepts,question_types});toast('시험 문항 분류를 저장했습니다. 전체 학생에게 공통 적용됩니다.');},btn));
}
