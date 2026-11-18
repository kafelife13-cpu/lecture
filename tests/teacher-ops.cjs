// Run: node tests/teacher-ops.cjs [--browser]. Fake RPC only; no network or database writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
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
  {name:'주간학생가',attendance:'미등원',clinic:'미입력',score:null,retest:false,homework:'미완',absence_dates:['2026-11-18']},
  {name:'주간학생나',attendance:'등원',clinic:'입력완료',score:0,retest:true,homework:'완료',absence_dates:[]},
  {name:'주간학생다',attendance:'시험지만 수령',clinic:'확인 불가',score:null,retest:false,homework:'없음',absence_dates:[]}]},
 {class_id:'class-b',label:'주간 다른반',students:[{name:'주간학생라',attendance:'확인 불가',clinic:'입력완료',score:100,retest:false,homework:'완료',absence_dates:[]}]}]}});
function fixture(stored){
 const ids=[...read('ops.html').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const els=Object.fromEntries(ids.map(id=>[id,element()])),tabs=['pending','weekly','board','history'].map(tab=>Object.assign(element(),{dataset:{opsTab:tab}}));
 els['ops-app'].hidden=true;els['ops-logout'].hidden=true;
 const events={},windowEvents={},values=new Map(stored?[["teacher_ops_password",stored]]:[]),calls=[],dialogs=[];
 let allow=true,handler=async(name,args)=>{
  if(args.p_password!=='fixture-password')return {error:{code:'42501',message:'never show this secret'}};
  if(name==='sms_approval_rpc')return {data:{...approval(),status:args.p_action==='approve'?'approved':'rejected'}};
  if(args.p_action==='pending')return {data:{teacher_id:'fixture-teacher',approvals:[approval()]}};
  if(args.p_action==='weekly')return {data:weekly()};
  if(args.p_action==='board')return {data:{updated_at:new Date().toISOString(),board:{items:['됨','진행중','대기','실패','선생님할일'].map(status=>({name:'작업 '+status,status,memo:'메모'})),tasks:[{name:'예약 작업',last_run_at:new Date().toISOString(),result:'성공'},{name:'오류 작업',last_run_at:new Date().toISOString(),result:'실패'}]}}};
  return {data:['approved','rejected','expired'].map((status,i)=>({...approval(),status,sent_count:i===0?2:i===1?0:null}))};
 };
 const c={console,Date,AbortController,setTimeout,clearTimeout,navigator:{},
  document:{getElementById:id=>els[id]||null,querySelectorAll:()=>tabs,addEventListener:(key,fn)=>events[key]=fn},
  sessionStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
  confirm:text=>{dialogs.push(text);return allow;},
  fetch:async(url,options)=>{
   assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');
   const name=url.split('/').at(-1),args=JSON.parse(options.body);assert.ok(['ops_teacher','sms_approval_rpc'].includes(name));calls.push({name,args});
   const result=await handler(name,args);return {ok:!result.error,json:async()=>result.error||result.data};
  },addEventListener:(key,fn)=>windowEvents[key]=fn};
 Object.defineProperty(c,'localStorage',{get(){throw Error('localStorage forbidden');}});c.window=c;
 vm.createContext(c);vm.runInContext(read('sms-approval.js'),c);vm.runInContext(read('ops.js'),c);
 const click=async(selector,dataset,disabled=false)=>{const target={dataset,disabled,closest:s=>s===selector?target:null};await events.click({target});await tick();};
 return {c,els,values,calls,dialogs,windowEvents,set handler(value){handler=value;},set confirm(value){allow=value;},
  login:async(pw='fixture-password')=>{els['ops-password'].value=pw;els['ops-login'].events.submit({preventDefault(){}});await tick();},
  tab:tab=>click('[data-ops-tab]',{opsTab:tab}),decision:action=>click('[data-ops-decision]',{opsDecision:action,opsId:'fixture-approval'}),
  filter:filter=>click('[data-ops-filter]',{opsFilter:filter}),
  lock:()=>els['ops-logout'].events.click(),refresh:()=>els['ops-refresh'].events.click(),content:()=>els['ops-content'].innerHTML};
}
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
 const manifest=JSON.parse(read('ops-manifest.json'));assert.equal(manifest.name,'서로국어 운영');assert.equal(manifest.scope,'./ops.html');assert.equal(manifest.start_url,'./ops.html');assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons)assert.ok(fs.existsSync(path.join(root,icon.src.split('?')[0])));
 assert.match(read('ops.html'),/rel="manifest" href="ops-manifest.json"/);assert.doesNotMatch(read('ops.html'),/href="manifest.json"/);
 for(const file of ['ops.html','ops.js','ops.css','ops-manifest.json'])assert.ok(read('sw.js').includes('/lecture/'+file));
 assert.match(read('sw.js'),/const CACHE_NAME = 'kukeo-wang-v200-ops-weekly'/);
 assert.match(read('ops.html'),/data-ops-tab="pending"[^\n]+\n\s*<button[^\n]+data-ops-tab="weekly"/);
 console.log('PASS: ops authentication/privacy, weekly summaries/filters/escaping/lock/races, shared approve/reject, legacy panel, manifest/cache and static SQL guards (fake RPC only; SQL not executed)');
 if(process.argv.includes('--browser'))await browserChecks();
})().catch(error=>{console.error(error);process.exitCode=1;});

async function browserChecks(){
 const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[],calls=[];
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
  await page.getByRole('button',{name:'자동화 현황',exact:true}).click();await page.getByText('자동화 작업',{exact:true}).waitFor();
  await page.getByRole('button',{name:'최근 기록',exact:true}).click();await page.getByText('보낸 수: 2통').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('teacher_ops_password')),'fixture-password');
  await page.reload();await page.getByText('가상학생가',{exact:false}).waitFor();
  await page.getByRole('button',{name:'잠그기'}).click();assert.equal(await page.locator('#ops-content').innerText(),'');assert.equal(await page.evaluate(()=>sessionStorage.getItem('teacher_ops_password')),null);
  assert.deepEqual(errors,[]);
  console.log('PASS: real Edge mobile/desktop rendering, password gate, shared approval dialog, tabs, reload/lock and storage isolation (all requests mocked)');
 }finally{await browser.close();}
}
