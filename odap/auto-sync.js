/* Poll shared Kkakka records without replacing an open teacher edit. */
let syncRevision=null,syncRunning=false,syncPending=false;
function syncBlocked(){return document.hidden||document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||page==='packets';}
async function checkKkakkaUpdates(){
 if(syncRunning||document.hidden)return;
 syncRunning=true;
 try{
  const revision=await api('/api/sync');
  if(syncRevision!==null&&revision!==syncRevision)syncPending=true;
  syncRevision=revision;
  const label=document.getElementById('sync-status');
  if(syncPending&&!syncBlocked()){
   const currentPage=page,currentStudent=sid;
   const fresh=await api('/api/students');
   if(page===currentPage&&sid===currentStudent&&!syncBlocked()){
    students=fresh.students;schools=fresh.schools;
    const position=window.scrollY;
    await navigate(currentPage);
    window.scrollTo(0,position);syncPending=false;
   }
  }
  if(label)label.textContent=syncPending?'새 기록 있음 · 작성 완료 후 반영':'자동 연동 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
 }catch{
  const label=document.getElementById('sync-status');if(label)label.textContent='연결 재확인 중 · 기존 화면 유지';
 }finally{syncRunning=false;}
}
Promise.resolve(window.researchReady).then(()=>{
 const label=document.createElement('small');label.id='sync-status';label.textContent='김까까 자동 연동 · 30초마다 확인';
 document.querySelector('.topbar>div').append(label);
 checkKkakkaUpdates();setInterval(checkKkakkaUpdates,30000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkKkakkaUpdates();});
});
