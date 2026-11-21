const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const core=await import('../odap/private-weekly-core.mjs');
 const context={school:'Synthetic school',week_start:'2026-10-26'};
 const packet={schema:1,title:'Synthetic weekly',items:Array.from({length:40},(_,i)=>({id:'q'+i,type:i<20?'mcq':'ox',text:'Prompt '+i,passage:'Passage',...(i<20?{choices:['one','two','three','four','five']}:{}),answer:i<20?'1':'O',explanation:'Reason',reviewed:true,evidence:[{approved:true,source_id:'source',page:'1',quote:'Source quote',school:context.school,kind:i===39?'학교 기출':'학교 프린트',year:2025}]}))};
 packet.items[20].images=[{data:'data:image/png;base64,YQ==',alt:'Synthetic'}];
 core.validatePacket(packet,context,true);
 const student=core.studentPacket(packet);
 assert.equal(student.items[0].images[0].data,packet.items[20].images[0].data);
 for(const q of student.items)for(const key of ['answer','explanation','evidence','reviewed'])assert.equal(Object.hasOwn(q,key),false);
 const allAnswers=Object.fromEntries(packet.items.map(q=>[q.id,q.answer]));
 const answers=Object.fromEntries(packet.items.filter(q=>q.type==='ox').map(q=>[q.id,q.answer]));
 assert.equal(student.items.length,20);assert.ok(student.items.every(q=>q.type==='ox'));
 assert.equal(core.gradeStoredAttempt(packet,allAnswers).correct,20);
 assert.equal(core.gradeStoredAttempt(packet,allAnswers).results.length,20);
 assert.throws(()=>core.gradePacket(packet,allAnswers));
 core.validatePacket({...packet,items:packet.items.filter(q=>q.type==='ox')},context,true);
 assert.equal(core.gradePacket(packet,answers).correct,20);
 assert.equal(core.gradePacket(packet,{...answers,q20:'X'}).correct,19);
 assert.throws(()=>core.gradePacket(packet,{...answers,q20:['O']}));
 assert.throws(()=>core.gradePacket(packet,{...answers,extra:'O'}));
 const modify=fn=>{const p=structuredClone(packet);fn(p);return p;};
 assert.throws(()=>core.validatePacket(modify(p=>p.items[39].evidence[0].year=2024),context,true));
 assert.throws(()=>core.validatePacket(modify(p=>p.items[20].evidence[0].school='Other'),context,true));
 assert.throws(()=>core.validatePacket(modify(p=>p.items[2].reviewed=false),context,true));
 assert.throws(()=>core.validatePacket(modify(p=>p.items[1]={...p.items[0],id:'q1'}),context,true));
 core.validatePacket(modify(p=>{p.items[1].text=p.items[0].text;p.items[1].passage='Different';}),context,true);
 core.validatePacket(modify(p=>{p.items[0].evidence[0].kind='문제은행';p.items[0].evidence[0].school='';}),context,true);
 assert.throws(()=>core.validatePacket(modify(p=>p.items[20].images[0].data='data:image/svg+xml;base64,YQ=='),context,true));
 assert.equal(await core.contentHash(packet),await core.contentHash(structuredClone(packet)));
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create table users(id text,role text,status text);insert into users values('t','teacher','active'),('a','student','active'),('b','student','active');create function authenticate_user(text,text,text) returns jsonb language sql as $$select to_jsonb(u) from users u where id=$1 and role=$3 and $2='test-only'$$;`);
  await db.exec(fs.readFileSync('supabase/odap/private-weekly.sql','utf8'));
  const rpc=async(action,p={},id='t',role='teacher')=>(await db.query('select odap_private_weekly_rpc($1,$2,$3,$4,$5) d',[id,'test-only',role,action,JSON.stringify(p)])).rows[0].d;
  const meta={student_id:'a',...context,title:'Synthetic',drive_file_id:'private-id',content_hash:await core.contentHash(packet)};
  const legacy=await rpc('create',{...meta,week_start:'2026-10-19'});
  await db.query('insert into odap_private_weekly_attempts(assignment_id,student_id,answers,correct) values($1,$2,$3,37)',[legacy.id,'a',JSON.stringify(allAnswers)]);
  await db.exec('alter table odap_private_weekly_attempts drop column total cascade');
  await db.exec(fs.readFileSync('supabase/odap/private-weekly.sql','utf8'));
  assert.equal((await rpc('get',{id:legacy.id})).attempt.total,40);
  assert.equal((await rpc('get',{id:legacy.id})).attempt.correct,37);
  const row=await rpc('create',meta);
  await assert.rejects(()=>rpc('create',meta));
  assert.deepEqual(await rpc('list',{},'a','student'),[]);
  await assert.rejects(()=>rpc('get',{id:row.id},'a','student'));
  await assert.rejects(()=>rpc('publish',{id:row.id,content_hash:meta.content_hash,confirmed:true}));
  await assert.rejects(()=>rpc('approve',{id:row.id,content_hash:'b'.repeat(64),confirmed:true}));
  await rpc('approve',{id:row.id,content_hash:meta.content_hash,confirmed:true});
  await rpc('publish',{id:row.id,content_hash:meta.content_hash,confirmed:true});
  assert.equal((await rpc('list',{},'a','student')).length,1);
  assert.equal((await rpc('list',{},'a','student'))[0].total,20);
  assert.equal((await rpc('list',{},'a','student'))[0].title,'주간 OX 테스트');
  assert.deepEqual(await rpc('list',{},'b','student'),[]);
  await assert.rejects(()=>rpc('get',{id:row.id},'b','student'));
  await assert.rejects(()=>rpc('submit',{id:row.id,content_hash:meta.content_hash,answers,correct:20}));
  await assert.rejects(()=>rpc('submit',{id:row.id,content_hash:meta.content_hash,answers,correct:21},'a','student'));
  await assert.rejects(()=>rpc('submit',{id:row.id,content_hash:meta.content_hash,answers:{...answers,q20:null},correct:20},'a','student'));
  const submit={id:row.id,content_hash:meta.content_hash,answers,correct:20};
  const concurrent=await Promise.allSettled([rpc('submit',submit,'a','student'),rpc('submit',submit,'a','student')]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await rpc('get',{id:row.id},'a','student')).attempt.correct,20);
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(()=>rpc('get',{id:row.id},'a','student'));
   await assert.rejects(()=>db.query('select * from odap_private_weekly'));
   await db.exec('reset role');
  }
  await db.exec('set role service_role');assert.equal((await rpc('profile')).role,'teacher');
  // Run the actual Edge handler with a synthetic DB and signed Drive adapter.
  const vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module'),{createHmac}=require('node:crypto');
  let handler,driveReads=0;const files=new Map(),secret='synthetic-secret-for-tests-only-123456789';
  const edge={...core,crypto,TextEncoder,TextDecoder,Uint8Array,URL,AbortSignal,Request,Response,ReadableStream,atob,btoa,
   Deno:{env:{get:key=>({ODAP_PRIVATE_DRIVE_URL:'https://script.google.com/macros/s/synthetic/exec',ODAP_PRIVATE_DRIVE_SECRET:secret}[key]||'synthetic')},serve:fn=>handler=fn},
   createClient:()=>({rpc:async(name,args)=>{try{
    if(name==='odap_rpc'){assert.equal(args.p_action,'GET /api/students');assert.equal(args.p_role,'teacher');return {data:{students:[{id:'a',school_id:1},{id:'b',school_id:1}],schools:[{id:1,name:context.school}]},error:null};}
    return {data:await rpc(args.p_action,args.p_payload,args.p_id,args.p_role),error:null};
   }catch(e){return {data:null,error:{message:e.message}};}}}),
   fetch:async(_url,options)=>{
    const req=JSON.parse(options.body),[claims,signature]=req.token.split('.');
    assert.equal(signature,createHmac('sha256',secret).update(claims).digest('base64url'));
    const c=JSON.parse(Buffer.from(claims,'base64url').toString());assert.equal(c.subject,'odap-private-weekly');
    if(req.op==='upload'){const id='file-'+files.size;files.set(id,JSON.parse(Buffer.from(req.data,'base64').toString()));return new Response(JSON.stringify({ok:true,result:{file_id:id}}));}
    driveReads++;return new Response(JSON.stringify({ok:true,result:{mime:'application/json',data:Buffer.from(JSON.stringify(files.get(c.file_id))).toString('base64')}}));
   }};
  vm.createContext(edge);
  const source=(fs.readFileSync('supabase/functions/odap-private-weekly/services.ts','utf8')+'\n'+fs.readFileSync('supabase/functions/odap-private-weekly/index.ts','utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  vm.runInContext(stripTypeScriptTypes(source),edge);
  const call=async(action,payload,id='t',role='teacher')=>{const res=await handler(new Request('https://edge.example.test',{method:'POST',body:JSON.stringify({credentials:{id,pw:'test-only',role},action,payload})}));return {status:res.status,body:await res.json()};};
  const made=await call('create',{student_id:'b',week_start:'2026-11-02',packet});assert.equal(made.status,200);
  assert.equal((await rpc('get',{id:made.body.id})).school,context.school);
  const eid=made.body.id;
  assert.equal((await call('revise',{id:eid,packet:{...packet,title:'Revised synthetic'}})).body.id,eid);
  assert.equal((await call('approve',{id:eid,confirmed:true})).status,403);
  let erow=await rpc('get',{id:eid});
  // Seed a server-reviewed synthetic file for privacy/grading tests; real review is
  // exercised separately by check-private-weekly-claude.cjs, never trust import flags.
  files.get(erow.drive_file_id).items.forEach(q=>q.reviewed=true);
  const reviewedHash=await core.contentHash(files.get(erow.drive_file_id));
  await rpc('revise',{id:eid,previous_hash:erow.content_hash,drive_file_id:erow.drive_file_id,title:erow.title,content_hash:reviewedHash});
  erow=await rpc('get',{id:eid});await rpc('approve',{id:eid,content_hash:erow.content_hash,confirmed:true});
  assert.equal((await call('revise',{id:eid,packet})).status,400);
  assert.equal((await call('publish',{id:eid,confirmed:true})).status,403);
  await rpc('publish',{id:eid,content_hash:erow.content_hash,confirmed:true});
  const beforeReads=driveReads;assert.equal((await call('open',{id:eid},'a','student')).status,400);assert.equal(driveReads,beforeReads);
  const opened=await call('open',{id:eid},'b','student');assert.equal(opened.body.attempt,null);assert.equal(Object.hasOwn(opened.body.packet.items[0],'answer'),false);
  const submitted=await call('submit',{id:eid,answers:{...answers,q20:'X'},correct:40,score:100},'b','student');assert.equal(submitted.body.correct,19);assert.equal(submitted.body.score,95);
  assert.equal((await call('submit',{id:eid,answers},'b','student')).status,400);
  assert.equal((await call('open',{id:eid},'b','student')).body.attempt.results[0].answer,'O');
  files.get('file-1').items[0].answer='2';assert.equal((await call('open',{id:eid},'b','student')).status,400);
  const forged=await call('create',{student_id:'b',school:'Forged school',week_start:'2026-11-09',packet});assert.equal(forged.status,200);
  assert.equal((await rpc('get',{id:forged.body.id})).school,context.school);
 }finally{await db.close();}
 console.log('PASS: 20/40-item validation, OX-only student privacy and grading, evidence/year/school gates, image preservation, answer stripping, server grading, private ownership, approval flow, one submission, anon RPC denial');
})().catch(e=>{console.error(e);process.exitCode=1;});
