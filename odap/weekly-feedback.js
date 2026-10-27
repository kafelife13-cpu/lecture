/* Teacher-only draft generation through the existing authenticated AI gateway. */
let weeklyFeedbackBusy=false,weeklyFeedbackStop=false;
const weeklyFeedbackDrafts=new Map();
async function weeklyFeedbackPage(){
 const rows=await homeworkRPC('list');
 const today=new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'})+'T00:00:00Z');today.setUTCDate(today.getUTCDate()-((today.getUTCDay()+6)%7));const monday=today.toISOString().slice(0,10);
 $('main').innerHTML=heading('주간 피드백','저장된 맞춤 과제의 승인 근거로 OX 20문항과 프린트 빈칸 초안을 만듭니다.')+
 '<section class="card"><p class="notice">학교·이번 범위·작년 기출 포함 여부와 정답을 검수해야 합니다. 현재 초안은 자동 배부되지 않으며 이 탭에서만 유지됩니다. 탭을 닫기 전에 JSON으로 저장하세요.</p><label>저장된 학생 과제<select id="weekly-feedback-homework"><option value="">선택하세요</option>'+rows.map(r=>`<option value="${E(r.id)}">${E(r.name||r.student_id)} · ${E(String(r.created_at||'').slice(0,10))}</option>`).join('')+'</select></label><label>주차 시작일 · 월요일<input type="date" id="weekly-feedback-week" value="'+monday+'"></label><div class="row"><button id="weekly-feedback-context">근거·빈칸 확인</button><button id="weekly-feedback-generate" class="primary">OX 20문항 생성·이어하기</button><button id="weekly-feedback-stop" disabled>현재 요청 후 중단</button><button id="weekly-feedback-export">초안 JSON 저장</button></div><p id="weekly-feedback-status" role="status"></p></section><section id="weekly-feedback-result" class="card"></section>';
 const selection=()=>{const r=rows.find(r=>r.id===$('weekly-feedback-homework').value);if(!r)throw Error('학생 과제를 선택하세요.');return r;};
 const week=()=>{const value=$('weekly-feedback-week').value;window.WeeklyFeedbackAI.coverage([],value);return value;};
 const state=r=>{const week_start=week(),key=r.id+':'+week_start;if(!weeklyFeedbackDrafts.has(key))weeklyFeedbackDrafts.set(key,{homework_id:r.id,student_id:r.student_id,week_start,items:[],blanks:[],evidence:[],status:'pending'});return weeklyFeedbackDrafts.get(key);};
 const draw=r=>{const d=state(r);$('weekly-feedback-status').textContent=`${d.week_start} · OX ${d.items.length}/20 · 빈칸 ${d.blanks.length} · 검수 대기${d.coverage?' · 작년 기출 연도 미확인':''}`;$('weekly-feedback-result').innerHTML=[...d.items,...d.blanks].map((q,i)=>`<article class="list-item"><h3>${i+1}. ${E(q.text)} [자작 · 검수 대기]</h3><p>정답: ${E(q.answer)}</p><p>${E(q.explanation)}</p><small>${E(q.evidence.source_title)} p.${E(q.evidence.page)} · ${E(q.concepts.join(', '))}</small></article>`).join('')||'<p>아직 생성한 초안이 없습니다.</p>';};
 const context=async r=>{const c=await api('/api/weekly-feedback/context',{id:r.id,student_id:r.student_id,week_start:week()});const d=state(r);if(d.items.some(q=>!c.evidence.some(e=>e.id===q.evidence.id&&e.quote===q.evidence.quote&&e.statement===q.evidence.statement)))throw Error('이미 만든 초안의 근거가 변경됐습니다. 기존 초안을 저장하고 새 과제로 다시 생성하세요.');d.evidence=c.evidence;d.blanks=c.blanks;d.coverage=c.coverage;return d;};
 on('weekly-feedback-context',async()=>{const r=selection();await context(r);draw(r);});
 on('weekly-feedback-export',()=>{const r=selection();download('주간피드백-검수대기-'+week()+'-'+r.id+'.json',JSON.stringify(state(r),null,2));});
 on('weekly-feedback-stop',()=>{weeklyFeedbackStop=true;});
 on('weekly-feedback-generate',async()=>{
  const r=selection();weeklyFeedbackBusy=true;weeklyFeedbackStop=false;const select=$('weekly-feedback-homework');select.disabled=true;$('weekly-feedback-week').disabled=true;$('weekly-feedback-context').disabled=true;$('weekly-feedback-stop').disabled=false;
  try{
   const d=await context(r);if(!d.evidence.length)throw Error('현재 승인 상태와 일치하는 프린트 근거가 없습니다. 원본·근거 검수를 먼저 확인하세요.');
   for(let request=0;request<4&&d.items.length<20&&!weeklyFeedbackStop;request++){
    $('weekly-feedback-status').textContent=`OX ${d.items.length}/20 · 다음 ${Math.min(5,20-d.items.length)}문항 생성 중…`;
    const result=await api('/api/weekly-feedback/ox',{id:r.id,student_id:r.student_id,week_start:week(),count:Math.min(5,20-d.items.length),exclude:d.items.map(q=>q.text)});
    d.items.push(...result.items);draw(r);if(!result.items.length)break;
   }
   $('weekly-feedback-status').textContent+=d.items.length===20?' · 20문항 초안 생성됨 · 작년 기출 연도·범위 검수 미완료':' · 부족분은 이어하기로 다시 요청할 수 있습니다.';
  }catch(e){draw(r);$('weekly-feedback-status').textContent+=' · '+e.message;}
  finally{weeklyFeedbackBusy=false;select.disabled=false;$('weekly-feedback-week').disabled=false;$('weekly-feedback-context').disabled=false;$('weekly-feedback-stop').disabled=true;}
 });
 $('weekly-feedback-week').onchange=()=>action(()=>{const r=selection();draw(r);});
 $('weekly-feedback-homework').onchange=()=>{const r=rows.find(r=>r.id===$('weekly-feedback-homework').value);if(r)draw(r);else $('weekly-feedback-result').replaceChildren();};
}
titles['weekly-feedback']='주간 피드백';
const weeklyFeedbackNavigate=navigate;
navigate=async function(name){if(weeklyFeedbackBusy||homeworkBusy){toast('생성 중입니다. 현재 요청 후 중단을 누른 뒤 이동하세요.');return;}if(name!=='weekly-feedback')return weeklyFeedbackNavigate(name);page=name;charts.forEach(c=>c.destroy());charts=[];$('breadcrumb').textContent=titles[name];document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));try{await weeklyFeedbackPage();}catch(e){$('main').innerHTML=empty('주간 피드백을 불러오지 못했습니다',e.message);}};
const weeklyFeedbackNav=document.createElement('button');weeklyFeedbackNav.dataset.page='weekly-feedback';weeklyFeedbackNav.textContent='▦ 주간 피드백';weeklyFeedbackNav.onclick=()=>action(()=>navigate('weekly-feedback'),weeklyFeedbackNav);document.querySelector('nav').append(weeklyFeedbackNav);
const weeklyFeedbackOldBlock=syncBlocked;syncBlocked=()=>weeklyFeedbackBusy||page==='weekly-feedback'||weeklyFeedbackOldBlock();
window.addEventListener('beforeunload',e=>{if(weeklyFeedbackBusy||[...weeklyFeedbackDrafts.values()].some(d=>d.items.length||d.blanks.length)){e.preventDefault();e.returnValue='';}});
