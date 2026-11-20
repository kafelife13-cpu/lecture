(function(){
 'use strict';
 const el=id=>document.getElementById(id),passwordKey='teacher_ops_password';
 const phone=/(^|[^0-9])(0[0-9]{1,2}[\s.()+-]*[0-9]{3,4}[\s.()-]*[0-9]{4}|\+82[\s.()-]*0?[0-9]{1,2}[\s.()-]*[0-9]{3,4}[\s.()-]*[0-9]{4})(?=[^0-9]|$)/g;
 const esc=value=>String(value??'').replace(phone,'$1[전화번호 숨김]').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const when=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'기록 없음';
 const labels={pending:'승인 대기',approved:'승인',rejected:'거절',expired:'만료'};
 const titles={videos:'영상 시청',today:'오늘 체크리스트',texts:'문자 문구',pending:'문자 승인',absence:'미등원 승인',daily:'클리닉 명단',weekly:'이번 주 명단',attendance:'출석부',board:'자동화 현황',history:'최근 7일 기록'};
 const weeklyFilters={all:['전체',()=>true],absent:['미등원',s=>s.attendance==='미등원'],missing:['미입력',s=>s.clinic==='미입력'],retest:['재시험',s=>s.retest===true],homework:['과제 미완',s=>s.homework==='미완'],video:['영상 미시청',s=>s.video==='미완'||(s.video_weeks||[]).some(w=>w.video==='미완')]};
// 11/21 주차별 영상(1주·2주…): 학원 PC가 video_weeks를 올릴 때만 표시. 미완은 굵게.
const videoWeeksHtml=s=>Array.isArray(s.video_weeks)&&s.video_weeks.length?`<p class="video-weeks">영상 주차: ${s.video_weeks.map(w=>w.video==='미완'?`<strong class="vw-miss">${esc(w.week)}주 미완 ${esc(w.percent)}%</strong>`:`<span>${esc(w.week)}주 ${esc(w.video)}</span>`).join(' · ')}</p>`:'';
const videoWeeksSummary=students=>{const weeks=[...new Set(students.flatMap(s=>(s.video_weeks||[]).map(w=>w.week)))].sort((a,b)=>a-b);return weeks.length?'<br>영상 미시청 '+weeks.map(n=>`${esc(n)}주 ${esc(students.filter(s=>(s.video_weeks||[]).some(w=>w.week===n&&w.video==='미완')).length)}`).join(' · '):'';};
const videoText=s=>!('video' in s)?'미집계':s.video==='없음'?'미시청 없음(다 봤거나 배정 없음)':s.video_percent===null?s.video+'(시청률 미확인)':s.video+' '+s.video_percent+'%';
 let password='',teacherId='',rows=[],weekData=null,weeklyFilter='all',tab='pending',busy=false,run=0;
 let dailyData=null,dailyDate='',dailyTimer,checkData=null,textData=null,recent=[],videoRows=null,clinicWatch=null,videoKind='replacement',videoOpen=false,excludes=[];
 let absenceDays=[];const excluded=new Map(),studentKey=/^s-[a-p]{64}$/;
 // Native fetch keeps the standalone shell independent of a CDN and stores no RPC responses.
 const client={async rpc(name,args){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch('https://zniwzwanlvvmzkkcmikh.supabase.co/rest/v1/rpc/'+name,{
    method:'POST',cache:'no-store',credentials:'omit',signal:controller.signal,
    headers:{'Content-Type':'application/json',apikey:'sb_publishable_IbfVcXs5TmXfumrnK4Somg_7MzygCdh'},body:JSON.stringify(args)
   });
   const data=await response.json();
   return response.ok?{data}:{error:{code:data.code,message:typeof data.message==='string'?data.message:''}};
  }finally{clearTimeout(timer);}
 }};
 function message(text){el('ops-message').textContent=text;}
 function clear(){clearTimeout(dailyTimer);clearTimeout(attTimer);rows=[];weekData=null;dailyData=null;absenceDays=[];el('ops-content').textContent='';}
 function setBusy(value){busy=value;el('ops-content').setAttribute('aria-busy',String(value));el('ops-refresh').disabled=value;el('ops-login-button').disabled=value;}
 function lock(text='잠겼습니다. 비밀번호를 다시 입력해 주세요.'){
  ++run;password='';teacherId='';dailyDate='';excluded.clear();attMarks.clear();absData=null;attData=null;sessionStorage.removeItem(passwordKey);clear();setBusy(false);
  el('ops-password').value='';el('ops-login').hidden=false;el('ops-app').hidden=true;el('ops-logout').hidden=true;message(text);
 }
 function failed(error){
  if(error.code==='42501'){lock('선생님 비밀번호를 확인해 주세요.');return;}
  if(error.code==='40001'){message('명단이 갱신되었습니다. 새로고침 후 문구를 다시 확인해 주세요.');return;}
  message(error.code==='PGRST202'?'운영 앱은 아직 서버 반영 전입니다.':'조회 또는 저장하지 못했습니다. 새로고침해 확인해 주세요. 자동으로 다시 요청하지 않습니다.');
 }
 async function read(action,pw=password,arg){
  const result=await client.rpc('ops_teacher',{p_password:pw,p_action:action,...(arg?{p_arg:arg}:{})});
  if(result.error){const error=Error('OPS_RPC_FAILED');error.code=result.error.code;throw error;}
  return result.data;
 }
 function roster(row){
  const classes=row.roster?.classes;
  if(!Array.isArray(classes)||!classes.length)return '<p>명단이 아직 올라오지 않았습니다. 명단 등록 후 승인해 주세요.</p>';
  return classes.map(c=>{
   const students=c.students||[],studentCount=students.filter(s=>s.recipients.includes('student')).length,parentCount=students.filter(s=>s.recipients.includes('parent')).length;
   const school=/^한백고/.test(c.label)?'sc_hanbaek':/^치동고/.test(c.label)?'sc_chidong':'';
   return `<h3>${esc(c.label)}</h3><p>학생 ${studentCount}통 · 학부모 ${parentCount}통</p><ul class="check">${students.map(s=>{const ex=excludes.find(e=>e.name.replace(/\s/g,'')===String(s.name).replace(/\s/g,'')&&(!e.school||!school||e.school===school));return `<li class="${ex?'st-skip':''}">${ex?'<s>':''}${esc(s.name)}${ex?'</s>':''} <span class="muted">${s.recipients.map(r=>r==='parent'?'학부모':'학생').join(' · ')}</span> ${ex?`<span class="status">제외됨(${esc(ex.until.slice(5))}까지)</span> <button type="button" class="secondary" data-ex-remove="${esc(ex.id)}">되돌리기</button>`:`<button type="button" class="secondary" data-ex-add="${esc(s.name)}" data-ex-school="${esc(school)}">이번 주 제외</button>`}</li>`;}).join('')}</ul>`;
  }).join('');
 }


 // ---- 11/19 영상 시청: 주차별 영상대체 / 보강신청 / 클리닉 해설 / 해설 번호별 ----
 const videoKinds={replacement:'주차별 영상대체',makeup:'보강신청 영상',clinic:'클리닉 해설강의',chapters:'해설 번호별(틀린 문제)'};
 const schoolName=s=>({sc_hanbaek:'한백고',sc_chidong:'치동고'}[s]||s||'');
 const pctClass=p=>p>=100?'done':p>0?'doing':'fail';
 function youtubeId(url){const m=/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/.exec(url||'');return m?m[1]:'';}
 function isWrong(q,given){
  const ans=String(q.answer??'').trim(),g=String(given??'').trim();
  if(/^any:/i.test(ans))return g?false:true;
  if(/^all:/i.test(ans)){const want=ans.slice(4).split(',').map(s=>s.trim()).filter(Boolean).sort().join(','),got=g.split(/[,\s]+/).filter(Boolean).sort().join(',');return want!==got;}
  if(/^\d+$/.test(ans))return g!==ans;
  return null; // 서술형 등은 판단하지 않음
 }
 function renderVideos(){
  const tabs=Object.entries(videoKinds).map(([k,l])=>`<button type="button" data-video-kind="${k}" aria-pressed="${k===videoKind}">${esc(l)}</button>`).join(' ');
  const head=`<div class="filters">${tabs}</div><p class="muted">국어왕 시청 기록 기준입니다. 유튜브로 따로 본 것은 0%로 보일 수 있습니다. <label class="inline"><input type="checkbox" data-video-open ${videoOpen?'checked':''}> 다 본 학생도 보기</label></p>`;
  if(videoKind==='chapters'){el('ops-content').innerHTML=head+renderChapters();return;}
  const rows=(videoRows||[]).filter(r=>r.kind===videoKind);
  const byTitle=new Map();rows.forEach(r=>{if(!byTitle.has(r.title))byTitle.set(r.title,[]);byTitle.get(r.title).push(r);});
  el('ops-content').innerHTML=head+([...byTitle].map(([title,list])=>{
   const done=list.filter(r=>Number(r.percent)>=100).length,shown=list.filter(r=>videoOpen||Number(r.percent)<100).sort((a,b)=>Number(a.percent)-Number(b.percent));
   return `<article><h3>${esc(title)}</h3><p><strong>다 본 학생 ${done} / ${list.length}명</strong>${videoKind==='replacement'?'':''}</p><ul class="check">${shown.map(r=>`<li class="st-${pctClass(Number(r.percent))}"><strong>${esc(r.student)}</strong> <span class="muted">${esc(r.group||schoolName(r.school))}</span> <span class="status">${esc(Math.round(Number(r.percent)))}%</span>${r.absence_date?`<br><span class="muted">결석일 ${esc(r.absence_date)}${r.expires_at?' · 볼 수 있는 기한 '+esc(when(r.expires_at)):''}</span>`:''}</li>`).join('')||'<li>모두 다 봤습니다.</li>'}</ul></article>`;
  }).join('')||'<p>최근 3주 안에 해당 영상이 없습니다.</p>');
 }
 function renderChapters(){
  const videos=clinicWatch||[];
  if(!videos.length)return '<p>번호별로 볼 수 있는 해설강의가 없습니다. (영상 설명에 [시험:…] 연결이 있는 클리닉 해설만 나옵니다.)</p>';
  const C=window.KkakkaVideoChapters;
  return videos.map(v=>{
   const yt=youtubeId(v.url)||(v.rows.find(r=>r.watch?.length)?.watch[0].source_id)||'';
   const hasChapters=!!(C&&yt&&C.get(yt).length);
   const exams=new Map((v.exams||[]).map(e=>[String(e.id),e]));
   const people=v.rows.map(r=>{
    const exam=exams.get(String(r.exam_id));const qs=exam?.questions||[];
    const wrong=qs.map((q,i)=>({num:q.num??i+1,w:isWrong(q,r.answers?.[i]??r.answers?.[String(i)])})).filter(x=>x.w===true).map(x=>Number(x.num));
    const rec=(r.watch||[]).find(w=>w.source_id===yt)||(r.watch||[])[0];
    const st=hasChapters?C.stats(yt,rec&&{youtubeId:rec.source_id,seconds:rec.seconds},C.duration(yt)):[];
    const pct=n=>{const s=st.find(x=>x.label===n+'번');return s?s.percent:0;};
    const items=wrong.map(n=>({n,p:pct(n)}));
    const avg=items.length?Math.round(items.reduce((a,b)=>a+b.p,0)/items.length):100;
    return {r,items,avg,full:items.filter(x=>x.p>=95).length};
   }).filter(p=>videoOpen||p.avg<95).sort((a,b)=>a.avg-b.avg);
   return `<article><h3>${esc(v.title)}</h3>${hasChapters?'':'<p class="weekly-warning">이 영상은 번호별 구간 정보가 없어 번호별 시청률을 계산할 수 없습니다.</p>'}<p class="muted">학생마다 틀린 번호의 해설 구간을 몇 % 봤는지 보여 줍니다. 95% 이상이면 다 본 것으로 봅니다.</p><ul class="check">${people.map(p=>`<li class="st-${p.avg>=95?'done':p.avg>0?'doing':'fail'}"><strong>${esc(p.r.student)}</strong> <span class="muted">${esc(p.r.group||schoolName(p.r.school))} · ${esc(p.r.score??'-')}점</span> <span class="status">틀린 ${p.items.length}개 중 다 봄 ${p.full}개 · 평균 ${p.avg}%</span><br>${p.items.map(x=>`<span class="chip ${x.p>=95?'ok':x.p>0?'mid':'no'}">${x.n}번 ${x.p}%</span>`).join(' ')||'<span class="muted">틀린 문제 없음</span>'}</li>`).join('')||'<li>모두 틀린 번호 해설을 다 봤습니다.</li>'}</ul></article>`;
  }).join('');
 }
 // ---- 11/19 오늘 체크리스트 ----
 const jobLabel=job=>({'clinic-missing-evening':'클리닉 미등원 안내 (당일 저녁 · 학부모)','clinic-missing-morning':'클리닉 시험지 미입력 안내 (다음날 · 학생·학부모)','clinic-retest-friday':'금요일 재시·보강 안내','video-incomplete-thursday':'목요일 영상 미시청 안내'}[job]||'문자');
 const jobInfo={'clinic-missing-evening':'수·목·금 20:50 자동 발송(문구 상시 승인). 오늘 클리닉에 안 온 학생의 학부모에게 "등원해서 시험지 받기" 안내. 안 보내려면 20:50 전에 [안 보내기].','clinic-missing-morning':'목·금·토 08:00 자동 발송(문구 상시 승인, 07:20 명단 조회). 전날 클리닉 시험지를 국어왕에 입력하지 않은 학생(등원 여부 상관없음)의 학생·학부모에게 입력 안내. 07:20 이후 이 화면에 명단이 뜨면, 보강 등으로 뺄 학생은 [빼기]를 누르면 그 학생만 빠지고 나머지는 08:00에 나갑니다.','video-incomplete-thursday':'목 09:00. 이번 주 영상 미시청 학생·학부모. 명단: 수 21:05.','clinic-retest-friday':'금 20:30. 70점 이하·미입력 학생·학부모(일요일 재시·보강). 명단: 금 20:10.'};
 const stClass=s=>({'됨':'done','예정':'wait','실패':'fail','승인 안 됨':'fail','안됨':'fail','건너뜀':'skip','지남':'skip','진행중':'doing'}[s]||'wait');
 function renderToday(){
  const c=checkData?.data;
  if(!c?.days?.days){el('ops-content').textContent='학원 PC가 올린 체크리스트가 없습니다.';return;}
  const now=new Date(),kst=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  const days=c.days.days.filter(d=>d.date>=kst).slice(0,3);
  const mine=(c.board?.items||[]).filter(i=>i.who==='선생님'&&i.status!=='됨');
  const approveBtn='<button type="button" class="go-approve" data-ops-tab="pending">문자 승인 화면 열기 → 문구 보고 [보내기]</button>';
  const sms=c.sms||[];
  const smsHtml=sms.length?`<article><h3>자동 문자 한눈에</h3><ul class="check">${sms.map(s=>`<li class="st-${s.state==='켜짐'?'done':'fail'}"><strong>${esc(s.name)}</strong> <span class="status">${esc(s.state)}</span><br>${esc(s.who)} · ${esc(s.when)} · ${esc(s.approve)}<br><span class="muted">명단 만들기 마지막 ${s.last?esc(when(s.last.at))+(s.last.ok?' 정상 실행':' <b>실행 오류</b>'):'기록 없음'}${s.next?' · 다음 '+esc(when(s.next)):''}</span></li>`).join('')}</ul><p class="muted">실제로 몇 통 나갔는지는 [최근 기록]에서 볼 수 있습니다.</p></article>`:'';
  el('ops-content').innerHTML=`<p class="muted">학원 PC 갱신 ${esc(when(checkData.updated_at))}</p>`+smsHtml+
   (mine.length?`<article class="mine"><h3>선생님이 하실 일</h3><ul class="check">${mine.map(i=>`<li><strong>${esc(i.task)}</strong><br><span class="muted">${esc(i.due||'날짜 미정')}${i.memo?' · '+esc(i.memo):''}</span></li>`).join('')}</ul></article>`:'')+
   days.map(d=>`<article><h3>${esc(d.label)}${d.date===kst?' · 오늘':''}</h3><ul class="check">${(d.auto||[]).map(a=>{
     const need=a.approve&&!['됨','실패','건너뜀','지남'].includes(a.st);
     return `<li class="st-${stClass(a.st)}${need?' need':''}"><span class="tm">${esc(a.time||'')}</span> <strong>${esc(a.name)}</strong> <span class="status">${esc(need?'승인 필요':a.st)}</span>${a.why?`<br><span class="muted">${esc(a.why)}</span>`:''}${need?'<br>'+approveBtn:''}</li>`;
   }).join('')||'<li>자동화 없음</li>'}</ul></article>`).join('');
 }
 // ---- 11/19 문자 문구 수정·새 문자 요청 ----
 const varHelp={'이름':'학생 이름','날짜':'클리닉 날짜','사유':'재시 사유(점수 미달/미입력)','일요일':'일요일 날짜','시각':'시각','퍼센트':'영상 시청률'};
 function renderTexts(){
  const defaults=checkData?.data?.defaults||[],jobs=checkData?.data?.jobs||{},saved=textData?.templates||[];
  if(!defaults.length){el('ops-content').textContent='학원 PC가 아직 기본 문구를 올리지 않았습니다. 잠시 뒤 새로고침해 주세요.';return;}
  const key=t=>t.job+'|'+t.recipient_type+'|'+(t.variant||'');
  el('ops-content').innerHTML=`<p class="muted">고친 문구는 <strong>다음 미리보기부터</strong> 쓰입니다. 미리보기에 그대로 보이고, [문자 승인]에서 승인해야만 나갑니다. 이미 승인 대기 중인 회차는 바뀌지 않습니다(그 사이에 고치면 그 회차는 보내지 않고 막힙니다).</p>`+
   defaults.map(d=>{
    const s=saved.find(t=>key(t)===key(d)),vars=(jobs[d.job]?.vars||[]).map(v=>`{${v}}=${varHelp[v]||v}`).join(' · ');
    const id=esc(key(d));
    return `<article><h3>${esc(jobLabel(d.job))} · ${d.recipient_type==='parent'?'학부모':'학생'}${d.variant?' · '+esc(d.variant):''}</h3><p><strong>${s?'고친 문구 사용 중':'기본 문구 사용 중'}</strong>${s?' · '+esc(when(s.updated_at)):''}</p><p class="muted">쓸 수 있는 칸: ${esc(vars)} ({이름}은 꼭 넣기, 전화번호·링크는 넣을 수 없음)</p><textarea rows="6" data-tpl="${id}">${esc(s?s.body:d.body)}</textarea><p><button type="button" data-tpl-save="${id}">이 문구로 저장</button> ${s?`<button type="button" class="secondary" data-tpl-reset="${id}">기본 문구로 되돌리기</button>`:''}</p></article>`;
   }).join('')+
   `<article><h3>새 문자 추가 요청</h3><p class="muted">새 종류의 문자는 대상 고르기·발송 시각을 만들어야 해서 총괄(Claude)이 만들어 드립니다. 여기 적으면 체크리스트에 할 일로 올라갑니다.</p><label>보낼 내용<textarea rows="4" id="req-body"></textarea></label><label>누구에게 (예: 한백고 클리닉 미응시 학부모)<input id="req-target"></label><label>언제 (예: 매주 토 10:00)<input id="req-when"></label><p><button type="button" data-req-send>요청 보내기</button></p>${(textData?.requests||[]).length?`<h3>보낸 요청</h3><ul>${textData.requests.map(r=>`<li>${esc(r.when_text)} · ${esc(r.target)} · <span class="muted">${esc(r.status==='done'?'완료':r.status==='rejected'?'안 함':'만드는 중')}</span><br>${esc(r.body)}</li>`).join('')}</ul>`:''}</article>`;
 }
 async function saveText(action,keyText,body){
  const [job,recipient_type,variant]=keyText.split('|');
  const token=++run;setBusy(true);message('저장하고 있습니다…');
  try{
   await read(action,password,action==='template_save'?{job,recipient_type,variant,body}:{job,recipient_type,variant});
   if(token!==run)return;
   textData=await read('templates');renderTexts();message(action==='template_save'?'저장했습니다. 다음 미리보기부터 이 문구가 쓰입니다.':'기본 문구로 되돌렸습니다.');
  }catch(error){if(token===run)message(error.code==='OPS_RPC_FAILED'||!error.code?'저장하지 못했습니다. {이름}이 들어 있는지, 쓸 수 없는 칸·전화번호·링크가 없는지 확인해 주세요.':'저장하지 못했습니다. ('+error.code+')');}
  finally{if(token===run)setBusy(false);}
 }
 function renderPending(){
  const card=r=>{
   const pending=r.status==='pending'&&Date.parse(r.expires_at)>Date.now(),hasRoster=!!r.roster?.classes?.length;
   return `<article><h3>${esc(jobLabel(r.job))}</h3><p><strong>${esc((r.job==='clinic-missing-evening'||r.job==='clinic-missing-morning')&&pending?'자동 발송 예정 · 뺄 학생은 [빼기], 전체를 안 보내려면 [안 보내기]':labels[pending?r.status:r.status==='pending'?'expired':r.status])}</strong> · ${esc(r.recipient_count)}통 예정</p><p>발송 ${esc(when(r.slot))}<br>승인 기한 ${esc(when(r.expires_at))}</p>${roster(r)}${(r.preview?.examples||[]).map(e=>`<h3>${e.recipient_type==='parent'?'학부모':'학생'} 문구 예시</h3><pre>${esc(e.text)}</pre>`).join('')}<div class="actions"><button type="button" class="primary" data-ops-decision="approve" data-ops-id="${esc(r.id)}" ${!pending||busy||!hasRoster?'disabled':''}>보내기</button><button type="button" data-ops-decision="reject" data-ops-id="${esc(r.id)}" ${!pending||busy?'disabled':''}>안 보내기</button></div></article>`;
  };
  const order=['clinic-missing-evening','clinic-missing-morning','video-incomplete-thursday','clinic-retest-friday'];
  el('ops-content').innerHTML=order.map(job=>{
   const list=rows.filter(r=>r.job===job),last=(Array.isArray(recent)?recent:[]).filter(r=>r.job===job)[0];
   const done=(checkData?.data?.results||[]).filter(x=>x.job===job).slice(0,3);
   const doneHtml=done.map(x=>`<p class="sent-ok">✅ <b>발송 완료</b> · ${esc(when(x.at))} · ${esc(x.label||'')} · 접수 <b>${esc(x.accepted)}통</b>${x.failed?` · 실패 ${esc(x.failed)}통`:''}${x.excluded?` · 제외 ${esc(x.excluded)}통`:''}</p>`).join('');
   return `<section class="sms-sec"><h2>${esc(jobLabel(job))}</h2><p class="muted">${esc(jobInfo[job])}</p>${doneHtml}${list.map(card).join('')||`<p class="muted"><b>지금 승인할 요청 없음</b>${last?` · 지난 회차 ${esc(when(last.slot))}: ${last.status==='approved'?'보냄 '+esc(Number.isInteger(last.sent_count)?last.sent_count+'통':''):last.status==='rejected'?'안 보냄(거절)':'기한 지남·안 보냄'}`:''}</p>`}</section>`;
  }).join('');
 }
 function renderBoard(data){
  if(!data){el('ops-content').textContent='학원 PC가 올린 현황판이 없습니다.';return;}
  const board=data.board;
  el('ops-content').innerHTML=`<p>갱신 ${esc(when(data.updated_at))}</p><h3>작업 현황</h3>${board.items.map(item=>`<article><h3>${esc(item.name)}</h3><span class="status" data-state="${esc(item.status)}">${esc(item.status)}</span><p>${esc(item.memo)}</p></article>`).join('')||'<p>등록된 항목이 없습니다.</p>'}<h3>예약 작업 · 마지막 실행</h3>${board.tasks.map(task=>`<article><h3>${esc(task.name)}</h3><p><span class="status" data-state="${esc(task.result)}">${esc(task.result)}</span> · ${esc(when(task.last_run_at))}</p></article>`).join('')||'<p>예약 작업 기록이 없습니다.</p>'}`;
 }
 function renderHistory(data){
  el('ops-content').innerHTML=data.map(r=>`<article><h3>${esc(jobLabel(r.job))}</h3><p>${esc(labels[r.status]||'확인 필요')} · ${esc(when(r.slot))}</p><p>보낸 수: ${Number.isInteger(r.sent_count)&&r.sent_count>=0?`${r.sent_count}통`:'미집계'}</p></article>`).join('')||'<p>최근 7일 처리 기록이 없습니다.</p>';
 }

 // ---- 11/20 출석부: 학원 PC가 맥가이 출결(정규반)·클리닉 등원/시험지 입력을 읽어 올림 ----
 // 11/21 선생님 직접 체크(출석·지각·미등원) + [미등원 발송]. 앱은 체크와 발송 요청만 저장하고,
 // 잔디 전송은 학원 PC가 한다(웹훅 주소는 앱에 없음). 맥가이 기록은 '맥가이:'로 따로 보여 준다.
 let attData=null,absData=null,attSessions=[],attTimer;const attMarks=new Map();
 const md=d=>{const [,m,dd]=d.split('-');return `${+m}/${+dd}(${'일월화수목금토'[new Date(d+'T12:00:00Z').getUTCDay()]})`;};
 const attCls=st=>({'출석':'done','등원':'done','지각':'wait','조퇴':'wait','결석':'fail','통보결석':'skip','미입력':'fail','예정':'skip','미등원':'fail'}[st]||'wait');
 const kstDay=(offset=0)=>new Date(Date.now()+9*3600000+offset*86400000).toISOString().slice(0,10);
 const destName=d=>d==='room'?'출결방':'나와의 대화';
 const absReason=r=>({ABSENCE_STALE:'2시간이 지나 보내지 않음',JANDI_ROOM_WEBHOOK_MISSING:'학원 PC에 출결방 웹훅 없음',JANDI_SELF_WEBHOOK_MISSING:'학원 PC에 나와의 대화 웹훅 없음',ABSENCE_INVALID:'명단 대신 「조회 실패」만 보냄'}[r]||'전송 실패');
 const attKey=s=>s.label+'|'+s.date;
 const sessionMarks=s=>attMarks.get(attKey(s))?.marks||{};
 function lastSend(s){return (absData?.sends||[]).filter(x=>x.class_label===s.label&&x.att_date===s.date&&x.destination===absData.settings?.destination).at(-1);}
 function sendStatus(x){
  if(!x)return '아직 보내지 않음';
  const t=Number.isFinite(Date.parse(x.done_at))?new Date(x.done_at).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}):'';
  return x.status==='sent'?`${x.round}회차 보냄 ${t} (${destName(x.destination)})`:x.status==='pending'?`${x.round}회차 전달 대기 — 학원 PC가 보냅니다`:`${x.round}회차 실패: ${absReason(x.reason)}`;
 }
 function attCount(s){const m=sessionMarks(s),n=s.students.filter(st=>m[st.name]).length,a=s.students.filter(st=>m[st.name]==='미등원').length;return `체크 ${n}/${s.students.length} · 미등원 ${a}명${attMarks.get(attKey(s))?.dirty?' · 저장 안 됨':''}`;}
 function sessionHtml(s,i){
  const m=sessionMarks(s),x=lastSend(s),pending=x?.status==='pending';
  return `<section class="att-session" data-att-session="${i}"><h4>${esc(md(s.date))}${s.time?' 수업 '+esc(s.time):''} · 직접 체크</h4><p class="muted" data-att-count="${i}">${esc(attCount(s))}</p><ul class="att-list">${s.students.map((st,j)=>`<li data-att-row="${i}-${j}" class="${m[st.name]?'st-'+attCls(m[st.name]):''}"><span class="att-name"><strong>${esc(st.name)}</strong> <span class="muted">맥가이: ${esc(st.cell?.st||'기록 없음')}${st.cell?.in?' '+esc(st.cell.in):''}${st.cell?.memo?' · '+esc(st.cell.memo):''}</span></span><span class="att-btns" role="group" aria-label="${esc(st.name)} 직접 체크">${['출석','지각','미등원'].map(k=>`<button type="button" data-att-mark="${k}" data-att-s="${i}" data-att-i="${j}" aria-pressed="${m[st.name]===k}" ${busy?'disabled':''}>${k}</button>`).join('')}</span></li>`).join('')}</ul><div class="actions"><button type="button" class="secondary" data-att-all="${i}" ${busy?'disabled':''}>남은 학생 모두 출석</button><button type="button" class="secondary" data-att-save="${i}" ${busy?'disabled':''}>저장</button><button type="button" class="primary" data-att-send="${i}" ${busy||pending?'disabled':''}>미등원 발송</button></div><p role="status">${esc(sendStatus(x))}</p>${x?.body?`<pre>${esc(x.body)}</pre>`:''}</section>`;
 }
 function renderAttendance(){
  const b=attData?.book;
  if(!b){el('ops-content').textContent='학원 PC가 올린 출석부가 없습니다.';return;}
  const today=kstDay(),from=kstDay(-7),manual=!!absData;attSessions=[];
  const reg=b.regular.map(c=>{
   const cnt={};for(const s of c.students)for(const d of c.dates){const st=s.cells[d]?.st||'';cnt[st]=(cnt[st]||0)+1;}
   const parts=c.dates.map(d=>{
    if(manual&&d<=today&&d>=from){
     const s={label:c.label,date:d,time:c.times?.[d]||'',students:c.students.filter(st=>st.cells[d]).map(st=>({name:st.name,cell:st.cells[d]}))};
     attSessions.push(s);return sessionHtml(s,attSessions.length-1);
    }
    return `<ul class="check">${c.students.map(s=>{const v=s.cells[d];if(!v)return '';return `<li class="st-${attCls(v.st)}"><strong>${esc(s.name)}</strong> <span class="muted">${esc(md(d))}</span> <span class="status">${esc(v.st)}</span>${v.in?` <span class="muted">${esc(v.in)}${v.out?'~'+esc(v.out):''}</span>`:''}${v.memo?`<br><span class="muted">메모: ${esc(v.memo)}</span>`:''}</li>`;}).join('')}</ul>`;
   }).join('');
   return `<article><h3>${esc(c.label)}</h3><p class="muted">${c.dates.map(md).join(', ')} · ${esc(c.students.length)}명 · 맥가이 ${Object.entries(cnt).map(([k,v])=>esc(k)+' '+esc(v)).join(' · ')}</p>${parts}</article>`;}).join('');
  const cl=b.clinic.map(c=>{const arr=c.students.filter(s=>s.arrived).length,ex=c.students.filter(s=>s.exam).length;
   return `<article><h3>클리닉 ${esc(md(c.date))}</h3><p class="muted">예약 ${esc(c.students.length)}명 · 등원 ${esc(arr)} · 시험지 입력 ${esc(ex)}</p><ul class="check">${c.students.map(s=>`<li class="st-${s.exam?'done':s.arrived?'wait':'fail'}"><strong>${esc(s.name)}</strong> <span class="status">${s.exam?'입력완료':s.arrived?'등원·미입력':'미등원'}</span><br><span class="muted">${esc(s.cls)}${s.start?' · '+esc(s.start):''}${s.in?' · 등원 '+esc(s.in):''}</span></li>`).join('')}</ul></article>`;}).join('');
  const st=absData?.settings,dest=st?.destination==='room'?'room':'self';
  const destBar=manual?`<article class="att-dest"><h3>미등원 발송 받는 곳: ${esc(destName(dest))}${dest==='self'?' (테스트)':''}</h3><div class="actions"><button type="button" data-att-dest="self" aria-pressed="${dest==='self'}" ${busy?'disabled':''}>나와의 대화</button><button type="button" data-att-dest="room" aria-pressed="${dest==='room'}" ${busy||!st?.room_ready?'disabled':''}>출결방</button></div>${st?.room_ready?'':'<p class="muted">출결방 웹훅이 학원 PC에 설정되어 있지 않아 전환할 수 없습니다.</p>'}<p class="muted">반마다 학생을 출석·지각·미등원으로 체크하고 [미등원 발송]을 누르면 학원 PC가 잔디로 보냅니다. 같은 명단은 다시 보내지 않습니다.</p></article>`:'<p class="weekly-warning" role="alert">직접 체크 기능은 아직 서버 반영 전입니다. 맥가이 기록만 보여 줍니다.</p>';
  el('ops-content').innerHTML=`<h3>${esc(b.label)}</h3><p class="muted">맥가이·국어왕 조회 ${esc(when(b.at))} · 학원 PC가 30분마다 갱신</p>${b.issues.length?`<p class="weekly-warning" role="alert">${b.issues.map(esc).join('<br>')}</p>`:''}${destBar}<h3>정규반 (직접 체크 · 맥가이 출결)</h3>${reg||'<p>이번 주 정규반 기록이 없습니다.</p>'}<h3>클리닉 (등원·시험지)</h3>${cl||'<p>이번 주 클리닉 기록이 없습니다.</p>'}`;
 }
 function mergeAbsence(data){
  absData=data;
  for(const r of data.marks||[]){const key=r.class_label+'|'+r.att_date;if(!attMarks.get(key)?.dirty)attMarks.set(key,{marks:{...r.marks},dirty:false});}
 }
 function pollAttendance(){clearTimeout(attTimer);if(tab==='attendance'&&(absData?.sends||[]).some(x=>x.status==='pending'))attTimer=setTimeout(refreshAbsence,15000);}
 async function absenceRpc(action,arg={}){
  const r=await client.rpc('ops_teacher_absence',{p_password:password,p_action:action,p_arg:arg});
  if(r.error){const e=Error('ABSENCE_RPC_FAILED');e.code=r.error.code;e.reason=r.error.message;throw e;}
  return r.data;
 }
 async function refreshAbsence(){
  if(tab!=='attendance'||busy||!password)return;
  const token=run;
  try{const data=await absenceRpc('get');if(token!==run||tab!=='attendance')return;mergeAbsence(data);renderAttendance();}catch{}
  finally{if(token===run)pollAttendance();}
 }
 const absMessage=e=>({ABSENCE_DUPLICATE:'같은 미등원 명단을 이미 보냈습니다. 바뀐 학생이 있을 때만 다시 보낼 수 있습니다.',ABSENCE_PENDING:'앞 요청을 학원 PC가 아직 보내는 중입니다. 잠시 뒤 다시 확인해 주세요.',ABSENCE_UNMARKED:'체크하지 않은 학생이 있습니다.',ABSENCE_ROOM_NOT_READY:'출결방 웹훅이 학원 PC에 없어 출결방으로 보낼 수 없습니다.',ABSENCE_CLASS_NOT_FOUND:'출석부가 갱신되어 이 반·날짜를 찾지 못했습니다. 새로고침해 주세요.'}[e.reason]||'저장하지 못했습니다(조회 실패). 새로고침 후 다시 해 주세요. 잔디로는 아무것도 보내지 않았습니다.');
 async function attendanceClick(btn){
  if(btn.dataset.attMark){
   const s=attSessions[btn.dataset.attS],st=s?.students[btn.dataset.attI];if(!st)return;
   const key=attKey(s),entry=attMarks.get(key)||{marks:{},dirty:false},k=btn.dataset.attMark;
   if(entry.marks[st.name]===k)delete entry.marks[st.name];else entry.marks[st.name]=k;
   entry.dirty=true;attMarks.set(key,entry);
   // 포커스가 그대로 있도록 그 줄의 버튼과 개수만 바꾼다.
   const row=el('ops-content').querySelector(`[data-att-row="${btn.dataset.attS}-${btn.dataset.attI}"]`);
   if(row){row.className=entry.marks[st.name]?'st-'+attCls(entry.marks[st.name]):'';row.querySelectorAll('[data-att-mark]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.attMark===entry.marks[st.name])));}
   const count=el('ops-content').querySelector(`[data-att-count="${btn.dataset.attS}"]`);if(count)count.textContent=attCount(s);
   return;
  }
  if(btn.dataset.attAll!==undefined){
   const s=attSessions[btn.dataset.attAll];if(!s)return;const entry=attMarks.get(attKey(s))||{marks:{},dirty:false};
   for(const st of s.students)if(!entry.marks[st.name])entry.marks[st.name]='출석';
   entry.dirty=true;attMarks.set(attKey(s),entry);renderAttendance();return;
  }
  let action,arg,s;
  if(btn.dataset.attDest){
   const d=btn.dataset.attDest;if(d===absData?.settings?.destination)return;
   if(d==='room'&&!absData?.settings?.room_ready){message('출결방 웹훅이 학원 PC에 없어 전환할 수 없습니다.');return;}
   if(!confirm(`미등원 발송 받는 곳을 「${destName(d)}」(으)로 바꿀까요?`))return;
   action='dest';arg={destination:d};
  }else{
   s=attSessions[btn.dataset.attSave??btn.dataset.attSend];if(!s)return;
   const m=sessionMarks(s);arg={class_label:s.label,att_date:s.date,marks:m};
   if(btn.dataset.attSave!==undefined)action='save';
   else{
    const left=s.students.filter(st=>!m[st.name]).length;if(left){message(`체크하지 않은 학생이 ${left}명 있습니다. 모두 체크한 뒤 보내 주세요.`);return;}
    const absent=s.students.filter(st=>m[st.name]==='미등원').map(st=>st.name);
    if(!confirm(`잔디 「${destName(absData?.settings?.destination)}」(으)로 보낼까요?\n${s.label} ${md(s.date)}\n미등원 ${absent.length}명${absent.length?': '+absent.join(', '):' (전원 등원)'}`))return;
    action='send';
   }
  }
  const token=++run;setBusy(true);renderAttendance();message('저장하고 있습니다…');
  try{
   await absenceRpc(action,arg);if(token!==run)return;
   if(s)attMarks.set(attKey(s),{marks:{...arg.marks},dirty:false});
   mergeAbsence(await absenceRpc('get'));if(token!==run)return;
   message(action==='send'?'발송 요청을 저장했습니다. 학원 PC가 잔디로 보내면 여기에 「보냄」으로 바뀝니다.':action==='dest'?'받는 곳을 바꿨습니다.':'저장했습니다.');
  }catch(e){if(token!==run)return;if(e.code==='42501'){lock('선생님 비밀번호를 확인해 주세요.');return;}message(absMessage(e));}
  finally{if(token===run){setBusy(false);renderAttendance();pollAttendance();}}
 }
 function renderWeekly(){
  if(!weekData){el('ops-content').textContent='학원 PC가 올린 이번 주 명단이 없습니다.';return;}
  const week=weekData.week;
  const summary=week.classes.map(c=>`<p><strong>${esc(c.label)}</strong><br>${Object.values(weeklyFilters).slice(1).map(([label,match])=>`${esc(label)} ${esc(c.students.filter(match).length)}`).join(' · ')}${videoWeeksSummary(c.students)}</p>`).join('');
  el('ops-content').innerHTML=`<h3>${esc(week.label)}</h3><p>집계 ${esc(when(week.at))} · 갱신 ${esc(when(weekData.updated_at))}</p>${week.blocked?`<p class="weekly-warning" role="alert">집계가 완전하지 않음: ${week.issues.map(esc).join(' · ')||'사유 미등록'}</p>`:''}${summary?`<article aria-label="반별 요약"><h3>반별 요약</h3>${summary}</article>`:''}<div class="weekly-filters" role="group" aria-label="학생 상태 필터">${Object.entries(weeklyFilters).map(([key,[label]])=>`<button type="button" data-ops-filter="${esc(key)}" aria-pressed="${esc(key===weeklyFilter)}">${esc(label)}</button>`).join('')}</div>${week.classes.map(c=>{
   const students=c.students.filter(weeklyFilters[weeklyFilter][1]);
   return `<article><h3>${esc(c.label)}</h3><ul class="weekly-students">${students.map(s=>`<li><strong>${esc(s.name)}</strong><p>출결: ${esc(s.attendance)} · 클리닉: ${esc(s.clinic)} · 점수: ${esc(s.score===null?'미집계':s.score)} · 재시험: ${esc(s.retest?'대상':'아님')} · 과제: ${esc(s.homework)} · 영상: ${esc(videoText(s))}</p>${videoWeeksHtml(s)}<p class="muted">결석일: ${s.absence_dates.length?s.absence_dates.map(esc).join(', '):'없음'}</p></li>`).join('')}</ul>${students.length?'':'<p>해당 학생이 없습니다.</p>'}</article>`;
  }).join('')||'<p>등록된 반이 없습니다.</p>'}`;
 }
 const forwarding=data=>data.day.scheduled.filter(s=>s.arrived===false&&s.exam_done===false);
 function forwardText(data,list=forwarding(data)){
  // 선생님 11/19 "간단하게": 학원 PC(ops-forward.mjs buildForwardText)와 같은 문구.
  return `${data.day.label} 미등원\n${list.map(s=>s.name).join(', ')} (${list.length}명)`;
 }
 function pollDaily(){
  clearTimeout(dailyTimer);
  if(dailyData?.forward?.status==='pending'||absenceDays.some(d=>d.forward?.status==='pending'))dailyTimer=setTimeout(refresh,15000);
 }
 function renderDaily(){
  const selector=`<label for="ops-date">클리닉 날짜</label><input id="ops-date" type="date" value="${esc(dailyDate)}">`;
  if(!dailyData){el('ops-content').innerHTML=selector+'<p>학원 PC가 올린 해당 날짜의 클리닉 명단이 없습니다.</p>';return;}
  const {day}=dailyData,arrived=day.scheduled.filter(s=>s.arrived===true),absent=day.scheduled.filter(s=>s.arrived===false&&s.macgai_record!==false),unrecorded=day.scheduled.filter(s=>s.arrived===false&&s.macgai_record===false),targets=forwarding(dailyData);
  const list=(students,sms=false)=>students.length?`<ul>${students.map(s=>`<li><strong>${esc(s.name)}</strong> · ${esc(s.class_label)} · ${sms?s.recipients.map(r=>r==='student'?'학생':'학부모').join(' · '):`예정 ${esc(s.start)}${s.arrived?` · 등원 ${esc(when(s.arrived_at))}${s.arrived_by?` (${esc(s.arrived_by)})`:''}`:''}${s.macgai_record===false?' · 맥가이 기록 없음':''} · 시험 ${s.exam_done?'응시':'미응시'}`}</li>`).join('')}</ul>`:'<p>해당 학생이 없습니다.</p>';
  el('ops-content').innerHTML=`${selector}<h3>${esc(day.label)}</h3><p class="muted">맥가이 등원 시각을 우선하며 패드 등원도 반영합니다. 맥가이는 10분 간격으로 조회하고, 02:30~03:30에는 저장된 기록을 사용합니다. 패드 기록 0건은 참고 사항입니다.</p><p>집계 ${esc(when(day.at))} · 갱신 ${esc(when(dailyData.updated_at))}</p>${day.issues.length||day.unresolved?`<p class="weekly-warning" role="alert">확인 필요 ${esc(day.unresolved)}명 · ${day.issues.map(esc).join(' · ')}</p>`:''}<article><h3>① 등원 명단 (${arrived.length}명)</h3>${list(arrived)}</article><article><h3>② 미등원 명단 (${absent.length}명)</h3>${list(absent)}<h3>맥가이 기록 없음 (${unrecorded.length}명)</h3>${list(unrecorded)}</article><article><h3>③ 미등원 학원 전달명단 (${targets.length}명)</h3>${list(targets)}<h3>잔디로 보낼 문구 미리보기</h3><pre>${esc(forwardText(dailyData))}</pre><a href="#absence" data-ops-tab="absence">미등원 승인에서 보내요</a></article><article><h3>④ 미응시 문자 발송명단 (${day.sms.length}명)</h3>${list(day.sms,true)}</article>`;
 }
 const selectedStudents=data=>forwarding(data).filter(s=>!excluded.get(data.clinic_date)?.has(s.key));
 function forwardStatus(forward){
  const time=Number.isFinite(Date.parse(forward?.done_at))?new Date(forward.done_at).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}):'시각 미기록';
  return forward?.status==='sent'?'전달됨 '+time:forward?.status==='pending'?'전달 대기(학원 PC 처리 중)':forward?.status==='rejected'?'보내지 않음':forward?.status==='failed'?'실패':'승인 전';
 }
 const selectable=data=>{const targets=forwarding(data);return targets.every(s=>studentKey.test(s.key))&&new Set(targets.map(s=>s.key)).size===targets.length;};
 function renderAbsence(){
  el('ops-content').innerHTML=[...absenceDays].sort((a,b)=>Number(a.forward?.status==='sent')-Number(b.forward?.status==='sent')||b.clinic_date.localeCompare(a.clinic_date)).map(data=>{
   const {day,forward,clinic_date:date}=data,targets=forwarding(data),selected=selectedStudents(data),pending=forward?.status==='pending',ready=selectable(data);
   return `<article data-ops-day="${esc(date)}"><h3>${esc(day.label)}</h3><p>집계 ${esc(when(day.at))} · 갱신 ${esc(when(data.updated_at))}</p>${day.issues.length||day.unresolved?`<p class="weekly-warning" role="alert">확인 필요 ${esc(day.unresolved)}명 · ${day.issues.map(esc).join(' · ')}</p>`:''}<h3>③ 미등원 학원 전달명단 (${targets.length}명)</h3>${targets.length?`<ul class="absence-students">${targets.map((s,i)=>`<li><label><input type="checkbox" data-ops-student="${i}" data-ops-date="${esc(date)}" ${!excluded.get(date)?.has(s.key)?'checked':''} ${busy||pending||!ready?'disabled':''}><span><strong>${esc(s.name)}</strong> · ${esc(s.class_label)} · 예정 ${esc(s.start)}${s.macgai_record===false?' · 맥가이 기록 없음':''}</span></label></li>`).join('')}</ul>`:'<p>해당 학생이 없습니다.</p>'}${!ready?'<p role="alert">학원 PC의 명단 갱신 후 학생을 선택할 수 있습니다.</p>':''}<h3>잔디로 보낼 문구 미리보기</h3><pre data-ops-preview="${esc(date)}" aria-live="polite">${esc(forwardText(data,selected))}</pre><p role="status">${esc(forwardStatus(forward))}</p><div class="actions"><button type="button" class="primary" data-ops-forward="${esc(date)}" ${busy||pending||!ready||!selected.length?'disabled':''}>${forward?.status==='sent'?'다시 보내기':'잔디로 보내기'}</button><button type="button" data-ops-reject="${esc(date)}" ${busy||pending||['sent','rejected'].includes(forward?.status)?'disabled':''}>안 보내기</button></div></article>`;
  }).join('')||'<p>최근 클리닉 명단이 없습니다.</p>';
 }
 async function decideAbsence(date,action){
  const data=absenceDays.find(d=>d.clinic_date===date);
  if(busy||!teacherId||!password||tab!=='absence'||!data||data.forward?.status==='pending')return;
  const selected=selectedStudents(data),resend=data.forward?.status==='sent';
  if(action==='forward'&&(!selectable(data)||!selected.length))return;
  if(action==='reject'&&(resend||data.forward?.status==='rejected'))return;
  if(action==='forward'){
   const warning=data.day.issues.length||data.day.unresolved?`\n확인 필요 ${data.day.unresolved}명: ${data.day.issues.join(' · ')}\n`:'';
   if(!window.confirm(`잔디 등하원방에 다음 문구를 ${resend?'다시 ':''}전달할까요?${warning}\n\n${forwardText(data,selected)}`))return;
   if(resend&&!window.confirm('이미 전달된 명단입니다. 같은 날짜의 명단을 다시 전달할까요?'))return;
  }else if(!window.confirm(data.day.label+' 미등원 명단을 보내지 않을까요?'))return;
  clearTimeout(dailyTimer);const token=++run;setBusy(true);renderAbsence();message('결정을 저장하고 있습니다…');
  try{
   const saved=await read(action,password,{clinic_date:date,updated_at:data.updated_at,...(action==='forward'?{selected:selected.map(s=>s.key)}:{}),...(resend?{resend_of:data.forward.id}:{})});if(token!==run)return;
   data.forward=saved;message(forwardStatus(saved));
  }catch(error){if(token===run){clear();failed(error);}}
  finally{if(token===run){setBusy(false);if(absenceDays.length){renderAbsence();pollDaily();}}}
 }
 async function refresh(){
  if(!password||!teacherId||busy)return;
  const token=++run,selected=tab;clear();setBusy(true);message('확인하고 있습니다…');
  try{
   if(selected==='attendance'){
    const r=await client.rpc('ops_teacher_attendance',{p_password:password});if(token!==run)return;
    if(r.error){clear();el('ops-content').innerHTML='<article class="mine"><h3>출석부를 불러오지 못했습니다</h3><p>잠시 뒤 [새로고침]을 눌러 주세요.</p></article>';return;}
    attData=r.data;
    try{mergeAbsence(await absenceRpc('get'));}catch(e){if(token!==run)return;absData=null;if(e.code==='42501'){lock('선생님 비밀번호를 확인해 주세요.');return;}}
    if(token!==run)return;renderAttendance();pollAttendance();message('반마다 출석·지각·미등원을 체크하고 [미등원 발송]을 눌러 주세요. 「맥가이:」는 맥가이 기록입니다.');return;
   }
   if(selected==='videos'){
    try{videoRows=await read('videos');if(token!==run)return;clinicWatch=await read('clinic_watch');}catch(e){if(token!==run)return;clear();el('ops-content').innerHTML='<article class="mine"><h3>이 화면은 서버 준비가 아직 안 됐습니다</h3><p>학원 컴퓨터에서 <strong>영상명단_켜기</strong>를 한 번 실행하면 켜집니다.</p></article>';message('');return;}
    if(token!==run)return;renderVideos();message('영상 종류를 눌러 바꿔 보세요.');return;
   }
   if(selected==='today'||selected==='texts'){
    try{checkData=await read('checklist');}catch(e){if(token!==run)return;clear();el('ops-content').innerHTML='<article class="mine"><h3>이 화면은 서버 준비가 아직 안 됐습니다</h3><p>학원 컴퓨터에서 <strong>영상명단_켜기</strong>를 한 번 실행하면 켜집니다. 그 전에도 [문자 승인]은 그대로 쓸 수 있습니다.</p></article>';message('');return;}
    if(token!==run)return;
    if(selected==='texts'){textData=await read('templates');if(token!==run)return;renderTexts();}else renderToday();
    message(selected==='today'?'승인이 필요한 항목은 주황 버튼을 누르면 [문자 승인] 화면으로 갑니다.':'문구를 고친 뒤 [이 문구로 저장]을 눌러 주세요.');return;
   }
   const data=await read(selected==='absence'?'daily':selected,password,selected==='daily'&&dailyDate?{clinic_date:dailyDate}:undefined);if(token!==run)return;
   if(selected==='pending'){rows=data.approvals;try{checkData=await read('checklist');}catch{}if(token!==run)return;try{excludes=(await read('templates')).excludes||[];}catch{excludes=[];}if(token!==run)return;try{recent=await read('history');}catch{recent=[];}if(token!==run)return;renderPending();}
   else if(selected==='absence'){absenceDays=data;renderAbsence();pollDaily();}
   else if(selected==='weekly'){weekData=data;renderWeekly();}
   else if(selected==='daily'){dailyData=data[0]||null;if(dailyData)dailyDate=dailyData.clinic_date;renderDaily();pollDaily();}
   else if(selected==='board')renderBoard(data);else renderHistory(data);
   message(selected==='pending'?'명단과 문구를 확인해 주세요. 승인해도 예정 시각에 응시 여부를 다시 확인합니다.':'최신 조회를 완료했습니다.');
  }catch(error){if(token===run){clear();failed(error);}}
  finally{if(token===run){setBusy(false);if(selected==='pending'&&rows.length)renderPending();if(selected==='daily'&&dailyData)renderDaily();if(selected==='absence'&&absenceDays.length)renderAbsence();if(selected==='attendance'&&attData&&tab==='attendance')renderAttendance();}}
 }
 async function login(pw){
  if(busy||!pw)return;
  const until=Number(sessionStorage.getItem('login_lock_until')||0);
  if(until>Date.now()){message('로그인 시도가 잠겼습니다. '+Math.ceil((until-Date.now())/60000)+'분 뒤 다시 시도해 주세요.');return;}
  const token=++run;clear();setBusy(true);message('비밀번호를 확인하고 있습니다…');
  try{
   const data=await read('pending',pw);if(token!==run)return;
   if(!data?.teacher_id||!Array.isArray(data.approvals))throw Error('OPS_RESPONSE_INVALID');
   sessionStorage.setItem(passwordKey,pw);sessionStorage.removeItem('login_failures');sessionStorage.removeItem('login_lock_until');
   password=pw;teacherId=data.teacher_id;rows=data.approvals;tab='pending';
   try{checkData=await read('checklist',pw);}catch{}if(token!==run)return;
   try{excludes=(await read('templates',pw)).excludes||[];}catch{excludes=[];}if(token!==run)return;
   try{recent=await read('history',pw);}catch{recent=[];}if(token!==run)return;
   el('ops-login').hidden=true;el('ops-app').hidden=false;el('ops-logout').hidden=false;selectTab();renderPending();
   message('명단과 문구를 확인해 주세요. 승인 자체로 문자를 발송하지 않습니다.');
  }catch(error){
   if(token!==run)return;
   sessionStorage.removeItem(passwordKey);clear();failed(error);
   if(error.code==='42501'){
    const failures=Number(sessionStorage.getItem('login_failures')||0)+1;
    sessionStorage.setItem('login_failures',String(failures));
    if(failures>=5){sessionStorage.setItem('login_lock_until',String(Date.now()+5*60*1000));sessionStorage.removeItem('login_failures');message('로그인에 5회 실패해 5분 동안 잠겼습니다.');}
   }
  }finally{el('ops-password').value='';if(token===run){setBusy(false);if(teacherId)renderPending();}}
 }
 function selectTab(){
  el('ops-title').textContent=titles[tab];
  document.querySelectorAll('[data-ops-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.opsTab===tab)));
 }
 el('ops-login').addEventListener('submit',event=>{event.preventDefault();login(el('ops-password').value);});
 el('ops-logout').addEventListener('click',()=>lock());
 el('ops-refresh').addEventListener('click',refresh);
 document.addEventListener('change',async event=>{
  const target=event.target;
  if(target.dataset?.opsStudent!==undefined){
   if(!teacherId||!password||busy||tab!=='absence')return;
   const data=absenceDays.find(d=>d.clinic_date===target.dataset.opsDate);
   if(!data||!selectable(data)||data.forward?.status==='pending')return;
   const student=forwarding(data)[target.dataset.opsStudent];if(!student)return;
   if(!excluded.has(data.clinic_date))excluded.set(data.clinic_date,new Set());
   const omissions=excluded.get(data.clinic_date);if(target.checked)omissions.delete(student.key);else omissions.add(student.key);
   // Update only the preview/button so checkbox keyboard focus stays in place.
   const selected=selectedStudents(data),content=el('ops-content');
   const preview=content.querySelector('[data-ops-preview="'+data.clinic_date+'"]');
   if(preview)preview.textContent=forwardText(data,selected).replace(phone,'$1[전화번호 숨김]');
   const button=content.querySelector('[data-ops-forward="'+data.clinic_date+'"]');
   if(button)button.disabled=!selected.length;
   return;
  }
  if(target.dataset?.videoOpen!==undefined){if(tab!=='videos')return;videoOpen=target.checked;renderVideos();return;}
  if(event.target.id!=='ops-date'||!teacherId||busy||tab!=='daily'||!/^\d{4}-\d{2}-\d{2}$/.test(event.target.value))return;
  dailyDate=event.target.value;await refresh();
 });
 document.addEventListener('click',async event=>{
  const menu=event.target.closest('[data-ops-tab]');
  if(menu){event.preventDefault();if(!teacherId||busy)return;tab=menu.dataset.opsTab;weeklyFilter='all';dailyDate='';selectTab();await refresh();return;}
  const att=event.target.closest('[data-att-mark],[data-att-all],[data-att-save],[data-att-send],[data-att-dest]');
  if(att){if(tab!=='attendance'||!teacherId||!password||busy||att.disabled)return;await attendanceClick(att);return;}
  const exAdd=event.target.closest('[data-ex-add]'),exRemove=event.target.closest('[data-ex-remove]');
  if(exAdd||exRemove){
   if(!teacherId||busy||tab!=='pending')return;
   const kst=new Date(Date.now()+9*3600000),sun=new Date(kst);sun.setUTCDate(kst.getUTCDate()+((7-kst.getUTCDay())%7));
   const until=sun.toISOString().slice(0,10);
   if(exAdd&&!confirm(exAdd.dataset.exAdd+' 학생을 '+until.slice(5)+'(일)까지 모든 자동 문자에서 뺄까요? 학생·학부모 모두 안 보냅니다.'))return;
   const token=++run;setBusy(true);
   try{
    if(exAdd)await read('exclude_add',password,{name:exAdd.dataset.exAdd,school:exAdd.dataset.exSchool||null,until});
    else await read('exclude_remove',password,{id:exRemove.dataset.exRemove});
    if(token!==run)return;excludes=(await read('templates')).excludes||[];
    message(exAdd?'뺐습니다. 승인해도 이 학생에게는 보내지 않습니다.':'되돌렸습니다.');
   }catch(e){if(token===run)message('저장하지 못했습니다. 서버 준비(영상명단_켜기) 전이면 채팅으로 이름을 알려 주세요.');}
   finally{if(token===run){setBusy(false);renderPending();}}
   return;
  }
  const vk=event.target.closest('[data-video-kind]');
  if(vk){if(tab!=='videos'||busy)return;videoKind=vk.dataset.videoKind;renderVideos();return;}
  const tplSave=event.target.closest('[data-tpl-save]');
  if(tplSave){if(!teacherId||busy||tab!=='texts')return;const k=tplSave.dataset.tplSave;const box=[...document.querySelectorAll('[data-tpl]')].find(x=>x.dataset.tpl===k);if(box&&confirm('이 문구로 저장할까요? 다음 미리보기부터 쓰입니다.'))await saveText('template_save',k,box.value.trim());return;}
  const tplReset=event.target.closest('[data-tpl-reset]');
  if(tplReset){if(!teacherId||busy||tab!=='texts')return;if(confirm('기본 문구로 되돌릴까요?'))await saveText('template_reset',tplReset.dataset.tplReset);return;}
  if(event.target.closest('[data-req-send]')){
   if(!teacherId||busy||tab!=='texts')return;
   const body=el('req-body').value.trim(),target=el('req-target').value.trim(),when_text=el('req-when').value.trim();
   if(!body||!target||!when_text){message('보낼 내용·대상·시각을 모두 적어 주세요.');return;}
   const token=++run;setBusy(true);
   try{await read('sms_request',password,{body,target,when_text});if(token!==run)return;textData=await read('templates');renderTexts();message('요청을 보냈습니다. 총괄이 만들어서 체크리스트에 올립니다.');}
   catch(error){if(token===run)message('요청을 저장하지 못했습니다. 전화번호는 넣을 수 없습니다.');}
   finally{if(token===run)setBusy(false);}
   return;
  }
  const forward=event.target.closest('[data-ops-forward]');
  if(forward){if(!forward.disabled)await decideAbsence(forward.dataset.opsForward,'forward');return;}
  const reject=event.target.closest('[data-ops-reject]');
  if(reject){if(!reject.disabled)await decideAbsence(reject.dataset.opsReject,'reject');return;}
  const filter=event.target.closest('[data-ops-filter]');
  if(filter){if(!teacherId||!password||busy||tab!=='weekly'||!Object.hasOwn(weeklyFilters,filter.dataset.opsFilter))return;weeklyFilter=filter.dataset.opsFilter;renderWeekly();el('ops-content').querySelector(`[data-ops-filter="${weeklyFilter}"]`)?.focus();return;}
  const button=event.target.closest('[data-ops-decision]');
  if(!button||button.disabled||busy||!password||!teacherId)return;
  const row=rows.find(r=>r.id===button.dataset.opsId),action=button.dataset.opsDecision;
  if(action==='approve'&&!row?.roster?.classes?.length)return;
  if(!window.smsApproval.confirm(row,action))return;
  const token=++run;setBusy(true);renderPending();message('결정을 저장하고 있습니다…');
  try{
   const saved=await window.smsApproval.rpc(client,{id:teacherId,pw:password},action,row.id);if(token!==run)return;
   rows=rows.map(r=>r.id===saved.id?{...saved,roster:r.roster}:r);message(window.smsApproval.message(saved));
  }catch(error){if(token===run){clear();failed(error);}}
  finally{if(token===run){setBusy(false);if(rows.length)renderPending();}}
 });
 // Clear private DOM before bfcache snapshots; restoring always reauthenticates.
 window.addEventListener('pagehide',()=>{++run;password='';teacherId='';excluded.clear();attMarks.clear();absData=null;attData=null;clear();setBusy(false);el('ops-app').hidden=true;el('ops-login').hidden=false;el('ops-logout').hidden=true;});
 window.addEventListener('pageshow',event=>{if(event.persisted)login(sessionStorage.getItem(passwordKey)||'');});
 if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
 login(sessionStorage.getItem(passwordKey)||'');
})();
