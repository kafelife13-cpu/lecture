process.env.TZ='Asia/Seoul';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),source=fs.readFileSync(path.join(root,'consultation.js'),'utf8');
function section(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert(a>=0&&b>a,`source section: ${start}`);return text.slice(a,b);}
const notice=(id,extra={})=>({id,title:'주간 안내',content:'합성 안내',created_at:'2026-11-01T00:00:00+09:00',...extra});
function fixture({items=[notice('new'),notice('old',{created_at:'2026-10-31T23:59:59+09:00'})],storage=new Map(),reads=[],preview=false,pad=false,fail=false,storageBlocked=false}={}){
 const nodes=new Map(),writes=[],activities=[],errors=[],queries=[],updates=[],storageWrites=[];
 let clock=Date.parse('2026-11-05T12:00:00+09:00');
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 function element(){return {attrs:{},events:{},children:[],style:{},innerHTML:'',classList:{add(){}},button:{},
  setAttribute(k,v){this.attrs[k]=v;},querySelector(){return this.button;},addEventListener(k,f){this.events[k]=f;},
  appendChild(e){this.children.push(e);},after(e){nodes.set(e.id,e);},remove(){nodes.delete(this.id);}};}
 const document={getElementById:id=>nodes.get(id),querySelector:()=>c.otherModal||null,createElement:element,body:{append(el){nodes.set(el.id,el);}}};
 for(const id of ['an-view-title','an-view-date','an-view-image','an-view-content','modal-announce-view','s-announce-list','s-clinic-notice-list']){const el=element();el.id=id;nodes.set(id,el);}
 const c={Date:Clock,document,console:{error:(...args)=>errors.push(args)},session:{id:'synthetic-student',role:'student',school_id:'school-a',group_id:'synthetic-group'},
  padMode:pad,studentPreviewMode:preview,announceDb:{items,reads},dialog:null,studentPushPromptShown:false,navigator:{},
  localStorage:{getItem(key){if(storageBlocked)throw Error('storage blocked');return storage.get(key)||null;},setItem(key,value){if(storageBlocked)throw Error('storage blocked');storageWrites.push(key);storage.set(key,value);}},
  showModal:el=>el.open=true,dismissModal:el=>el?.remove(),
  sendStudentActivity:(...args)=>activities.push(args),updateAnnounceBadge:()=>updates.push('badge'),renderHomeAnnounceBanner:()=>updates.push('banner'),
  studentPushInfo:()=>({}),showStudentPushPrompt:()=>updates.push('push'),
  esc:s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))};
 c.window=c;
 c.sb={from(table){assert(['announcements','announcement_reads'].includes(table),'no other tables');const filters=[];queries.push({table,filters});return {
  select(){return this;},order(){return this;},eq(...args){filters.push(args);return this;},
  then(resolve,reject){return Promise.resolve({data:table==='announcements'?items:reads.filter(r=>filters.every(([k,v])=>r[k]===v))}).then(resolve,reject);},
  async upsert(row){assert.equal(table,'announcement_reads');writes.push(row);return c.saveResult?await c.saveResult:fail?{error:{message:'synthetic save failure'}}:{error:null};},
  delete(){assert.fail('announcement/read deletion is forbidden');}
 };}};
 vm.createContext(c);
 for(const [start,end] of [
  ['function weekMonday(value)','function sameClinicWeek'],
  ['function announceImageUrls(a)','function announceReadCount'],
  ['function myAnnounceItems()','function updateAnnounceBadge()'],
  ['async function updatePushBtnState()','window.addEventListener(\'focus\'']
 ])vm.runInContext(section(html,start,end),c);
 vm.runInContext(section(source,' window.isExamConsultationNoticeStudent=',' function entry(){'),c);
 const popup=()=>nodes.get('exam-consultation-notice');
 return {c,nodes,writes,activities,errors,queries,updates,storage,storageWrites,popup,setClock:value=>clock=Date.parse(value),async dismiss(method='button'){
  const el=popup();assert(el?.open,'popup open before dismissal');
  if(method==='cancel'){let prevented=false;el.events.cancel({preventDefault(){prevented=true;}});assert(prevented);}else el.button.onclick();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(popup(),undefined,'dismiss immediately');
 }};
}
(async()=>{
 let f=fixture({items:[notice('other-school',{school_id:'school-b'}),notice('latest',{school_id:'school-a'}),notice('earlier')]});
 assert.equal(f.c.currentHomeworkNotice().id,'latest');f.c.showEntryNotice();assert(f.popup());await f.dismiss();
 f.c.showEntryNotice();assert.equal(f.popup(),undefined,'latest read does not expose older unread notice');
 f=fixture({items:[notice('latest'),notice('earlier')],reads:[{announcement_id:'latest',student_id:'synthetic-student'}]});
 f.c.showEntryNotice();assert.equal(f.popup(),undefined);assert.equal(f.c.currentHomeworkNotice().id,'latest');
 console.log('PASS 1: latest eligible notice only; read latest never falls back; other schools excluded');

 for(const method of ['button','cancel']){
  f=fixture();f.c.showEntryNotice();const el=f.popup();await f.dismiss(method);el.button.onclick();
  f.c.showEntryNotice();assert.equal(f.popup(),undefined);assert.equal(f.writes.length,1);assert.equal(f.writes[0].student_id,'synthetic-student');
  assert.equal(f.c.isAnnounceRead('new'),true);assert.equal(f.activities.length,0);assert(f.updates.includes('badge'));
  assert.equal(f.storage.get('homeworkPopupSeen:synthetic-student:new'),'1');
  const reload=fixture({storage:f.storage});reload.c.showEntryNotice();assert.equal(reload.popup(),undefined,'device marker survives reload without DB receipt');
  const otherDevice=fixture({reads:f.c.announceDb.reads});otherDevice.c.showEntryNotice();assert.equal(otherDevice.popup(),undefined,'server receipt suppresses another device');
  const otherStudent=fixture({storage:f.storage});otherStudent.c.session.id='synthetic-other';otherStudent.c.showEntryNotice();assert(otherStudent.popup());
 }
 f=fixture({fail:true});f.c.showEntryNotice();await f.dismiss();assert.equal(f.c.isAnnounceRead('new'),false);assert.equal(f.updates.length,0);assert.equal(f.errors.length,1);
 f.c.showEntryNotice();assert.equal(f.popup(),undefined);const failedReload=fixture({storage:f.storage});failedReload.c.showEntryNotice();assert.equal(failedReload.popup(),undefined);
 f=fixture({storageBlocked:true});f.c.showEntryNotice();await f.dismiss();f.c.announceDb.reads=[];f.c.showEntryNotice();assert.equal(f.popup(),undefined,'memory survives blocked storage');
 f=fixture();let complete;f.c.saveResult=new Promise(resolve=>complete=resolve);
 const pending=f.c.recordAnnounceRead(f.c.announceDb.items[0],{activity:true});await f.c.recordAnnounceRead(f.c.announceDb.items[0],{activity:true});assert.equal(f.writes.length,1);
 complete({error:null});await pending;assert.equal(f.activities.length,1);
 f=fixture();f.c.saveResult=Promise.reject(Error('synthetic network failure'));await f.c.recordAnnounceRead(f.c.announceDb.items[0],{activity:true});assert.equal(f.c.announceDb.reads.length,0);assert.equal(f.updates.length,0);
 console.log('PASS 2: button/Esc, reload, own-ID single write, silent activity, failures and blocked storage');

 f=fixture({pad:true});f.c.showEntryNotice();assert.equal(f.popup(),undefined);await f.c.openAnnounceView('new');assert.equal(f.writes.length,0);assert.equal(f.storageWrites.length,0);
 f=fixture({preview:true});f.c.showEntryNotice();assert(f.popup());await f.dismiss();await f.c.openAnnounceView('new');assert.equal(f.writes.length,0);assert.equal(f.storageWrites.length,0);
 f=fixture();f.c.session.role='teacher';f.c.showEntryNotice();await f.c.openAnnounceView('new');assert.equal(f.popup(),undefined);assert.equal(f.writes.length,0);
 f=fixture();await f.c.openAnnounceView('new');assert.equal(f.activities.length,1);assert.equal(f.writes.length,1);
 f=fixture({fail:true});await f.c.openAnnounceView('new');assert.equal(f.activities.length,0);assert.equal(f.c.announceDb.reads.length,0);
 console.log('PASS 2 modes: pad hidden; preview visible; pad/preview detail and popup cannot persist');

 f=fixture();const original=JSON.stringify(f.c.announceDb.items);f.c.showEntryNotice();await f.dismiss();f.c.renderSAnnounceList();assert.match(f.nodes.get('s-announce-list').innerHTML,/openAnnounceView\('old'\)/);assert.equal(JSON.stringify(f.c.announceDb.items),original);assert.equal(f.c.announceDb.reads.length,1);
 console.log('PASS 3: past notices remain in list; no announcement/read deletion calls');

 f=fixture({items:[notice('sunday'),notice('saturday',{created_at:'2026-10-31T23:59:59+09:00'})]});
 assert.equal(f.c.isHomeworkNotice(f.c.announceDb.items[0]),true);assert.equal(f.c.isHomeworkNotice(f.c.announceDb.items[1]),false);
 f.setClock('2026-11-02T00:00:00+09:00');assert.equal(f.c.currentHomeworkNotice().id,'sunday');
 f.setClock('2026-11-08T00:00:00+09:00');assert.equal(f.c.currentHomeworkNotice().id,'sunday','prior week still eligible on Sunday');
 f.c.announceDb.items.unshift(notice('next-sunday',{created_at:'2026-11-08T00:00:00+09:00'}));assert.equal(f.c.currentHomeworkNotice().id,'next-sunday');
 f.setClock('2026-11-09T00:00:00+09:00');assert.equal(f.c.isHomeworkNotice(f.c.announceDb.items[1]),false);assert.equal(f.c.currentHomeworkNotice().id,'next-sunday');
 f.c.announceDb.items.shift();assert.equal(f.c.currentHomeworkNotice(),null);
 assert.equal(f.c.isHomeworkNotice(notice('future',{created_at:'2027-01-01T00:00:00+09:00'})),true,'no end boundary');
 console.log('PASS 4: Sunday inclusive, Saturday excluded, Monday carryover, next Sunday replacement/Monday expiry');

 f=fixture();assert.equal(f.c.isHomeworkNotice(notice('general',{notice_kind:'general'})),true);assert.equal(f.c.isHomeworkNotice(notice('legacy')),true);
 assert.equal(f.c.isHomeworkNotice(notice('clinic',{title:'과제 숙제',notice_kind:'clinic'})),false);
 for(const created_at of [undefined,'','bad-date'])assert.equal(f.c.isHomeworkNotice(notice('invalid',{created_at})),false);
 f.c.announceDb.items=[notice('clinic',{title:'과제',notice_kind:'clinic'}),notice('invalid',{created_at:undefined}),notice('general')];f.c.showEntryNotice();assert(f.popup());assert.equal(f.c.currentHomeworkNotice().id,'general');
 console.log('PASS 5: general/missing kind without keywords; clinic and invalid/missing dates excluded');

 f=fixture({items:[notice('an_mock_score_202609'),notice('an_1792925427850'),notice('allowed')]});f.c.session.group_id='hanbaek_wed_1800';assert.equal(f.c.currentHomeworkNotice().id,'allowed');f.c.session.group_id='synthetic-weekend';assert.equal(f.c.currentHomeworkNotice().id,'an_1792925427850');
 console.log('PASS 6: retired mock score and Wednesday-group exclusions preserved');

 for(const selector of ['.modal-bg.show','dialog[open]']){f=fixture();f.c.document.querySelector=s=>{assert.equal(s,'.modal-bg.show,dialog[open]');return {selector};};f.c.showEntryNotice();assert.equal(f.popup(),undefined);}
 f=fixture();f.c.dialog={};f.c.showEntryNotice();assert.equal(f.popup(),undefined);f.c.dialog=null;f.c.showEntryNotice();assert(f.popup());
 await f.c.updatePushBtnState();assert.equal(f.c.studentPushPromptShown,false);assert(!f.updates.includes('push'));
 delete f.popup().open;await f.c.updatePushBtnState();assert.equal(f.c.studentPushPromptShown,false,'fallback browser without dialog.open still defers push');f.popup().open=true;
 await f.dismiss();await f.c.updatePushBtnState();assert.equal(f.c.studentPushPromptShown,true);assert(f.updates.includes('push'));
 console.log('PASS 7: existing modal/dialog blocks popup; push deferred without consuming shown flag');

 f=fixture({items:[notice('unsafe',{title:'<img onerror="bad()"> & title',content:'<script>bad()</script> https://example.invalid/guide.pdf?q=1&x=2',image_urls:JSON.stringify(['https://example.invalid/a.png','http://example.invalid/b.png','javascript:bad()','data:image/png,bad'])})]});
 f.c.showEntryNotice();const el=f.popup();assert.equal(el.attrs['aria-labelledby'],'homework-entry-title');assert.equal(el.attrs['aria-describedby'],'homework-entry-content');assert.match(el.innerHTML,/<h2 id="homework-entry-title" tabindex="-1" autofocus>/);assert.match(el.innerHTML,/id="homework-entry-content"/);assert.equal(typeof el.events.cancel,'function');
 assert.match(el.innerHTML,/&lt;img onerror=&quot;bad\(\)&quot;&gt; &amp; title/);assert.match(el.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(el.innerHTML,/<script>|javascript:|data:image/);assert.equal((el.innerHTML.match(/<img /g)||[]).length,2);assert.match(el.innerHTML,/alt="과제 안내 첨부 자료"/);assert.match(el.innerHTML,/href="https:\/\/example.invalid\/guide.pdf\?q=1&amp;x=2" target="_blank" rel="noopener"/);
 console.log('PASS 8 / safety: ARIA, initial heading autofocus, cancel, escaped HTML, HTTP(S) images and PDF links');

 for(const mode of ['native','missing','throws']){
  f=fixture();const doc=f.c.document,create=doc.createElement;let overlays=0,nativeCalls=0;
  const control=props=>({tabIndex:0,getClientRects:()=>[{}],focus(){doc.activeElement=this;},...props});
  const heading=control({tabIndex:-1}),first=control({}),second=control({}),last=control({}),disabled=control({disabled:true}),hidden=control({hidden:true}),invisible=control({getClientRects:()=>[]});
  let controls=[heading,disabled,first,hidden,second,invisible,last];
  doc.createElement=tag=>{
   const node=create();node.parentNode={insertBefore(){}};node.append=()=>{};node.focus=()=>{doc.activeElement=node;};
   if(tag==='div')overlays++;
   node.querySelector=s=>s==='[data-homework-close]'?last:heading;
   node.querySelectorAll=()=>controls;
   node.addEventListener=function(k,fn){const previous=this.events[k];this.events[k]=previous?e=>{previous(e);fn(e);}:fn;};
   if(mode!=='missing')node.showModal=()=>{nativeCalls++;if(mode==='throws')throw Error('synthetic modal failure');node.open=true;heading.focus();};
   return node;
  };
  vm.runInContext(section(source,' function showModal(el)',' function close(){'),f.c);
  f.c.showEntryNotice();const popup=f.popup();assert.equal(doc.activeElement,heading,mode+' initial heading focus');
  assert.equal(nativeCalls,mode==='missing'?0:1);assert.equal(overlays,mode==='native'?0:1);
  function tab(from,shiftKey,to){
   doc.activeElement=from;const event={key:'Tab',shiftKey,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
   popup.events.keydown(event);assert.equal(event.defaultPrevented,true,mode+' prevents browser Tab escape');assert.equal(doc.activeElement,to,mode+' Tab cycle');
  }
  tab(heading,true,last);tab(heading,false,first);
  tab(first,false,second);tab(second,false,last);tab(last,false,first);
  tab(first,true,last);tab(last,true,second);tab(second,true,first);
  controls=[heading,last];tab(heading,true,last);tab(last,false,last);tab(last,true,last);
  controls=[heading,disabled,hidden,invisible];tab(heading,false,heading);tab(heading,true,heading);
  popup.events.keydown({key:'Enter',preventDefault(){assert.fail('non-Tab key intercepted');}});
 }
 console.log('PASS focus: native/missing/throws use real modal source; heading reverse Tab, both cycles, hidden/disabled exclusion, single/zero controls');

 f=fixture({reads:[{announcement_id:'new',student_id:'synthetic-student'},{announcement_id:'new',student_id:'synthetic-other'}]});await f.c.loadAnnounceData();assert.equal(f.c.announceDb.reads.length,1);assert.deepEqual(f.queries.find(q=>q.table==='announcement_reads').filters,[['student_id','synthetic-student']]);
 f.c.session={id:'synthetic-teacher',role:'teacher'};await f.c.loadAnnounceData();assert.equal(f.c.announceDb.reads.length,2);assert.deepEqual(f.queries.at(-1).filters,[]);
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');for(const script of ['consultation.js','student-sections.js']){assert(html.includes(script+'?v=20261105-homework-popup'));assert(sw.includes(script+'?v=20261105-homework-popup'));}assert(sw.includes("const CACHE_NAME = 'kukeo-wang-v183-homework-popup'"));
 console.log('PASS data/cache: student-scoped receipts, unchanged teacher scope, matching script versions and v183');
})().catch(e=>{console.error(e);process.exitCode=1;});
