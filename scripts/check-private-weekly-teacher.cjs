const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const packet={schema:1,title:'Private <script>bad()</script>',items:Array.from({length:40},(_,i)=>({id:'q'+i,type:i<20?'mcq':'ox',text:(i<20?'MCQ ':'OX ONLY ')+i+' <script>bad()</script>',passage:'source <img src=x onerror=bad()>',choices:i<20?['one','two','three','four','five']:undefined,answer:i<20?'3':'O',explanation:'EXPLANATION '+i+' <script>bad()</script>',evidence:[]}))};
packet.items[0].images=[{data:'data:image/png;base64,YQ==',alt:'" onerror="bad()'},{data:'data:image/svg+xml;base64,YQ=='}];
function harness(){
 const elements=new Map(),handlers={},calls=[];let responder;
 const element=id=>{if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',innerHTML:'',textContent:'',files:[],isConnected:true,append(){},querySelectorAll:()=>[]});return elements.get(id);};
 element('student-picker');element('main').querySelectorAll=()=>[...elements.values()].filter(e=>e.id.startsWith('pw-')||e.id==='student-picker');
 const sandbox={structuredClone,URL,sid:'student-a',students:[{id:'student-a',name:'Student <A>',school:'School A'},{id:'student-b',school:'School B'}],titles:{},page:'private-weekly',charts:[],weeklyFeedbackBusy:false,homeworkBusy:false,
  $:element,E:escape,getStudents:async()=>{},heading:()=>'',studentPicker:()=>'',wireStudent:()=>{},on:(id,fn)=>handlers[id]=fn,action:fn=>fn(),navigate:async()=>{},syncBlocked:()=>false,toast:()=>{},window:{location:{href:'https://example.test/odap/'}},
  document:{createElement:()=>({dataset:{},isConnected:true,querySelectorAll:()=>[]}),querySelector:()=>({append(){}}),querySelectorAll:()=>[]},api:async(_path,request)=>{calls.push(request);return responder(request);}};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync('odap/private-weekly-teacher.js','utf8'),sandbox);
 return{element,handlers,calls,sandbox,set responder(v){responder=v;}};
}
(async()=>{
 const h=harness();let pause=false,release,fail=false,state='draft',reviewed=false;
 h.responder=async r=>{
  if(r.action==='list')return pause?new Promise(resolve=>{release=()=>resolve([]);}):[];
  if(r.action==='create')return{id:'assignment-a',status:'draft'};
  if(r.action==='generate_ox')return{id:'assignment-a',status:'draft'};
  if(r.action==='review_publish'){if(fail)throw Error('Claude rejected ambiguous item');state='published';reviewed=true;return{id:'assignment-a',status:'published'};}
  if(r.action==='open')return{id:'assignment-a',status:state,week_start:'2026-10-26',packet:{...packet,...(reviewed?{review:{provider:'anthropic',state:'passed'}}:{})}};
  throw Error('Unexpected '+r.action);
 };
 await h.sandbox.privateWeeklyTeacherPage();
 h.element('pw-file').files=[{text:async()=>JSON.stringify({packet:{...packet,review:{provider:'anthropic',state:'passed'}}})}];
 await h.handlers['pw-preview']();assert.equal(h.element('pw-print').disabled,true,'untrusted file cannot assert review');
 assert.equal(h.element('pw-create').disabled,false);assert.ok(!h.element('pw-preview-body').innerHTML.includes('<script>'));
 h.element('pw-week').value='2026-10-26';pause=true;
 const running=h.handlers['pw-create']();assert.equal(h.element('student-picker').disabled,true);
 h.sandbox.sid='student-b';h.element('pw-week').value='2026-11-02';
 await h.handlers['pw-create']();release();await running;
 const create=h.calls.find(c=>c.action==='create');assert.equal(create.payload.student_id,'student-a');assert.equal(create.payload.week_start,'2026-10-26');assert.equal(create.payload.school,'School A');
 assert.deepEqual(h.calls.filter(c=>['create','generate_ox','review_publish'].includes(c.action)).map(c=>c.action),['create','generate_ox','review_publish']);
 assert.ok(!h.calls.some(c=>['approve','publish'].includes(c.action)),'no human confirmation bypass');
 assert.equal(h.element('pw-print').disabled,false);assert.equal(h.element('pw-publish').disabled,true);assert.equal(h.element('student-picker').disabled,false);
 assert.match(h.element('pw-status').textContent,/OX 20문항 게시 완료/);
 const reviewedPacket={...packet,review:{provider:'anthropic',state:'passed'}};
 const worksheet=h.sandbox.privateWeeklyPrintDocument(reviewedPacket,'<b>student</b>','2026-10-26');
 assert.equal((worksheet.match(/<article>/g)||[]).length,20);assert.ok(!worksheet.includes('OX ONLY'));assert.ok(!worksheet.includes('EXPLANATION'));assert.ok(!worksheet.includes('정답 3'));assert.ok(!worksheet.includes('<script>'));assert.ok(!worksheet.includes('image/svg'));assert.ok(worksheet.includes('image/png'));assert.ok(worksheet.includes('&lt;b&gt;student&lt;/b&gt;'));
 const key=h.sandbox.privateWeeklyPrintDocument(reviewedPacket,'student','2026-10-26',true);
 assert.equal((key.match(/<article>/g)||[]).length,20);assert.ok(key.includes('정답 3'));assert.ok(key.includes('EXPLANATION 19'));assert.ok(!key.includes('EXPLANATION 20'));assert.ok(!key.includes('<script>'));
 assert.throws(()=>h.sandbox.privateWeeklyPrintDocument(packet,'student','week'),/Claude/);
 assert.throws(()=>h.sandbox.privateWeeklyPrintDocument({...packet,review:{provider:'teacher',state:'passed'}},'student','week'),/Claude/);
 assert.throws(()=>h.sandbox.privateWeeklyPrintDocument({...packet,review:{provider:'anthropic',state:'pending'}},'student','week'),/Claude/);
 // A fresh run that fails review stays unprintable and retryable, with no success claim.
 const failed=harness();failed.responder=async r=>r.action==='list'?[]:r.action==='create'?{id:'failed',status:'draft'}:r.action==='generate_ox'?{}:r.action==='review_publish'?Promise.reject(Error('rejected')):{id:'failed',status:'draft',week_start:'2026-10-26',packet};
 await failed.sandbox.privateWeeklyTeacherPage();failed.element('pw-file').files=[{text:async()=>JSON.stringify({packet})}];await failed.handlers['pw-preview']();failed.element('pw-week').value='2026-10-26';await assert.rejects(()=>failed.handlers['pw-create'](),/rejected/);
 assert.equal(failed.element('pw-print').disabled,true);assert.equal(failed.element('pw-publish').disabled,false);assert.match(failed.element('pw-status').textContent,/미완료/);
 console.log('PASS teacher: generated OX → Claude review → OX publish, snapshot locks, untrusted review rejected, fail-closed retry, MCQ-only worksheet and separate answer key');
})().catch(e=>{console.error(e);process.exitCode=1;});


