// 보관된 중간고사 중세국어 개념정리 영상을 새로 열어 준 학생에게만 홈 화면 팝업으로 안내한다.
// 대상: 2026-11-14 02:37 이후 review 권한을 새로 받았고 아직 다 보지 않은 학생. 하루 한 번만 띄운다.
(function(root){
 const IDS=['v1786872154770','v1786872166415'];
 const SINCE=Date.parse('2026-11-14T02:37:34Z');
 const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function kstDay(){return new Date(Date.now()+9*3600*1000).toISOString().slice(0,10);}
 root.reopenedReviewVideosFor=function(student){
  if(!student||student.role!=='student')return [];
  return IDS.filter(id=>db.access.some(a=>a.student_id===student.id&&a.video_id===id&&a.access_kind==='review'&&
    Date.parse(a.granted_at)>=SINCE&&!isAccessExpired(a))&&getPct(student.id,id)<100)
   .map(id=>db.videos.find(v=>v.id===id)).filter(Boolean);
 };
 root.showReopenedReviewPopup=function(){
  if(!session||session.role!=='student'||(typeof padMode!=='undefined'&&padMode))return;
  if(document.getElementById('reopened-review-popup')||document.querySelector('.modal-bg.show,dialog[open]'))return;
  const videos=root.reopenedReviewVideosFor(session);
  if(!videos.length)return;
  const key='reopenedReviewPopup:'+session.id+':'+kstDay();
  try{if(localStorage.getItem(key))return;}catch(_){}
  const modal=document.createElement('div');
  modal.id='reopened-review-popup';modal.className='modal-bg show';
  modal.setAttribute('role','dialog');modal.setAttribute('aria-label','중세국어 복습 영상 안내');
  modal.innerHTML='<div class="modal" style="max-width:520px"><h3 style="margin-bottom:8px">📺 중세국어 복습 영상이 열렸어요</h3>'+
   '<p style="font-size:13px;color:var(--text2);margin-bottom:12px">중간고사 때 공부한 중세국어 개념정리 영상을 다시 볼 수 있어요. 끝까지 시청해 주세요.</p>'+
   videos.map(v=>'<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)"><div style="flex:1;font-weight:700;font-size:13px">'+esc(v.title)+'</div><button class="btn btn-sm blue" data-reopened-play="'+esc(v.id)+'">보기</button></div>').join('')+
   '<div style="text-align:right;margin-top:12px"><button class="btn" data-reopened-close>닫기</button></div></div>';
  const close=()=>{modal.remove();try{localStorage.setItem(key,'1');}catch(_){}};
  modal.addEventListener('click',e=>{
   const play=e.target.closest('[data-reopened-play]');
   if(play){const id=play.dataset.reopenedPlay;close();openPlay(id);return;}
   if(e.target.closest('[data-reopened-close]')||e.target===modal)close();
  });
  document.body.appendChild(modal);
 };
})(window);
