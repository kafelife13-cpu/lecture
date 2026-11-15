const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('clinic-practice.js','utf8');
// Minimal offline DOM: exercises wrappers/events/escaping, not a browser layout engine.
function fixture(overrides={}){
 let document;
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.style={};this.events={};this.dataset={};this.value='';this.disabled=false;this.hidden=false;this.parent=null;this._html='';this.textContent='';}
  get id(){return this.attrs.id;}set id(v){this.attrs.id=v;}
  get isConnected(){return this===document.body||!!this.parent?.isConnected;}
  setAttribute(k,v){this.attrs[k]=v;if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;if(k==='value')this.value=v;if(k==='checked')this.checked=true;if(k==='hidden')this.hidden=true;}
  append(el){el.parent=this;this.children.push(el);}
  insertBefore(el,anchor){el.parent=this;const i=this.children.indexOf(anchor);this.children.splice(i<0?this.children.length:i,0,el);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}
  contains(el){return this===el||this.children.some(c=>c.contains(el));}
  insertAdjacentElement(position,el){const p=this.parent;el.parent=p;const i=p.children.indexOf(this);p.children.splice(i+(position==='afterend'?1:0),0,el);}
  set innerHTML(html){this._html=html;this.children.forEach(c=>c.parent=null);this.children=[];const stack=[this];
   for(const m of html.matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)){const [,closing,tag,attributes]=m;if(closing){if(stack.length>1)stack.pop();continue;}const el=new Element(tag);
    for(const a of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g))el.setAttribute(a[1],a[2]??'');stack.at(-1).append(el);if(!['INPUT','IMG','BR','HR','META','LINK'].includes(el.tagName))stack.push(el);
   }
  }
  get innerHTML(){return this._html;}
  querySelectorAll(selector){const matches=e=>selector==='input:checked'?e.tagName==='INPUT'&&e.checked:selector[0]==='['?Object.hasOwn(e.attrs,selector.slice(1,-1)):e.tagName===selector.toUpperCase();return this.children.flatMap(c=>[...(matches(c)?[c]:[]),...c.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){document.activeElement=this;}
  addEventListener(name,fn){this.events[name]=fn;}
  showModal(){this.open=true;}
  close(){this.open=false;this.events.close?.();}
 }
 document={createElement:tag=>new Element(tag),getElementById:id=>{const walk=e=>e.id===id?e:e.children.map(walk).find(Boolean);return walk(document.body);},activeElement:null};
 document.body=new Element('body');
 for(const id of ['home-announce-banner','s-res-wrong-list']){const e=new Element('div');e.id=id;e.innerHTML='<p>EXISTING_RESULT</p>';document.body.append(e);}
 const state={enabled:true,pending:0,timers:[],allocationCalls:0,items:[{id:'i1',exam_name:'평가',num:'1',text:'문항',passage:'지문',choices:['A','B','C','D','E'],images:[]}],calls:[],resultCalls:0,homeCalls:0,fail:false};
 const c={document,session:{id:'s',role:'student'},weeklyLogin:{id:'s',pw:'synthetic',role:'student'},padMode:false,studentPreviewMode:false,
  sExamData:{id:'exam',name:'이름에는 표시 없음',category:'school',clinic_week:'11월 1주차'},
  renderSExamResultView:()=>{state.resultCalls++;return 'original-result';},renderSHome:()=>{state.homeCalls++;return 'original-home';},doLogout:()=>{c.session=null;c.weeklyLogin=null;},
  setTimeout:(fn,ms)=>{state.timers.push({fn,ms});return state.timers.length;},
  sb:{rpc:async(name,p)=>{assert.equal(name,'odap_clinic_practice_rpc');state.calls.push(p);if(state.gate)await state.gate;if(state.fail)return {error:{message:'failure'}};
   if(p.p_action==='list')return {data:JSON.parse(JSON.stringify({enabled:state.enabled,items:state.enabled?state.items:[],pending:state.pending}))};
   if(p.p_action==='allocate'){
    state.allocationCalls++;if(state.failAfter!==undefined&&state.allocationCalls>state.failAfter)return {error:{code:'57014',message:'synthetic cancellation'}};
    if(!state.stuck){const n=Math.min(3,state.pending);state.pending-=n;for(let i=0;i<n;i++)state.items.push({id:'new-'+state.items.length,exam_name:'평가',num:state.items.length+1,text:'준비된 문항',choices:['가','나','다','라','마'],images:[]});}
    return {data:{pending:state.pending}};
   }
   if(p.p_action==='submit'){const result={id:p.p_payload.id,my_answer:p.p_payload.answer,correct:false,answer:'3',explanation:'해설 <script> & "'};state.items.find(i=>i.id===result.id).result=result;return {data:result};}
   if(p.p_action==='report')return {data:{saved:true}};assert.fail('unexpected RPC action');
  }},...overrides};
 vm.createContext(c);vm.runInContext(source,c);return {c,state,document};
}
const flush=()=>new Promise(r=>setImmediate(r));
const render=async(f,where='result')=>{const out=where==='result'?f.c.renderSExamResultView():f.c.renderSHome();await flush();return out;};
const runTimers=async f=>{for(let n=0;n<20;n++){await flush();const timer=f.state.timers.shift();if(!timer)return;timer.fn();}assert.fail('automatic retry must stop');};
(async()=>{
 for(const override of [{padMode:true},{studentPreviewMode:true},{weeklyLogin:null},{session:{id:'s',role:'teacher'}},{weeklyLogin:{id:'other',role:'student'}},{session:null}]){
  const f=fixture(override);assert.equal(await render(f),'original-result');await render(f,'home');assert.equal(f.state.calls.length,0);assert.equal(f.document.getElementById('clinic-practice-home'),undefined);assert.equal(f.document.getElementById('clinic-practice-result'),undefined);
 }
 const off=fixture();off.state.enabled=false;await render(off);assert.equal(off.state.calls.length,1,'one read discovers server stop');await render(off,'home');await render(off);assert.equal(off.state.calls.length,1,'known stopped session makes no further calls');assert.equal(off.document.getElementById('clinic-practice-result'),undefined);
 for(const exam of [{category:'homework',clinic_week:'11월 1주차'},{category:'school',clinic_week:''},{category:'school'},{category:'mock',clinic_week:'11월 1주차'}]){const f=fixture({sExamData:exam});await render(f);assert.equal(f.state.calls.length,0);}
 const f=fixture();await render(f);let card=f.document.getElementById('clinic-practice-result');assert.ok(card);assert.match(card.innerHTML,/비슷한 유형 1문제/);assert.match(card.innerHTML,/연습 · 점수에 반영되지 않아요/);assert.equal(f.state.calls[0].p_payload.exam_id,'exam');
 assert.ok(f.document.body.children.indexOf(card)<f.document.body.children.indexOf(f.document.getElementById('s-res-wrong-list')));
 await render(f,'home');assert.ok(f.document.getElementById('clinic-practice-home'));assert.equal(f.state.calls.at(-1).p_payload.exam_id,undefined);
 const failed=fixture();failed.state.fail=true;await render(failed);assert.equal(failed.state.resultCalls,1);assert.equal(failed.document.getElementById('s-res-wrong-list').innerHTML,'<p>EXISTING_RESULT</p>');assert.equal(failed.document.getElementById('clinic-practice-result'),undefined);
 console.log('PASS: pad/preview/role/login guards, stopped-session silence, school/week-only result cards, home placement, RPC failure preserves results');
 const unusable=fixture();unusable.state.items=[{id:'empty',text:'윗글의 내용과 일치하지 않는 것은?',passage:'',choices:[]}];await render(unusable);await render(unusable,'home');assert.equal(unusable.document.getElementById('clinic-practice-result'),undefined);assert.equal(unusable.document.getElementById('clinic-practice-home'),undefined);
 const malicious='<script>alert(1)</script> & "\'';
 f.state.items=[{id:'evil',exam_name:malicious,num:malicious,text:malicious,passage:'① A ② B ③ C ④ D ⑤ E '+malicious,choices:[],images:[{data:'data:image/png;base64,AAAA',alt:malicious},{data:'data:image/jpeg;base64,AAAA',alt:'JPEG'},{data:'https://bad.example/private'},{data:'data:image/svg+xml;base64,AAAA'}]}];
 const opener=card.querySelector('button');opener.focus();await opener.onclick({currentTarget:opener});
 let dialog=f.document.getElementById('clinic-practice-dialog'),content=dialog.querySelector('[data-question]');assert.ok(dialog.open);assert.equal(dialog.attrs['aria-labelledby'],'clinic-practice-title');assert.equal(f.document.activeElement.tagName,'H2');
 assert.ok(!content.innerHTML.includes('<script>'));assert.ok(content.innerHTML.includes('&lt;script&gt;'));assert.ok(content.innerHTML.includes('&amp;'));assert.ok(content.innerHTML.includes('&quot;'));assert.ok(content.innerHTML.includes('&#39;'));
 assert.equal(content.querySelectorAll('img').length,2);assert.ok(!content.innerHTML.includes('https://'));assert.ok(!content.innerHTML.includes('svg+xml'));assert.equal(content.querySelectorAll('input').length,5);assert.match(content.innerHTML,/① A ② B/);assert.equal(content.querySelectorAll('fieldset').length,1);
 assert.ok(!content.innerHTML.includes('제출 결과'));assert.ok(!content.innerHTML.includes('해설'));
 content.querySelectorAll('input')[1].checked=true;const form=content.querySelector('[data-answer]');await form.onsubmit({preventDefault(){}});
 assert.equal(f.state.calls.at(-1).p_action,'submit');assert.deepEqual(JSON.parse(JSON.stringify(f.state.calls.at(-1).p_payload)),{id:'evil',answer:'2'});
 assert.match(content.innerHTML,/정답 3번/);assert.match(content.innerHTML,/해설 &lt;script&gt; &amp; &quot;/);assert.equal(content.querySelectorAll('input').length,5);assert.equal(content.querySelector('fieldset').attrs.disabled,'');
 content.querySelector('[data-report]').onclick();const report=content.querySelector('[data-report-form]');assert.equal(report.hidden,false);assert.equal(f.document.activeElement.tagName,'TEXTAREA');report.querySelector('textarea').value='문항 확인';await report.onsubmit({preventDefault(){}});assert.equal(f.state.calls.at(-1).p_action,'report');assert.match(dialog.querySelector('[data-status]').textContent,/저장/);
 content.querySelector('[data-next]').onclick();await flush();assert.equal(f.document.getElementById('clinic-practice-dialog'),undefined);assert.equal(f.document.getElementById('clinic-practice-home'),undefined,'all answered means no home card');assert.equal(f.document.activeElement,f.document.getElementById('clinic-practice-result').querySelector('button'),'return focus survives card refresh');
 const escaped=f.document.getElementById('clinic-practice-result').querySelector('button');await escaped.onclick({currentTarget:escaped});dialog=f.document.getElementById('clinic-practice-dialog');dialog.close();await flush();assert.equal(f.document.getElementById('clinic-practice-dialog'),undefined,'native close path cleanup');
 assert.match(source,/min-height:44px/);assert.match(source,/aria-live="polite"/);assert.ok(!/onkeydown|preventDefault[^\n]*Escape/.test(source),'does not cancel native Escape');
 console.log('PASS: escaped strings and raster images, unchanged embedded choices with five answer radios, server submit only, post-submit explanation/report, dialog focus/close and 44px styles (fake DOM)');
 const race=fixture();let release;race.state.gate=new Promise(r=>release=r);race.c.renderSExamResultView();race.c.session={id:'other',role:'student'};race.c.weeklyLogin={id:'other',role:'student',pw:'synthetic'};release();await flush();assert.equal(race.document.getElementById('clinic-practice-result'),undefined);
 const logout=fixture();await render(logout);let button=logout.document.getElementById('clinic-practice-result').querySelector('button');await button.onclick({currentTarget:button});logout.c.doLogout();await flush();assert.equal(logout.document.getElementById('clinic-practice-dialog'),undefined);assert.equal(logout.document.getElementById('clinic-practice-result'),undefined);
 console.log('PASS: stale login responses ignored and logout clears practice content');
 const retry=fixture();retry.state.pending=9;retry.state.failAfter=1;await render(retry);await runTimers(retry);
 assert.equal(retry.state.allocationCalls,4,'one successful batch then three failed attempts');assert.equal(retry.state.pending,6);
 let retryCard=retry.document.getElementById('clinic-practice-result');assert.match(retryCard.innerHTML,/비슷한 유형 4문제/,'existing and first committed batch remain visible');
 assert.match(retryCard.querySelector('[data-prepare-status]').textContent,/지연/);assert.equal(retryCard.querySelector('[data-prepare-retry]').hidden,false);assert.match(retryCard.innerHTML,/잠시 후 다시/);
 assert.equal(retry.document.getElementById('s-res-wrong-list').innerHTML,'<p>EXISTING_RESULT</p>');await render(retry);await runTimers(retry);assert.equal(retry.state.allocationCalls,4,'rerender cannot restart exhausted retries');
 retry.state.failAfter=undefined;retryCard=retry.document.getElementById('clinic-practice-result');retryCard.querySelector('[data-prepare-retry]').onclick();await runTimers(retry);
 assert.equal(retry.state.pending,0);assert.equal(retry.state.allocationCalls,6);assert.match(retry.document.getElementById('clinic-practice-result').innerHTML,/비슷한 유형 10문제/);
 assert.equal(retry.document.getElementById('clinic-practice-result').querySelector('[data-prepare-retry]').hidden,true);
 const emptyRetry=fixture();emptyRetry.state.items=[];emptyRetry.state.pending=2;emptyRetry.state.failAfter=0;await render(emptyRetry);await runTimers(emptyRetry);
 assert.equal(emptyRetry.state.allocationCalls,3);assert.equal(emptyRetry.document.getElementById('clinic-practice-result').querySelector('[data-prepare-retry]').hidden,false);
 const capped=fixture();capped.state.pending=30;capped.state.stuck=true;await render(capped);await runTimers(capped);assert.equal(capped.state.allocationCalls,8);assert.match(capped.document.getElementById('clinic-practice-result').querySelector('[data-prepare-status]').textContent,/이어/);
 const stopRetry=fixture();stopRetry.state.pending=9;await render(stopRetry);const callsBeforeLogout=stopRetry.state.allocationCalls;stopRetry.c.doLogout();await runTimers(stopRetry);assert.equal(stopRetry.state.allocationCalls,callsBeforeLogout);
 console.log('PASS: separate allocation/list, 57014 retains committed cards, 3-failure and 8-call caps, notice/manual retry resumes, empty-pending guidance and logout stops retries');
 const t=fixture(),teacherCalls=[];let confirmed=false;
 for(const tag of ['nav','main']){const el=t.document.createElement(tag);if(tag==='main')el.id='main';t.document.body.append(el);}
 const menu=t.document.body.querySelector('nav');for(let n=0;n<14;n++)menu.append(t.document.createElement('button'));
 t.document.querySelector=s=>t.document.body.querySelector(s);t.document.querySelectorAll=s=>t.document.body.querySelectorAll(s);
 const teacherSummary={weeks:['11월 1주차'],rows:[{student_name:malicious,exam_name:'평가',wrong:6,assigned:2,pending:3,skipped:1,answered:1,correct:0,skip_reasons:{no_mapping:1,no_homework_candidate:1}}],questions:[{content_key:'text-hash',text:malicious,students:2}]};
 Object.assign(t.c,{$:id=>t.document.getElementById(id),E:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),heading:()=>'',titles:{},navigate:async()=>{},syncBlocked:()=>false,action:fn=>fn(),page:'clinic-practice',confirm:message=>{assert.match(message,/2명, 2개 배정/);return confirmed;},api:async(path,p)=>{
  assert.equal(path,'/api/clinic-practice');teacherCalls.push(p);if(p.action==='summary')return teacherSummary;if(p.action==='reports')return [{id:'report',content_key:'text-hash',student_name:malicious,text:'문항',reason:malicious,status:'open'}];if(p.action==='withdraw')return {students:2,items:2,withdrawn:p.payload.dry_run?0:2};if(p.action==='report_resolve')return {resolved:true};assert.fail('unexpected teacher action');
 }});
 vm.runInContext(fs.readFileSync('odap/clinic-practice-teacher.js','utf8'),t.c);await t.c.clinicPracticeTeacherPage();
 assert.equal(menu.children[2].dataset.page,'clinic-practice','new menu is third, not below the fold');
 const css=fs.readFileSync('odap/app.css','utf8');assert.match(css,/@media screen and \(min-width:721px\)\{\.sidebar\{overflow-y:auto\}\.sidebar>\*\{flex-shrink:0\}\}/,'desktop navigation must scroll');
 assert.ok(t.document.getElementById('cp-summary').innerHTML.includes('&lt;script&gt;'));assert.ok(!t.document.getElementById('cp-reports').innerHTML.includes('<script>'));assert.match(t.document.getElementById('cp-status').textContent,/2개 배정 \/ 1개 풀이/);
 assert.match(t.document.getElementById('cp-summary').innerHTML,/<th>배정 대기<\/th>/);assert.match(t.document.getElementById('cp-status').textContent,/3개 배정 대기/);
 await t.document.querySelector('[data-withdraw]').onclick();assert.equal(teacherCalls.at(-1).payload.dry_run,true,'cancel never mutates');
 confirmed=true;await t.document.querySelector('[data-withdraw]').onclick();const withdrawal=teacherCalls.find(p=>p.action==='withdraw'&&!p.payload.dry_run);assert.equal(withdrawal.payload.content_key,'text-hash');assert.equal(withdrawal.payload.expected_items,2);
 await t.document.querySelector('[data-resolve]').onclick();assert.ok(teacherCalls.some(p=>p.action==='report_resolve'&&p.payload.id==='report'));
 console.log('PASS: teacher menu rendering/escaping, totals and skip reasons, cancelled withdrawal is read-only, confirmed whole-question withdrawal, report resolution');
 console.log('PASS: missing choices hide cards; teacher menu inserted third and desktop overflow CSS present (no real browser layout test)');
 for(const file of ['clinic-practice.js','odap/clinic-practice-teacher.js','odap/cloud.js'])new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
 const index=fs.readFileSync('index.html','utf8'),sw=fs.readFileSync('sw.js','utf8'),teacher=fs.readFileSync('odap/clinic-practice-teacher.js','utf8');
 assert.match(index,/clinic-practice\.js\?v=20261105-similar/);assert.match(sw,/kukeo-wang-v(19[5-9]|[2-9]\d\d)-/);assert.match(sw,/\/lecture\/clinic-practice\.js\?v=20261105-similar/);
 assert.match(teacher,/dry_run:true/);assert.match(teacher,/confirm\(/);assert.match(teacher,/expected_items:impact.items/);assert.match(teacher,/no_homework_candidate/);
 console.log('PASS: student/teacher script syntax, entry/cache wiring, teacher withdrawal preview/confirmation and skip reasons');
})().catch(e=>{console.error(e);process.exitCode=1;});
