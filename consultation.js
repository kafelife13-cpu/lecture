(function(){
 'use strict';
 const notice=`[국어왕 김까까 | 개별 상담 및 맞춤 보강 안내]

학부모님 안녕하세요. 학생별 시험 결과와 문제를 풀 때의 사고 과정을 확인하고, 앞으로의 학습 방향을 안내하는 개별 상담을 진행합니다.

■ 상담 일정 (1인 15분)
10/22(목) 오후 4~10시 · 24명
10/23(금) 오후 4~10시 · 24명
10/25(일) 오후 6~10시 · 16명
각 날짜 밤 10~11시 전화 상담 추가 · 4명씩\n총 76명, 시간대별 선착순 신청

■ 신청 대상 및 방법
국어왕에 중간·기말고사 성적을 입력한 학생만 신청 가능합니다. 학생 계정으로 로그인한 뒤 홈의 ‘개별 상담 신청’에서 원하는 시간을 선택해 주세요. 학생당 1회 신청할 수 있으며, 예약 완료 표시가 나와야 확정됩니다.
https://kafelife13-cpu.github.io/lecture/index.html?consultation=1

■ 시험지 반드시 지참
학생이 실제로 푼 시험지를 꼭 가져와야 합니다. 문제를 풀 때 어떤 생각으로 답을 골랐는지 학생이 직접 말로 설명하며 확인하므로 학생 본인의 참여가 필요합니다. 풀이 흔적은 지우지 않고 가져와 주세요.

■ 매주 클리닉이 개별 보강의 기준이 됩니다
앞으로 학생별 취약점을 보완하는 개별 보강 시스템을 적용할 예정입니다. 매주 클리닉에서 확인한 오답에 맞춰 학생마다 필요한 과제를 제공할 예정이므로, 매주 클리닉 참여와 정확한 답안 입력, 오답 점검이 더욱 중요해집니다. 클리닉을 빠지거나 답안을 입력하지 않으면 취약점을 정확히 파악하고 맞춤 과제를 제공하기 어렵습니다.

학생이 매주 클리닉에 성실히 참여하고 오답을 끝까지 점검할 수 있도록 가정에서도 관심 부탁드립니다. 감사합니다.`;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const day=s=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',weekday:'short'}).format(new Date(s));
 const time=s=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s));
 if(typeof module!=='undefined')module.exports={notice,day,time};
 if(typeof document==='undefined')return;
 let dialog=null,timer=null,busy=false,loading=false,owner=null,revision=0;
 async function rpc(action,payload={}){
  if(!session||!weeklyLogin||session.id!==weeklyLogin.id||padMode||studentPreviewMode)throw Error('학생 또는 강사 본인 계정으로 다시 로그인해 주세요.');
  const r=await sb.rpc('consultation_rpc',{p_id:weeklyLogin.id,p_password:weeklyLogin.pw,p_role:weeklyLogin.role,p_action:action,p_payload:payload});
  if(r.error)throw Error(/schema cache|does not exist|Could not find/i.test(r.error.message)?'상담 신청 시스템을 준비 중입니다. 선생님께 문의해 주세요.':r.error.message);
  return r.data;
 }
 function dismissModal(el){if(!el)return;el._dispose?.();if(el.open&&typeof el.close==='function')el.close();el.remove();}
 // ponytail: retain native focus handling; older in-app browsers use one keyboard-accessible overlay.
 function showModal(el){
  if(typeof el.showModal==='function'){try{el.showModal();return;}catch(_){}}
  const previous=document.activeElement,overlay=document.createElement('div');overlay.className='consultation-fallback';
  el.parentNode.insertBefore(overlay,el);overlay.append(el);el.setAttribute('open','');el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.tabIndex=-1;
  const keys=e=>{if(e.key==='Escape'){e.preventDefault();el.querySelector('[data-close],[data-entry-close]')?.click();}
   if(e.key==='Tab'){const items=Array.from(el.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]')).filter(x=>!x.hidden&&x.getClientRects().length);const first=items[0],last=items[items.length-1];if(!first){e.preventDefault();el.focus();}else if(e.shiftKey&&(document.activeElement===first||document.activeElement===el)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
  el.addEventListener('keydown',keys);el._dispose=()=>{el.removeEventListener('keydown',keys);overlay.remove();previous?.focus?.();};el.querySelector('button')?.focus();
 }
 function close(){revision++;clearInterval(timer);timer=null;const old=dialog;dialog=null;owner=null;busy=false;loading=false;dismissModal(old);}
 function message(text){if(dialog)dialog.querySelector('[data-message]').textContent=text;}
 async function refresh(){
  if(loading||busy||!dialog)return;
  if(session?.id!==owner){close();return;}
  const version=revision;loading=true;
  try{
   const data=await rpc('list');if(!dialog||version!==revision||session?.id!==owner)return;
   const teacher=session.role==='teacher',prep=(data.preparations||[]),myPrep=prep.find(s=>s.mine),mine=data.slots.find(s=>s.mine)||myPrep,remaining=data.slots.filter(s=>s.available).length;
   dialog.querySelector('[data-status]').textContent=teacher?'총 '+data.slots.length+'자리 · 남은 자리 '+remaining+'개':myPrep?'사전 작성 등원 확인 중':mine?'예약 확정: '+day(mine.starts_at)+' '+time(mine.starts_at)+'~'+time(mine.ends_at):data.eligible?'신청 가능 · 남은 자리 '+remaining+'개':'중간·기말고사 성적 입력 후 신청할 수 있습니다.';
   if(myPrep)dialog.querySelector('[data-status]').textContent='사전 작성 등원: '+day(myPrep.starts_at)+' '+time(myPrep.starts_at)+' · 시험지를 가지고 먼저 작성해 주세요. 실제 상담 시간은 선생님께 확인하세요.';
   let html=prep.length?'<section><h3>사전 작성 등원 (상담 시간과 별도)</h3>'+prep.map(s=>'<div class="consultation-slot"><strong>'+day(s.starts_at)+' '+time(s.starts_at)+'</strong><span>'+esc(teacher?s.student_name:'내 사전 작성 일정')+'</span><button class="btn" data-cancel="'+esc(s.booking_id)+'" data-starts-at="'+esc(s.starts_at)+'">예약 취소</button></div>').join('')+'</section>':'';
   for(const label of [...new Set(data.slots.map(s=>day(s.starts_at)))]){
    html+='<section style="margin-top:20px"><h3>'+esc(label)+'</h3><div class="consultation-grid">';
    for(const s of data.slots.filter(s=>day(s.starts_at)===label)){
     const canBook=!teacher&&data.eligible&&!mine&&s.available;
     html+='<div class="consultation-slot"><strong>'+time(s.starts_at)+'~'+time(s.ends_at)+'</strong>'+(time(s.starts_at)>='22:00'?'<span>전화 상담 전용</span>':'')+'<span>'+esc(s.mine?'내 예약':s.available?'신청 가능':'마감')+'</span>';
     if(teacher&&s.booking_id)html+='<span>'+esc(s.student_name)+' · '+esc(s.student_id)+'</span>';
     if(canBook)html+='<button class="btn blue" data-book="'+esc(s.starts_at)+'">이 시간 신청</button>';
     if(s.booking_id&&(teacher||s.mine))html+='<button class="btn" data-cancel="'+esc(s.booking_id)+'" data-starts-at="'+esc(s.starts_at)+'">예약 취소</button>';
     html+='</div>';
    }
    html+='</div></section>';
   }
   dialog.querySelector('[data-slots]').innerHTML=html;
   dialog.querySelector('[data-paper-wrap]').hidden=teacher||!!mine||!data.eligible;
   dialog.querySelector('[data-score-entry]').hidden=teacher||data.eligible;
  }catch(e){if(version===revision){message(e.message);dialog?.querySelectorAll('[data-book],[data-cancel]').forEach(b=>b.disabled=true);}}
  finally{if(version===revision)loading=false;}
 }
 window.openConsultation=async function(){
  closeEntryNotice();close();owner=session?.id;const teacher=session?.role==='teacher';
  dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','consultation-title');dialog.className='consultation-dialog';
  dialog.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px"><h2 id="consultation-title">'+(teacher?'상담 신청 현황':'개별 상담 신청')+'</h2><button class="btn" data-close aria-label="상담 창 닫기">닫기</button></div><p>10/22(목)·23(금) 16~22시 / 25(일) 18~22시<br>밤 22~23시 전화 상담 추가 (각 날짜 4명)<br>1인 15분 · 총 76명 · 선착순 · 한국 시간</p><p><strong>본인이 푼 시험지를 반드시 지참하세요.</strong><br>학생이 풀이 당시의 생각을 직접 말로 설명하며 점검합니다.</p><p>매주 클리닉 오답을 바탕으로 개별 보강 과제가 제공될 예정입니다. <strong>매주 클리닉 참여와 정확한 답안 입력이 중요합니다.</strong></p><p role="status" data-status>예약 현황 확인 중…</p><p role="alert" data-message style="color:var(--red,#b42318)"></p><button class="btn" data-score-entry hidden>중간·기말고사 성적 입력하기</button><label data-paper-wrap hidden style="display:block;padding:12px;background:var(--bg,#f5f5f5)"><input type="checkbox" data-paper> 시험지 지참 및 학생 본인 참여 안내를 확인했습니다.</label><div style="display:flex;gap:8px;margin:12px 0"><button class="btn" data-refresh>현황 새로고침</button>'+(teacher?'<button class="btn" data-notice>학부모 안내문 복사</button>':'')+'</div><div data-slots></div>';
  const opened=dialog;document.body.append(opened);opened.addEventListener('close',()=>{if(dialog===opened)close();},{once:true});
  dialog.addEventListener('click',async e=>{
   const b=e.target.closest('button');if(!b)return;
   if(b.hasAttribute('data-close'))return close();
   if(b.hasAttribute('data-score-entry')){close();sNav('exam','naeshin');return;}
   if(b.hasAttribute('data-refresh'))return refresh();
   if(b.hasAttribute('data-notice')){try{await navigator.clipboard.writeText(notice);message('학부모 안내문을 복사했습니다.');}catch(_){message('복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.');}return;}
   if(busy)return;
   const slot=b.dataset.book,id=b.dataset.cancel;if(!slot&&!id)return;
   if(slot&&!dialog.querySelector('[data-paper]').checked){message('시험지 지참 안내를 먼저 확인해 주세요.');return;}
   if(id&&!confirm('이 예약을 취소하면 다른 학생이 신청할 수 있습니다. 취소할까요?'))return;
   const version=revision;busy=true;dialog.querySelectorAll('[data-book],[data-cancel]').forEach(x=>x.disabled=true);message('처리 중…');
   try{await rpc(slot?'book':'cancel',slot?{starts_at:slot,paper_confirmed:true}:{id});if(version===revision){const at=slot||b.dataset.startsAt;sendStudentActivity(slot?'상담 신청':'상담 신청 취소',(at?day(at)+' '+time(at)+' · 15분 상담':'상담 예약')+(slot?' · 시험지 지참 확인':''));message(slot?'예약이 확정되었습니다. 시험지를 꼭 가져와 주세요.':'예약을 취소했습니다.');}}
   catch(err){if(version===revision)message(err.message);}
   finally{if(version===revision){busy=false;await refresh();}}
  });
  showModal(opened);await refresh();if(dialog===opened)timer=setInterval(refresh,20000);
 };

 // ponytail: this temporary entry notice replaces older automatic study notices for these two schools.
 window.isExamConsultationNoticeStudent=function(student){
  return !!student&&student.role==='student'&&(['sc_hanbaek','sc_chidong'].includes(student.school_id)||/^(hanbaek|chidong)_/.test(student.group_id||''));
 };
 function closeEntryNotice(){dismissModal(document.getElementById('exam-consultation-notice'));}
 function showEntryNotice(){
  if(!window.isExamConsultationNoticeStudent(session)||padMode)return;
  const oldPush=document.getElementById('student-push-dialog');if(oldPush?.open)oldPush.close();
  if(document.getElementById('exam-consultation-notice')||document.querySelector('dialog[open]'))return;
  ['sentence-study-popup','sok-task-popup'].forEach(id=>document.getElementById(id)?.remove());
  const popup=document.createElement('dialog');popup.id='exam-consultation-notice';popup.className='consultation-dialog';
  popup.style.maxWidth='560px';popup.setAttribute('aria-labelledby','exam-consultation-notice-title');
  popup.innerHTML='<h2 id="exam-consultation-notice-title">중간고사 성적을 입력해 주세요</h2><p>상담 신청 전에 시험 성적과 오답을 입력해 주세요.</p><button class="btn blue exam-score-primary" data-entry-score>지금 성적 입력하기 →</button><p>중간고사 준비하고 시험 보느라 모두 수고 많았어요. 이번 시험을 돌아보고 기말고사에는 더 열심히 준비해 봅시다!</p><p><strong>먼저 중간고사 답안과 성적을 입력해 주세요.</strong><br>틀린 문항에는 내가 선택한 답과 그 답을 고른 이유, 시험 볼 때 떠올린 생각도 적어 주세요.</p><p style="padding:12px;background:var(--bg);border-radius:10px">예) 프린트에서 본 내용이라고 생각해서 ③번을 골랐지만, 정확한 근거는 기억나지 않았다.</p><p><strong>상담: 10/22(목) · 10/23(금) · 10/25(일)</strong><br>성적 입력 후 원하는 시간을 신청하세요.<br>본인이 푼 시험지를 꼭 가져와 주세요.</p><p>전화·카카오톡 상담은 언제든 개별적으로 연락해 주세요.<br><a href="tel:01021557286">010-2155-7286</a></p><div style="display:grid;gap:10px"><button class="btn green" data-entry-consultation>상담 신청하기</button><button class="btn" data-entry-close>닫기</button></div>';
  document.body.append(popup);
  popup.addEventListener('close',()=>dismissModal(popup),{once:true});
  popup.addEventListener('click',e=>{
   if(e.target.closest('[data-entry-score]')){closeEntryNotice();sNav('exam','naeshin');}
   if(e.target.closest('[data-entry-consultation]')){closeEntryNotice();openConsultation();}
   if(e.target.closest('[data-entry-close]'))closeEntryNotice();
  });
  showModal(popup);
 }

 function entry(){
  document.querySelectorAll('[data-consultation-entry]').forEach(x=>x.remove());
  if(!session||padMode)return;
  if(window.isExamConsultationNoticeStudent(session))showEntryNotice();
  if(studentPreviewMode)return;
  const host=document.querySelector(session.role==='teacher'?'#panel-dashboard':'#panel-home');if(!host)return;
  const card=document.createElement('section');card.dataset.consultationEntry='';card.className='card';card.style.cssText='padding:18px;margin-bottom:16px;border-left:4px solid var(--accent,#4757d5)';
  card.innerHTML='<h3>시험 분석 · 개별 상담 주간</h3><p>10/22·23·25 · 1인 15분 · 선착순 76명 · 밤 22~23시 전화 상담<br>성적 입력 완료 학생 대상 · 시험지 필수 지참</p><button class="btn blue">'+(session.role==='teacher'?'상담 신청 현황 · 안내문':'개별 상담 신청')+'</button>';
  card.querySelector('button').onclick=openConsultation;
  if(session.role==='student'){const score=document.createElement('button');score.className='btn blue exam-score-primary';score.textContent='중간고사 성적 입력하기 →';score.onclick=()=>sNav('exam','naeshin');card.prepend(score);}
  host.prepend(card);
  if(new URLSearchParams(location.search).get('consultation')==='1'&&!window.isExamConsultationNoticeStudent(session))openConsultation();
 }
 const style=document.createElement('style');style.textContent='.consultation-fallback{position:fixed;inset:0;z-index:2147483647;background:#0008;display:flex;align-items:center;justify-content:center;overflow:auto}.consultation-fallback>.consultation-dialog[open]{display:block;position:relative;inset:auto;margin:auto}.exam-score-primary{display:flex;width:100%;justify-content:center;min-height:60px;font-size:19px!important;font-weight:800;margin:12px 0 20px;background:#4338ca!important;color:#fff!important;border:2px solid #a5b4fc!important;border-radius:12px} .consultation-dialog{margin:auto;overflow:auto;width:calc(100% - 24px);max-width:850px;max-height:90vh;box-sizing:border-box;border:0;border-radius:16px;padding:24px;background:var(--bg2,#fff);color:var(--text,#171b2c);line-height:1.7}.consultation-dialog [hidden]{display:none!important}.consultation-dialog p{margin:12px 0}.consultation-dialog::backdrop{background:#0008}.consultation-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px}.consultation-slot{display:flex;flex-direction:column;gap:6px;border:1px solid var(--border,#ddd);border-radius:10px;padding:12px}.consultation-slot .btn{min-height:44px;justify-content:center}.consultation-dialog button:focus-visible{outline:3px solid #5275ee;outline-offset:3px}';document.head.append(style);
 for(const name of ['launchStudent','launchTeacher']){const original=window[name];window[name]=function(){const v=original.apply(this,arguments);entry();return v;};}
 const logout=window.doLogout;window.doLogout=function(){closeEntryNotice();close();document.querySelectorAll('[data-consultation-entry]').forEach(x=>x.remove());return logout.apply(this,arguments);};
 window.addEventListener('pagehide',close);
 window.addEventListener('pageshow',showEntryNotice);
 document.addEventListener('visibilitychange',function(){if(!document.hidden)showEntryNotice();});entry();
})();

// Dedicated photo submissions reuse the existing certification storage.
(function(){if(typeof document==='undefined')return;const s=document.createElement('script');s.src='wrong-photo-section.js?v=20261020-2';document.head.append(s);})();
