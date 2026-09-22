(function(){
 'use strict';let dialog=null,listener=null;
 function close(){if(listener)window.removeEventListener('message',listener);listener=null;if(dialog)dialog.remove();dialog=null;}
 window.openOdapResearch=function(){
  if(!session||!weeklyLogin||session.id!==weeklyLogin.id||padMode||studentPreviewMode){notify('본인 계정으로 로그인하세요.','error');return;}
  if(session.role==='teacher'){window.open('odap/','_blank','noopener');return;}
  close();const who=session.id,nonce=crypto.randomUUID();dialog=document.createElement('dialog');dialog.style.cssText='width:96vw;max-width:1100px;height:92vh;padding:0;border:0;border-radius:14px';
  const bar=document.createElement('div');bar.style.cssText='padding:12px 18px;display:flex;justify-content:space-between';const label=document.createElement('strong');label.textContent=session.name+'의 오답정리';const button=document.createElement('button');button.textContent='닫기';button.onclick=close;bar.append(label,button);
  const frame=document.createElement('iframe');frame.title=label.textContent;frame.src='odap/student.html?embedded='+encodeURIComponent(nonce);frame.style.cssText='border:0;width:100%;height:calc(100% - 52px)';
  listener=e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin||e.data?.type!=='odap-ready'||e.data.nonce!==nonce)return;if(!session||session.id!==who||!weeklyLogin||weeklyLogin.id!==who){close();return;}frame.contentWindow.postMessage({type:'odap-login',nonce,id:weeklyLogin.id,pw:weeklyLogin.pw,role:'student'},location.origin);window.removeEventListener('message',listener);listener=null;};
  window.addEventListener('message',listener);dialog.append(bar,frame);dialog.addEventListener('close',close,{once:true});document.body.append(dialog);dialog.showModal();
 };
 function addButton(){
  if(!session)return;const parent=document.querySelector(session.role==='teacher'?'#panel-dashboard':'#panel-scores');
  if(!parent||document.getElementById('odap-open'))return;const b=document.createElement('button');b.id='odap-open';b.className='btn blue';b.textContent=session.role==='teacher'?'오답연구소 열기':session.name+'의 오답정리 · 선생님 자료';b.onclick=window.openOdapResearch;parent.prepend(b);
 }
 const originalStudent=window.launchStudent;window.launchStudent=function(){const v=originalStudent.apply(this,arguments);addButton();return v;};
 const originalTeacher=window.launchTeacher;window.launchTeacher=function(){const v=originalTeacher.apply(this,arguments);addButton();return v;};
 const originalLogout=window.doLogout;window.doLogout=function(){close();document.getElementById('odap-open')?.remove();return originalLogout.apply(this,arguments);};
 window.addEventListener('pagehide',close);addButton();
})();
