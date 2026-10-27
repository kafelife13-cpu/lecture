(function(root){
 'use strict';
 const labels={take_home:'시험지 수령 후 집에서 채점',finish_home:'클리닉 미완 · 귀가 후 당일 마무리'};
 const statuses={pending:'승인 대기',approved:'수락됨',rejected:'거절됨'};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
 const when=s=>new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
 if(typeof module!=='undefined')module.exports={labels,statuses};
 if(typeof document==='undefined')return;
 const el=id=>document.getElementById(id);let studentRun=0,teacherRun=0,studentBusy=false,teacherBusy=false,rows=[];
 function allowed(role){return session?.role===role&&weeklyLogin?.role===role&&weeklyLogin.id===session.id&&!padMode&&!studentPreviewMode;}
 async function rpc(action,payload,role){
  if(!allowed(role))throw Error('본인 계정으로 다시 로그인해주세요.');
  const r=await sb.rpc('clinic_home_rpc',{p_id:weeklyLogin.id,p_password:weeklyLogin.pw,p_action:action,p_payload:payload||{}});
  if(r.error)throw Error(r.error.code==='PGRST202'?'클리닉 신청 기능을 준비 중입니다. 선생님께 알려주세요.':r.error.message||'저장하지 못했습니다. 다시 확인해주세요.');
  return r.data;
 }
 function studentShow(data){
  const r=data.request;
  document.querySelectorAll('[data-clinic-home-kind]').forEach(b=>b.disabled=studentBusy||!!r);
  el('clinic-home-student-status').textContent=r?`${labels[r.kind]} · ${statuses[r.status]} · 신청 ${when(r.requested_at)}${r.reviewed_at?' · 처리 '+when(r.reviewed_at):''}`:'선생님이 수락해야 확정됩니다. 신청 버튼만 눌러서는 승인되지 않아요.';
 }
 root.renderStudentClinicHome=async function(){
  const card=el('clinic-home-student');if(!card)return;card.hidden=!allowed('student');if(card.hidden)return;
  const run=++studentRun,who=session.id;document.querySelectorAll('[data-clinic-home-kind]').forEach(b=>b.disabled=true);
  el('clinic-home-student-status').textContent='오늘 신청 기록을 확인하고 있어요…';
  try{const data=await rpc('get',{},'student');if(run===studentRun&&session?.id===who)studentShow(data);}
  catch(e){if(run===studentRun&&session?.id===who)el('clinic-home-student-status').textContent=e.message;}
 };
 root.requestClinicHome=async function(kind){
  if(studentBusy||!allowed('student')||!labels[kind])return;
  if(!confirm(labels[kind]+' 신청을 보낼까요? 선생님이 수락해야 확정됩니다.'))return;
  const who=session.id,run=++studentRun;studentBusy=true;document.querySelectorAll('[data-clinic-home-kind]').forEach(b=>b.disabled=true);
  el('clinic-home-student-status').textContent='신청을 저장하고 있어요…';
  try{const data=await rpc('request',{kind},'student');studentBusy=false;if(run===studentRun&&session?.id===who)studentShow(data);}
  catch(e){studentBusy=false;if(run===studentRun&&session?.id===who){el('clinic-home-student-status').textContent=e.message+' 상태 새로고침으로 저장 여부를 확인해주세요.';}}
 };
 function teacherShow(){
  const filter=el('clinic-home-filter').value,selected=rows.filter(r=>filter==='all'||r.status===filter);
  el('clinic-home-summary').textContent=`전체 ${rows.length}명 · 승인 대기 ${rows.filter(r=>r.status==='pending').length}명 · 수락 ${rows.filter(r=>r.status==='approved').length}명 · 거절 ${rows.filter(r=>r.status==='rejected').length}명`;
  el('clinic-home-rows').innerHTML=selected.map(r=>`<article class="clinic-home-row"><div><strong>${esc(r.student_name)}</strong> <span>${esc(r.school_name)}</span><p>${esc(labels[r.kind])}</p><p>${esc(statuses[r.status])} · 신청 ${esc(when(r.requested_at))}</p>${r.reviewed_at?`<p>처리 ${esc(when(r.reviewed_at))}</p>`:''}</div>${r.status==='pending'?`<div class="clinic-home-actions"><button type="button" class="btn green btn-sm" data-clinic-review="approve" data-request-id="${esc(r.id)}" ${teacherBusy?'disabled':''}>수락</button><button type="button" class="btn red btn-sm" data-clinic-review="reject" data-request-id="${esc(r.id)}" ${teacherBusy?'disabled':''}>거절</button></div>`:''}</article>`).join('')||'<p>해당하는 신청이 없습니다.</p>';
 }
 root.renderClinicCheckout=async function(){
  if(!allowed('teacher')||!el('clinic-home-teacher')||teacherBusy)return;
  const input=el('clinic-home-date');if(!input.value)input.value=today();input.max=today();
  const run=++teacherRun,who=session.id;rows=[];el('clinic-home-summary').textContent='';el('clinic-home-rows').textContent='신청을 확인하고 있습니다…';el('clinic-home-message').textContent='';
  try{const data=await rpc('list',{date:input.value},'teacher');if(run===teacherRun&&session?.id===who){rows=data.rows;teacherShow();}}
  catch(e){if(run===teacherRun&&session?.id===who)el('clinic-home-rows').textContent=e.message;}
 };
 document.addEventListener('change',e=>{if(e.target.id==='clinic-home-date')root.renderClinicCheckout();if(e.target.id==='clinic-home-filter')teacherShow();});
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-clinic-review]');if(!b||teacherBusy||!allowed('teacher'))return;
  const who=session.id,run=++teacherRun;teacherBusy=true;teacherShow();
  el('clinic-home-message').textContent='처리 중…';
  try{const saved=await rpc(b.dataset.clinicReview,{request_id:b.dataset.requestId},'teacher');if(run===teacherRun&&session?.id===who){rows=rows.map(r=>String(r.id)===String(saved.id)?saved:r);el('clinic-home-message').textContent=saved.student_name+' '+statuses[saved.status];}}
  catch(err){if(run===teacherRun&&session?.id===who)el('clinic-home-message').textContent=err.message;}
  finally{teacherBusy=false;if(run===teacherRun&&session?.id===who)teacherShow();}
 });
})(typeof window==='object'?window:this);
