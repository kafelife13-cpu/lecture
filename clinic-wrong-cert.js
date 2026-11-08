// 클리닉 오답 필기 인증
// 학생: 클리닉 시험지를 채점(입력)하면 틀린 문항 번호마다 필기 사진 인증 칸이 생긴다.
//       70점 이하는 필수, 나머지는 선택. 해설영상(클리닉 강의)을 보고 필기한 뒤 문항별로 사진을 올린다.
// 교사: 클리닉 시험별로 학생 점수·필수 여부·문항별 제출 현황을 보고 승인/반려한다.
// 저장: 기존 인증 테이블(cert_weeks/cert_items/cert_submissions)을 그대로 쓴다. 새 테이블·SQL 없음.
//       시험 답안(exam_responses)은 읽기만 하고 바꾸지 않는다.
(function(){
 'use strict';
 const CUT=70,MAX_MB=15,PREFIX='[오답인증] ';
 const SCHOOL={'한백고':'sc_hanbaek','치동고':'sc_chidong'};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const schoolOf=exam=>SCHOOL[exam&&exam.clinic_school]||'';
 const itemId=(examId,school)=>'ci_cwc_'+examId+'_'+school;
 const weekId=(examId,school)=>'cw_cwc_'+examId+'_'+school;
 // photo_url: JSON 배열. 각 원소는 '사진주소#7' 형식(뒤 숫자 = 문항 번호). 기존 인증 사진보기와 호환.
 function photos(raw){try{const a=JSON.parse(raw||'[]');return Array.isArray(a)?a:[];}catch(_){return raw?[raw]:[];}}
 function numOf(url){const m=String(url).match(/#(\d+)(?:번)?$/);return m?Number(m[1]):null;}
 function byNum(raw){const map={};photos(raw).forEach(u=>{const n=numOf(u);if(n!=null)(map[n]||(map[n]=[])).push(u);});return map;}
 function scoreOf(r){if(!r)return null;if(r.score!=null)return Number(r.score);if(r.points_total)return Math.round(r.points_earned/r.points_total*100);return null;}
 const required=r=>{const s=scoreOf(r);return s!=null&&s<=CUT;};
 function wrongNums(exam,r){
  if(!exam||!r||!Array.isArray(exam.questions))return [];
  const isWrong=typeof repIsWrong==='function'?repIsWrong:(resp,i)=>!!resp.answers&&Object.prototype.hasOwnProperty.call(resp.answers,i);
  const out=[];exam.questions.forEach((q,i)=>{if(isWrong(r,i,exam))out.push(i+1);});return out;
 }
 function progress(exam,r,sub){const nums=wrongNums(exam,r),map=byNum(sub&&sub.photo_url);const done=nums.filter(n=>map[n]&&map[n].length).length;return {nums,map,done,total:nums.length,complete:nums.length>0&&done===nums.length};}
 function valid(f){return ['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(f.type)&&f.size>0&&f.size<=MAX_MB*1024*1024;}
 if(typeof module!=='undefined')module.exports={photos,numOf,byNum,scoreOf,required,wrongNums,progress,itemId,CUT};
 if(typeof document==='undefined')return;

 async function q(p){const r=await p;if(r.error)throw Error(r.error.message);return r.data;}
 async function clinicExams(school){
  let p=sb.from('exams').select('id,name,questions,clinic_week,clinic_school,created_at').eq('category','school').not('clinic_week','is',null).order('created_at',{ascending:false}).limit(30);
  const rows=await q(p);
  return rows.filter(e=>schoolOf(e)&&(!school||schoolOf(e)===school));
 }
 async function ensureItem(exam){
  const school=schoolOf(exam),id=itemId(exam.id,school);
  const have=await q(sb.from('cert_items').select('id').eq('id',id));
  if(have.length)return id;
  const now=new Date().toISOString();
  await q(sb.from('cert_weeks').upsert({id:weekId(exam.id,school),school_id:school,name:PREFIX+exam.name,created_at:now},{onConflict:'id'}));
  await q(sb.from('cert_items').upsert({id,week_id:weekId(exam.id,school),school_id:school,title:PREFIX+exam.name,type:'photo',targets:'[]',form_link:null,created_at:now},{onConflict:'id'}));
  return id;
 }
 function statusLabel(sub,pr){
  if(!sub||!pr.done)return ['미제출','muted'];
  if(sub.status==='approved')return ['승인 완료','green'];
  if(sub.status==='rejected')return ['반려 · 다시 올려 주세요','red'];
  return pr.complete?['제출 완료 · 확인 대기','amber']:['일부 제출 ('+pr.done+'/'+pr.total+')','amber'];
 }
 function badge(text,tone){const c={green:'var(--green,#16a34a)',red:'var(--red,#dc2626)',amber:'var(--amber,#d97706)',muted:'var(--text3,#888)',blue:'var(--accent,#4f7cff)'}[tone]||'inherit';return '<span style="display:inline-block;border:1px solid '+c+';color:'+c+';border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;margin-left:6px">'+esc(text)+'</span>';}
 function thumbs(urls){return (urls||[]).map(u=>'<a href="'+esc(u)+'" target="_blank" rel="noopener"><img src="'+esc(u)+'" alt="필기 사진" style="width:84px;height:104px;object-fit:cover;border-radius:8px;border:1px solid var(--border,#ddd);margin:4px 4px 0 0"></a>').join('');}

 let dialog=null,busy=false;
 function openDialog(title,intro){
  dialog?.remove();busy=false;
  dialog=document.createElement('dialog');dialog.className='consultation-dialog';dialog.setAttribute('aria-label',title);
  dialog.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0">'+esc(title)+'</h2><button class="btn" data-close>닫기</button></div><p style="color:var(--text2);line-height:1.6">'+intro+'</p><p role="status" data-status>불러오는 중…</p><div data-list></div>';
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-close]').onclick=()=>{if(!busy){dialog.close();dialog.remove();}};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  return dialog;
 }
 const setStatus=t=>{const s=dialog&&dialog.querySelector('[data-status]');if(s)s.textContent=t;};

 // ───────── 학생 ─────────
 let sData=[];
 async function loadStudent(){
  const me=session,exams=await clinicExams(me.school_id||'');
  if(!exams.length){sData=[];return;}
  const resp=await q(sb.from('exam_responses').select('*').eq('student_id',me.id).in('exam_id',exams.map(e=>e.id)));
  const ids=exams.map(e=>itemId(e.id,schoolOf(e)));
  const subs=await q(sb.from('cert_submissions').select('*').eq('student_id',me.id).in('item_id',ids));
  sData=exams.map(e=>{const r=resp.filter(x=>x.exam_id===e.id).sort((a,b)=>String(b.submitted_at).localeCompare(String(a.submitted_at)))[0];return {exam:e,r,sub:subs.find(s=>s.item_id===itemId(e.id,schoolOf(e)))};}).filter(x=>x.r);
 }
 function renderStudent(){
  const list=dialog.querySelector('[data-list]');
  if(!sData.length){list.innerHTML='<div class="card" style="padding:16px">아직 채점한 클리닉 시험이 없어요. 먼저 <b>클리닉 시험지 채점</b>에서 답을 입력하면, 틀린 문항마다 인증 칸이 생겨요.</div>';return;}
  list.innerHTML=sData.map((x,k)=>{
   const pr=progress(x.exam,x.r,x.sub),[st,tone]=statusLabel(x.sub,pr),must=required(x.r),score=scoreOf(x.r);
   const head='<h3 style="margin:0 0 6px">'+esc(x.exam.name)+'</h3><div>'+esc(x.exam.clinic_week||'')+' · '+(score!=null?score+'점':'점수 없음')+(must?badge('필수 (70점 이하)','red'):badge('선택','blue'))+badge(st,tone)+'</div>';
   if(!pr.total)return '<section class="card" style="padding:16px;margin:12px 0">'+head+'<p>틀린 문항이 없어요. 인증할 것이 없습니다 🎉</p></section>';
   const rows=pr.nums.map(n=>{
    const urls=pr.map[n]||[];
    return '<div data-row style="border-top:1px solid var(--border,#e5e5e5);padding:10px 0" data-k="'+k+'" data-n="'+n+'"><b>'+n+'번</b> '+(urls.length?badge('사진 '+urls.length+'장','green'):badge('미제출','muted'))+'<div>'+thumbs(urls)+'</div>'+
     '<label style="display:block;margin-top:6px">필기 사진 선택<input data-files type="file" accept="image/*" capture="environment" multiple style="display:block;margin-top:4px"></label>'+
     '<button class="btn blue btn-sm" data-save style="margin-top:6px">'+n+'번 사진 올리기</button> <span role="status" data-result style="font-size:12px"></span></div>';
   }).join('');
   return '<section class="card" style="padding:16px;margin:12px 0">'+head+'<p style="margin:8px 0">진행: '+pr.done+' / '+pr.total+' 문항 · <button class="btn btn-sm" data-video>해설영상 보러 가기</button></p>'+rows+'</section>';
  }).join('');
 }
 window.openClinicWrongCert=async function(){
  if(!session||session.role!=='student'&&!studentPreviewMode){notify('학생 계정으로 로그인해 주세요.','error');return;}
  if(padMode){notify('패드 모드에서는 쓸 수 없어요. 본인 휴대폰으로 로그인해 주세요.','info');return;}
  openDialog('클리닉 오답 필기 인증','클리닉 <b>해설영상</b>을 보고 틀린 문제를 필기한 뒤, <b>문항 번호마다</b> 필기 사진을 올려 주세요. <b>70점 이하</b>는 필수, 나머지는 자유롭게 사용할 수 있어요.');
  const owner=session.id;
  try{await loadStudent();if(session.id!==owner)return;renderStudent();setStatus(studentPreviewMode?'학생 화면 미리보기 · 저장은 학생 본인 로그인에서만 됩니다.':'');if(studentPreviewMode)dialog.querySelectorAll('input,[data-save]').forEach(e=>e.disabled=true);}
  catch(e){setStatus('불러오지 못했습니다. 잠시 후 다시 열어 주세요.');console.error(e);return;}
  dialog.addEventListener('click',async e=>{
   if(e.target.closest('[data-video]')){dialog.close();dialog.remove();if(typeof sNav==='function')sNav('clinic-lectures');return;}
   const btn=e.target.closest('[data-save]');if(!btn||busy||studentPreviewMode)return;
   const row=btn.closest('[data-row]'),x=sData[Number(row.dataset.k)],n=Number(row.dataset.n),out=row.querySelector('[data-result]');
   const files=[...row.querySelector('[data-files]').files];
   if(!files.length||files.length>5||files.some(f=>!valid(f))){out.textContent='사진을 1~5장 골라 주세요 (장당 '+MAX_MB+'MB 이하).';return;}
   if(!weeklyLogin||weeklyLogin.id!==session.id||session.id!==owner){out.textContent='본인 계정으로 다시 로그인해 주세요.';return;}
   busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);out.textContent='올리는 중… 창을 닫지 마세요.';
   try{
    const id=await ensureItem(x.exam);
    const fresh=(await q(sb.from('cert_submissions').select('*').eq('item_id',id).eq('student_id',owner)))[0];
    const urls=photos(fresh&&fresh.photo_url);
    for(const f of files){
     const ext={'image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'}[f.type]||'jpg';
     const path='cert/cwc_'+owner+'_'+x.exam.id+'_q'+n+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)+'.'+ext;
     await q(sb.storage.from('qa-files').upload(path,f,{contentType:f.type||'image/jpeg'}));
     urls.push(sb.storage.from('qa-files').getPublicUrl(path).data.publicUrl+'#'+n);
    }
    const payload={item_id:id,student_id:owner,school_id:schoolOf(x.exam),status:'pending',photo_url:JSON.stringify(urls),submitted_at:new Date().toISOString()};
    if(fresh)await q(sb.from('cert_submissions').update(payload).eq('id',fresh.id));
    else await q(sb.from('cert_submissions').insert(Object.assign({id:'cs_cwc_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)},payload)));
    await loadStudent();renderStudent();setStatus(n+'번 사진 '+files.length+'장 저장 완료');
   }catch(err){out.textContent='저장되지 않았어요. 다시 시도하거나 선생님께 알려 주세요.';console.error(err);}
   finally{busy=false;dialog&&dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
 };

 // ───────── 교사 ─────────
 let tExams=[],tExam=null,tRows=[],tSubs=[];
 async function loadTeacherExam(exam){
  tExam=exam;const id=itemId(exam.id,schoolOf(exam));
  const resp=await q(sb.from('exam_responses').select('*').eq('exam_id',exam.id));
  tSubs=await q(sb.from('cert_submissions').select('*').eq('item_id',id));
  const latest={};resp.forEach(r=>{const k=r.student_id||r.student_name;if(!latest[k]||String(r.submitted_at)>String(latest[k].submitted_at))latest[k]=r;});
  tRows=Object.values(latest).map(r=>{const u=(db.users||[]).find(u=>u.id===r.student_id);return {r,name:u?u.name:r.student_name,sid:r.student_id,sub:tSubs.find(s=>s.student_id===r.student_id)};})
   .sort((a,b)=>(required(b.r)-required(a.r))||((scoreOf(a.r)??999)-(scoreOf(b.r)??999))||String(a.name).localeCompare(String(b.name),'ko'));
 }
 function renderTeacher(){
  const list=dialog.querySelector('[data-list]');
  const sel='<label>클리닉 시험 <select class="form-select" data-exam>'+tExams.map(e=>'<option value="'+esc(e.id)+'"'+(tExam&&tExam.id===e.id?' selected':'')+'>'+esc(e.clinic_school+' · '+e.name+' ('+(e.clinic_week||'')+')')+'</option>').join('')+'</select></label> <label><input type="checkbox" data-mustonly'+(renderTeacher.mustOnly?' checked':'')+'> 필수(70점 이하)만</label>';
  if(!tExam){list.innerHTML=sel+'<p>클리닉 시험이 없습니다.</p>';return;}
  const rows=tRows.filter(x=>!renderTeacher.mustOnly||required(x.r));
  const must=tRows.filter(x=>required(x.r)),mustDone=must.filter(x=>progress(tExam,x.r,x.sub).complete).length;
  list.innerHTML=sel+'<p style="margin:10px 0"><b>필수 '+must.length+'명 중 '+mustDone+'명 완료</b> · 전체 채점 '+tRows.length+'명 · 사진 제출 '+tSubs.length+'명</p>'+
   rows.map(x=>{
    const pr=progress(tExam,x.r,x.sub),[st,tone]=statusLabel(x.sub,pr);
    const nums=pr.nums.map(n=>{const u=pr.map[n]||[];return '<div style="display:inline-block;vertical-align:top;margin:4px 10px 4px 0"><div style="font-size:12px"><b>'+n+'번</b> '+(u.length?'✓':'✗')+'</div>'+thumbs(u)+'</div>';}).join('');
    return '<section class="card" style="padding:12px 14px;margin:10px 0" data-sid="'+esc(x.sid||'')+'"><div><b>'+esc(x.name)+'</b> · '+(scoreOf(x.r)??'-')+'점'+(required(x.r)?badge('필수','red'):badge('선택','blue'))+badge(st,tone)+' <span style="font-size:12px;color:var(--text3)">오답 '+pr.total+'문 · 인증 '+pr.done+'문</span></div>'+
     (pr.total?'<div>'+nums+'</div>':'')+
     (x.sub?'<div style="margin-top:6px"><button class="btn btn-sm blue" data-approve>승인</button> <button class="btn btn-sm" data-reject>반려</button></div>':'')+'</section>';
   }).join('');
 }
 window.openClinicWrongCertTeacher=async function(){
  if(!session||session.role!=='teacher'){notify('교사 로그인이 필요합니다.','error');return;}
  openDialog('클리닉 오답 인증 현황','학생이 클리닉 시험을 채점하면 틀린 문항마다 필기 사진 칸이 생깁니다. <b>70점 이하는 필수</b>입니다. 해설영상은 <b>강의 관리 → 클리닉 해설</b>로 매주 올려 주세요.');
  try{tExams=await clinicExams('');if(tExams[0]){await ensureItem(tExams[0]).catch(()=>{});await loadTeacherExam(tExams[0]);}renderTeacher();setStatus('');}
  catch(e){setStatus('불러오지 못했습니다: '+e.message);return;}
  dialog.addEventListener('change',async e=>{
   if(e.target.matches('[data-mustonly]')){renderTeacher.mustOnly=e.target.checked;renderTeacher();return;}
   if(!e.target.matches('[data-exam]'))return;
   const ex=tExams.find(x=>x.id===e.target.value);if(!ex)return;setStatus('불러오는 중…');
   try{await ensureItem(ex).catch(()=>{});await loadTeacherExam(ex);renderTeacher();setStatus('');}catch(err){setStatus('불러오지 못했습니다: '+err.message);}
  });
  dialog.addEventListener('click',async e=>{
   const b=e.target.closest('[data-approve],[data-reject]');if(!b||busy)return;
   const sid=b.closest('[data-sid]').dataset.sid,x=tRows.find(r=>r.sid===sid);if(!x||!x.sub)return;
   busy=true;try{await q(sb.from('cert_submissions').update({status:b.matches('[data-approve]')?'approved':'rejected'}).eq('id',x.sub.id));await loadTeacherExam(tExam);renderTeacher();setStatus(x.name+' · '+(b.matches('[data-approve]')?'승인':'반려')+' 저장');}
   catch(err){setStatus('저장 실패: '+err.message);}finally{busy=false;}
  });
 };
})();
