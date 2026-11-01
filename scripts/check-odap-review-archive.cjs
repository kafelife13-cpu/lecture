// npm install --no-save @electric-sql/pglite linkedom; node scripts/check-odap-review-archive.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const core=await import('../odap/review-archive-core.mjs'),{contentHash}=await import('../odap/private-weekly-core.mjs');
 const packet={schema:1,student_id:'a',school:'School',title:'Week review',week_start:'2026-10-26',week_label:'Week 1',originals:[{exam_id:'exam',exam_name:'Exam',num:1,text:'<img src=x onerror=alert(1)>',answer:'2',my_answer:'1',explanation:'Reason',file_id:'pdf',page:3}],practice:{count:15,file_id:'pdf'},files:[{id:'pdf',name:'test.pdf',data:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}]};
 assert.deepEqual(core.validateArchive(packet),packet);assert.equal(core.studentArchive(packet).student_id,undefined);
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
 const made=[],revoked=[],listeners=new Map();let serial=0;
 const ui={window:{addEventListener:(n,f)=>{if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f);},removeEventListener:(n,f)=>listeners.get(n)?.delete(f)},document:window.document,atob,Uint8Array,Blob,AbortSignal,URL:{createObjectURL:()=>{const u='blob:test'+(++serial);made.push(u);return u;},revokeObjectURL:u=>revoked.push(u)}};
 vm.createContext(ui);vm.runInContext(fs.readFileSync('odap/review-archive.js','utf8'),ui);
 const host=ui.document.getElementById('host'),reader=ui.window.reviewArchiveReader(host);reader.show(packet);
 assert.equal(host.querySelector('img'),null);assert.ok(host.textContent.includes('<img src=x'));
 host.querySelector('[data-review-original]').onclick();assert.ok(host.querySelector('iframe').src.endsWith('#page=3'));
 host.querySelector('[data-review-practice]').onclick();assert.ok(host.querySelector('iframe').src.endsWith('#page=1'));
 reader.clear();assert.deepEqual(revoked,made);assert.equal(host.children.length,0);reader.dispose();
 // A response arriving after pagehide must not re-render private contents.
 let resolveList;ui.fetch=()=>new Promise(resolve=>resolveList=resolve);
 const container=ui.document.getElementById('student'),mount=ui.window.mountReviewArchive({id:'a',pw:'synthetic'},container);
 for(const f of [...listeners.get('pagehide')])f();
 resolveList(new Response(JSON.stringify([{id:'a',week_label:'Week',week_start:'2026-10-26',original_count:1}])));await mount;assert.equal(container.children.length,0);
 console.log('PASS: archive validation, immutable weeks, active account authentication, own published rows only, role grants, Edge ownership before file access, hash integrity, PDF page links, escaping and logout cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
