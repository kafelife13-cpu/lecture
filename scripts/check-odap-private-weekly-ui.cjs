const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 const status={textContent:''};let form=null,buttons=[],contentHTML='',listHTML='';
 const content={get innerHTML(){return contentHTML;},set innerHTML(v){contentHTML=v;form=v.includes('<form ')?{onsubmit:null}:null;}};
 const list={get innerHTML(){return listHTML;},set innerHTML(v){listHTML=v;buttons=[...v.matchAll(/data-weekly="([^"]+)"/g)].map(m=>({dataset:{weekly:m[1]},disabled:false}));}};
 const root={set innerHTML(_v){contentHTML='';listHTML='';buttons=[];},querySelector:s=>s==='[role=status]'?status:s==='[data-content]'?content:s==='[data-list]'?list:s==='form'?form:null,querySelectorAll:s=>s==='[data-weekly]'?buttons:[]};
 const events={},calls=[];let responder;let answerValues={};
 const window={addEventListener:(name,fn)=>events[name]=fn};
 const sandbox={window,AbortSignal,FormData:class{get(key){return answerValues[key]??null;}},fetch:async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);return responder(body);}};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync('odap/private-weekly-student.js','utf8'),sandbox);
 return {window,root,status,calls,events,get buttons(){return buttons;},get form(){return form;},get html(){return contentHTML;},get listHTML(){return listHTML;},set responder(v){responder=v;},set answers(v){answerValues=v;}};
}
const ok=body=>({ok:true,status:200,json:async()=>body});
const bad=(message,status=400)=>({ok:false,status,json:async()=>({error:message})});
(async()=>{
 const packet={schema:1,title:'Synthetic <script>alert(1)</script>',items:Array.from({length:40},(_,i)=>({id:'q'+i,type:i<20?'mcq':'ox',text:'Question <'+i+'>',passage:'Passage & text',...(i<20?{choices:['A','B','C','D','E']}:{})}))};
 packet.items[0].images=[{data:'data:image/png;base64,YQ==',alt:'image " test'}];
 const rows=[{id:'assignment-a',week_start:'2026-10-26',title:packet.title,submitted_at:null}];
 const answers=Object.fromEntries(packet.items.map(q=>[q.id,q.type==='mcq'?'1':'O']));
 const attempt={submitted_at:'2026-10-28T00:00:00Z',correct:39,total:40,score:97.5,results:packet.items.map((q,i)=>({id:q.id,correct:i!==0,answer:q.type==='mcq'?'1':'O',explanation:'Explanation <b>literal</b>'}))};
 const h=harness();let submitted=false,failSubmit=true;
 h.answers=answers;
 h.responder=async body=>{
  if(body.action==='list')return ok(rows);
  if(body.action==='open')return ok({id:body.payload.id,week_start:'2026-10-26',status:'published',packet,attempt:submitted?attempt:null});
  if(body.action==='submit'){if(failSubmit)return bad('Synthetic temporary failure');submitted=true;return ok(attempt);}
  throw Error('Unexpected action');
 };
 await h.window.mountPrivateWeekly({id:'synthetic-student',pw:'test-only'},h.root);
 assert.equal(h.buttons.length,1);assert.ok(!h.listHTML.includes('<script>'));
 await h.buttons[0].onclick();assert.ok(h.form);assert.equal((h.html.match(/<fieldset/g)||[]).length,40);
 assert.equal((h.html.match(/type="radio"/g)||[]).length,140);assert.ok(h.html.includes('data:image/png;base64,YQ=='));
 assert.ok(!h.html.includes('<script>'));assert.ok(!h.html.includes('Explanation'));
 const submitter={disabled:false};
 await h.form.onsubmit({preventDefault(){},target:h.form,submitter});
 assert.equal(submitter.disabled,false);assert.match(h.status.textContent,/Synthetic temporary failure/);
 failSubmit=false;await h.form.onsubmit({preventDefault(){},target:h.form,submitter});
 assert.match(h.html,/39 \/ 40/);assert.ok(h.html.includes('&lt;b&gt;literal&lt;/b&gt;'));assert.ok(!h.html.includes('<form'));
 const payload=h.calls.find(c=>c.action==='submit').payload;assert.equal(Object.keys(payload.answers).length,40);assert.equal(Object.hasOwn(payload,'score'),false);assert.equal(payload.id,'assignment-a');
 await h.buttons[0].onclick();assert.ok(!h.form);assert.match(h.status.textContent,/이미 제출/);
 const failed=harness();failed.responder=async()=>bad('unavailable',404);await failed.window.mountPrivateWeekly({id:'synthetic-student',pw:'test-only'},failed.root);assert.match(failed.status.textContent,/서버를 준비/);
 const empty=harness();empty.responder=async()=>ok([]);await empty.window.mountPrivateWeekly({id:'synthetic-student',pw:'test-only'},empty.root);assert.match(empty.status.textContent,/아직 배정/);
 const race=harness();race.answers=answers;let resolveOpen,resolveSubmit,saved=false;
 race.responder=async body=>{
  if(body.action==='list')return ok([...rows,{...rows[0],id:'assignment-b'}]);
  if(body.action==='open'){
   if(saved)return ok({id:body.payload.id,packet,attempt});
   return new Promise(resolve=>{resolveOpen=()=>resolve(ok({id:body.payload.id,packet,attempt:null}));});
  }
  if(body.action==='submit')return new Promise(resolve=>{resolveSubmit=()=>{saved=true;resolve(bad('Lost submit response'));};});
 };
 await race.window.mountPrivateWeekly({id:'synthetic-student',pw:'test-only'},race.root);
 const opening=race.buttons[0].onclick();assert.ok(race.buttons.every(b=>b.disabled));
 await race.buttons[1].onclick();assert.equal(race.calls.filter(c=>c.action==='open').length,1);
 resolveOpen();await opening;assert.ok(race.buttons.every(b=>!b.disabled));
 const event={preventDefault(){},target:race.form,submitter:{disabled:false}};
 const submitting=race.form.onsubmit(event);await race.buttons[1].onclick();await race.form.onsubmit(event);
 assert.equal(race.calls.filter(c=>c.action==='submit').length,1);assert.equal(race.calls.at(-1).payload.id,'assignment-a');
 resolveSubmit();await submitting;assert.match(race.status.textContent,/결과를 복구/);assert.match(race.html,/39 \/ 40/);assert.ok(race.buttons.every(b=>!b.disabled));
 // Execute the teacher page: saving must use the selected student/week snapshot.
 const elements=new Map(),handlers={},teacherCalls=[];let pauseList=false,releaseList;
 const element=id=>{if(!elements.has(id))elements.set(id,{id,disabled:false,checked:false,value:'',innerHTML:'',textContent:'',dataset:{},files:[],isConnected:true,append(){},querySelectorAll:()=>[]});return elements.get(id);};
 element('main').querySelectorAll=()=>[...elements.values()].filter(e=>e.id.startsWith('pw-')||e.id==='student-picker');
 const teacher={structuredClone,URLSearchParams,sid:'student-a',students:[{id:'student-a',school:'Synthetic school'},{id:'student-b',school:'Other school'}],titles:{},page:'private-weekly',charts:[],weeklyFeedbackBusy:false,homeworkBusy:false,
  $:element,E:v=>String(v??''),getStudents:async()=>{},heading:()=>'',studentPicker:()=>'',wireStudent:()=>{},on:(id,fn)=>handlers[id]=fn,action:fn=>fn(),navigate:async()=>{},syncBlocked:()=>false,toast:()=>{},
  document:{createElement:()=>({dataset:{},isConnected:true,querySelectorAll:()=>[]}),querySelector:()=>({append(){}}),querySelectorAll:()=>[]},
  api:async(_path,request)=>{teacherCalls.push(request);if(request.action==='list'){if(pauseList)return new Promise(resolve=>{releaseList=()=>resolve([]);});return [];}if(request.action==='create')return {id:'teacher-assignment'};if(request.action==='approve')return {status:'approved'};throw Error('Unexpected teacher operation');}};
 vm.createContext(teacher);vm.runInContext(fs.readFileSync('odap/private-weekly-teacher.js','utf8'),teacher);
 await teacher.privateWeeklyTeacherPage();element('pw-file').files=[{text:async()=>JSON.stringify({packet})}];element('pw-confirm').checked=true;
 await handlers['pw-preview']();assert.equal(element('pw-confirm').checked,false);
 element('pw-confirm').checked=true;element('pw-week').value='2026-10-26';pauseList=true;
 const save=handlers['pw-create']();assert.equal(element('student-picker').disabled,true);
 teacher.sid='student-b';element('pw-week').value='2026-11-02';
 releaseList();await save;
 const creation=teacherCalls.find(c=>c.action==='create').payload;
 assert.equal(creation.student_id,'student-a');assert.equal(creation.week_start,'2026-10-26');assert.equal(creation.school,'Synthetic school');assert.equal(element('pw-publish').disabled,false);
 assert.equal(element('student-picker').disabled,false);
 console.log('PASS: student list → 40-item form → failed submit → result → saved result, escaped text, image preservation, empty/unavailable states');
})().catch(e=>{console.error(e);process.exitCode=1;});
