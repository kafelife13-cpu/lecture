import {createClient} from 'npm:@supabase/supabase-js@2';
import {boundedJSON,drive} from '../odap-private-weekly/services.ts';
import {contentHash} from '../../../odap/private-weekly-core.mjs';
import {validateArchive,studentArchive} from '../../../odap/review-archive-core.mjs';
const origins=new Set(['https://kafelife13-cpu.github.io','http://127.0.0.1:8876']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://kafelife13-cpu.github.io','Access-Control-Allow-Headers':'apikey,content-type,authorization','Access-Control-Allow-Methods':'POST,OPTIONS',Vary:'Origin'};
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.has(origin))return reply({error:'허용되지 않은 출처입니다.'},403);
 if(req.method==='OPTIONS')return new Response('',{headers});
 if(req.method!=='POST')return reply({error:'POST만 지원합니다.'},405);
 try{
  const body=await boundedJSON(req.body),c=body.credentials,p=body.payload||{};
  if(!c||!['teacher','student'].includes(c.role)||typeof c.id!=='string'||typeof c.pw!=='string')return reply({error:'본인 계정으로 로그인하세요.'},401);
  if(!['list','open','create','publish'].includes(body.action))throw Error('지원하지 않는 자료 작업입니다.');
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const rpc=async(action:string,payload:unknown={})=>{
   const {data,error}=await db.rpc('odap_review_archive_rpc',{p_id:c.id,p_password:c.pw,p_role:c.role,p_action:action,p_payload:payload});
   if(error)throw Error(error.message);return data;
  };
  await rpc('profile');
  if(body.action==='list')return reply(await rpc('list',c.role==='teacher'?{student_id:p.student_id}:{}));
  if(['create','publish'].includes(body.action)&&c.role!=='teacher')return reply({error:'교사만 자료를 공개할 수 있습니다.'},403);
  if(body.action==='create'){
   const packet=validateArchive(p.packet),hash=await contentHash(packet);
   const saved=await drive('put',{request_id:crypto.randomUUID(),content:packet,content_hash:hash});
   if(!saved||typeof saved.file_id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(saved.file_id))throw Error('비공개 저장 결과를 확인하세요.');
   const check=await drive('get',{file_id:saved.file_id});
   if(!check.content||await contentHash(check.content)!==hash)throw Error('저장한 자료의 내용이 일치하지 않습니다.');
   const row=await rpc('create',{student_id:packet.student_id,school:packet.school,week_start:packet.week_start,week_label:packet.week_label,title:packet.title,original_count:packet.originals.length,practice_count:packet.practice.count,drive_file_id:saved.file_id,content_hash:hash});
   return reply({id:row.id,status:row.status,week_start:row.week_start});
  }
  if(typeof p.id!=='string')throw Error('자료를 선택하세요.');
  const row=await rpc('get',{id:p.id}); // Ownership must be checked before Drive access.
  const saved=await drive('get',{file_id:row.drive_file_id});
  if(!saved.content||await contentHash(saved.content)!==row.content_hash)throw Error('자료의 저장 버전이 다릅니다.');
  const packet=validateArchive(saved.content);
  if(packet.student_id!==row.student_id||packet.week_start!==row.week_start||packet.title!==row.title)throw Error('학생·주차 연결을 확인하세요.');
  if(body.action==='publish')return reply(await rpc('publish',{id:row.id,confirmed:p.confirmed,content_hash:row.content_hash}));
  return reply({id:row.id,status:row.status,packet:c.role==='teacher'?packet:studentArchive(packet)});
 }catch(error){return reply({error:error instanceof Error?error.message:'자료를 불러오지 못했습니다.'},400);}
});
