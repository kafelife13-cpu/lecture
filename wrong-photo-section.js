(function(){
 'use strict';
 const campaign='midterm_202610',title='중간고사 오답 문제 사진 제출';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const itemId=s=>'ci_wrong_'+campaign+'_'+s;
 function photos(raw){try{const a=JSON.parse(raw||'[]');return Array.isArray(a)?a:[];}catch(_){return raw?[raw]:[];}}
 function valid(file){return ['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size>0&&file.size<=15*1024*1024;}
 if(typeof module!=='undefined')module.exports={photos,valid,itemId};
 if(typeof document==='undefined')return;
 let dialog,busy=false,bookings=[],subs=[],items=[];
 const studentList=()=>db.users.filter(u=>u.role==='student'&&u.status==='active'&&!['이내','들소'].includes(u.name));
 function booked(id){return bookings.some(b=>b.student_id===id||b.mine&&id===session.id);}
 function note(id){return booked(id)?'상담 신청 학생: 상담 중 선생님이 사진을 촬영하여 보충합니다.':'상담 미신청 학생: 시험지를 가지고 등원하여 틀린 문제를 촬영해 제출하세요.';}
 async function checked(query){const r=await query;if(r.error)throw Error(r.error.message);return r.data;}
 async function load(){
  const c=await checked(sb.rpc('consultation_rpc',{p_id:weeklyLogin.id,p_password:weeklyLogin.pw,p_role:weeklyLogin.role,p_action:'list',p_payload:{}}));
  bookings=c.slots.filter(s=>s.booking_id||s.mine);
  items=await checked(sb.from('cert_items').select('*').like('id','ci_wrong_'+campaign+'_%'));
  subs=items.length?await checked(sb.from('cert_submissions').select('*').in('item_id',items.map(i=>i.id))):[];
 }
 async function provision(){
  for(const school of [...new Set(studentList().map(u=>u.school_id).filter(Boolean))]){
   const wid='cw_wrong_'+campaign+'_'+school,id=itemId(school);
   const targets=studentList().filter(u=>u.school_id===school).map(u=>u.id);
   await checked(sb.from('cert_weeks').upsert({id:wid,school_id:school,name:title,created_at:new Date().toISOString()},{onConflict:'id'}));
   await checked(sb.from('cert_items').upsert({id,week_id:wid,school_id:school,title:'[clinic]'+title,type:'photo',targets:JSON.stringify(targets),form_link:null,created_at:new Date().toISOString()},{onConflict:'id'}));
  }
  await load();
 }
 function render(){
  const teacher=session.role==='teacher',students=teacher?studentList():[session];
  dialog.querySelector('[data-list]').innerHTML=students.map(u=>{
   const sub=subs.find(s=>s.student_id===u.id&&s.item_id===itemId(u.school_id)),urls=photos(sub?.photo_url);
   return '<section class="card" style="padding:16px;margin:12px 0" data-student="'+esc(u.id)+'"><h3>'+esc(u.name)+' · '+(urls.length?'사진 '+urls.length+'장 제출':'사진 미제출')+'</h3><p>'+note(u.id)+'</p>'+urls.map(url=>{let label='';try{label=new URL(url).hash.slice(1);}catch(_){}return '<a href="'+esc(url)+'" target="_blank" rel="noopener"><img src="'+esc(url)+'" alt="'+esc(label||'오답 문제 사진')+'" style="width:120px;height:150px;object-fit:contain;margin:4px"></a>';}).join('')+'<label>문항 번호 (예: 3, 8, 12)<input data-numbers class="form-input" maxlength="100"></label><label>사진 선택 · 여러 장 가능<input data-files type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div data-preview></div><button class="btn blue" data-save>사진 추가 제출</button><p role="status" data-result></p></section>';
  }).join('');
 }
 window.openWrongPhotos=async function(){
  if(!session||!weeklyLogin||padMode){notify('본인 계정으로 로그인해 주세요.','error');return;}
  dialog?.remove();busy=false;const owner=session.id;
  dialog=document.createElement('dialog');dialog.className='consultation-dialog';dialog.innerHTML='<h2>'+title+'</h2><p>성적·답안을 바꾸지 않고 사진만 추가할 수 있습니다. 문제와 본인의 풀이 흔적이 잘 보이도록 촬영해 주세요.</p><button class="btn" data-close>닫기</button><p role="status" data-status>불러오는 중…</p><div data-list></div>';
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-close]').onclick=()=>{if(!busy){dialog.close();dialog.remove();}};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  try{await load();if(session.id!==owner)return; if(session.role==='teacher'&&!studentPreviewMode)await provision();dialog.querySelector('[data-status]').textContent='상담 신청 여부와 사진 제출 여부를 별도로 표시합니다.';render();if(studentPreviewMode){dialog.querySelector('[data-status]').textContent='학생 화면 미리보기 · 사진 저장은 본인 로그인 또는 교사 화면에서 가능합니다.';dialog.querySelectorAll('input,[data-save]').forEach(e=>e.disabled=true);}}
  catch(e){dialog.querySelector('[data-status]').textContent='불러오지 못했습니다: '+e.message;return;}
  dialog.addEventListener('change',e=>{
   if(!e.target.matches('[data-files]'))return;
   const box=e.target.closest('[data-student]').querySelector('[data-preview]');box.replaceChildren();
   for(const f of e.target.files){if(!valid(f))continue;const img=document.createElement('img'),url=URL.createObjectURL(f);img.src=url;img.alt=f.name;img.style.cssText='width:100px;height:120px;object-fit:contain';img.onload=()=>URL.revokeObjectURL(url);box.append(img);}
  });
  dialog.addEventListener('click',async e=>{
   if(!e.target.closest('[data-save]')||busy||studentPreviewMode)return;
   const section=e.target.closest('[data-student]'),id=section.dataset.student;
   const u=session.role==='teacher'?studentList().find(u=>u.id===id):session;
   const result=section.querySelector('[data-result]'),files=[...section.querySelector('[data-files]').files],nums=section.querySelector('[data-numbers]').value.trim();
   if(!u||u.id!==id||session.id!==owner)return;
   if(!files.length||files.length>10||files.some(f=>!valid(f))){result.textContent='JPG·PNG·WebP 사진을 1~10장 선택해 주세요. 사진당 최대 15MB입니다.';return;}
   if(!/^\d+(\s*[,，]\s*\d+)*$/.test(nums)){result.textContent='사진에 해당하는 문항 번호를 쉼표로 구분해 입력해 주세요.';return;}
   if(!items.some(i=>i.id===itemId(u.school_id))){result.textContent='선생님이 오답 사진 제출 화면을 먼저 열어 설정해야 합니다.';return;}
   busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);result.textContent='사진을 저장 중입니다. 창을 닫지 마세요.';
   try{
    const fresh=await checked(sb.from('cert_submissions').select('*').eq('item_id',itemId(u.school_id)).eq('student_id',id));
    const previous=fresh[0],urls=photos(previous?.photo_url);
    for(const f of files){const path='cert/'+id+'_'+campaign+'_'+crypto.randomUUID()+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[f.type]);await checked(sb.storage.from('qa-files').upload(path,f,{contentType:f.type}));urls.push(sb.storage.from('qa-files').getPublicUrl(path).data.publicUrl+'#'+encodeURIComponent(nums+'번'));}
    const payload={id:previous?.id||'cs_'+crypto.randomUUID(),item_id:itemId(u.school_id),student_id:id,school_id:u.school_id,status:'pending',photo_url:JSON.stringify(urls),submitted_at:new Date().toISOString()};
    if(previous)await checked(sb.from('cert_submissions').update(payload).eq('id',previous.id));else await checked(sb.from('cert_submissions').insert(payload));
    await load();render();dialog.querySelector('[data-status]').textContent=u.name+' · 사진 '+files.length+'장 저장 완료';
   }catch(err){result.textContent='제출 완료되지 않았습니다: '+err.message;}
   finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
 };
 function entry(){
  document.querySelectorAll('[data-wrong-photo-entry]').forEach(e=>e.remove());
  if(!session||padMode||studentPreviewMode||session.role!=='teacher')return;
  for(const selector of session.role==='teacher'?['#page-teacher #panel-dashboard','#page-teacher #panel-exam']:['#page-student #panel-home','#page-student #panel-exam']){
   const host=document.querySelector(selector);if(!host)continue;
   const section=document.createElement('section');section.dataset.wrongPhotoEntry='';section.className='card';section.style.cssText='padding:18px;margin-bottom:16px';section.innerHTML='<h3>오답 문제 사진 제출</h3><p>상담 신청 학생은 상담 중 교사 보충 · 미신청 학생은 등원 후 사진 제출</p><button class="btn blue">'+(session.role==='teacher'?'학생별 사진 확인 · 상담 중 보충':'틀린 문제 사진 올리기')+'</button>';section.querySelector('button').onclick=openWrongPhotos;host.prepend(section);
  }
 }
 for(const name of ['launchStudent','launchTeacher','returnFromStudentPreview']){const old=window[name];window[name]=function(){const r=old.apply(this,arguments);entry();return r;};}
 entry();
})();

