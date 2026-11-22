// 동형모의고사 데일리 인증 (한백고·치동고, 선생님 2026-11-21 지시)
// 학생: 월·화요일에 동형모의고사를 하루 1회 풀고, 회차 번호와 채점한 시험지 사진을 올린다.
// 교사: 날짜·학교별로 인증 현황을 보고 승인/반려한다.
// 저장: 기존 인증 테이블(cert_weeks/cert_items/cert_submissions)을 그대로 쓴다(clinic-wrong-cert.js 방식). 새 테이블·SQL 없음.
//       targets는 '[]'로 두어 기존 '개별 인증 안내' 목록에는 섞이지 않는다.
// 인증으로 보는 기준(자동 문자와 같음): 그날 항목에 사진이 있고 상태가 pending 또는 approved. 반려(rejected)는 미인증.
(function(){
 'use strict';
 const MAX_MB=15,PREFIX='[동형인증] ';
 const SCHOOLS={sc_hanbaek:'한백고',sc_chidong:'치동고'};
 const DAYS=[1,2]; // 월·화 (선생님 11/21 "데일리는 월 화 인증하는거야")
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const kstDate=d=>new Date(new Date(d).getTime()+9*3600000).toISOString().slice(0,10);
 const dow=date=>new Date(date+'T12:00:00Z').getUTCDay();
 const addDays=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const isCertDay=date=>DAYS.includes(dow(date));
 const mondayOf=date=>addDays(date,-((dow(date)+6)%7));
 const weekDays=date=>DAYS.map(d=>addDays(mondayOf(date),d-1));
 // 주말에는 다가오는 월·화 과제를 미리 보여 준다. 인증 저장 날짜 규칙은 유지한다.
 const studentDays=date=>weekDays([0,6].includes(dow(date))?addDays(date,dow(date)===0?1:2):date);
 const assignedRound=(exam,date)=>mondayOf(date)==='2026-11-23'&&exam.category==='homework'&&/기말\s*대비\s*5\s*주차/.test(exam.clinic_week||'')?Number((exam.name||'').match(/동형모의고사\s*([12])회/)?.[1]||0):0;
 const itemId=(date,school)=>'ci_dh_'+date+'_'+school;
 const weekId=(date,school)=>'cw_dh_'+mondayOf(date)+'_'+school;
 function photos(raw){try{const a=JSON.parse(raw||'[]');return Array.isArray(a)?a:[];}catch(_){return raw?[raw]:[];}}
 const roundOf=raw=>{const m=String(photos(raw)[0]||'').match(/#(\d+)회$/);return m?Number(m[1]):null;};
 const certified=sub=>!!sub&&['pending','approved'].includes(sub.status)&&photos(sub.photo_url).length>0;
 function valid(f){return ['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(f.type)&&f.size>0&&f.size<=MAX_MB*1024*1024;}
 if(typeof module!=='undefined')module.exports={kstDate,isCertDay,mondayOf,weekDays,itemId,weekId,photos,roundOf,certified,SCHOOLS,studentDays,assignedRound};
 if(typeof document==='undefined')return;

 async function q(p){const r=await p;if(r.error)throw Error(r.error.message);return r.data;}
 async function ensureItem(date,school){
  const id=itemId(date,school);
  if((await q(sb.from('cert_items').select('id').eq('id',id))).length)return id;
  const now=new Date().toISOString(),label=SCHOOLS[school]+' 동형모의고사 '+mondayOf(date)+' 주';
  await q(sb.from('cert_weeks').upsert({id:weekId(date,school),school_id:school,name:PREFIX+label,created_at:now},{onConflict:'id'}));
  await q(sb.from('cert_items').upsert({id,week_id:weekId(date,school),school_id:school,title:PREFIX+SCHOOLS[school]+' '+date,type:'photo',targets:'[]',form_link:null,created_at:now},{onConflict:'id'}));
  return id;
 }
 const dayName=date=>'일월화수목금토'[dow(date)]+'요일';
 function badge(text,tone){const c={green:'var(--green,#16a34a)',red:'var(--red,#dc2626)',amber:'var(--amber,#d97706)',muted:'var(--text3,#888)'}[tone]||'inherit';return '<span style="display:inline-block;border:1px solid '+c+';color:'+c+';border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;margin-left:6px">'+esc(text)+'</span>';}
 function statusBadge(sub){if(!sub)return badge('미인증','muted');if(sub.status==='approved')return badge('승인 완료','green');if(sub.status==='rejected')return badge('반려 · 다시 올려 주세요','red');return badge('인증 완료 · 확인 대기','amber');}
 const thumbs=urls=>(urls||[]).map(u=>'<a href="'+esc(u)+'" target="_blank" rel="noopener"><img src="'+esc(u)+'" alt="동형모의고사 인증 사진" style="width:84px;height:104px;object-fit:cover;border-radius:8px;border:1px solid var(--border,#ddd);margin:4px 4px 0 0"></a>').join('');

 let dialog=null,busy=false;
 function openDialog(title,intro){
  dialog?.remove();busy=false;
  dialog=document.createElement('dialog');dialog.className='consultation-dialog';dialog.setAttribute('aria-label',title);
  dialog.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0">'+esc(title)+'</h2><button class="btn" data-close>닫기</button></div><p style="color:var(--text2);line-height:1.6">'+intro+'</p><p role="status" data-status>불러오는 중…</p><div data-list></div>';
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-close]').onclick=()=>{if(!busy){dialog.close();dialog.remove();}};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 }
 const setStatus=t=>{const s=dialog&&dialog.querySelector('[data-status]');if(s)s.textContent=t;};

 // ───────── 학생 ─────────
 let sSubs=[],sExams=[];
 async function loadStudent(){const ids=studentDays(kstDate(Date.now())).map(d=>itemId(d,session.school_id));[sSubs,sExams]=await Promise.all([q(sb.from('cert_submissions').select('*').eq('student_id',session.id).in('item_id',ids)),q(sb.from('exams').select('id,name,category,clinic_week,total_q').eq('clinic_school',SCHOOLS[session.school_id]).eq('category','homework').order('created_at',{ascending:false}))]);}
 function renderStudent(){
  const today=kstDate(Date.now());
  dialog.querySelector('[data-list]').innerHTML=studentDays(today).map(date=>{
   const sub=sSubs.find(s=>s.item_id===itemId(date,session.school_id)),round=roundOf(sub&&sub.photo_url);
   const assigned=sExams.find(ex=>assignedRound(ex,date)===dow(date));
   const examLink=assigned?'<p><b>'+esc(assigned.name)+'</b> · '+assigned.total_q+'문항</p><button class="btn blue" data-exam="'+esc(assigned.id)+'">오답 번호 입력 · 결과 확인</button>':'';
   const head='<h3 style="margin:0 0 6px">'+esc(date.slice(5).replace('-','/')+' '+dayName(date))+statusBadge(sub)+'</h3>'+(round?'<div>'+round+'회 인증</div>':'')+'<div>'+thumbs(photos(sub&&sub.photo_url))+'</div>'+examLink;
   if(date!==today)return '<section class="card" style="padding:16px;margin:12px 0">'+head+'<p style="font-size:13px;color:var(--text3)">'+(date>today?'이 날이 되면 인증할 수 있어요.':'지난 날짜는 인증할 수 없어요.')+'</p></section>';
   return '<section class="card" style="padding:16px;margin:12px 0" data-today>'+head+
    '<label style="display:block;margin-top:8px">푼 회차 <input data-round type="number" min="1" max="99" class="form-input" style="width:90px" value="'+(assigned?dow(date):round||'')+'"'+(assigned?' readonly':'')+'> 회</label>'+
    '<label style="display:block;margin-top:6px">채점한 시험지 사진 (1~4장)<input data-files type="file" accept="image/*" multiple style="display:block;margin-top:4px"></label>'+
    '<button class="btn blue" data-save style="margin-top:8px">'+(sub&&sub.status!=='rejected'?'사진 다시 올리기':'오늘 인증하기')+'</button> <span role="status" data-result style="font-size:12px"></span></section>';
  }).join('');
 }
 window.openDongheongCert=async function(){
  if(!session||session.role!=='student'&&!studentPreviewMode){notify('학생 계정으로 로그인해 주세요.','error');return;}
  if(padMode){notify('패드 모드에서는 쓸 수 없어요. 본인 휴대폰으로 로그인해 주세요.','info');return;}
  if(!SCHOOLS[session.school_id]){notify('한백고·치동고 학생만 사용하는 인증이에요.','info');return;}
  openDialog('동형모의고사 인증','<b>월·화요일</b>에 동형모의고사를 <b>하루 1회</b> 풀고 채점한 뒤, 푼 회차와 시험지 사진을 올려 주세요. 그날 밤 9시까지 인증하지 않으면 안내 문자가 가요.');
  const owner=session.id;
  try{await loadStudent();if(session.id!==owner)return;renderStudent();setStatus(studentPreviewMode?'학생 화면 미리보기 · 저장은 학생 본인 로그인에서만 됩니다.':(isCertDay(kstDate(Date.now()))?'':'오늘은 인증하는 날이 아니에요. (월·화만 인증)'));if(studentPreviewMode)dialog.querySelectorAll('input,[data-save]').forEach(e=>e.disabled=true);}
  catch(e){setStatus('불러오지 못했습니다. 잠시 후 다시 열어 주세요.');console.error(e);return;}
  dialog.addEventListener('click',async e=>{
   const examButton=e.target.closest('[data-exam]');
   if(examButton&&!busy){
    const id=examButton.dataset.exam;dialog.close();dialog.remove();
    sNav('literature-exam');await sExamOpenForGrading(id,'wrongonly');return;
   }
   const btn=e.target.closest('[data-save]');if(!btn||busy||studentPreviewMode)return;
   const box=btn.closest('[data-today]'),out=box.querySelector('[data-result]'),today=kstDate(Date.now());
   const round=Number(box.querySelector('[data-round]').value),files=[...box.querySelector('[data-files]').files];
   if(!isCertDay(today)){out.textContent='월·화요일에만 인증할 수 있어요.';return;}
   if(!Number.isInteger(round)||round<1||round>99){out.textContent='푼 회차 번호를 적어 주세요.';return;}
   if(!files.length||files.length>4||files.some(f=>!valid(f))){out.textContent='사진을 1~4장 골라 주세요 (장당 '+MAX_MB+'MB 이하).';return;}
   if(!weeklyLogin||weeklyLogin.id!==session.id||session.id!==owner){out.textContent='본인 계정으로 다시 로그인해 주세요.';return;}
   busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);out.textContent='올리는 중… 창을 닫지 마세요.';
   try{
    const school=session.school_id,id=await ensureItem(today,school);
    const fresh=(await q(sb.from('cert_submissions').select('*').eq('item_id',id).eq('student_id',owner)))[0],urls=[];
    for(const f of files){
     const ext={'image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'}[f.type]||'jpg';
     const path='cert/dh_'+owner+'_'+today+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)+'.'+ext;
     await q(sb.storage.from('qa-files').upload(path,f,{contentType:f.type||'image/jpeg'}));
     urls.push(sb.storage.from('qa-files').getPublicUrl(path).data.publicUrl+'#'+round+'회');
    }
    // 하루 1회: 다시 올리면 그날 인증을 새 사진으로 바꾼다(이전 사진 파일은 지우지 않음).
    const payload={item_id:id,student_id:owner,school_id:school,status:'pending',photo_url:JSON.stringify(urls),submitted_at:new Date().toISOString()};
    if(fresh)await q(sb.from('cert_submissions').update(payload).eq('id',fresh.id));
    else await q(sb.from('cert_submissions').insert(Object.assign({id:'cs_dh_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)},payload)));
    await loadStudent();renderStudent();setStatus(round+'회 인증 저장 완료');
   }catch(err){out.textContent='저장되지 않았어요. 다시 시도하거나 선생님께 알려 주세요.';console.error(err);}
   finally{busy=false;dialog&&dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  });
 };

 // ───────── 교사 ─────────
 let tDate='',tSchool='sc_hanbaek',tSubs=[];
 const lastCertDay=()=>{let d=kstDate(Date.now());while(!isCertDay(d))d=addDays(d,-1);return d;};
 const students=()=>(db.users||[]).filter(u=>u.role==='student'&&u.status==='active'&&u.school_id===tSchool).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko'));
 async function loadTeacher(){tSubs=await q(sb.from('cert_submissions').select('*').eq('item_id',itemId(tDate,tSchool)));}
 function renderTeacher(){
  const list=students(),done=list.filter(u=>certified(tSubs.find(s=>s.student_id===u.id))).length;
  dialog.querySelector('[data-list]').innerHTML='<div style="display:flex;gap:10px;flex-wrap:wrap"><label>날짜 <input type="date" class="form-input" data-date value="'+tDate+'"></label><label>학교 <select class="form-select" data-school>'+Object.entries(SCHOOLS).map(([k,v])=>'<option value="'+k+'"'+(k===tSchool?' selected':'')+'>'+v+'</option>').join('')+'</select></label></div>'+
   (isCertDay(tDate)?'':'<p style="color:var(--red,#dc2626)">월·화요일이 아닙니다.</p>')+
   '<p style="margin:10px 0"><b>'+list.length+'명 중 '+done+'명 인증</b> · 미인증 '+(list.length-done)+'명</p>'+
   list.map(u=>{const sub=tSubs.find(s=>s.student_id===u.id),round=roundOf(sub&&sub.photo_url);
    return '<section class="card" style="padding:12px 14px;margin:10px 0" data-sid="'+esc(u.id)+'"><div><b>'+esc(u.name)+'</b>'+(round?' · '+round+'회':'')+statusBadge(sub)+'</div>'+(sub?'<div>'+thumbs(photos(sub.photo_url))+'</div><div style="margin-top:6px"><button class="btn btn-sm blue" data-approve>승인</button> <button class="btn btn-sm" data-reject>반려</button></div>':'')+'</section>';}).join('');
 }
 window.openDongheongCertTeacher=async function(){
  if(!session||session.role!=='teacher'){notify('교사 로그인이 필요합니다.','error');return;}
  openDialog('동형모의고사 인증 현황','한백고·치동고 학생이 <b>월·화요일</b>에 올린 동형모의고사 인증입니다. 미인증 학생은 그날 21:00 학생, 다음날 08:00 학부모에게 안내 문자가 갑니다(자동 문자를 켠 경우).');
  tDate=lastCertDay();
  const reload=async()=>{setStatus('불러오는 중…');try{await loadTeacher();renderTeacher();setStatus('');}catch(err){setStatus('불러오지 못했습니다: '+err.message);}};
  await reload();
  dialog.addEventListener('change',e=>{if(e.target.matches('[data-date]')&&e.target.value){tDate=e.target.value;reload();}if(e.target.matches('[data-school]')){tSchool=e.target.value;reload();}});
  dialog.addEventListener('click',async e=>{
   const b=e.target.closest('[data-approve],[data-reject]');if(!b||busy)return;
   const sid=b.closest('[data-sid]').dataset.sid,sub=tSubs.find(s=>s.student_id===sid);if(!sub)return;
   busy=true;try{await q(sb.from('cert_submissions').update({status:b.matches('[data-approve]')?'approved':'rejected'}).eq('id',sub.id));await loadTeacher();renderTeacher();setStatus((b.matches('[data-approve]')?'승인':'반려')+' 저장');}
   catch(err){setStatus('저장 실패: '+err.message);}finally{busy=false;}
  });
 };
 // 한백고·치동고 학생에게만 과제 화면의 인증 칸을 보인다.
 function entry(){const show=!!(session&&session.role==='student'&&SCHOOLS[session.school_id]);document.querySelectorAll('[data-dongheong-entry]').forEach(e=>e.style.display=show?'':'none');}
 for(const name of ['launchStudent','launchTeacher','returnFromStudentPreview']){const old=window[name];if(typeof old==='function')window[name]=function(){const r=old.apply(this,arguments);entry();return r;};}
 entry();
})();
