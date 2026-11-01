// npm install --no-save @electric-sql/pglite linkedom; node scripts/check-odap-review-archive.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const core=await import('../odap/review-archive-core.mjs'),{contentHash}=await import('../odap/private-weekly-core.mjs');
 const packet={schema:1,student_id:'a',school:'School',title:'Week review',week_start:'2026-10-26',week_label:'Week 1',originals:[{exam_id:'exam',exam_name:'Exam',num:1,text:'<img src=x onerror=alert(1)>',answer:'2',my_answer:'1',explanation:'Reason',file_id:'pdf',page:3}],practice:{count:15,file_id:'pdf'},files:[{id:'pdf',name:'test.pdf',data:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}]};
 assert.deepEqual(core.validateArchive(packet),packet);assert.equal(core.studentArchive(packet).student_id,undefined);
 const quizQuestion={text:'Choose <img src=x onerror=alert(1)>',passage:'A shared passage',choices:['one','two','three','four','five'],answer:'2',explanation:'Because two is correct',underline:['one'],table:[['A','B'],['C','D']]};
 const quizPacket=core.validateArchive({...packet,practice:{count:2,items:[quizQuestion,{...quizQuestion,text:'Select both',answer:'all:3,4'}]},originals:[{...packet.originals[0],quiz:quizQuestion}]});
 assert.equal(quizPacket.practice.items.length,2);assert.equal(core.studentArchive(quizPacket).originals[0].quiz.choices.length,5);
 for(const mutate of [p=>p.practice.items[0].answer='all:2,2',p=>p.practice.items[0].choices.pop(),p=>p.practice.count=1,p=>p.originals[0].quiz.answer='5',p=>p.practice.items[0].table=[['a',{}]]]){const bad=structuredClone(quizPacket);mutate(bad);assert.throws(()=>core.validateArchive(bad));}
 for(const mutate of [p=>p.week_start='2026-11-01',p=>p.files[0].data='javascript:bad',p=>p.originals[0].page=0,p=>p.originals.push(p.originals[0]),p=>p.practice.file_id='missing']){const bad=structuredClone(packet);mutate(bad);assert.throws(()=>core.validateArchive(bad));}
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create table users(id text,name text,role text,status text);insert into users values('t','Teacher','teacher','active'),('a','A','student','active'),('b','B','student','active'),('inactive','Inactive','student','inactive');create function authenticate_user(text,text,text) returns jsonb language sql as $$select to_jsonb(u) from users u where id=$1 and role=$3 and $2='test-only'$$;`);
  await db.exec(fs.readFileSync('supabase/odap/review-archive.sql','utf8'));
  const rpc=async(action,p={},id='t',role='teacher',pw='test-only')=>(await db.query('select odap_review_archive_rpc($1,$2,$3,$4,$5) d',[id,pw,role,action,JSON.stringify(p)])).rows[0].d;
  const meta={student_id:'a',school:'School',week_start:packet.week_start,week_label:packet.week_label,title:packet.title,drive_file_id:'file0',content_hash:await contentHash(packet),original_count:1,practice_count:15};
  const row=await rpc('create',meta);assert.equal((await rpc('create',meta)).id,row.id);
  await assert.rejects(()=>rpc('create',{...meta,content_hash:'b'.repeat(64)}));
  await assert.rejects(()=>rpc('get',{id:row.id},'a','student'));
  assert.deepEqual(await rpc('list',{},'a','student'),[]);
  await assert.rejects(()=>rpc('publish',{id:row.id,content_hash:meta.content_hash}));
  await rpc('publish',{id:row.id,content_hash:meta.content_hash,confirmed:true});
  assert.equal((await rpc('list',{student_id:'b'},'a','student')).length,1);
  assert.deepEqual(await rpc('list',{},'b','student'),[]);
  await assert.rejects(()=>rpc('get',{id:row.id},'b','student'));
  await assert.rejects(()=>rpc('profile',{},'inactive','student'));
  await assert.rejects(()=>rpc('profile',{},'a','student','wrong'));
  const next=await rpc('create',{...meta,week_start:'2026-11-02'});await rpc('publish',{id:next.id,content_hash:meta.content_hash,confirmed:true});
  const rows=await rpc('list',{},'a','student');assert.equal(rows.length,2);assert.equal(rows[0].week_start,'2026-11-02');assert.equal(rows[0].drive_file_id,undefined);assert.equal(rows[0].student_id,undefined);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>rpc('list'));await assert.rejects(()=>db.query('select * from odap_review_archive'));await db.exec('reset role');}
  await db.exec('set role service_role');
  let handler,driveReads=0;const files=new Map();
  const edge={...core,contentHash,crypto,TextEncoder,TextDecoder,Uint8Array,URL,AbortSignal,Request,Response,ReadableStream,atob,btoa,
   Deno:{env:{get:()=> 'synthetic'},serve:fn=>handler=fn},
   createClient:()=>({rpc:async(_name,a)=>{try{return {data:await rpc(a.p_action,a.p_payload,a.p_id,a.p_role,a.p_password)};}catch(e){return {error:{message:e.message}};}}}),
   boundedJSON:async body=>JSON.parse(await new Response(body).text()),
   drive:async(action,p)=>{if(action==='put'){const file_id='f'+files.size;files.set(file_id,structuredClone(p.content));return {file_id};}driveReads++;return {content:files.get(p.file_id)};}};
  vm.createContext(edge);vm.runInContext(require('node:module').stripTypeScriptTypes(fs.readFileSync('supabase/functions/odap-review-archive/index.ts','utf8').replace(/^import .*;\r?\n/gm,'')),edge);
  const call=async(action,payload,id='t',role='teacher')=>{const r=await handler(new Request('https://edge.example',{method:'POST',body:JSON.stringify({credentials:{id,role,pw:'test-only'},action,payload})}));assert.equal(r.headers.get('cache-control'),'no-store');return {status:r.status,body:await r.json()};};
  const made=await call('create',{packet:{...packet,student_id:'b',title:'Edge test'}});assert.equal(made.status,200);
  const eid=made.body.id;assert.equal((await call('publish',{id:eid,confirmed:true})).status,200);
  const before=driveReads;assert.equal((await call('open',{id:eid},'a','student')).status,400);assert.equal(driveReads,before);
  assert.equal((await call('publish',{id:eid,confirmed:true},'b','student')).status,403);
  const opened=await call('open',{id:eid},'b','student');assert.equal(opened.status,200);assert.equal(opened.body.packet.student_id,undefined);assert.equal(opened.body.packet.originals[0].answer,'2');
  assert.equal((await call('list',{student_id:'a'},'b','student')).body.length,1);
  files.get('f0').title='Tampered';assert.equal((await call('open',{id:eid},'b','student')).status,400);
 }finally{await db.close();}
 // Exercise the actual reader, including HTML escaping, page links and URL cleanup.
 const {parseHTML}=require('linkedom'),{window}=parseHTML('<html><body><div id="host"></div><div id="student"></div></body></html>');
 const made=[],revoked=[],listeners=new Map(),rendered=[];let serial=0,destroyed=0;
 Object.getPrototypeOf(window.document.createElement('canvas')).getContext=()=>({});
 const pdfLib={GlobalWorkerOptions:{},getDocument:options=>{assert.equal(options.isEvalSupported,false);return {destroy:async()=>{destroyed++;},promise:Promise.resolve({numPages:5,getPage:async n=>{rendered.push(n);return {getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve()})};}})};}};
 const ui={window:{'pdfjs-dist/build/pdf':pdfLib,addEventListener:(n,f)=>{if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f);},removeEventListener:(n,f)=>listeners.get(n)?.delete(f)},document:window.document,atob,Uint8Array,Blob,AbortSignal,URL:{createObjectURL:()=>{const u='blob:test'+(++serial);made.push(u);return u;},revokeObjectURL:u=>revoked.push(u)}};
 vm.createContext(ui);vm.runInContext(fs.readFileSync('odap/review-archive.js','utf8'),ui);
 const host=ui.document.getElementById('host'),reader=ui.window.reviewArchiveReader(host);reader.show(packet);
 assert.equal(host.querySelector('img'),null);assert.ok(host.textContent.includes('<img src=x'));
 await host.querySelector('[data-review-original]').onclick();assert.equal(rendered.at(-1),3);assert.equal(host.querySelector('canvas').getAttribute('aria-label'),'test.pdf 3쪽');
 await host.querySelector('[data-pdf-next]').onclick();assert.equal(rendered.at(-1),4);
 await host.querySelector('[data-review-practice]').onclick();assert.equal(rendered.at(-1),1);assert.equal(host.querySelector('[data-pdf-prev]').disabled,true);
 reader.clear();assert.deepEqual(revoked,made);assert.equal(host.children.length,0);assert.equal(destroyed,2);reader.dispose();
 // Repeatable mobile practice: answers hidden until check, multi-answer grading,
 // reload/continue, wrong-only retry, separate user/week keys and blocked storage.
 const stored=new Map();ui.localStorage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)};
 const qr=ui.window.reviewArchiveReader(host),key='review-quiz:v1:a:week1';
 const launch=()=>host.querySelector('[data-quiz-practice]').onclick();
 const choose=(...values)=>{host.querySelectorAll('input').forEach(el=>{el.checked=values.includes(el.value);if(el.checked)el.setAttribute('checked','');else el.removeAttribute('checked');});host.querySelector('input').onchange();};
 const submit=()=>host.querySelector('form').onsubmit({preventDefault(){}});
 qr.show(quizPacket,key);launch();assert.equal(host.querySelector('img'),null);assert.equal(host.querySelector('[data-quiz-check]').disabled,true);assert.equal(host.querySelector('.quiz-feedback').textContent,'');assert.equal(host.querySelectorAll('td').length,4);
 choose('1');submit();assert.ok(host.querySelector('.quiz-feedback').textContent.includes('다시 확인'));
 host.querySelector('[data-quiz-next]').onclick();choose('4','3');
 qr.clear();qr.show(quizPacket,key);launch();assert.ok(host.querySelector('h3[tabindex]').textContent.includes('Select both'));assert.equal(host.querySelectorAll('input:checked').length,2);
 submit();assert.ok(host.querySelector('.quiz-feedback').textContent.includes('정답이에요'));host.querySelector('[data-quiz-next]').onclick();assert.ok(host.querySelector('.quiz-score').textContent.includes('1 / 2'));
 host.querySelector('[data-quiz-retry]').onclick();assert.ok(host.querySelector('h3[tabindex]').textContent.includes('Choose'));assert.equal(host.querySelectorAll('input:checked').length,0);choose('2');submit();host.querySelector('[data-quiz-next]').onclick();assert.equal(host.querySelector('[data-quiz-retry]'),null);assert.ok(host.querySelector('.quiz-score').textContent.includes('1 / 1'));
 assert.ok(!stored.get(key+':practice').includes('passage'));assert.ok(!stored.get(key+':practice').includes('explanation'));
 qr.show(quizPacket,'review-quiz:v1:b:week1');launch();assert.equal(host.querySelectorAll('input:checked').length,0);
 qr.show(quizPacket,'review-quiz:v1:a:week2');launch();assert.equal(host.querySelectorAll('input:checked').length,0);
 ui.localStorage.setItem=()=>{throw Error('blocked');};choose('1');assert.ok(host.querySelector('[data-quiz-storage]').textContent.includes('저장할 수 없어요'));qr.dispose();
 // A response arriving after pagehide must not re-render private contents.
 let resolveList;ui.fetch=()=>new Promise(resolve=>resolveList=resolve);
 const container=ui.document.getElementById('student'),mount=ui.window.mountReviewArchive({id:'a',pw:'synthetic'},container);
 for(const f of [...listeners.get('pagehide')])f();
 resolveList(new Response(JSON.stringify([{id:'a',week_label:'Week',week_start:'2026-10-26',original_count:1}])));await mount;assert.equal(container.children.length,0);
 console.log('PASS: archive validation, immutable weeks, active account authentication, own published rows only, role grants, Edge ownership before file access, hash integrity, PDF page links, escaping and logout cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
