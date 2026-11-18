(function(){
 'use strict';
 const el=id=>document.getElementById(id),passwordKey='teacher_ops_password';
 const phone=/(^|[^0-9])(0[0-9]{1,2}[\s.()+-]*[0-9]{3,4}[\s.()-]*[0-9]{4}|\+82[\s.()-]*0?[0-9]{1,2}[\s.()-]*[0-9]{3,4}[\s.()-]*[0-9]{4})(?=[^0-9]|$)/g;
 const esc=value=>String(value??'').replace(phone,'$1[전화번호 숨김]').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const when=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'기록 없음';
 const labels={pending:'승인 대기',approved:'승인',rejected:'거절',expired:'만료'};
 const titles={pending:'문자 승인',daily:'클리닉 명단',weekly:'이번 주 명단',board:'자동화 현황',history:'최근 7일 기록'};
 const weeklyFilters={all:['전체',()=>true],absent:['미등원',s=>s.attendance==='미등원'],missing:['미입력',s=>s.clinic==='미입력'],retest:['재시험',s=>s.retest===true],homework:['과제 미완',s=>s.homework==='미완']};
 let password='',teacherId='',rows=[],weekData=null,weeklyFilter='all',tab='pending',busy=false,run=0;
 let dailyData=null,dailyDate='',dailyTimer;
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
 function clear(){clearTimeout(dailyTimer);rows=[];weekData=null;dailyData=null;el('ops-content').textContent='';}
 function setBusy(value){busy=value;el('ops-content').setAttribute('aria-busy',String(value));el('ops-refresh').disabled=value;el('ops-login-button').disabled=value;}
 function lock(text='잠겼습니다. 비밀번호를 다시 입력해 주세요.'){
  ++run;password='';teacherId='';dailyDate='';sessionStorage.removeItem(passwordKey);clear();setBusy(false);
  el('ops-password').value='';el('ops-login').hidden=false;el('ops-app').hidden=true;el('ops-logout').hidden=true;message(text);
 }
 function failed(error){
  if(error.code==='42501'){lock('선생님 비밀번호를 확인해 주세요.');return;}
  if(error.code==='40001'){message('명단이 갱신되었습니다. 새로고침 후 문구를 다시 확인해 주세요.');return;}
  message(error.code==='PGRST202'?'운영 앱은 아직 서버 반영 전입니다.':'조회 또는 저장하지 못했습니다. 새로고침해 확인해 주세요. 자동으로 다시 요청하지 않습니다.');
 }
 async function read(action,pw=password,arg){
  const result=await client.rpc('ops_teacher',{p_password:pw,p_action:action,...(arg?{p_arg:arg}:{})});
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
 function renderWeekly(){
  if(!weekData){el('ops-content').textContent='학원 PC가 올린 이번 주 명단이 없습니다.';return;}
  const week=weekData.week;
  const summary=week.classes.map(c=>`<p><strong>${esc(c.label)}</strong><br>${Object.values(weeklyFilters).slice(1).map(([label,match])=>`${esc(label)} ${esc(c.students.filter(match).length)}`).join(' · ')}</p>`).join('');
  el('ops-content').innerHTML=`<h3>${esc(week.label)}</h3><p>집계 ${esc(when(week.at))} · 갱신 ${esc(when(weekData.updated_at))}</p>${week.blocked?`<p class="weekly-warning" role="alert">집계가 완전하지 않음: ${week.issues.map(esc).join(' · ')||'사유 미등록'}</p>`:''}${summary?`<article aria-label="반별 요약"><h3>반별 요약</h3>${summary}</article>`:''}<div class="weekly-filters" role="group" aria-label="학생 상태 필터">${Object.entries(weeklyFilters).map(([key,[label]])=>`<button type="button" data-ops-filter="${esc(key)}" aria-pressed="${esc(key===weeklyFilter)}">${esc(label)}</button>`).join('')}</div>${week.classes.map(c=>{
   const students=c.students.filter(weeklyFilters[weeklyFilter][1]);
   return `<article><h3>${esc(c.label)}</h3><ul class="weekly-students">${students.map(s=>`<li><strong>${esc(s.name)}</strong><p>출결: ${esc(s.attendance)} · 클리닉: ${esc(s.clinic)} · 점수: ${esc(s.score===null?'미집계':s.score)} · 재시험: ${esc(s.retest?'대상':'아님')} · 과제: ${esc(s.homework)}</p><p class="muted">결석일: ${s.absence_dates.length?s.absence_dates.map(esc).join(', '):'없음'}</p></li>`).join('')}</ul>${students.length?'':'<p>해당 학생이 없습니다.</p>'}</article>`;
  }).join('')||'<p>등록된 반이 없습니다.</p>'}`;
 }
 const forwarding=data=>data.day.scheduled.filter(s=>s.arrived===false&&s.exam_done===false);
 function forwardText(data){
  return `${data.day.label} · 미등원 학원 전달명단\n${forwarding(data).map(s=>`${s.class_label} · ${s.name} · 예정 ${s.start}`).join('\n')}`;
 }
 function pollDaily(){
  clearTimeout(dailyTimer);
  if(dailyData?.forward?.status==='pending')dailyTimer=setTimeout(refresh,15000);
 }
 function renderDaily(){
  const selector=`<label for="ops-date">클리닉 날짜</label><input id="ops-date" type="date" value="${esc(dailyDate)}">`;
  if(!dailyData){el('ops-content').innerHTML=selector+'<p>학원 PC가 올린 해당 날짜의 클리닉 명단이 없습니다.</p>';return;}
  const {day,forward}=dailyData,arrived=day.scheduled.filter(s=>s.arrived===true),absent=day.scheduled.filter(s=>s.arrived===false&&s.macgai_record!==false),unrecorded=day.scheduled.filter(s=>s.arrived===false&&s.macgai_record===false),targets=forwarding(dailyData);
  const list=(students,sms=false)=>students.length?`<ul>${students.map(s=>`<li><strong>${esc(s.name)}</strong> · ${esc(s.class_label)} · ${sms?s.recipients.map(r=>r==='student'?'학생':'학부모').join(' · '):`예정 ${esc(s.start)}${s.arrived?` · 등원 ${esc(when(s.arrived_at))}${s.arrived_by?` (${esc(s.arrived_by)})`:''}`:''}${s.macgai_record===false?' · 맥가이 기록 없음':''} · 시험 ${s.exam_done?'응시':'미응시'}`}</li>`).join('')}</ul>`:'<p>해당 학생이 없습니다.</p>';
  const status=forward?.status,doneTime=Number.isFinite(Date.parse(forward?.done_at))?new Date(forward.done_at).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}):'시각 미기록';
  el('ops-content').innerHTML=`${selector}<h3>${esc(day.label)}</h3><p class="muted">맥가이 등원 시각을 우선하며 패드 등원도 반영합니다. 맥가이는 10분 간격으로 조회하고, 02:30~03:30에는 저장된 기록을 사용합니다. 패드 기록 0건은 참고 사항입니다.</p><p>집계 ${esc(when(day.at))} · 갱신 ${esc(when(dailyData.updated_at))}</p>${day.issues.length||day.unresolved?`<p class="weekly-warning" role="alert">확인 필요 ${esc(day.unresolved)}명 · ${day.issues.map(esc).join(' · ')}</p>`:''}<article><h3>① 등원 명단 (${arrived.length}명)</h3>${list(arrived)}</article><article><h3>② 미등원 명단 (${absent.length}명)</h3>${list(absent)}<h3>맥가이 기록 없음 (${unrecorded.length}명)</h3>${list(unrecorded)}</article><article><h3>③ 미등원 학원 전달명단 (${targets.length}명)</h3>${list(targets)}<h3>잔디로 보낼 문구 미리보기</h3><pre>${esc(forwardText(dailyData))}</pre><p role="status">${status==='sent'?`전달됨 ${esc(doneTime)}`:status==='pending'?'대기 · 학원 PC가 1분 안에 보냅니다':status==='failed'?'실패 · 전달 결과를 확인하고 다시 요청해 주세요.':'전달 요청 전'}</p><button type="button" class="primary" data-ops-forward ${busy||status==='pending'||!targets.length?'disabled':''}>${status==='sent'?'다시 전달':'잔디 등하원방에 전달'}</button></article><article><h3>④ 미응시 문자 발송명단 (${day.sms.length}명)</h3>${list(day.sms,true)}</article>`;
 }
 async function forwardDaily(){
  if(busy||!teacherId||!password||tab!=='daily'||!dailyData||dailyData.forward?.status==='pending'||!forwarding(dailyData).length)return;
  const data=dailyData,resend=data.forward?.status==='sent';
  const warning=data.day.issues.length||data.day.unresolved?`\n확인 필요 ${data.day.unresolved}명: ${data.day.issues.join(' · ')}\n`:'';
  if(!window.confirm(`잔디 등하원방에 다음 문구를 ${resend?'다시 ':''}전달할까요?${warning}\n\n${forwardText(data)}`))return;
  if(resend&&!window.confirm('이미 전달된 명단입니다. 같은 날짜의 명단을 다시 전달할까요?'))return;
  clearTimeout(dailyTimer);const token=++run;setBusy(true);renderDaily();message('전달 요청을 저장하고 있습니다…');
  try{
   const saved=await read('forward',password,{clinic_date:data.clinic_date,updated_at:data.updated_at,...(resend?{resend_of:data.forward.id}:{})});if(token!==run)return;
   data.forward=saved;message(saved.status==='pending'?'학원 PC가 1분 안에 보냅니다':saved.status==='sent'?'이미 전달된 명단입니다.':'전달에 실패했습니다.');
  }catch(error){if(token===run){clear();failed(error);}}
  finally{if(token===run){setBusy(false);if(dailyData){renderDaily();pollDaily();}}}
 }
 async function refresh(){
  if(!password||!teacherId||busy)return;
  const token=++run,selected=tab;clear();setBusy(true);message('확인하고 있습니다…');
  try{
   const data=await read(selected,password,selected==='daily'&&dailyDate?{clinic_date:dailyDate}:undefined);if(token!==run)return;
   if(selected==='pending'){rows=data.approvals;renderPending();}
   else if(selected==='weekly'){weekData=data;renderWeekly();}
   else if(selected==='daily'){dailyData=data[0]||null;if(dailyData)dailyDate=dailyData.clinic_date;renderDaily();pollDaily();}
   else if(selected==='board')renderBoard(data);else renderHistory(data);
   message(selected==='pending'?'명단과 문구를 확인해 주세요. 승인해도 예정 시각에 응시 여부를 다시 확인합니다.':'최신 조회를 완료했습니다.');
  }catch(error){if(token===run){clear();failed(error);}}
  finally{if(token===run){setBusy(false);if(selected==='pending'&&rows.length)renderPending();if(selected==='daily'&&dailyData)renderDaily();}}
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
 document.addEventListener('change',async event=>{
  if(event.target.id!=='ops-date'||!teacherId||busy||tab!=='daily'||!/^\d{4}-\d{2}-\d{2}$/.test(event.target.value))return;
  dailyDate=event.target.value;await refresh();
 });
 document.addEventListener('click',async event=>{
  const menu=event.target.closest('[data-ops-tab]');
  if(menu){if(!teacherId||busy)return;tab=menu.dataset.opsTab;weeklyFilter='all';dailyDate='';selectTab();await refresh();return;}
  const forward=event.target.closest('[data-ops-forward]');
  if(forward){if(!forward.disabled)await forwardDaily();return;}
  const filter=event.target.closest('[data-ops-filter]');
  if(filter){if(!teacherId||!password||busy||tab!=='weekly'||!Object.hasOwn(weeklyFilters,filter.dataset.opsFilter))return;weeklyFilter=filter.dataset.opsFilter;renderWeekly();el('ops-content').querySelector(`[data-ops-filter="${weeklyFilter}"]`)?.focus();return;}
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
