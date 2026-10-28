import { createClient } from 'npm:@supabase/supabase-js@2';
import { drive, claude } from '../odap-private-weekly/services.ts';
import { contentHash, validatePacket } from '../../../odap/private-weekly-core.mjs';
import { autoSources, autoMCQ } from '../../../odap/private-weekly-auto.mjs';
import { GENERATE_SYSTEM, REVIEW_SYSTEM, generatedPacket, reviewMessages, validateReview, reviewEvidence } from '../../../odap/private-weekly-review.mjs';

// Called by a database cron, independent of teacher browsers. One leased phase per invocation.
Deno.serve(async req=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 const secret=Deno.env.get('ODAP_WEEKLY_WORKER_SECRET');
 if(req.method!=='POST'||!secret||secret.length<32||req.headers.get('x-weekly-worker-secret')!==secret)return reply({error:'unauthorized'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const rpc=async(name:string,payload:Record<string,unknown>={})=>{const {data,error}=await db.rpc(name,payload);if(error)throw Error(error.message);return data;};
 let job:any=null;
 try{
  job=await rpc('odap_private_weekly_auto_claim');
  if(!job)return reply({processed:false});
  const context=await rpc('odap_private_weekly_auto_context',{p_job:job.id,p_lease:job.lease});
  let packet:any;
  if(job.phase==='generate'){
   const seed=autoMCQ(context),sources=autoSources(context);
   const generated=await claude(GENERATE_SYSTEM,[{role:'user',content:JSON.stringify({sources:sources.map(e=>({source_id:e.source_id,page:e.page,quote:e.quote,kind:e.kind,year:e.year,original_exam_verified:e.original_exam_verified}))})}],14000);
   packet=generatedPacket(seed,sources,generated.value);
   validatePacket(packet,context,false);
  }else if(job.phase==='review'){
   const saved=await drive('get',{file_id:job.draft_drive_file_id});
   if(await contentHash(saved.content)!==job.draft_content_hash)throw Error('저장된 자동 생성 자료의 해시가 다릅니다.');
   packet=validatePacket(saved.content,context,false);reviewEvidence(packet);
   const batches=[];for(let i=0;i<packet.items.length;i+=10)batches.push(packet.items.slice(i,i+10));
   const reports=await Promise.all(batches.map(async items=>{const r=await claude(REVIEW_SYSTEM,reviewMessages(items),6000);return {items:validateReview(items,r.value),model:r.model};}));
   packet={...packet,items:packet.items.map(q=>({...q,reviewed:true})),review:{provider:'anthropic',state:'passed',model:reports[0].model,reviewed_at:new Date().toISOString(),reviewed_content_hash:job.draft_content_hash,scope:'provided_source_quotes_and_images',items:reports.flatMap(r=>r.items)}};
   validatePacket(packet,context,true);
  }else throw Error('자동 처리 단계가 올바르지 않습니다.');
  const hash=await contentHash(packet),file=await drive('put',{request_id:job.lease,content:packet,content_hash:hash});
  if(!file||typeof file.file_id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(file.file_id))throw Error('Drive 파일 ID가 올바르지 않습니다.');
  const verify=await drive('get',{file_id:file.file_id});
  if(await contentHash(verify.content)!==hash)throw Error('Drive 저장 검증에 실패했습니다.');
  const result=await rpc('odap_private_weekly_auto_finish',{p_job:job.id,p_lease:job.lease,p_payload:{phase:job.phase==='generate'?'review':'published',drive_file_id:file.file_id,content_hash:hash,title:packet.title,review_provider:packet.review?.provider,review_passed:packet.review?.state==='passed'}});
  return reply({processed:true,phase:result?.phase||result?.status});
 }catch(error){
  // A rejected or incomplete review never publishes, and errors contain no credentials/student responses.
  const message=error instanceof Error?error.message:'자동 처리 오류';
  if(job)await rpc('odap_private_weekly_auto_finish',{p_job:job.id,p_lease:job.lease,p_payload:{phase:'blocked',error:message.slice(0,600)}}).catch(()=>{});
  return reply({processed:false,error:message},400);
 }
});
