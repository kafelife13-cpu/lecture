/* Uses the existing authenticated teacher menu and RPC transport. */
let clinicPracticeBusy=false;
async function clinicPracticeTeacherPage(){
 const call=(action,payload={})=>api('/api/clinic-practice',{action,payload});
 const initial=await call('summary',{clinic_week:''});
 if(page!=='clinic-practice')return;
 $('main').innerHTML=heading('클리닉 비슷한 유형','연습 · 점수에 반영되지 않아요')+'<section class="card"><label>클리닉 주차<select id="cp-week">'+initial.weeks.map(w=>'<option value="'+E(w)+'">'+E(w)+'</option>').join('')+'</select></label><button id="cp-refresh">새로고침</button><p id="cp-status" role="status"></p><div id="cp-summary"></div><h3>배정 문항 · 전체 학생 회수</h3><div id="cp-questions"></div><h3>문항 오류 신고</h3><div id="cp-reports"></div></section>';
 const root=$('cp-summary'),valid=()=>page==='clinic-practice'&&root.isConnected;
 let sequence=0;
 const run=fn=>async()=>{if(clinicPracticeBusy)return;clinicPracticeBusy=true;try{await fn();}catch(e){if(valid())$('cp-status').textContent=e.message;}finally{clinicPracticeBusy=false;}};
 const reasons={no_mapping:'은행: 검수 연결·개념 없음',mapping_conflict:'은행: 원문·시험 정답 불일치',no_type:'은행: 원문 유형 없음',no_candidate:'은행: 후보 없음',no_domain:'과제: 대응 영역 없음',no_homework_candidate:'과제: 조건에 맞는 후보 없음',no_choices:'과제: 5개 선택지 확인 불가'};
 const withdraw=async content_key=>{
  const impact=await call('withdraw',{content_key,dry_run:true});if(!valid())return;
  if(!confirm('전체 주차의 '+impact.students+'명, '+impact.items+'개 배정을 회수하고 모든 학생의 새 배정도 차단합니다. 풀이 기록은 유지됩니다. 계속할까요?'))return;
  await call('withdraw',{content_key,expected_items:impact.items});await load();
 };
 async function load(){
  const ticket=++sequence,week=$('cp-week').value;
  const [summary,reports]=await Promise.all([call('summary',{clinic_week:week}),call('reports')]);
  if(!valid()||ticket!==sequence)return;
  $('cp-status').textContent=week+' · '+summary.rows.reduce((n,r)=>n+Number(r.assigned),0)+'개 배정 / '+summary.rows.reduce((n,r)=>n+Number(r.answered),0)+'개 풀이 / '+summary.rows.reduce((n,r)=>n+Number(r.pending||0),0)+'개 배정 대기';
  root.innerHTML='<div class="table-wrap"><table><thead><tr><th>학생</th><th>시험</th><th>오답</th><th>배정</th><th>배정 대기</th><th>건너뜀</th><th>풀이</th><th>정답</th><th>건너뛴 사유</th></tr></thead><tbody>'+summary.rows.map(r=>'<tr><td>'+E(r.student_name)+'</td><td>'+E(r.exam_name)+'</td><td>'+E(r.wrong)+'</td><td>'+E(r.assigned)+'</td><td>'+E(r.pending||0)+'</td><td>'+E(r.skipped)+'</td><td>'+E(r.answered)+'</td><td>'+E(r.correct)+'</td><td>'+Object.entries(reasons).map(([k,label])=>E(label)+': '+E(r.skip_reasons[k]||0)).join('<br>')+'</td></tr>').join('')+'</tbody></table></div>';
  $('cp-questions').innerHTML=summary.questions.map(q=>'<p>'+E(q.text)+' · 전체 '+E(q.students)+'명 <button data-withdraw="'+E(q.content_key)+'">문항 회수</button></p>').join('')||'<p>배정 문항이 없습니다.</p>';
  $('cp-reports').innerHTML=reports.map(r=>'<article><p>'+E(r.student_name)+' · '+E(r.text)+'</p><p>'+E(r.reason)+'</p><p>'+E(r.status==='resolved'?'처리 완료':'접수')+'</p>'+(r.status==='open'?'<button data-resolve="'+E(r.id)+'">신고 처리 완료</button>':'')+'<button data-withdraw="'+E(r.content_key)+'">문항 회수</button></article>').join('')||'<p>신고가 없습니다.</p>';
  document.querySelectorAll('[data-withdraw]').forEach(b=>b.onclick=run(()=>withdraw(b.dataset.withdraw)));
  document.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=run(async()=>{await call('report_resolve',{id:b.dataset.resolve});await load();}));
 }
 $('cp-week').onchange=run(load);$('cp-refresh').onclick=run(load);await load();
}
titles['clinic-practice']='클리닉 비슷한 유형';
const clinicPracticeNavigate=navigate;
navigate=async function(name){
 if(clinicPracticeBusy){toast('현재 처리가 끝난 뒤 이동하세요.');return;}
 if(name!=='clinic-practice')return clinicPracticeNavigate(name);
 if(privateWeeklyBusy||weeklyFeedbackBusy||homeworkBusy||reviewArchiveBusy||clinicBusy){toast('현재 처리가 끝난 뒤 이동하세요.');return;}
 page=name;charts.forEach(c=>c.destroy());charts=[];$('breadcrumb').textContent=titles[name];document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
 $('main').innerHTML='<p>연습 현황을 불러옵니다…</p>';await clinicPracticeTeacherPage();
};
const clinicPracticeNav=document.createElement('button');clinicPracticeNav.dataset.page='clinic-practice';clinicPracticeNav.textContent='클리닉 비슷한 유형';clinicPracticeNav.onclick=()=>action(()=>navigate('clinic-practice'),clinicPracticeNav);const clinicPracticeMenu=document.querySelector('nav');clinicPracticeMenu.insertBefore(clinicPracticeNav,clinicPracticeMenu.children[2]||null);
const clinicPracticeSyncBlocked=syncBlocked;syncBlocked=()=>clinicPracticeBusy||page==='clinic-practice'||clinicPracticeSyncBlocked();
