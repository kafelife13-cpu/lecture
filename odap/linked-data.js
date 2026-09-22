let linkedTable='exams',linkedOffset=0;
const linkedKinds={exams:'시험·과제 문항',exam_responses:'시험·과제 제출',qa_materials:'학교 학습자료',qa_questions:'학생 질문·교사 답변',weekly_homework:'주간 과제 계획',weekly_homework_work:'주간 과제 수행',ox_questions:'김까까 OX 문항',ox_attempts:'김까까 OX 풀이',vocab_units:'어휘 학습자료',vocab_responses:'어휘시험 제출',special_tests:'특별 시험',special_test_results:'특별 시험 결과'};
const linkedLabels={text:'내용',question:'질문',ai_answer:'AI 답변',teacher_reply:'교사 답변',teacher_note:'교사 메모',statement:'명제',answer:'정답',explanation:'해설',passage:'지문',wrong:'틀린 어휘',data:'수행 내용',result:'결과',history:'이전 결과',score:'점수',correct_count:'정답 수',total_q:'전체 문항',student_answer:'학생 답',is_correct:'정답 여부',status:'상태',kind:'종류',description:'안내',targets:'학습 목표',section_a:'학습 A',section_b:'학습 B',section_c:'학습 C',answers:'제출 답안',thoughts:'풀이 생각'};
function linkedValue(value){
 if(value===null||value===undefined)return '';
 if(typeof value==='boolean')return value?'맞음':'틀림';
 if(Array.isArray(value))return value.map(linkedValue).join('\n');
 if(typeof value==='object')return Object.entries(value).filter(([key])=>!/(password|token|secret|_id$)/i.test(key)).map(([key,v])=>(linkedLabels[key]||(/^\d+$/.test(key)?(Number(key)+1)+'번':key))+': '+linkedValue(v)).join('\n');
 return String(value);
}
async function linkedPage(){
 await getStudents();
 const data=await api('/api/linked?table='+linkedTable+'&student_id='+encodeURIComponent(sid)+'&offset='+linkedOffset);
 $('main').innerHTML=heading('김까까 연결 자료','김까까에 저장된 원본 기록을 직접 조회합니다. 복사·수동 동기화가 필요하지 않습니다.')+`<section class="card"><div class="filters"><label>자료 종류<select id="linked-kind">${Object.entries(linkedKinds).map(([key,title])=>`<option value="${key}" ${linkedTable===key?'selected':''}>${title}</option>`).join('')}</select></label>${studentPicker()}</div><p class="mini-stat">${N(data.total)}건 · ${E(data.checked_at)} 확인</p><p class="notice">원본 조회와 문제은행 검수는 별도입니다. 새 자료는 바로 조회되며 학생 배부용 변형문항은 검수 후 승인합니다.</p>${data.items.map(r=>{const student=students.find(s=>String(s.id)===String(r.student_id));const title=r.name||r.title||r.test_name||r.student_name||student?.name||r.question||r.statement||linkedKinds[linkedTable];return `<article class="list-item"><h3>${E(String(title).slice(0,140))}</h3><p class="mini-stat">${E(student?.name||r.student_name||'')} · ${E((r.submitted_at||r.updated_at||r.created_at||'').slice(0,16).replace('T',' '))}</p>${Object.entries(linkedLabels).filter(([key])=>r[key]!==undefined&&r[key]!==null&&r[key]!=='').map(([key,label])=>`<details><summary>${label}</summary><div class="passage">${E(linkedValue(r[key]))}</div></details>`).join('')}${Array.isArray(r.questions)?`<details><summary>문항 ${r.questions.length}개 보기</summary>${r.questions.map((q,i)=>`<section class="list-item"><h3>${i+1}번</h3>${questionMarkup(q)}</section>`).join('')}</details>`:''}</article>`;}).join('')||empty('해당 기록이 없습니다')}<div class="pagination"><button id="linked-prev" ${linkedOffset===0?'disabled':''}>← 이전</button><span>${N(Math.min(linkedOffset+50,data.total))} / ${N(data.total)}</span><button id="linked-next" ${linkedOffset+50>=data.total?'disabled':''}>다음 →</button></div></section>`;
 $('linked-kind').onchange=()=>{linkedTable=$('linked-kind').value;linkedOffset=0;action(linkedPage);};
 $('student-picker').onchange=()=>{sid=$('student-picker').value;linkedOffset=0;action(linkedPage);};
 on('linked-prev',()=>{linkedOffset=Math.max(0,linkedOffset-50);return linkedPage();});on('linked-next',()=>{linkedOffset+=50;return linkedPage();});
}
titles.linked='김까까 연결 자료';
const navigateWithoutLinked=navigate;
navigate=async function(name){if(name!=='linked')return navigateWithoutLinked(name);page=name;charts.forEach(c=>c.destroy());charts=[];document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));$('breadcrumb').textContent=titles.linked;try{await linkedPage();}catch(e){$('main').innerHTML=empty('연결 자료를 불러오지 못했습니다',e.message);}};
const linkedNav=document.createElement('button');linkedNav.dataset.page='linked';linkedNav.textContent='↗ 김까까 연결 자료';linkedNav.onclick=()=>action(()=>navigate('linked'),linkedNav);document.querySelector('nav').append(linkedNav);
