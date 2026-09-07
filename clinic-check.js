/* Weekly teacher checkout records. Completion is explicit, never inferred from scores. */
(function(root){
 'use strict';
 const modes={unchecked:'미확인',onsite:'현장 완료',take_home:'시험지 수령 → 가정 수행',finish_home:'현장 진행 → 가정 마무리'};
 function monday(value){const d=new Date((value||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date()))+'T12:00:00Z');if(isNaN(d))throw Error('날짜를 확인해주세요.');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
 function summary(rows){return {total:rows.length,checked:rows.filter(r=>r.mode!=='unchecked').length,home:rows.filter(r=>['take_home','finish_home'].includes(r.mode)&&!r.completed).length,done:rows.filter(r=>r.completed).length};}
 if(typeof module!=='undefined')module.exports={modes,monday,summary};
 if(typeof document==='undefined')return;
 const el=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let rows=[],run=0,busy=false,loadedWeek='',owner='';
 async function rpc(action,payload){
  if(!session||session.role!=='teacher'||!weeklyLogin||weeklyLogin.role!=='teacher'||padMode||studentPreviewMode)throw Error('교사 계정으로 다시 로그인해주세요.');
  const res=await sb.rpc('clinic_checkout_rpc',{p_id:weeklyLogin.id,p_password:weeklyLogin.pw,p_action:action,p_payload:payload});
  if(res.error)throw Error(res.error.code==='PGRST202'?'수행 체크 서버 설정이 아직 적용되지 않았습니다. 저장 기능은 서버 설정 후 사용할 수 있습니다.':res.error.message||'기록을 처리하지 못했습니다.');
  return res.data;
 }
 root.renderClinicCheckout=async function(){
  if(!session||session.role!=='teacher'||!el('clinic-check-body'))return;
  if(busy)return;
  const token=++run,who=session.id;
  const date=el('clinic-check-week');date.value=monday(date.value||undefined);
  const week=date.value;loadedWeek='';rows=[];
  el('clinic-check-body').innerHTML='<p role="status">수행 기록을 확인하고 있습니다…</p>';
  el('clinic-check-summary').textContent='';
  try{
   const result=await rpc('list',{week_start:week});
   if(token!==run||session?.id!==who)return;
   rows=result;loadedWeek=week;owner=who;
   const select=el('clinic-check-slot'),old=select.value;
   const slots=[...new Map(rows.map(r=>[r.slot_id||'',r.slot_label])).entries()];
   select.innerHTML='<option value="all">모든 시간대</option>'+slots.map(([id,label])=>'<option value="'+esc(id)+'">'+esc(label)+'</option>').join('');
   select.value=slots.some(([id])=>id===old)?old:'all';render();
  }catch(e){if(token===run&&session?.id===who)el('clinic-check-body').innerHTML='<p role="alert">'+esc(e.message)+'</p><p>조회되지 않은 기록을 미확인이나 미완료로 처리하지 않습니다.</p>';}
 };
 function render(){
  const slot=el('clinic-check-slot').value,filter=el('clinic-check-filter').value,query=el('clinic-check-search').value.trim();
  const selected=rows.filter(r=>(slot==='all'||(r.slot_id||'')===slot)&&(!query||r.student_name.includes(query)));
  const n=summary(selected);
  el('clinic-check-summary').textContent=loadedWeek+' 주간 · 전체 '+n.total+'명 · 확인 '+n.checked+'명 · 미확인 '+(n.total-n.checked)+'명 · 수행 완료 '+n.done+'명 · 가정 수행 중 '+n.home+'명';
  const shown=selected.filter(r=>filter==='all'||(filter==='unchecked'?r.mode==='unchecked':filter==='home'?['take_home','finish_home'].includes(r.mode)&&!r.completed:r.completed));
  const groups=new Map();shown.forEach(r=>{const key=r.slot_id||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);});
  el('clinic-check-body').innerHTML=[...groups].map(([key,list])=>{
   const total=summary(selected.filter(r=>(r.slot_id||'')===key));
   return '<section class="clinic-check-group"><h3>'+esc(list[0].slot_label)+'</h3><p>전체 '+total.total+'명 · 확인 '+total.checked+'명 · 미확인 '+(total.total-total.checked)+'명</p>'+list.sort((a,b)=>(a.mode!=='unchecked')-(b.mode!=='unchecked')||a.student_name.localeCompare(b.student_name,'ko')).map(r=>
    '<article class="clinic-check-student" data-check-id="'+esc(r.student_id)+'"><div class="clinic-check-name"><strong>'+esc(r.student_name)+'</strong><span>'+esc(r.school_name||'학교 미배정')+'</span><span class="badge '+(r.completed?'done':'partial')+'">'+(r.completed?'수행 완료':r.mode==='unchecked'?'미확인':'가정 수행 중')+'</span></div><label>귀가 전 수행 방식<select class="form-select" data-check-mode aria-label="'+esc(r.student_name)+' 수행 방식"'+(busy?' disabled':'')+'>'+Object.entries(modes).map(([v,label])=>'<option value="'+v+'"'+(v===r.mode?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+(['take_home','finish_home'].includes(r.mode)?'<label class="clinic-check-complete"><input type="checkbox" data-check-complete aria-label="'+esc(r.student_name)+' 가정 수행 완료"'+(r.completed?' checked':'')+(busy?' disabled':'')+'> 가정 수행까지 완료 확인</label>':'')+'<small>'+(r.updated_at?'저장됨 · '+esc(new Date(r.updated_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})):'아직 체크하지 않았습니다.')+'</small></article>'
   ).join('')+'</section>';
  }).join('')||'<p>선택한 조건에 해당하는 학생이 없습니다.</p>';
 }
 function lock(value){busy=value;document.querySelectorAll('#clinic-check-card input,#clinic-check-card select,#clinic-check-card button').forEach(x=>x.disabled=value);}
 document.addEventListener('change',async function(e){
  if(e.target.id==='clinic-check-week'){root.renderClinicCheckout();return;}
  if(['clinic-check-slot','clinic-check-filter'].includes(e.target.id)){if(loadedWeek)render();return;}
  if(!e.target.matches('[data-check-mode],[data-check-complete]'))return;
  const row=rows.find(r=>r.student_id===e.target.closest('[data-check-id]').dataset.checkId);
  if(busy||!row||!loadedWeek||owner!==session?.id)return;
  const mode=e.target.matches('[data-check-mode]')?e.target.value:row.mode;
  const completed=mode==='onsite'||(mode!=='unchecked'&&e.target.matches('[data-check-complete]')&&e.target.checked);
  const who=session.id;lock(true);el('clinic-check-message').textContent=row.student_name+' 저장 중…';
  try{
   const saved=await rpc('save',{week_start:loadedWeek,student_id:row.student_id,mode,completed,version:row.version});
   if(session?.id!==who)return;
   Object.assign(row,saved);el('clinic-check-message').textContent=row.student_name+' 저장 완료';
  }catch(err){if(session?.id===who)el('clinic-check-message').textContent='저장되지 않았습니다: '+err.message+' 새로고침 후 다시 확인해주세요.';}
  finally{lock(false);if(session?.id===who)render();}
 });
 document.addEventListener('input',e=>{if(e.target.id==='clinic-check-search'&&loadedWeek)render();});
})(typeof window==='object'?window:this);
