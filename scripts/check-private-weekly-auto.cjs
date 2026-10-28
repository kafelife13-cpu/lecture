const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
(async()=>{
 const core=await import('../odap/private-weekly-core.mjs'),review=await import('../odap/private-weekly-review.mjs'),selection=await import('../odap/private-weekly-auto.mjs');
 const evidence=[{approved:true,source_id:'print',page:1,quote:'학교 프린트의 확인된 명제',kind:'학교 프린트',school:'Test School',private_student_id:'PRIVATE_STUDENT_ID'}, {approved:true,source_id:'past',page:2,quote:'2025 기출 복원본의 확인된 명제',kind:'학교 기출',school:'Test School',year:2025,original_exam_verified:false,private_student_name:'PRIVATE_STUDENT_NAME'}];
 const context={school:'Test School',week_start:'2026-10-26',student_id:'PRIVATE_STUDENT_ID',student_name:'PRIVATE_STUDENT_NAME',password:'PRIVATE_PASSWORD',wrongs:Array.from({length:10},(_,i)=>({question:{id:'original'+i,text:'Original '+i},concepts:['높임'],question_types:['적용'],student_answer:'PRIVATE_ANSWER',student_reason:'PRIVATE_REASON'})),candidates:Array.from({length:20},(_,i)=>({id:'bank'+i,status:'approved',text:'Real source question '+i,choices:['a','b','c','d','e'],answer:'1',explanation:'Explanation '+i,concepts:['높임'],question_types:['적용'],evidence:[evidence[0]],private_meta:'PRIVATE_META'})),evidence};
 const seed=selection.autoMCQ(context),sources=selection.autoSources(context);
 assert.equal(seed.items.length,20);assert.equal(new Set(seed.items.map(q=>q.bank_id)).size,20);assert.equal(seed.items.filter(q=>q.selection_role==='similar').length,10);assert.equal(seed.items.filter(q=>q.selection_role==='concept').length,10);assert.equal(seed.items.every(q=>q.origin_type==='existing'&&q.reviewed===false),true);assert.equal(seed.items[0].text,context.candidates[0].text);assert.equal(sources[0].page,'1');
 const modify=fn=>{const c=structuredClone(context);fn(c);return c;};
 assert.throws(()=>selection.autoMCQ(modify(c=>c.wrongs=[])),/오답/);
 assert.throws(()=>selection.autoMCQ(modify(c=>c.wrongs[0].concepts=[])),/개념/);
 assert.throws(()=>selection.autoMCQ(modify(c=>c.candidates[0].id='original0')),/부족/);
 assert.throws(()=>selection.autoMCQ(modify(c=>c.candidates[0].text='Original 0')),/부족/);
 assert.throws(()=>selection.autoMCQ(modify(c=>c.candidates[0].text=c.candidates[1].text)),/부족/);
 assert.throws(()=>selection.autoMCQ(modify(c=>c.candidates[0].status='draft')),/부족/);
 assert.throws(()=>selection.autoMCQ(modify(c=>c.candidates.forEach(q=>q.question_types=['다른유형']))),/유사/);
 assert.throws(()=>selection.autoSources(modify(c=>c.evidence[1].year=2024)),/작년/);
 assert.throws(()=>selection.autoSources(modify(c=>c.evidence[0].school='Other School')),/근거/);
 assert.throws(()=>selection.autoSources(modify(c=>c.evidence[0].approved=false)),/근거/);
 const gen={items:Array.from({length:20},(_,i)=>({type:'ox',text:'Generated OX '+i,answer:i<10?'O':'X',explanation:'Evidence explanation '+i,evidence_refs:[i%2]}))};
 const generated=review.generatedPacket(seed,sources,gen);core.validatePacket(generated,context,false);
 function harness(){
  let handler,job={id:'job',lease:'lease-1',phase:'generate'},leaseActive=true,failReview=false,expireOnWrite=false,contextError=false;
  const calls=[],ai=[],files=new Map(),finished=[];
  const env={ODAP_WEEKLY_WORKER_SECRET:'synthetic-worker-secret-1234567890123456',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'};
  const edge={...core,...review,...selection,crypto,Request,Response,TextEncoder,TextDecoder,
   Deno:{env:{get:k=>env[k]},serve:f=>handler=f},
   createClient:()=>({rpc:async(name,p={})=>{calls.push({name,p});try{
    if(name==='odap_private_weekly_auto_claim')return{data:job&&structuredClone(job)};
    if(!leaseActive||p.p_lease!==job.lease)throw Error('stale lease');
    if(name==='odap_private_weekly_auto_context'){if(contextError)throw Error('missing source evidence');return{data:structuredClone(context)};}
    if(name==='odap_private_weekly_auto_finish'){
     if(p.p_payload.phase==='published'){
      assert.equal(p.p_payload.review_provider,'anthropic');assert.equal(p.p_payload.review_passed,true);
      const saved=files.get(p.p_payload.drive_file_id);assert.equal(saved.review.items.length,40);assert.equal(saved.items.every(q=>q.reviewed),true);
     }
     finished.push(p.p_payload);return{data:{phase:p.p_payload.phase}};
    }throw Error('unexpected rpc');
   }catch(e){return{error:{message:e.message}};}}}),
   drive:async(action,p)=>{
    if(action==='get')return{content:structuredClone(files.get(p.file_id))};
    const id='file'+files.size;assert.equal(await core.contentHash(p.content),p.content_hash);files.set(id,structuredClone(p.content));if(expireOnWrite)leaseActive=false;return{file_id:id};
   },
   claude:async(system,messages,maxTokens)=>{
    const body={system,messages,maxTokens};ai.push(body);assert.ok(!JSON.stringify(body).includes('PRIVATE_'),'private identity/answer metadata must not reach Claude');
    if(system===review.GENERATE_SYSTEM){const input=JSON.parse(messages[0].content);assert.deepEqual(Object.keys(input),['sources']);assert.ok(input.sources.every(s=>Object.keys(s).every(k=>['source_id','page','quote','kind','year','original_exam_verified'].includes(k))));return{value:structuredClone(gen),model:'synthetic-model'};}
    assert.equal(system,review.REVIEW_SYSTEM);const qs=JSON.parse(messages[0].content[0].text).items;assert.equal(qs.length,10);assert.ok(qs.every(q=>!Object.hasOwn(q,'answer')));
    const full=files.get(job.draft_drive_file_id);return{model:'synthetic-model',value:{items:qs.map((q,i)=>({id:q.id,answer:full.items.find(x=>x.id===q.id).answer,supported:!(failReview&&i===0),unambiguous:true,explanation_supported:true,reason:'Matched provided evidence'}))}};
   }};
  vm.createContext(edge);vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/odap-weekly-worker/index.ts','utf8').replace(/^import .*;\r?\n/gm,'')),edge);
  return {calls,ai,files,finished,env,get job(){return job;},set job(v){job=v;},set failReview(v){failReview=v;},set expireOnWrite(v){expireOnWrite=v;},set leaseActive(v){leaseActive=v;},set contextError(v){contextError=v;},call:async(method='POST',token=env.ODAP_WEEKLY_WORKER_SECRET)=>{const r=await handler(new Request('https://worker.example',{method,headers:{'x-weekly-worker-secret':token}}));return{status:r.status,data:await r.json()};}};
 }
 const h=harness();assert.equal((await h.call('POST','wrong')).status,401);assert.equal((await h.call('GET')).status,401);assert.equal(h.calls.length,0);assert.equal(h.ai.length,0);
 const missing=harness();delete missing.env.ODAP_WEEKLY_WORKER_SECRET;assert.equal((await missing.call('POST','long-but-unconfigured-secret-123456')).status,401);assert.equal(missing.calls.length,0);
 const empty=harness();empty.job=null;assert.deepEqual((await empty.call()).data,{processed:false});assert.equal(empty.ai.length,0);
 const result=await h.call();assert.equal(result.status,200);assert.equal(result.data.phase,'review');assert.equal(h.ai.length,1);assert.equal(h.finished.length,1);assert.equal(h.finished[0].review_passed,false);assert.equal(h.finished[0].phase,'review');
 const draft=h.finished[0];h.job={id:'job',lease:'lease-2',phase:'review',draft_drive_file_id:draft.drive_file_id,draft_content_hash:draft.content_hash};
 const reviewed=await h.call();assert.equal(reviewed.status,200);assert.equal(reviewed.data.phase,'published');assert.equal(h.ai.length,5);assert.equal(h.finished.at(-1).review_passed,true);
 const reviewedIds=h.ai.slice(1).flatMap(x=>JSON.parse(x.messages[0].content[0].text).items.map(q=>q.id));assert.equal(reviewedIds.length,40);assert.equal(new Set(reviewedIds).size,40);
 const rejection=harness();rejection.files.set('draft',generated);rejection.job={id:'job',lease:'lease-1',phase:'review',draft_drive_file_id:'draft',draft_content_hash:await core.contentHash(generated)};rejection.failReview=true;
 assert.equal((await rejection.call()).status,400);assert.equal(rejection.finished.length,1);assert.equal(rejection.finished[0].phase,'blocked');assert.equal(rejection.files.size,1,'rejected review must not write a passed packet');
 const stale=harness();stale.leaseActive=false;assert.equal((await stale.call()).status,400);assert.equal(stale.ai.length,0);assert.equal(stale.finished.length,0);
 const changed=harness();changed.expireOnWrite=true;assert.equal((await changed.call()).status,400);assert.equal(changed.finished.length,0,'stale lease cannot finalize even after model completed');
 const invalid=harness();invalid.contextError=true;assert.equal((await invalid.call()).status,400);assert.equal(invalid.ai.length,0);assert.equal(invalid.finished[0].phase,'blocked');
 const tampered=harness();tampered.files.set('draft',generated);tampered.job={id:'job',lease:'lease-1',phase:'review',draft_drive_file_id:'draft',draft_content_hash:'bad'};assert.equal((await tampered.call()).status,400);assert.equal(tampered.ai.length,0);assert.equal(tampered.finished[0].phase,'blocked');
 console.log('PASS auto selection + actual worker: original/duplicate/source rejection; auth/empty no Claude; whitelisted non-PII generation; all40 independent review; passed flags required; rejection/hash mismatch blocked; stale leases never finalize');
})().catch(e=>{console.error(e);process.exitCode=1;});
