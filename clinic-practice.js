/* Independent practice: never writes exam grades, homework completion or rankings. */
(function(){
 'use strict';
 const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const imageOK=s=>/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(s||'');
 const clinic=e=>e&&(e.category??'school')==='school'&&String(e.clinic_week||'').trim()!=='';
 const validChoices=choices=>Array.isArray(choices)&&choices.length===5&&choices.every(c=>typeof c==='string'&&c.trim());
 const playable=q=>validChoices(q.choices)||/①[\s\S]+②[\s\S]+③[\s\S]+④[\s\S]+⑤[\s\S]+/.test(String(q.text||'')+'\n'+String(q.passage||''));
 let owner=null,stopped=false,dialog=null,returnFocus=null;
 let job=null,stalled=false,preparationNotice='';
 const sequence={home:0,result:0};
 function allowed(){
  if(typeof weeklyLogin==='undefined'||!weeklyLogin||typeof session==='undefined'||!session||session.role!=='student'||weeklyLogin.role!=='student'||session.id!==weeklyLogin.id||typeof padMode!=='undefined'&&padMode||typeof studentPreviewMode!=='undefined'&&studentPreviewMode)return false;
  if(owner!==weeklyLogin){owner=weeklyLogin;stopped=false;job=null;stalled=false;preparationNotice='';}
  return !stopped;
 }
 function clearCards(){document.getElementById('clinic-practice-home')?.remove();document.getElementById('clinic-practice-result')?.remove();}
 async function call(action,payload={}){
  if(!allowed())throw Error('현재 연습을 사용할 수 없습니다.');
  const login=owner;
  const r=await sb.rpc('odap_clinic_practice_rpc',{p_id:login.id,p_password:login.pw,p_role:'student',p_action:action,p_payload:payload});
  if(!allowed()||owner!==login)throw Error('로그인 정보가 바뀌었습니다.');
  if(r.error)throw Error('연습을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.');
  if(r.data?.enabled===false){stopped=true;clearCards();if(dialog?.open)dialog.close();}
  return r.data;
 }
 function preparationStatus(message,retry=false){
  preparationNotice=message;stalled=retry;
  for(const where of ['home','result']){const card=document.getElementById('clinic-practice-'+where);if(!card)continue;card.querySelector('[data-prepare-status]').textContent=message;card.querySelector('[data-prepare-retry]').hidden=!retry;}
 }
 function startPreparation(){
  if(!allowed()||job||stalled)return;
  const token={login:owner};job=token;
  const valid=()=>allowed()&&owner===token.login&&job===token;
  void (async()=>{
   let failures=0,remaining=1;
   // Each successful RPC commits three decisions. Limit both retries and total automatic calls.
   for(let calls=0;calls<8&&valid();calls++){
    preparationStatus('연습 문제를 준비하고 있어요. 준비된 문제는 먼저 풀 수 있어요.');
    try{
     const result=await call('allocate');if(!valid())return;
     failures=0;remaining=Number(result.pending||0);preparationNotice=remaining?'남은 연습 문제를 준비하고 있어요.':'';
     await Promise.all([refresh('home',false),refresh('result',false)]);if(!valid())return;
     if(!remaining){if(!stalled)preparationStatus('');return;}
    }catch{
     if(!valid())return;
     failures++;preparationStatus('문제 준비가 지연되어 다시 시도하고 있어요.');
     // Allocation failure never clears the independently fetched, committed items.
     await Promise.all([refresh('home',false),refresh('result',false)]);if(!valid())return;
     if(failures>=3){preparationStatus('문제 준비가 지연되고 있어요. 준비된 문제는 먼저 풀고, 잠시 후 다시 눌러 주세요.',true);return;}
    }
    await new Promise(resolve=>setTimeout(resolve,failures?500*2**(failures-1):100));
   }
   if(valid()&&remaining)preparationStatus('아직 준비 중인 연습이 있어요. 잠시 후 다시 눌러 이어서 준비해 주세요.',true);
  })().catch(()=>{if(valid())preparationStatus('문제 준비가 지연되고 있어요. 잠시 후 다시 눌러 주세요.',true);})
   .finally(()=>{if(job===token)job=null;});
 }
 async function refresh(where,automatic=true){
  const ticket=++sequence[where],id='clinic-practice-'+where;
  const restoreFocus=document.getElementById(id)?.contains(document.activeElement);
  if(!allowed()){clearCards();return;}
  const exam=where==='result'&&typeof sExamData!=='undefined'?sExamData:null;
  if(where==='result'&&!clinic(exam)){document.getElementById(id)?.remove();return;}
  try{
   const data=await call('list',exam?{exam_id:exam.id}:{});
   if(ticket!==sequence[where]||!allowed()||where==='result'&&sExamData!==exam)return;
   const items=(data?.items||[]).filter(q=>playable(q)&&(where!=='home'||!q.result));
   const pending=Number(data?.pending||0);
   const anchor=document.getElementById(where==='home'?'home-announce-banner':'s-res-wrong-list');if(!anchor)return;
   if(!data?.enabled||!items.length&&!pending){document.getElementById(id)?.remove();if(restoreFocus){anchor.setAttribute('tabindex','-1');anchor.focus();}return;}
   const returnToCard=document.getElementById(id)?.contains(returnFocus);document.getElementById(id)?.remove();
   const card=document.createElement('section');card.id=id;card.className='card';card.style.padding='16px';card.setAttribute('tabindex','-1');
   card.innerHTML='<p>연습 · 점수에 반영되지 않아요</p>'+(items.length?'<button type="button" data-practice-open class="btn" style="min-height:44px;min-width:44px">비슷한 유형 '+E(items.length)+'문제</button>':'')+'<p data-prepare-status role="status" aria-live="polite"></p><button type="button" data-prepare-retry style="min-height:44px;min-width:44px" hidden>잠시 후 다시</button>';
   const open=card.querySelector('[data-practice-open]');if(open)open.onclick=e=>openPractice(exam,e.currentTarget);
   card.querySelector('[data-prepare-status]').textContent=preparationNotice||(pending?'연습 문제를 준비하고 있어요.':'');
   const retry=card.querySelector('[data-prepare-retry]');retry.hidden=!stalled;retry.onclick=()=>{stalled=false;startPreparation();};
   anchor.insertAdjacentElement(where==='home'?'afterend':'beforebegin',card);
   const focusTarget=open||(!retry.hidden?retry:card);
   if(returnToCard)returnFocus=focusTarget;
   if(restoreFocus)focusTarget.focus();
   if(pending&&automatic)startPreparation();
  }catch{if(ticket===sequence[where]&&document.getElementById(id))preparationStatus('연습을 확인하지 못했어요. 잠시 후 다시 눌러 주세요.',true);}
 }
 async function openPractice(exam,opener){
  if(!allowed()){clearCards();return;}
  opener.disabled=true;
  try{
   const data=await call('list',exam?{exam_id:exam.id}:{});
   if(!data?.enabled||!allowed())return;
   const items=(data.items||[]).filter(q=>playable(q)&&(exam||!q.result)).sort((a,b)=>Number(!!a.result)-Number(!!b.result));
   if(!items.length){clearCards();return;}
   dialog?.remove();dialog=document.createElement('dialog');returnFocus=opener;
   const box=dialog,login=owner;let index=0;
   box.setAttribute('aria-labelledby','clinic-practice-title');box.style.cssText='max-width:680px;width:calc(100% - 32px);max-height:90vh;border:1px solid #777;border-radius:12px;padding:20px';
   box.innerHTML='<style>#clinic-practice-dialog button,#clinic-practice-dialog label{min-height:44px;min-width:44px}#clinic-practice-dialog label{display:flex;gap:12px;align-items:center;padding:8px}#clinic-practice-dialog p,#clinic-practice-dialog legend{white-space:pre-wrap;overflow-wrap:anywhere}#clinic-practice-dialog img{max-width:100%;height:auto}#clinic-practice-dialog textarea{width:100%;min-height:88px}</style><h2 id="clinic-practice-title" tabindex="-1">비슷한 유형 풀기</h2><p>연습 · 점수에 반영되지 않아요</p><button type="button" data-close>닫기</button><p role="status" aria-live="polite" data-status></p><div data-question></div>';
   box.id='clinic-practice-dialog';document.body.append(box);
   const status=box.querySelector('[data-status]'),content=box.querySelector('[data-question]');
   const valid=()=>box.isConnected&&box.open&&allowed()&&owner===login;
   box.querySelector('[data-close]').onclick=()=>box.close();
   box.addEventListener('close',()=>{const focus=returnFocus;box.remove();if(dialog===box)dialog=null;if(focus?.isConnected)focus.focus();if(allowed()){void refresh('home');void refresh('result');}});
   // Native dialog supplies Escape closing and the modal focus boundary.
   function draw(){
    const q=items[index],result=q.result;
    status.textContent=(index+1)+' / '+items.length+'문제';
    content.innerHTML='<p>'+E(q.exam_name)+' · '+E(q.num)+'번 오답 연습</p>'+(q.passage?'<p>'+E(q.passage)+'</p>':'')+
     (Array.isArray(q.images)?q.images:[]).filter(im=>imageOK(im?.data)).map(im=>'<img src="'+E(im.data)+'" alt="'+E(im.alt||'문항 그림')+'">').join('')+
     '<form data-answer><fieldset'+(result?' disabled':'')+'><legend>'+E(q.text)+'</legend>'+(validChoices(q.choices)?q.choices:['','','','','']).map((c,i)=>'<label><input type="radio" name="practice-answer" value="'+E(i+1)+'" required'+(result?.my_answer===String(i+1)?' checked':'')+'>'+E(i+1)+'번 '+E(c)+'</label>').join('')+'</fieldset>'+(!result?'<button type="submit">답 제출</button>':'')+'</form>'+
     (result?'<section aria-label="제출 결과"><p>'+(result.correct?'정답이에요.':'다시 개념을 확인해 보세요.')+' 정답 '+E(result.answer)+'번</p><p>'+E(result.explanation)+'</p><button type="button" data-report>문항 오류 신고</button><form data-report-form hidden><label>신고 사유<textarea name="reason" required maxlength="500"></textarea></label><button type="submit">신고 보내기</button></form><button type="button" data-next>'+(index+1<items.length?'다음 문제':'마치기')+'</button></section>':'');
    const answerForm=content.querySelector('[data-answer]');
    answerForm.onsubmit=async event=>{
     event.preventDefault();if(!valid()||q.result)return;
     const answer=answerForm.querySelector('input:checked')?.value;if(!answer)return;
     const button=answerForm.querySelector('button');button.disabled=true;status.textContent='답을 저장하고 있어요.';
     try{const result=await call('submit',{id:q.id,answer});if(!valid())return;q.result=result;draw();status.textContent='제출했어요. 정답과 해설을 확인하세요.';content.querySelector('[data-next]').focus();}
     catch(e){clearCards();if(valid())status.textContent=e.message;}
     finally{if(button.isConnected)button.disabled=false;}
    };
    if(result){
     const reportForm=content.querySelector('[data-report-form]');
     content.querySelector('[data-report]').onclick=()=>{reportForm.hidden=false;reportForm.querySelector('textarea').focus();};
     reportForm.onsubmit=async event=>{event.preventDefault();if(!valid())return;const button=reportForm.querySelector('button');button.disabled=true;
      try{await call('report',{id:q.id,reason:reportForm.querySelector('textarea').value});if(valid()){reportForm.hidden=true;status.textContent='문항 오류 신고를 저장했어요.';content.querySelector('[data-next]').focus();}}
      catch(e){clearCards();if(valid())status.textContent=e.message;}finally{button.disabled=false;}
     };
     content.querySelector('[data-next]').onclick=()=>{if(!valid()){box.close();return;}if(++index<items.length){draw();box.querySelector('h2').focus();}else box.close();};
    }
   }
   box.showModal();draw();box.querySelector('h2').focus();
  }catch{clearCards();}finally{opener.disabled=false;}
 }
 const resultBefore=renderSExamResultView;
 renderSExamResultView=function(...args){const result=resultBefore.apply(this,args);void refresh('result');return result;};
 const homeBefore=renderSHome;
 renderSHome=function(...args){const result=homeBefore.apply(this,args);void refresh('home');return result;};
 const logoutBefore=doLogout;
 doLogout=function(...args){stopped=true;sequence.home++;sequence.result++;clearCards();if(dialog?.open)dialog.close();owner=null;return logoutBefore.apply(this,args);};
})();
