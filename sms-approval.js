(function(root){
 'use strict';
 const el=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const when=v=>new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
 const labels={pending:'승인 대기',approved:'보내기 승인됨',rejected:'안 보내기',expired:'기한 만료'};
 let rows=[],busy=false,run=0;
 function allowed(){return session?.role==='teacher'&&weeklyLogin?.role==='teacher'&&weeklyLogin.id===session.id&&!padMode&&!studentPreviewMode;}
 async function rpc(action,id){
  if(!allowed())throw Error('선생님 계정으로 다시 로그인해 주세요.');
  const result=await sb.rpc('sms_approval_rpc',{p_id:weeklyLogin.id,p_password:weeklyLogin.pw,p_action:action,p_request_id:id||null});
  if(result.error)throw Error(result.error.code==='PGRST202'?'문자 승인 기능은 운영 반영 전입니다.':'조회 또는 저장하지 못했습니다. 새로고침해 확인해 주세요.');
  return result.data;
 }
 function render(){
  el('sms-approval-list').innerHTML=rows.map(r=>{
   const expired=Date.parse(r.expires_at)<=Date.now(),pending=r.status==='pending'&&!expired;
   const status=expired&&r.status==='pending'?'expired':r.status;
   return `<article class="sms-approval-card"><h2>${r.job==='clinic-missing-evening'?'클리닉 미응시 · 저녁 학부모':'클리닉 미응시 · 아침 학생·학부모'}</h2><p><strong>${esc(labels[status]||'확인 필요')}</strong> · ${esc(r.recipient_count)}통 예정</p><p>발송 ${esc(when(r.slot))}<br>승인 기한 ${esc(when(r.expires_at))}</p><ul>${(r.preview?.classes||[]).map(c=>`<li>${esc(c.label)}: 학생 ${esc(c.students)}명 · ${esc(c.recipients)}통</li>`).join('')}</ul>${(r.preview?.examples||[]).map(e=>`<h3>${e.recipient_type==='parent'?'학부모':'학생'} 문구 예시</h3><pre>${esc(e.text)}</pre>`).join('')}<div class="sms-approval-actions"><button type="button" class="btn blue" data-sms-decision="approve" data-sms-id="${esc(r.id)}" ${!pending||busy?'disabled':''}>보내기</button><button type="button" class="btn" data-sms-decision="reject" data-sms-id="${esc(r.id)}" ${!pending||busy?'disabled':''}>안 보내기</button></div></article>`;
  }).join('')||'<p>승인 대기 및 최근 요청이 없습니다.</p>';
 }
 root.renderSmsApprovals=async function(){
  if(busy)return;
  const token=++run,who=session?.id;rows=[];el('sms-approval-list').textContent='';
  if(!allowed()){el('sms-approval-message').textContent='선생님 계정으로 이용해 주세요.';return;}
  el('sms-approval-message').textContent='요청을 확인하고 있습니다…';
  try{const result=await rpc('list');if(token!==run||session?.id!==who||!allowed())return;if(!Array.isArray(result))throw Error('승인 목록을 확인하지 못했습니다.');rows=result;render();el('sms-approval-message').textContent='승인해도 발송 시각에 응시 여부를 다시 확인합니다.';}
  catch(e){if(token===run&&session?.id===who)el('sms-approval-message').textContent=e.message;}
 };
 document.addEventListener('click',async event=>{
  if(event.target.closest('[data-sms-refresh]')){root.renderSmsApprovals();return;}
  const button=event.target.closest('[data-sms-decision]');if(!button||busy||!allowed())return;
  const row=rows.find(r=>r.id===button.dataset.smsId);
  if(!row||row.status!=='pending'||Date.parse(row.expires_at)<=Date.now()){root.renderSmsApprovals();return;}
  const action=button.dataset.smsDecision;
  if(!confirm(action==='approve'?`${row.recipient_count}통의 문구와 대상을 확인했습니다. 예정 시각 발송을 승인할까요?`:'이 요청은 보내지 않을까요?'))return;
  const token=++run,who=session.id;busy=true;render();el('sms-approval-message').textContent='결정을 저장하고 있습니다…';
  try{const saved=await rpc(action,row.id);if(token!==run||session?.id!==who||!allowed())return;rows=rows.map(r=>r.id===saved.id?saved:r);el('sms-approval-message').textContent=saved.status==='approved'?'보내기를 승인했습니다. 예정 시각에 조건을 다시 확인합니다.':saved.status==='rejected'?'보내지 않기로 했습니다.':'승인 기한 또는 다른 기기의 결정으로 처리하지 않았습니다.';}
  catch(e){if(token===run&&session?.id===who){rows=[];el('sms-approval-message').textContent=e.message+' 자동으로 다시 요청하지 않습니다.';}}
  finally{busy=false;if(token===run&&session?.id===who&&allowed())render();else el('sms-approval-list').textContent='';}
 });
})(window);
