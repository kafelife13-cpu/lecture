// Run: node tests/teacher-ops.cjs [--browser]. Fake RPC only; no network or database writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function element(){
 let content='';
 return {value:'',hidden:false,disabled:false,dataset:{},attrs:{},events:{},
  get innerHTML(){return content;},set innerHTML(v){content=v;},get textContent(){return content;},set textContent(v){content=v;},
  querySelector(){return null;},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.events[k]=v;}};
}
const approval=()=>({id:'fixture-approval',job:'clinic-missing-morning',slot:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),status:'pending',recipient_count:3,
 preview:{examples:[{recipient_type:'student',text:'시험에 응시해 주세요.'},{recipient_type:'parent',text:'학부모 안내 예시'}]},
 roster:{classes:[{class_id:'class-a',label:'가상반',students:[{name:'가상학생가',recipients:['student','parent']},{name:'가상학생나',recipients:['parent']}]}]}});
const weekly=()=>({updated_at:'2026-11-19T10:30:00+09:00',week:{label:'기말대비 4주차',at:'2026-11-19T10:00:00+09:00',blocked:true,issues:['가상반 출결 확인 중'],classes:[
 {class_id:'class-a',label:'주간 가상반',students:[
  {name:'주간학생가',attendance:'미등원',clinic:'미입력',score:null,retest:false,homework:'미완',absence_dates:['2026-11-18'],video_weeks:[{week:1,video:'완료',percent:100},{week:2,video:'미완',percent:30},{week:3,video:'없음',percent:null}]},
  {name:'주간학생나',attendance:'등원',clinic:'입력완료',score:0,retest:true,homework:'완료',absence_dates:[]},
  {name:'주간학생다',attendance:'시험지만 수령',clinic:'확인 불가',score:null,retest:false,homework:'없음',absence_dates:[]}]},
 {class_id:'class-b',label:'주간 다른반',students:[{name:'주간학생라',attendance:'확인 불가',clinic:'입력완료',score:100,retest:false,homework:'완료',absence_dates:[]}]}]}});
function fixture(stored){
 const ids=[...read('ops.html').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const els=Object.fromEntries(ids.map(id=>[id,element()])),tabs=['pending','absence','daily','weekly','board','history'].map(tab=>Object.assign(element(),{dataset:{opsTab:tab}}));
 els['ops-app'].hidden=true;els['ops-logout'].hidden=true;
 const events={},windowEvents={},values=new Map(stored?[["teacher_ops_password",stored]]:[]),calls=[],dialogs=[],timers=new Map();
 let allow=true,handler=async(name,args)=>{
  if(args.p_password!=='fixture-password')return {error:{code:'42501',message:'never show this secret'}};
  if(name==='sms_approval_rpc')return {data:{...approval(),status:args.p_action==='approve'?'approved':'rejected'}};
  if(args.p_action==='pending')return {data:{teacher_id:'fixture-teacher',approvals:[approval()]}};
  if(args.p_action==='weekly')return {data:weekly()};
  if(args.p_action==='daily')return {data:daily()};
  if(args.p_action==='reject')return {data:{id:'reject-1',status:'rejected'}};
  if(args.p_action==='forward')return {data:{id:'request-1',status:'pending',done_at:null}};
  if(args.p_action==='board')return {data:{updated_at:new Date().toISOString(),board:{items:['됨','진행중','대기','실패','선생님할일'].map(status=>({name:'작업 '+status,status,memo:'메모'})),tasks:[{name:'예약 작업',last_run_at:new Date().toISOString(),result:'성공'},{name:'오류 작업',last_run_at:new Date().toISOString(),result:'실패'}]}}};
  return {data:['approved','rejected','expired'].map((status,i)=>({...approval(),status,sent_count:i===0?2:i===1?0:null}))};
 };
 const c={console,Date,AbortController,setTimeout:(fn,ms)=>{const id={};timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),navigator:{},
  document:{getElementById:id=>els[id]||null,querySelectorAll:()=>tabs,addEventListener:(key,fn)=>events[key]=fn},
  sessionStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
  confirm:text=>{dialogs.push(text);return Array.isArray(allow)?allow.shift():allow;},
  fetch:async(url,options)=>{
   assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');
   const name=url.split('/').at(-1),args=JSON.parse(options.body);assert.ok(['ops_teacher','sms_approval_rpc','ops_teacher_attendance','ops_teacher_absence'].includes(name));calls.push({name,args});
   const result=await handler(name,args);return {ok:!result.error,json:async()=>result.error||result.data};
  },addEventListener:(key,fn)=>windowEvents[key]=fn};
 Object.defineProperty(c,'localStorage',{get(){throw Error('localStorage forbidden');}});c.window=c;
 vm.createContext(c);vm.runInContext(read('sms-approval.js'),c);vm.runInContext(read('ops.js'),c);
 const click=async(selector,dataset,disabled=false)=>{const target={dataset,disabled,closest:s=>s===selector?target:null};await events.click({target,preventDefault(){}});await tick();};
 return {c,els,values,calls,dialogs,windowEvents,timers,set handler(value){handler=value;},set confirm(value){allow=value;},
  login:async(pw='fixture-password')=>{els['ops-password'].value=pw;els['ops-login'].events.submit({preventDefault(){}});await tick();},
  tab:tab=>click('[data-ops-tab]',{opsTab:tab}),decision:action=>click('[data-ops-decision]',{opsDecision:action,opsId:'fixture-approval'}),
  filter:filter=>click('[data-ops-filter]',{opsFilter:filter}),
  att:async dataset=>{const target={dataset,disabled:false,closest:sel=>sel.startsWith('[data-att-mark]')?target:null};await events.click({target,preventDefault(){}});await tick();},
  forward:(date='2026-11-18')=>click('[data-ops-forward]',{opsForward:date}),reject:(date='2026-11-18')=>click('[data-ops-reject]',{opsReject:date}),
  check:(index,checked,date='2026-11-18')=>events.change({target:{dataset:{opsStudent:String(index),opsDate:date},checked}}),date:value=>events.change({target:{id:'ops-date',value}}),
  lock:()=>els['ops-logout'].events.click(),refresh:()=>els['ops-refresh'].events.click(),content:()=>els['ops-content'].innerHTML};
}
const daily=()=>[{clinic_date:'2026-11-18',updated_at:'2026-11-19T10:30:00+09:00',forward:null,day:{label:'11/18(수) 클리닉',at:'2026-11-19T10:00:00+09:00',issues:[],unresolved:0,
 scheduled:[
  {key:'s-'+'a'.repeat(64),name:'등원학생',class_label:'클리닉반',start:'17:00',arrived:true,arrived_at:'2026-11-18T17:03:00+09:00',arrived_by:'맥가이',macgai_record:true,exam_done:false},
  {key:'s-'+'b'.repeat(64),name:'미등원미응시학생',class_label:'클리닉반',start:'18:00',arrived:false,arrived_at:null,arrived_by:null,macgai_record:false,exam_done:false},
  {key:'s-'+'c'.repeat(64),name:'미등원응시학생',class_label:'클리닉반',start:'19:00',arrived:false,arrived_at:null,arrived_by:null,macgai_record:true,exam_done:true}],
 sms:[{name:'문자학생',class_label:'문자반',recipients:['student','parent']}]
}}];
(async()=>{
 let f=fixture();assert.equal(f.calls.length,0);assert.equal(f.content(),'');assert.equal(f.els['ops-app'].hidden,true);
 await f.tab('weekly');await f.filter('all');assert.equal(f.calls.length,0);assert.doesNotMatch(f.content(),/주간학생/);
 await f.decision('approve');assert.equal(f.calls.length,0);
 await f.login('wrong');assert.equal(f.content(),'');assert.equal(f.values.has('teacher_ops_password'),false);assert.equal(f.els['ops-app'].hidden,true);
 await f.tab('weekly');assert.equal(f.content(),'');
 await f.login();assert.match(f.content(),/가상학생가/);assert.match(f.content(),/가상학생나/);assert.match(f.content(),/학생 1통 · 학부모 2통/);
 assert.match(f.content(),/학부모 안내 예시/);assert.equal(f.values.get('teacher_ops_password'),'fixture-password');assert.equal(f.els['ops-password'].value,'');
 assert.equal(f.values.has('login_failures'),false);assert.equal(f.els['ops-app'].hidden,false);
 f.confirm=false;const before=f.calls.length;await f.decision('approve');assert.equal(f.calls.length,before);
 f.confirm=true;await f.decision('approve');assert.equal(f.calls.at(-1).name,'sms_approval_rpc');assert.equal(f.calls.at(-1).args.p_id,'fixture-teacher');assert.match(f.els['ops-message'].textContent,/보내기를 승인/);
 await f.decision('reject');assert.equal(f.calls.length,before+1,'already decided rows cannot be changed');
 await f.tab('board');for(const status of ['됨','진행중','대기','실패','선생님할일'])assert.match(f.content(),new RegExp(status));assert.match(f.content(),/예약 작업/);assert.match(f.content(),/성공/);assert.match(f.content(),/갱신/);
 await f.tab('history');for(const word of ['승인','거절','만료','2통','0통','미집계'])assert.ok(f.content().includes(word),word);
 f.lock();assert.equal(f.content(),'');assert.equal(f.values.has('teacher_ops_password'),false);assert.equal(f.els['ops-app'].hidden,true);
 await f.tab('pending');assert.equal(f.content(),'');

 f=fixture();await f.login();await f.tab('weekly');assert.equal(f.calls.at(-1).args.p_action,'weekly');
 assert.equal(f.els['ops-title'].textContent,'이번 주 명단');
 for(const word of ['기말대비 4주차','집계가 완전하지 않음: 가상반 출결 확인 중','갱신','집계','11. 19.','10:30','10:00','미등원 1 · 미입력 1 · 재시험 1 · 과제 미완 1','미등원 0 · 미입력 0 · 재시험 0 · 과제 미완 0','주간학생가','주간학생나','주간학생다','주간학생라','시험지만 수령','확인 불가','점수: 0','점수: 미집계','2026-11-18'])assert.ok(f.content().includes(word),word);
 const weeklyCalls=f.calls.length;
 for(const filter of ['absent','missing','homework']){await f.filter(filter);assert.match(f.content(),/주간학생가/);assert.doesNotMatch(f.content(),/주간학생[나다라]/);assert.match(f.content(),/미등원 1 · 미입력 1 · 재시험 1 · 과제 미완 1/);assert.match(f.content(),/해당 학생이 없습니다/);assert.ok(f.content().includes(`data-ops-filter="${filter}" aria-pressed="true"`));}
 // 11/21 주차별 영상: 학생 줄, 반 요약, 영상 미시청 필터(주차 미완 포함).
 assert.ok(f.content().includes('영상 주차: <span>1주 완료</span> · <strong class="vw-miss">2주 미완 30%</strong> · <span>3주 없음</span>'));
 assert.ok(f.content().includes('영상 미시청 1주 0 · 2주 1 · 3주 0'));
 await f.filter('video');assert.match(f.content(),/주간학생가/);assert.doesNotMatch(f.content(),/주간학생[나다라]/);
 await f.filter('retest');assert.match(f.content(),/주간학생나/);assert.doesNotMatch(f.content(),/주간학생[가다라]/);
 await f.filter('all');for(const name of ['가','나','다','라'])assert.ok(f.content().includes('주간학생'+name));
 await f.filter('__proto__');assert.equal(f.calls.length,weeklyCalls,'filtering must not call RPC');
 assert.doesNotMatch(JSON.stringify([...f.values]),/주간학생/,'weekly snapshots never enter storage');
 f.lock();await f.filter('all');await f.tab('weekly');assert.equal(f.content(),'');assert.equal(f.calls.length,weeklyCalls);
 f=fixture();await f.login();await f.tab('weekly');f.windowEvents.pagehide();assert.equal(f.content(),'');await f.filter('all');assert.equal(f.content(),'');
 f=fixture();await f.login();f.handler=async()=>({data:null});await f.tab('weekly');assert.match(f.els['ops-content'].textContent,/이번 주 명단이 없습니다/);
 const empty=weekly();empty.week.blocked=false;empty.week.classes=[];f.handler=async()=>({data:empty});await f.refresh();assert.match(f.content(),/등록된 반이 없습니다/);assert.doesNotMatch(f.content(),/집계가 완전하지 않음/);
 const unsafe=weekly(),attack='<img src=x onerror=alert(1)> 010-1234-5678';
 unsafe.week.label=attack;unsafe.week.issues=[attack];unsafe.week.classes[0].label=attack;
 Object.assign(unsafe.week.classes[0].students[0],{name:attack,attendance:attack,clinic:attack,score:attack,homework:attack,absence_dates:[attack]});
 f.handler=async()=>({data:unsafe});await f.refresh();assert.doesNotMatch(f.content(),/<img|010-1234-5678/);assert.match(f.content(),/&lt;img/);assert.match(f.content(),/전화번호 숨김/);
 f.handler=async()=>({error:{code:'42501'}});await f.refresh();assert.equal(f.content(),'');await f.filter('all');assert.equal(f.content(),'');
 f=fixture();await f.login();let releaseWeek;f.handler=()=>new Promise(resolve=>releaseWeek=resolve);const readingWeek=f.tab('weekly');await tick();f.lock();releaseWeek({data:weekly()});await readingWeek;assert.equal(f.content(),'');await f.filter('all');assert.equal(f.content(),'');

 // Daily roster and forwarding: fake RPC only, never contact Jandi or the real database.
 f=fixture();await f.tab('daily');await f.forward();await f.date('2026-11-18');assert.equal(f.calls.length,0);assert.equal(f.content(),'');
 await f.login();await f.tab('daily');assert.equal(f.calls.at(-1).args.p_action,'daily');assert.equal(f.calls.at(-1).args.p_arg,undefined);
 for(const value of ['value="2026-11-18"','① 등원 명단 (1명)','② 미등원 명단 (1명)','맥가이 기록 없음 (1명)','③ 미등원 학원 전달명단 (1명)','④ 미응시 문자 발송명단 (1명)','학생 · 학부모','17:03','(맥가이)','패드 기록 0건은 참고 사항'])assert.ok(f.content().includes(value),value);
 assert.match(f.content(),/<pre>11\/18\(수\) 클리닉 미등원\n미등원미응시학생 \(1명\)<\/pre>/);
 assert.doesNotMatch(f.content(),/data-ops-forward/);assert.match(f.content(),/미등원 승인에서 보내요/);
 const readOnly=f.calls.length;await f.forward();assert.equal(f.calls.length,readOnly);
 await f.tab('absence');assert.equal(f.els['ops-title'].textContent,'미등원 승인');assert.match(f.content(),/승인 전/);assert.match(f.content(),/type="checkbox"[^>]*checked/);
 f.confirm=false;const beforeForward=f.calls.length;await f.forward();assert.equal(f.calls.length,beforeForward);
 f.confirm=true;await f.forward();assert.equal(f.calls.at(-1).args.p_action,'forward');
 assert.deepEqual(f.calls.at(-1).args.p_arg,{clinic_date:'2026-11-18',updated_at:daily()[0].updated_at,selected:['s-'+'b'.repeat(64)]});
 assert.match(f.dialogs.at(-1),/미등원미응시학생/);assert.doesNotMatch(f.dialogs.at(-1),/미등원응시학생|등원학생/);
 assert.match(f.content(),/전달 대기\(학원 PC 처리 중\)/);assert.match(f.content(),/data-ops-forward="2026-11-18" disabled/);
 const queued=f.calls.length;await f.forward();assert.equal(f.calls.length,queued);
 const sent=daily();sent[0].forward={id:'sent-id',status:'sent',done_at:'2026-11-19T10:32:00+09:00'};
 f.handler=async()=>({data:sent});const poll=[...f.timers.values()].find(t=>t.ms===15000);assert.ok(poll);await poll.fn();
 assert.match(f.content(),/전달됨 10:32/);assert.match(f.content(),/>다시 보내기<\/button>/);
 assert.equal([...f.timers.values()].some(t=>t.ms===15000),false);
 const beforeResend=f.calls.length;f.confirm=[true,false];await f.forward();assert.equal(f.calls.length,beforeResend,'second confirmation cancellation never writes');
 f.confirm=[true,true];f.handler=async()=>({data:{id:'request-2',status:'pending'}});const dialogsBefore=f.dialogs.length;await f.forward();
 assert.equal(f.dialogs.length,dialogsBefore+2);assert.equal(f.calls.at(-1).args.p_arg.resend_of,'sent-id');
 assert.doesNotMatch(JSON.stringify([...f.values]),/미등원|문자학생/);
 f.lock();assert.equal(f.timers.size,0);await f.forward();assert.equal(f.content(),'');

 f=fixture();await f.login();await f.tab('daily');f.handler=async()=>({data:[]});await f.date('2026-11-17');
 assert.deepEqual(f.calls.at(-1).args.p_arg,{clinic_date:'2026-11-17'});assert.match(f.content(),/value="2026-11-17"/);assert.match(f.content(),/명단이 없습니다/);assert.doesNotMatch(f.content(),/data-ops-forward/);
 const dateCalls=f.calls.length;await f.date('invalid');assert.equal(f.calls.length,dateCalls);
 const emptyDay=daily();emptyDay[0].day.scheduled=[];emptyDay[0].day.sms=[];f.handler=async()=>({data:emptyDay});await f.tab('absence');assert.match(f.content(),/data-ops-forward="2026-11-18" disabled/);await f.forward();assert.equal(f.calls.length,dateCalls+1);
 const unsafeDay=daily(),dailyAttack='<img src=x onerror=alert(1)> 010-1234-5678';
 unsafeDay[0].day.label=dailyAttack;unsafeDay[0].day.issues=[dailyAttack];unsafeDay[0].day.unresolved=2;
 Object.assign(unsafeDay[0].day.scheduled[1],{name:dailyAttack,class_label:dailyAttack,start:dailyAttack});unsafeDay[0].day.sms[0].name=dailyAttack;
 unsafeDay[0].forward={status:'failed'};f.handler=async()=>({data:unsafeDay});await f.refresh();assert.match(f.content(),/확인 필요 2명/);assert.match(f.content(),/실패/);assert.doesNotMatch(f.content(),/<img|010-1234-5678/);assert.match(f.content(),/&lt;img/);
 f.handler=async()=>({error:{code:'40001'}});await f.forward();assert.equal(f.content(),'');assert.match(f.els['ops-message'].textContent,/명단이 갱신/);
 f=fixture();await f.login();await f.tab('absence');let releaseDaily;f.handler=()=>new Promise(resolve=>releaseDaily=resolve);
 const forwarding=f.forward();await tick();const inFlight=f.calls.length;await f.forward();assert.equal(f.calls.length,inFlight);f.lock();releaseDaily({data:{status:'pending'}});await forwarding;assert.equal(f.content(),'');assert.equal(f.timers.size,0);
 f=fixture();await f.login();f.handler=()=>new Promise(resolve=>releaseDaily=resolve);const readingDaily=f.tab('absence');await tick();f.windowEvents.pagehide();releaseDaily({data:daily()});await readingDaily;assert.equal(f.content(),'');assert.equal(f.timers.size,0);
 f=fixture();await f.login();await f.tab('absence');f.handler=async()=>({error:{code:'42501'}});await f.refresh();assert.equal(f.content(),'');assert.equal(f.values.has('teacher_ops_password'),false);
 f=fixture();await f.login();await f.tab('absence');f.handler=async()=>{throw Error('network secret');};await f.forward();const failForward=f.calls.length;await tick();assert.equal(f.calls.length,failForward);assert.equal(f.timers.size,0);assert.match(f.els['ops-message'].textContent,/자동으로 다시 요청하지/);

 f=fixture();await f.login();await f.decision('reject');assert.match(f.els['ops-message'].textContent,/보내지 않기로/);
 f=fixture('wrong');await tick();assert.equal(f.content(),'');assert.equal(f.values.has('teacher_ops_password'),false);
 f=fixture('fixture-password');assert.equal(f.content(),'','session restore must reauthenticate before rendering');await tick();assert.match(f.content(),/가상학생가/);
 f.windowEvents.pagehide();assert.equal(f.content(),'');assert.equal(f.els['ops-app'].hidden,true);f.windowEvents.pageshow({persisted:true});await tick();assert.match(f.content(),/가상학생가/);

 f=fixture();for(let i=0;i<5;i++)await f.login('wrong');assert.ok(Number(f.values.get('login_lock_until'))>Date.now());
 const attempts=f.calls.length;await f.login();assert.equal(f.calls.length,attempts);assert.equal(f.content(),'');
 f=fixture();f.handler=async()=>{throw Error('network secret');};await f.login();assert.equal(f.values.has('login_failures'),false);assert.doesNotMatch(f.els['ops-message'].textContent,/network secret/);
 f=fixture();f.handler=async()=>({error:{code:'PGRST202'}});await f.login();assert.match(f.els['ops-message'].textContent,/서버 반영 전/);

 f=fixture();f.handler=async()=>({data:{teacher_id:'fixture-teacher',approvals:[{...approval(),roster:null}]}});await f.login();
 assert.match(f.content(),/명단이 아직/);assert.match(f.content(),/data-ops-decision="approve"[^>]*disabled/);const missing=f.calls.length;await f.decision('approve');assert.equal(f.calls.length,missing);
 f=fixture();const malicious=approval();malicious.roster.classes[0].students[0].name='<img src=x onerror=alert(1)>';
 malicious.preview.examples[0].text='010-1234-5678 / 02-123-4567 / +82 10-1234-5678 / (010) 1234-5678 / 010\n1234\n5678';
 f.handler=async()=>({data:{teacher_id:'fixture-teacher',approvals:[malicious]}});await f.login();
 assert.doesNotMatch(f.content(),/<img|010-1234-5678|02-123-4567|10-1234-5678|1234|5678/);assert.match(f.content(),/&lt;img/);assert.match(f.content(),/전화번호 숨김/);

 f=fixture();await f.login();let release;f.handler=()=>new Promise(resolve=>release=resolve);
 const saving=f.decision('approve');await tick();const savingCalls=f.calls.length;await f.decision('approve');assert.equal(f.calls.length,savingCalls,'double tap makes only one write');
 f.lock();release({data:{...approval(),status:'approved'}});await saving;assert.equal(f.content(),'','late decision cannot repopulate locked DOM');
 f=fixture();await f.login();f.handler=()=>new Promise(resolve=>release=resolve);const refreshing=f.refresh();await tick();f.lock();release({data:{teacher_id:'fixture-teacher',approvals:[approval()]}});await refreshing;assert.equal(f.content(),'');
 f=fixture();f.handler=()=>new Promise(resolve=>release=resolve);await f.login();f.windowEvents.pagehide();release({data:{teacher_id:'fixture-teacher',approvals:[approval()]}});await tick();assert.equal(f.content(),'');assert.equal(f.values.has('teacher_ops_password'),false);
 f=fixture();await f.login();f.handler=async()=>({error:{code:'42501'}});await f.refresh();assert.equal(f.content(),'');assert.equal(f.values.has('teacher_ops_password'),false);
 f=fixture();await f.login();f.handler=async()=>{throw Error('timeout');};await f.decision('approve');const failedCalls=f.calls.length;await tick();assert.equal(f.calls.length,failedCalls);assert.equal(f.content(),'');assert.match(f.els['ops-message'].textContent,/자동으로 다시 요청하지/);

 // Selection is kept in memory, survives refresh, and never falls back to names.
 f=fixture();await f.login();const twins=daily();twins[0].day.scheduled.push({...twins[0].day.scheduled[1],key:'s-'+'d'.repeat(64)});
 f.handler=async(name,args)=>({data:args.p_action==='daily'?twins:{id:'selected-request',status:'pending'}});
 await f.tab('absence');const preview=element(),send=element();
 f.els['ops-content'].querySelector=selector=>selector.startsWith('[data-ops-preview')?preview:send;
 await f.check(0,false);assert.equal(preview.textContent,'11/18(수) 클리닉 미등원\n미등원미응시학생 (1명)');assert.equal(send.disabled,false);
 await f.check(1,false);assert.match(preview.textContent,/\(0명\)/);assert.equal(send.disabled,true);
 const none=f.calls.length;await f.forward();assert.equal(f.calls.length,none);
 await f.check(1,true);await f.refresh();assert.match(f.content(),/\(1명\)<\/pre>/);
 await f.forward();assert.deepEqual(f.calls.at(-1).args.p_arg.selected,['s-'+'d'.repeat(64)]);
 assert.match(f.dialogs.at(-1),/미등원미응시학생 \(1명\)/);assert.doesNotMatch(JSON.stringify([...f.values]),/s-dddd|미등원/);

 f=fixture();await f.login();await f.tab('absence');f.confirm=false;const rejectCalls=f.calls.length;await f.reject();assert.equal(f.calls.length,rejectCalls);
 f.confirm=true;await f.reject();assert.equal(f.calls.at(-1).args.p_action,'reject');assert.deepEqual(f.calls.at(-1).args.p_arg,{clinic_date:'2026-11-18',updated_at:daily()[0].updated_at});assert.match(f.content(),/보내지 않음/);
 await f.reject();assert.equal(f.calls.length,rejectCalls+1);await f.forward();assert.equal(f.calls.at(-1).args.p_action,'forward');
 const pendingCalls=f.calls.length;await f.reject();assert.equal(f.calls.length,pendingCalls);

 f=fixture();await f.login();const older=daily()[0],newer=daily()[0];older.clinic_date='2026-11-17';newer.forward={status:'sent'};
 f.handler=async()=>({data:[newer,older]});await f.tab('absence');assert.ok(f.content().indexOf('data-ops-day="2026-11-17"')<f.content().indexOf('data-ops-day="2026-11-18"'));
 const sentCalls=f.calls.length;await f.reject();assert.equal(f.calls.length,sentCalls);
 const legacyDay=daily();delete legacyDay[0].day.scheduled[1].key;f.handler=async()=>({data:legacyDay});await f.refresh();assert.match(f.content(),/학원 PC의 명단 갱신/);const legacyCalls=f.calls.length;await f.forward();assert.equal(f.calls.length,legacyCalls);
 f.handler=async()=>({data:[]});await f.refresh();assert.match(f.content(),/최근 클리닉 명단이 없습니다/);

 const selectionSql=read('supabase_patch_ops_forward_selection.sql');
 assert.match(selectionSql,/p_arg jsonb default null/);assert.match(selectionSql,/authenticate_user\(candidate.id, p_password, 'teacher'\)/);
 assert.match(selectionSql,/status in \('pending','sent','failed','rejected'\)/);assert.match(selectionSql,/OPS_SELECTION_INVALID/);
 assert.match(selectionSql,/jsonb_array_length\(chosen\) <> jsonb_array_length\(p_arg->'selected'\)/);
 assert.match(selectionSql,/jsonb_set\(daily.day, '\{scheduled\}', chosen\)/);assert.match(selectionSql,/jsonb_agg\(s order by ordinal\)/);
 assert.match(selectionSql,/not \(p_arg \? 'selected'\)/);assert.match(selectionSql,/count\(distinct value\)/);
 assert.match(selectionSql,/for update/);assert.match(selectionSql,/OPS_DAILY_CHANGED.*40001/);
 assert.doesNotMatch(selectionSql,/create policy|grant\s+(select|insert|update|all)\s+on/i);
 // Unrelated RPC actions and authentication are copied without changes.
 assert.equal(selectionSql.slice(selectionSql.indexOf("  if p_action = 'pending' then")),read('supabase_add_ops_daily.sql').slice(read('supabase_add_ops_daily.sql').indexOf("  if p_action = 'pending' then")));

 // Existing teacher panel still uses the same RPC, confirms decisions and rejects non-teachers.
 const els={'sms-approval-list':element(),'sms-approval-message':element()},events={},calls=[];
 const c={console,Date,session:{id:'teacher',role:'teacher'},weeklyLogin:{id:'teacher',pw:'test-only',role:'teacher'},padMode:false,studentPreviewMode:false,confirm:()=>true,
  document:{getElementById:id=>els[id],addEventListener:(key,fn)=>events[key]=fn},sb:{rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_action==='list'?[approval()]:{...approval(),status:args.p_action==='approve'?'approved':'rejected'}};}}};c.window=c;
 vm.createContext(c);vm.runInContext(read('sms-approval.js'),c);await c.renderSmsApprovals();assert.match(els['sms-approval-list'].innerHTML,/보내기/);
 const target={dataset:{smsDecision:'approve',smsId:'fixture-approval'},closest:s=>s==='[data-sms-decision]'?target:null};await events.click({target});
 assert.equal(calls.at(-1).args.p_action,'approve');assert.match(els['sms-approval-message'].textContent,/승인했습니다/);
 c.session.role='student';const count=calls.length;await c.renderSmsApprovals();assert.equal(calls.length,count);assert.equal(els['sms-approval-list'].textContent,'');

 // Static migration guards only: the requested SQL must not be executed by this check.
 const sql=read('supabase_add_teacher_ops.sql');
 for(const table of ['ops_rosters','ops_board'])assert.ok(sql.includes(`alter table public.${table} enable row level security`));
 assert.doesNotMatch(sql,/create policy|grant\s+(select|insert|update|all)\s+on\s+(table\s+)?public\.ops_/i);
 assert.match(sql,/authenticate_user\(candidate.id, p_password, 'teacher'\)/);assert.match(sql,/TEACHER_AUTH_REQUIRED.*42501/);
 assert.match(sql,/sms_approval_publishers where token_hash = encode\(extensions.digest/);
 assert.match(sql,/OPS_ROSTER_IMMUTABLE/);assert.match(sql,/OPS_RECIPIENT_COUNT_MISMATCH/);assert.match(sql,/interval '7 days'/);
 const weeklySql=read('supabase_add_ops_weekly.sql');
 assert.match(weeklySql,/alter table public.ops_weekly enable row level security/);
 assert.match(weeklySql,/revoke all on public.ops_weekly from public, anon, authenticated/);
 assert.doesNotMatch(weeklySql,/create policy|grant\s+(select|insert|update|all)\s+on\s+(table\s+)?public\.ops_/i);
 assert.match(weeklySql,/week jsonb not null check \(public.ops_valid_weekly\(week\)\)/);
 assert.match(weeklySql,/id text primary key default 'current' check \(id = 'current'\)/);
 assert.match(weeklySql,/octet_length\(p_value::text\) > 1048576/);
 assert.equal(weeklySql.match(/  if regexp_replace[^\n]+/)[0],sql.match(/  if regexp_replace[^\n]+/)[0],'reuse phone rejection pattern');
 for(const field of ['label','at','blocked','issues','classes','class_id','students','name','attendance','clinic','score','retest','homework','absence_dates'])assert.ok(weeklySql.includes(`->'${field}'`)||weeklySql.includes(`->>'${field}'`),field);
 assert.match(weeklySql,/exception when invalid_datetime_format or datetime_field_overflow then return false/);
 assert.match(weeklySql,/on conflict \(id\) do update set week = excluded.week, updated_at = excluded.updated_at/);
 assert.match(weeklySql,/jsonb_build_object\('week', week, 'updated_at', updated_at\)/);
 // Removing only the weekly additions must reproduce the old RPCs byte-for-byte.
 const legacy=weeklySql.slice(weeklySql.indexOf('create or replace function public.ops_pc('))
  .replaceAll('create or replace function public.ops_','create function public.ops_')
  .replace("('roster','board','weekly')","('roster','board')").replace("('pending','board','history','weekly')","('pending','board','history')")
  .replace(/  elsif p_action = 'weekly' then\n[\s\S]*?(?=  else\n|  elsif p_action = 'board' then)/g,'');
 assert.equal(legacy.trim(),sql.slice(sql.indexOf('create function public.ops_pc(')).trim(),'existing auth, roster, board, pending and history behavior stays unchanged');
 const sourcePatch=read('supabase_patch_ops_daily_source.sql');
 assert.match(sourcePatch,/create or replace function public.ops_valid_daily/);
 assert.match(sourcePatch,/s \? 'arrived_by' and s \? 'macgai_record'/);
 assert.match(sourcePatch,/jsonb_typeof\(s->'macgai_record'\) = 'boolean'/);
 assert.match(sourcePatch,/s->>'arrived_by' in \('맥가이','패드'\)/);
 assert.doesNotMatch(sourcePatch,/create table|create policy|grant execute|function public.ops_(pc|teacher)|update public\./i);
 const dailySql=read('supabase_add_ops_daily.sql').replace(/\r\n/g,'\n');
 for(const table of ['ops_daily','ops_forward_requests'])assert.ok(dailySql.includes(`alter table public.${table} enable row level security`));
 assert.match(dailySql,/revoke all on public.ops_daily, public.ops_forward_requests from public, anon, authenticated/);
 assert.doesNotMatch(dailySql,/create policy|grant\s+(select|insert|update|all)\s+on\s+(table\s+)?public\.ops_/i);
 assert.equal((dailySql.match(/create (?:or replace )?function public.ops_/g)||[]).length,3,'one validator and exactly two RPCs');
 assert.equal((dailySql.match(/^commit;/gm)||[]).length,1);
 assert.equal(dailySql.match(/  if regexp_replace[^\n]+/)[0].trim(),sql.match(/  if regexp_replace[^\n]+/)[0].trim());
 assert.match(dailySql,/octet_length\(p_value::text\) > 1048576/);
 assert.match(dailySql,/exception when invalid_datetime_format or datetime_field_overflow then return false/);
 for(const field of ['label','at','issues','scheduled','unresolved','sms','name','class_label','start','arrived','arrived_at','exam_done','recipients'])assert.ok(dailySql.includes(`->'${field}'`)||dailySql.includes(`->>'${field}'`),field);
 assert.match(dailySql,/create unique index ops_forward_one_pending[^\n]+where status = 'pending'/);
 assert.match(dailySql,/drop function public.ops_teacher\(text,text\);/);
 assert.match(dailySql,/p_arg jsonb default null/);
 assert.match(dailySql,/grant execute on function public.ops_teacher\(text,text,jsonb\) to anon, authenticated/);
 assert.match(dailySql,/on conflict \(clinic_date\) do update set day = excluded.day, updated_at = excluded.updated_at/);
 assert.match(dailySql,/ops_daily where clinic_date = selected_date for update/);
 assert.match(dailySql,/request.status = 'pending' or \(request.status = 'sent'/);
 assert.match(dailySql,/\(p_arg->>'resend_of'\)::uuid is distinct from request.id/);
 assert.match(dailySql,/OPS_DAILY_CHANGED.*40001/);
 assert.match(dailySql,/values\(selected_date, 'jandi-attendance', clock_timestamp\(\), teacher_id, daily.day\)/);
 assert.match(dailySql,/s->'arrived' = 'false'::jsonb and s->'exam_done' = 'false'::jsonb/);
 assert.match(dailySql,/if request.status = 'pending' then[\s\S]*OPS_FORWARD_IMMUTABLE/);
 assert.match(dailySql,/order by d.clinic_date desc/);assert.match(dailySql,/Asia\/Seoul'\)::date - 13/);
 // Removing daily-only additions must reproduce ALL previous RPC behavior verbatim.
 const dailyLegacy=dailySql.slice(dailySql.indexOf('create or replace function public.ops_pc('))
  .replace(' item jsonb; request public.ops_forward_requests%rowtype;',' item jsonb;')
  .replace("('roster','board','weekly','daily','forward-list','forward-done')","('roster','board','weekly')")
  .replace(/  elsif p_action = 'daily' then[\s\S]*?(?=  elsif p_action = 'weekly' then)/,'')
  .replace(/-- PostgreSQL requires[^\n]+\n-- The transaction[^\n]+\ndrop function public.ops_teacher\(text,text\);\n/,'')
  .replace('p_action text, p_arg jsonb default null)','p_action text)')
  .replace(' result jsonb; selected_date date; daily public.ops_daily%rowtype; request public.ops_forward_requests%rowtype;',' result jsonb;')
  .replace("('pending','board','history','weekly','daily','forward')","('pending','board','history','weekly')")
  .replace(/  if p_action in \('daily','forward'\) then[\s\S]*?(?=  if p_action = 'pending' then)/,'')
  .replaceAll('on function public.ops_teacher(text,text,jsonb)','on function public.ops_teacher(text,text)');
 assert.equal(dailyLegacy.trim(),weeklySql.slice(weeklySql.indexOf('create or replace function public.ops_pc(')).replace(/\r\n/g,'\n').trim());
 const manifest=JSON.parse(read('ops-manifest.json'));assert.equal(manifest.name,'서로국어 운영');assert.equal(manifest.scope,'./ops.html');assert.equal(manifest.start_url,'./ops.html');assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons)assert.ok(fs.existsSync(path.join(root,icon.src.split('?')[0])));
 assert.match(read('ops.html'),/rel="manifest" href="ops-manifest.json"/);assert.doesNotMatch(read('ops.html'),/href="manifest.json"/);
 for(const file of ['ops.html','ops.js','ops.css','ops-manifest.json'])assert.ok(read('sw.js').includes('/lecture/'+file));
 assert.match(read('sw.js'),/const CACHE_NAME = 'kukeo-wang-v212-ops-absence'/);
 // 11/21 출석부 직접 체크 · 미등원 발송: 웹훅 없음, 체크 완료 전 발송 불가, 서버 거부 사유 표시
 {
  const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const book={label:'출석부',at:'2026-11-21T01:00:00Z',week:[],issues:[],clinic:[],regular:[{label:'가상반(토10:30)',dates:[day],times:{[day]:'10:30'},
   students:[{name:'체크학생가',cells:{[day]:{st:'출석',in:'10:20',out:'',memo:''}}},{name:'체크학생나',cells:{[day]:{st:'미입력',in:'',out:'',memo:''}}}]}]};
  let abs={settings:{destination:'self',room_ready:false},marks:[],sends:[]};const sends=[];
  const g=fixture();g.handler=async(name,args)=>{
   if(args.p_password!=='fixture-password')return {error:{code:'42501'}};
   if(name==='ops_teacher_attendance')return {data:{book,updated_at:book.at}};
   if(name==='ops_teacher_absence'){
    if(args.p_action==='send'){sends.push(args.p_arg);if(sends.length>1)return {error:{code:'P0001',message:'ABSENCE_DUPLICATE'}};
     abs={...abs,sends:[{class_label:'가상반(토10:30)',att_date:day,destination:'self',round:1,status:'pending'}]};}
    return {data:args.p_action==='get'?abs:{ok:true}};}
   if(args.p_action==='pending')return {data:{teacher_id:'fixture-teacher',approvals:[]}};
   return {data:[]};
  };
  await g.login();await g.tab('attendance');
  assert.match(g.content(),/받는 곳: 나와의 대화/);assert.match(g.content(),/전환할 수 없습니다/);assert.match(g.content(),/맥가이: 출석 10:20/);assert.match(g.content(),/수업 10:30/);
  await g.att({attDest:'room'});assert.ok(!g.calls.some(c=>c.args.p_action==='dest'),'room switch blocked when room webhook missing is enforced by disabled button + server');
  g.confirm=true;await g.att({attSend:'0'});assert.equal(sends.length,0);assert.match(g.els['ops-message'].textContent,/체크하지 않은 학생이 2명/);
  await g.att({attMark:'미등원',attS:'0',attI:'1'});await g.att({attAll:'0'});
  await g.att({attSend:'0'});assert.equal(sends.length,1);assert.deepEqual({...sends[0].marks},{'체크학생나':'미등원','체크학생가':'출석'});
  assert.match(g.dialogs.at(-1),/나와의 대화[\s\S]*미등원 1명: 체크학생나/);assert.match(g.content(),/1회차 전달 대기/);
  assert.ok([...g.timers.values()].some(t=>t.ms===15000),'polls while the PC has not sent yet');
  abs={...abs,sends:[]};await g.att({attSend:'0'});assert.match(g.els['ops-message'].textContent,/이미 보냈습니다/);
  assert.doesNotMatch(JSON.stringify(g.calls),/wh\.jandi|webhook/i);
  g.lock();assert.equal(g.content(),'');
 }

 assert.match(read('ops.html'),/data-ops-tab="pending"[^\n]+\n\s*<button[^\n]+data-ops-tab="absence"[^\n]+\n\s*<button[^\n]+data-ops-tab="daily"[^\n]+\n\s*<button[^\n]+data-ops-tab="weekly"/);
 console.log('PASS: ops authentication/privacy, daily rosters/dates/forward/resend/polling/lock/races, weekly filters, shared approvals, legacy RPC preservation, manifest/cache and static SQL guards (fake RPC only; SQL not executed)');
 if(process.argv.includes('--browser'))await browserChecks();
})().catch(error=>{console.error(error);process.exitCode=1;});

async function browserChecks(){
 const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[],calls=[],dailyRows=daily();
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='ops.test'){
    const file=url.pathname.split('/').at(-1),types={html:'text/html',js:'text/javascript',css:'text/css',json:'application/json',png:'image/png'};
    if(['ops.html','ops.js','ops.css','ops-manifest.json','sms-approval.js','icon-192.png','icon-512.png'].includes(file))return route.fulfill({contentType:types[file.split('.').at(-1)],body:fs.readFileSync(path.join(root,file))});
   }
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    const args=route.request().postDataJSON();calls.push(args);
    if(args.p_password!=='fixture-password')return route.fulfill({status:403,json:{code:'42501'}});
    if(url.pathname.endsWith('/sms_approval_rpc'))return route.fulfill({json:{...approval(),status:'approved'}});
    if(args.p_action==='pending')return route.fulfill({json:{teacher_id:'fixture-teacher',approvals:[approval()]}});
    if(args.p_action==='weekly')return route.fulfill({json:weekly()});
    if(args.p_action==='daily')return route.fulfill({json:args.p_arg?.clinic_date&&args.p_arg.clinic_date!=='2026-11-18'?[]:dailyRows});
    if(args.p_action==='forward'){dailyRows[0].forward={id:'browser-request',status:'pending'};return route.fulfill({json:dailyRows[0].forward});}
    if(args.p_action==='board')return route.fulfill({json:{updated_at:new Date().toISOString(),board:{items:[{name:'자동화 작업',status:'선생님할일',memo:'내용 확인'}],tasks:[{name:'예약 작업',last_run_at:new Date().toISOString(),result:'성공'}]}}});
    return route.fulfill({json:[{...approval(),status:'approved',sent_count:2}]});
   }
   return route.abort();
  });
  await page.goto('https://ops.test/lecture/ops.html');
  assert.equal(calls.length,0);assert.equal(await page.locator('#ops-app').isVisible(),false);assert.doesNotMatch(await page.locator('body').innerText(),/가상학생/);
  await page.locator('#ops-password').fill('wrong');await page.locator('#ops-login-button').click();await page.getByText('선생님 비밀번호를 확인해 주세요.').waitFor();
  assert.equal(await page.locator('#ops-content').innerText(),'');
  await page.locator('#ops-password').fill('fixture-password');await page.locator('#ops-login-button').click();await page.getByText('가상학생가',{exact:false}).waitFor();
  for(const width of [320,390,850]){
   await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow at '+width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(require('node:os').tmpdir(),'teacher-ops-mobile.png'),fullPage:true});
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'보내기',exact:true}).click();await page.getByText('보내기를 승인했습니다.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'이번 주 명단',exact:true}).click();await page.getByText('주간학생가',{exact:true}).waitFor();
  await page.getByText('집계가 완전하지 않음: 가상반 출결 확인 중',{exact:true}).waitFor();
  for(const width of [320,390,850]){
   await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'weekly no horizontal overflow at '+width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'재시험',exact:true}).click();assert.equal(await page.getByText('주간학생가',{exact:true}).count(),0);assert.equal(await page.getByText('주간학생나',{exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'재시험',exact:true}).evaluate(el=>el===document.activeElement),true,'filter keeps keyboard focus');
  await page.getByRole('button',{name:'전체',exact:true}).click();
  await page.screenshot({path:path.join(require('node:os').tmpdir(),'teacher-ops-weekly-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'클리닉 명단',exact:true}).click();await page.getByText('③ 미등원 학원 전달명단 (1명)',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('클리닉 날짜').inputValue(),'2026-11-18');
  assert.equal(await page.locator('[data-ops-forward]').count(),0);
  await page.getByRole('link',{name:'미등원 승인에서 보내요'}).click();await page.getByRole('checkbox').waitFor();
  assert.equal(await page.getByRole('checkbox').isChecked(),true);
  await page.getByRole('checkbox').focus();await page.keyboard.press('Space');
  assert.equal(await page.getByRole('checkbox').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.getByRole('button',{name:'잔디로 보내기',exact:true}).isDisabled(),true);
  assert.match(await page.locator('[data-ops-preview]').innerText(),/\(0명\)/);
  await page.keyboard.press('Space');assert.match(await page.locator('[data-ops-preview]').innerText(),/미등원미응시학생 \(1명\)/);
  for(const width of [320,390,850]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'daily no horizontal overflow at '+width);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(require('node:os').tmpdir(),'teacher-ops-daily-mobile.png'),fullPage:true});
  page.once('dialog',dialog=>{assert.match(dialog.message(),/11\/18\(수\) 클리닉 미등원\n미등원미응시학생 \(1명\)/);return dialog.accept();});
  await page.getByRole('button',{name:'잔디로 보내기',exact:true}).click();await page.locator('#ops-content').getByText('전달 대기(학원 PC 처리 중)',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'잔디로 보내기',exact:true}).isDisabled(),true);
  dailyRows[0].forward={id:'browser-request',status:'sent',done_at:'2026-11-19T10:32:00+09:00'};
  await page.getByRole('button',{name:'새로고침',exact:true}).click();await page.getByText('전달됨 10:32',{exact:true}).waitFor();
  let resendDialogs=0;const acceptResend=dialog=>{resendDialogs++;return dialog.accept();};page.on('dialog',acceptResend);
  await page.getByRole('button',{name:'다시 보내기',exact:true}).click();await page.locator('#ops-content').getByText('전달 대기(학원 PC 처리 중)',{exact:true}).waitFor();page.off('dialog',acceptResend);assert.equal(resendDialogs,2);
  assert.equal(calls.at(-1).p_arg.resend_of,'browser-request');
  await page.getByRole('button',{name:'클리닉 명단',exact:true}).click();
  await page.getByLabel('클리닉 날짜').fill('2026-11-17');await page.getByText('학원 PC가 올린 해당 날짜의 클리닉 명단이 없습니다.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'잔디로 보내기',exact:true}).count(),0);
  await page.getByRole('button',{name:'자동화 현황',exact:true}).click();await page.getByText('자동화 작업',{exact:true}).waitFor();
  await page.getByRole('button',{name:'최근 기록',exact:true}).click();await page.getByText('보낸 수: 2통').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('teacher_ops_password')),'fixture-password');
  await page.reload();await page.getByText('가상학생가',{exact:false}).waitFor();
  await page.getByRole('button',{name:'잠그기'}).click();assert.equal(await page.locator('#ops-content').innerText(),'');assert.equal(await page.evaluate(()=>sessionStorage.getItem('teacher_ops_password')),null);
  assert.deepEqual(errors,[]);
  console.log('PASS: real Edge mobile/desktop rendering, password gate, shared approval dialog, tabs, reload/lock and storage isolation (all requests mocked)');
 }finally{await browser.close();}
}
