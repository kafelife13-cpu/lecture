const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
(async()=>{
 const core=await import('../odap/private-weekly-core.mjs'),review=await import('../odap/private-weekly-review.mjs');
 const context={school:'Test School',week_start:'2026-10-26'};
 const packet={schema:1,title:'PRIVATE STUDENT NAME',student_id:'PRIVATE STUDENT ID',review:{provider:'anthropic',state:'passed'},items:Array.from({length:40},(_,i)=>({id:'q'+i,type:i<20?'mcq':'ox',text:'Question '+i,...(i<20?{choices:['a','b','c','d','e']}:{}),answer:i<20?'1':i<30?'O':'X',explanation:'Evidence explanation',reviewed:true,evidence:[{approved:true,source_id:'src'+i,page:'1',quote:'Fact '+i,kind:i===39?'학교 기출':'학교 프린트',school:context.school,year:2025}]}))};
 const verdicts=qs=>({items:qs.map(q=>({id:q.id,answer:q.answer,supported:true,unambiguous:true,explanation_supported:true,reason:'Source supports this answer'}))});
 const good=verdicts(packet.items);
 review.validateReview(packet.items,good);
 for(const changed of [ {...good,items:good.items.slice(1)}, {...good,items:good.items.map((v,i)=>i===1?good.items[0]:v)}, {...good,items:good.items.map((v,i)=>i===1?{...v,answer:'2'}:v)}, {...good,items:good.items.map((v,i)=>i===1?{...v,supported:false}:v)}]) assert.throws(()=>review.validateReview(packet.items,changed));
 assert.throws(()=>review.parseClaudeJSON({stop_reason:'max_tokens',content:[{type:'text',text:JSON.stringify(good)}]}));
 const sources=review.reviewEvidence(packet);
 const gen={items:Array.from({length:20},(_,i)=>({type:'ox',text:'Generated '+i,answer:i<10?'O':'X',explanation:'Generated explanation',evidence_refs:[i===19?39:i]}))};
 const generated=review.generatedPacket(packet,sources,gen);
 assert.equal(generated.items.length,40);assert.equal(generated.items[20].origin_label,'자작');assert.equal(generated.items[0].text,packet.items[0].text);assert.equal(generated.review,undefined);
 assert.throws(()=>review.generatedPacket(packet,sources,{items:gen.items.map(q=>({...q,evidence_refs:[999]}))}));
 let handler,aiCalls=0,failReview=false,failTransport=false,truncate=false,studentRole=false;const files=new Map();let row=null;
 const edge={...core,...review,crypto,TextEncoder,TextDecoder,Uint8Array,URL,AbortSignal,Request,Response,ReadableStream,atob,btoa,
  Deno:{env:{get:k=>({ODAP_PRIVATE_DRIVE_URL:'https://script.google.com/macros/s/test/exec',ODAP_PRIVATE_DRIVE_SECRET:'synthetic-secret-test-123456789012345',ODAP_CLAUDE_MODEL:'test-model'}[k]||'synthetic')},serve:f=>handler=f},
  createClient:()=>({rpc:async(_name,{p_action:a,p_payload:p,p_role:role})=>{try{
   if(a==='profile')return {data:{role}};
   if(a==='create'){row={...p,id:'assignment',status:'draft'};return {data:row};}
   if(a==='get')return {data:structuredClone(row)};
   if(a==='revise'){assert.equal(row.status,'draft');assert.equal(row.content_hash,p.previous_hash);row={...row,...p};return {data:row};}
   if(a==='approve'){assert.equal(row.status,'draft');row.status='approved';return {data:row};}
   if(a==='publish'){assert.equal(row.status,'approved');row.status='published';return {data:row};}
   throw Error(a);
  }catch(e){return {error:{message:e.message}};}}}),
  fetch:async(url,options)=>{
   const body=JSON.parse(options.body);
   if(url==='https://api.anthropic.com/v1/messages'){
    aiCalls++;assert.equal(JSON.stringify(body).includes('PRIVATE STUDENT'),false);assert.equal(body.model,'test-model');
    if(failTransport)return new Response('{}',{status:429});
    const input=body.messages[0].content;
    let value;
    if(typeof input==='string')value={items:gen.items.map((q,i)=>({...q,evidence_refs:[i===19?39:i]}))};
    else{
     const qs=JSON.parse(input[0].text).items;
     assert.equal(Object.hasOwn(qs[0],'answer'),false);
     value=verdicts(qs.map(q=>({...q,answer:files.get(row.drive_file_id).items.find(x=>x.id===q.id).answer})));
     if(failReview)value.items[0].unambiguous=false;
    }
    return new Response(JSON.stringify({stop_reason:truncate?'max_tokens':'end_turn',content:[{type:'text',text:JSON.stringify(value)}]}));
   }
   const claims=JSON.parse(Buffer.from(body.token.split('.')[0],'base64url').toString());
   if(body.op==='upload'){const id='file'+files.size;files.set(id,JSON.parse(Buffer.from(body.data,'base64').toString()));return new Response(JSON.stringify({ok:true,result:{file_id:id}}));}
   return new Response(JSON.stringify({ok:true,result:{mime:'application/json',data:Buffer.from(JSON.stringify(files.get(claims.file_id))).toString('base64')}}));
  }};
 vm.createContext(edge);vm.runInContext(stripTypeScriptTypes((fs.readFileSync('supabase/functions/odap-private-weekly/services.ts','utf8')+'\n'+fs.readFileSync('supabase/functions/odap-private-weekly/index.ts','utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')),edge);
 const call=async(action,payload={})=>{const r=await handler(new Request('https://edge.example',{method:'POST',body:JSON.stringify({credentials:{id:'t',pw:'private',role:studentRole?'student':'teacher'},action,payload})}));return {status:r.status,data:await r.json()};};
 assert.equal((await call('create',{student_id:'private-student',...context,packet})).status,200);
 assert.equal(files.get(row.drive_file_id).review,undefined);assert.equal(files.get(row.drive_file_id).items[0].reviewed,false);
 assert.equal((await call('approve',{id:row.id,confirmed:true})).status,403);
 studentRole=true;assert.equal((await call('review_publish',{id:row.id})).status,403);assert.equal(aiCalls,0);studentRole=false;
 failTransport=true;assert.equal((await call('review_publish',{id:row.id})).status,400);assert.equal(row.status,'draft');failTransport=false;
 truncate=true;assert.equal((await call('review_publish',{id:row.id})).status,400);assert.equal(row.status,'draft');truncate=false;
 failReview=true;assert.equal((await call('review_publish',{id:row.id})).status,400);assert.equal(row.status,'draft');failReview=false;
 assert.equal((await call('generate_ox',{id:row.id})).status,200);assert.equal(row.status,'draft');assert.equal(files.get(row.drive_file_id).items[20].origin_label,'자작');
 const published=await call('review_publish',{id:row.id});assert.equal(published.status,200);assert.equal(row.status,'published');assert.equal(published.data.review.items.length,40);
 const count=aiCalls;assert.equal((await call('review_publish',{id:row.id})).status,200);assert.equal(aiCalls,count);
 const opened=await call('open',{id:row.id});assert.equal(opened.data.packet.review.state,'passed');
 console.log('PASS: real Edge generation/review pipeline; all40 verdicts; PII metadata omitted; independent answers; forged approval stripped; failure/429/truncation hold; generated refs binding; retry idempotence');
})().catch(e=>{console.error(e);process.exitCode=1;});
