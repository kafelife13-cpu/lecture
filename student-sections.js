(function(root){
 'use strict';
 function replacement(access){return access?.access_kind==='replacement';}
 function noticeMatches(item,kind){return (item.notice_kind||'general')===kind;}
 if(typeof module!=='undefined')module.exports={replacement,noticeMatches};
 if(typeof document==='undefined')return;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 root.renderMockScoreNotice=function(){
  const panel=document.querySelector('#page-student #panel-notice-hub');
  if(!panel||document.getElementById('mock-score-notice'))return;
  const card=document.createElement('section');card.id='mock-score-notice';card.className='weekly-plan';
  card.innerHTML='<h2>★ 고1 9월 모의고사 성적 입력</h2><p>9월 11일(금)까지 모든 학생이 점수를 확인해 주세요. 아직 입력하지 않았다면 채점 후 0~100점 숫자로 입력하세요. 선생님이 이미 입력한 점수는 중복 제출하지 않아도 됩니다.</p><button class="btn blue">🔢 성적 입력 / 확인</button>';
  card.querySelector('button').onclick=()=>sNav('exam','mock');
  panel.querySelector('.page-header').after(card);
 };
 root.renderWeeklyExtras=function(week){
  let host=document.getElementById('s-weekly-extras');
  if(!host){host=document.createElement('div');host.id='s-weekly-extras';document.getElementById('s-weekly-body').before(host);}
  const end=new Date(week+'T00:00:00');end.setDate(end.getDate()+7);
  const notices=myAnnounceItems().filter(a=>(a.notice_kind||'general')==='general'&&new Date(a.created_at)<end);
  const notice=notices[0];
  const items=certDb.items.filter(i=>(certDb.targets[i.id]||[]).includes(session.id)&&new Date(i.created_at)<end);
  const cards=items.map(i=>{
   const sub=certDb.submissions.find(s=>s.item_id===i.id&&s.student_id===session.id);
   const status=sub?.status||'none';
   const current=new Date(i.created_at)>=new Date(week+'T00:00:00');
   if(!current&&['approved','pending'].includes(status))return '';
   return '<button class="weekly-task" data-cert-open="'+esc(i.id)+'"><span class="weekly-task-copy"><strong>'+esc(certDisplayTitle(i))+'</strong><small>'+esc((certDb.weeks.find(w=>w.id===i.week_id)||{}).name||'사진 인증')+'</small><span class="weekly-status">'+({approved:'완료',pending:'선생님 확인 대기',rejected:'다시 제출',none:'사진 제출 필요'}[status]||'확인 필요')+'</span></span><span>→</span></button>';
  }).join('');
  host.innerHTML=(notice?'<section class="weekly-plan"><h2>'+esc(notice.title)+'</h2><div style="white-space:pre-wrap;line-height:1.8">'+esc(notice.content)+'</div><button class="btn" data-homework-notice>첨부자료와 안내 보기</button></section>':'')+(cards?'<section class="weekly-plan"><h2>사진 인증 할 일</h2><p>이번 주 인증과 아직 제출하지 않은 인증을 함께 확인해요.</p><div class="weekly-tasks">'+cards+'</div></section>':'');
 };
 root.openAssignedCert=function(id){
  if(!session||!(certDb.targets[id]||[]).includes(session.id))return;
  sNav('cert');
  requestAnimationFrame(()=>document.getElementById('cert-task-'+id)?.scrollIntoView({block:'start'}));
 };
 document.addEventListener('click',e=>{const b=e.target.closest('[data-cert-open]');if(b)openAssignedCert(b.dataset.certOpen);if(e.target.closest('[data-homework-notice]'))sNav('announce');});
 if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{
  if(e.data?.type!=='OPEN_HOMEWORK')return;
  if(session?.role==='student'&&!padMode)sNav('weekly');
  else location.hash='homework';
 });
 root.isReplacementAccess=function(sid,vid){return db.access.some(a=>a.student_id===sid&&a.video_id===vid&&replacement(a)&&!isAccessExpired(a));};
 root.renderReplacementLectures=function(){
  const el=document.getElementById('student-replacement-list');
  const rows=db.access.filter(a=>a.student_id===session.id&&replacement(a)).sort((a,b)=>new Date(b.granted_at)-new Date(a.granted_at));
  el.innerHTML=rows.length?rows.map(a=>{
   const v=db.videos.find(v=>v.id===a.video_id);if(!v)return '';
   const pct=getPct(session.id,v.id),expired=isAccessExpired(a),date=accessExpiry(a);
   return '<div class="card" style="padding:18px;margin-bottom:12px"><span class="badge '+(pct>=100?'done':'partial')+'">'+(pct>=100?'시청 완료':expired?'시청 기간 종료':'필수 시청')+'</span><h3 style="margin:10px 0">'+esc(v.title)+'</h3><p style="font-size:13px;color:var(--text2)">'+(a.absence_date?esc(a.absence_date)+' 미등원 대체 · ':'')+esc(isNaN(date)?'':date.toLocaleDateString('ko-KR')+'까지')+'</p><p style="margin:10px 0">시청 진도 '+Math.min(100,Math.max(0,pct))+'%</p>'+(!expired?'<button class="btn blue" data-replacement-video="'+esc(v.id)+'">'+(pct>0&&pct<100?'이어보기':'강의 보기')+'</button>':'<p>선생님에게 시청 기간을 문의해주세요.</p>')+'</div>';
  }).join(''):'<div class="weekly-empty">지정된 영상대체 강의가 없어요.<p>미등원한 수업의 대체 영상을 선생님이 지정하면 여기에 표시돼요.</p></div>';
 };
 document.addEventListener('click',e=>{const b=e.target.closest('[data-replacement-video]');if(b)openPlay(b.dataset.replacementVideo);});
 root.grantVideoAssignment=async function(){
  if(!session||session.role!=='teacher'||studentPreviewMode)return;
  const button=document.getElementById('access-grant-submit');if(button.disabled)return;
  const ids=Array.from(document.getElementById('access-grant-student').selectedOptions).map(o=>o.value).filter(Boolean);
  const vid=document.getElementById('access-grant-video').value,kind=document.getElementById('access-grant-kind').value,absence=document.getElementById('access-absence-date').value;
  if(!ids.length||!vid){notify('학생과 강의를 선택해주세요.','error');return;}
  if(kind==='replacement'&&!/^\d{4}-\d{2}-\d{2}$/.test(absence)){notify('영상대체할 미등원 날짜를 선택해주세요.','error');return;}
  if(!['replacement','review'].includes(kind)||!reviewVideos().some(v=>v.id===vid)||ids.some(id=>!activeStudents().some(s=>s.id===id))){notify('학생과 강의 목록을 다시 확인해주세요.','error');return;}
  button.disabled=true;const failures=[];let count=0;
  try{
   for(const sid of ids){
    try{
     const existing=db.access.find(a=>a.student_id===sid&&a.video_id===vid);
     const row={id:existing?.id||'ac_'+crypto.randomUUID(),student_id:sid,video_id:vid,granted_at:new Date().toISOString(),expires_at:null,access_kind:kind,absence_date:kind==='replacement'?absence:null};
     const r=await sb.from('video_access').upsert(row,{onConflict:'student_id,video_id'});if(r.error)throw r.error;
     if(existing)Object.assign(existing,row);else db.access.push(row);
     await logVideoAccessGrant(sid,vid,row.granted_at,kind,row.absence_date);count++;
    }catch(e){failures.push((db.users.find(s=>s.id===sid)?.name||sid)+': '+e.message);}
   }
   notify(count+'명 '+(kind==='replacement'?'영상대체 지정':'복습 권한 부여')+' 완료'+(failures.length?' · 실패 '+failures.length+'명 ('+failures.join(', ')+')':''),failures.length?'error':'success');
   renderAccessPanel();renderDashboard();
  }finally{button.disabled=false;}
 };
})(typeof window==='undefined'?globalThis:window);
