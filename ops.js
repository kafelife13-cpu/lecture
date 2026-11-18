(function(){
 'use strict';
 const el=id=>document.getElementById(id),passwordKey='teacher_ops_password';
 const phone=/(^|[^0-9])(0[0-9]{1,2}[\s.()+-]*[0-9]{3,4}[\s.()-]*[0-9]{4}|\+82[\s.()-]*0?[0-9]{1,2}[\s.()-]*[0-9]{3,4}[\s.()-]*[0-9]{4})(?=[^0-9]|$)/g;
 const esc=value=>String(value??'').replace(phone,'$1[전화번호 숨김]').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const when=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'기록 없음';
 const labels={pending:'승인 대기',approved:'승인',rejected:'거절',expired:'만료'};
 const titles={pending:'문자 승인',board:'자동화 현황',history:'최근 7일 기록'};
 let password='',teacherId='',rows=[],tab='pending',busy=false,run=0;
 // Native fetch keeps the standalone shell independent of a CDN and stores no RPC responses.
 const client={async rpc(name,args){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch('https://zniwzwanlvvmzkkcmikh.supabase.co/rest/v1/rpc/'+name,{
    method:'POST',cache:'no-store',credentials:'omit',signal:controller.signal,
    headers:{'Content-Type':'application/json',apikey:'sb_publishable_IbfVcXs5TmXfumrnK4Somg_7MzygCdh'},body:JSON.stringify(args)
   });
   const data=await response.json();
   return response.ok?{data}:{error:{code:data.code}};
  }finally{clearTimeout(timer);}
 }};
 function message(text){el('ops-message').textContent=text;}
 function clear(){rows=[];el('ops-content').textContent='';}
 function setBusy(value){busy=value;el('ops-content').setAttribute('aria-busy',String(value));el('ops-refresh').disabled=value;el('ops-login-button').disabled=value;}
 function lock(text='잠겼습니다. 비밀번호를 다시 입력해 주세요.'){
  ++run;password='';teacherId='';sessionStorage.removeItem(passwordKey);clear();setBusy(false);
  el('ops-password').value='';el('ops-login').hidden=false;el('ops-app').hidden=true;el('ops-logout').hidden=true;message(text);
 }
 function failed(error){
  if(error.code==='42501'){lock('선생님 비밀번호를 확인해 주세요.');return;}
  message(error.code==='PGRST202'?'운영 앱은 아직 서버 반영 전입니다.':'조회 또는 저장하지 못했습니다. 새로고침해 확인해 주세요. 자동으로 다시 요청하지 않습니다.');
 }
 async function read(action,pw=password){
  const result=await client.rpc('ops_teacher',{p_password:pw,p_action:action});
  if(result.error){const error=Error('OPS_RPC_FAILED');error.code=result.error.code;throw error;}
  return result.data;
 }
 function roster(row){
  const classes=row.roster?.classes;
  if(!Array.isArray(classes)||!classes.length)return '<p>명단이 아직 올라오지 않았습니다. 명단 등록 후 승인해 주세요.</p>';
  return classes.map(c=>{
   const students=c.students||[],studentCount=students.filter(s=>s.recipients.includes('student')).length,parentCount=students.filter(s=>s.recipients.includes('parent')).length;
   return `<h3>${esc(c.label)}</h3><p>학생 ${studentCount}통 · 학부모 ${parentCount}통</p><ul>${students.map(s=>`<li>${esc(s.name)} <span class="muted">${s.recipients.map(r=>r==='parent'?'학부모':'학생').join(' · ')}</span></li>`).join('')}</ul>`;
  }).join('');
 }
 function renderPending(){
  el('ops-content').innerHTML=rows.map(r=>{
   const pending=r.status==='pending'&&Date.parse(r.expires_at)>Date.now(),hasRoster=!!r.roster?.classes?.length;
   return `<article><h3>${r.job==='clinic-missing-evening'?'클리닉 미응시 · 저녁 학부모':'클리닉 미응시 · 아침 학생·학부모'}</h3><p><strong>${esc(labels[pending?r.status:r.status==='pending'?'expired':r.status])}</strong> · ${esc(r.recipient_count)}통 예정</p><p>발송 ${esc(when(r.slot))}<br>승인 기한 ${esc(when(r.expires_at))}</p>${roster(r)}${(r.preview?.examples||[]).map(e=>`<h3>${e.recipient_type==='parent'?'학부모':'학생'} 문구 예시</h3><pre>${esc(e.text)}</pre>`).join('')}<div class="actions"><button type="button" class="primary" data-ops-decision="approve" data-ops-id="${esc(r.id)}" ${!pending||busy||!hasRoster?'disabled':''}>보내기</button><button type="button" data-ops-decision="reject" data-ops-id="${esc(r.id)}" ${!pending||busy?'disabled':''}>안 보내기</button></div></article>`;
  }).join('')||'<p>승인 대기 요청이 없습니다.</p>';
 }
 function renderBoard(data){
  if(!data){el('ops-content').textContent='학원 PC가 올린 현황판이 없습니다.';return;}
  const board=data.board;
  el('ops-content').innerHTML=`<p>갱신 ${esc(when(data.updated_at))}</p><h3>작업 현황</h3>${board.items.map(item=>`<article><h3>${esc(item.name)}</h3><span class="status" data-state="${esc(item.status)}">${esc(item.status)}</span><p>${esc(item.memo)}</p></article>`).join('')||'<p>등록된 항목이 없습니다.</p>'}<h3>예약 작업 · 마지막 실행</h3>${board.tasks.map(task=>`<article><h3>${esc(task.name)}</h3><p><span class="status" data-state="${esc(task.result)}">${esc(task.result)}</span> · ${esc(when(task.last_run_at))}</p></article>`).join('')||'<p>예약 작업 기록이 없습니다.</p>'}`;
 }
 function renderHistory(data){
  el('ops-content').innerHTML=data.map(r=>`<article><h3>${r.job==='clinic-missing-evening'?'클리닉 미응시 · 저녁':'클리닉 미응시 · 아침'}</h3><p>${esc(labels[r.status]||'확인 필요')} · ${esc(when(r.slot))}</p><p>보낸 수: ${Number.isInteger(r.sent_count)&&r.sent_count>=0?`${r.sent_count}통`:'미집계'}</p></article>`).join('')||'<p>최근 7일 처리 기록이 없습니다.</p>';
 }
 async function refresh(){
  if(!password||!teacherId||busy)return;
  const token=++run,selected=tab;clear();setBusy(true);message('확인하고 있습니다…');
  try{
   const data=await read(selected);if(token!==run)return;
   if(selected==='pending'){rows=data.approvals;renderPending();}
   else if(selected==='board')renderBoard(data);else renderHistory(data);
   message(selected==='pending'?'명단과 문구를 확인해 주세요. 승인해도 예정 시각에 응시 여부를 다시 확인합니다.':'최신 조회를 완료했습니다.');
  }catch(error){if(token===run){clear();failed(error);}}
  finally{if(token===run){setBusy(false);if(selected==='pending'&&rows.length)renderPending();}}
 }
 async function login(pw){
  if(busy||!pw)return;
  const until=Number(sessionStorage.getItem('login_lock_until')||0);
  if(until>Date.now()){message('로그인 시도가 잠겼습니다. '+Math.ceil((until-Date.now())/60000)+'분 뒤 다시 시도해 주세요.');return;}
  const token=++run;clear();setBusy(true);message('비밀번호를 확인하고 있습니다…');
  try{
   const data=await read('pending',pw);if(token!==run)return;
   if(!data?.teacher_id||!Array.isArray(data.approvals))throw Error('OPS_RESPONSE_INVALID');
   sessionStorage.setItem(passwordKey,pw);sessionStorage.removeItem('login_failures');sessionStorage.removeItem('login_lock_until');
   password=pw;teacherId=data.teacher_id;rows=data.approvals;tab='pending';
   el('ops-login').hidden=true;el('ops-app').hidden=false;el('ops-logout').hidden=false;selectTab();renderPending();
   message('명단과 문구를 확인해 주세요. 승인 자체로 문자를 발송하지 않습니다.');
  }catch(error){
   if(token!==run)return;
   sessionStorage.removeItem(passwordKey);clear();failed(error);
   if(error.code==='42501'){
    const failures=Number(sessionStorage.getItem('login_failures')||0)+1;
    sessionStorage.setItem('login_failures',String(failures));
    if(failures>=5){sessionStorage.setItem('login_lock_until',String(Date.now()+5*60*1000));sessionStorage.removeItem('login_failures');message('로그인에 5회 실패해 5분 동안 잠겼습니다.');}
   }
  }finally{el('ops-password').value='';if(token===run){setBusy(false);if(teacherId)renderPending();}}
 }
 function selectTab(){
  el('ops-title').textContent=titles[tab];
  document.querySelectorAll('[data-ops-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.opsTab===tab)));
 }
 el('ops-login').addEventListener('submit',event=>{event.preventDefault();login(el('ops-password').value);});
 el('ops-logout').addEventListener('click',()=>lock());
 el('ops-refresh').addEventListener('click',refresh);
 document.addEventListener('click',async event=>{
  const menu=event.target.closest('[data-ops-tab]');
  if(menu){if(!teacherId||busy)return;tab=menu.dataset.opsTab;selectTab();await refresh();return;}
  const button=event.target.closest('[data-ops-decision]');
  if(!button||button.disabled||busy||!password||!teacherId)return;
  const row=rows.find(r=>r.id===button.dataset.opsId),action=button.dataset.opsDecision;
  if(action==='approve'&&!row?.roster?.classes?.length)return;
  if(!window.smsApproval.confirm(row,action))return;
  const token=++run;setBusy(true);renderPending();message('결정을 저장하고 있습니다…');
  try{
   const saved=await window.smsApproval.rpc(client,{id:teacherId,pw:password},action,row.id);if(token!==run)return;
   rows=rows.map(r=>r.id===saved.id?{...saved,roster:r.roster}:r);message(window.smsApproval.message(saved));
  }catch(error){if(token===run){clear();failed(error);}}
  finally{if(token===run){setBusy(false);if(rows.length)renderPending();}}
 });
 // Clear private DOM before bfcache snapshots; restoring always reauthenticates.
 window.addEventListener('pagehide',()=>{++run;password='';teacherId='';clear();setBusy(false);el('ops-app').hidden=true;el('ops-login').hidden=false;el('ops-logout').hidden=true;});
 window.addEventListener('pageshow',event=>{if(event.persisted)login(sessionStorage.getItem(passwordKey)||'');});
 if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
 login(sessionStorage.getItem(passwordKey)||'');
})();
