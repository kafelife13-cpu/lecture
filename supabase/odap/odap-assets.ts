// Deploy as Supabase Edge Function `odap-assets` with gateway JWT verification disabled.
// Every operation authenticates the existing Kkakka account before touching storage.
import { createClient } from 'npm:@supabase/supabase-js@2';
const origins=new Set(['https://kafelife13-cpu.github.io','http://127.0.0.1:8876']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin)?origin:'https://kafelife13-cpu.github.io','Access-Control-Allow-Headers':'apikey,content-type,authorization','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers});
 if(origin&&!origins.has(origin))return reply({error:'허용되지 않은 출처'},403);
 if(req.method==='OPTIONS')return new Response('',{headers});
 if(req.method!=='POST')return reply({error:'POST만 지원합니다.'},405);
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const b=await req.json(),c=b.credentials;
  if(!c||!['teacher','student'].includes(c.role)||typeof c.id!=='string'||typeof c.pw!=='string')return reply({error:'로그인이 필요합니다.'},401);
  const rpc=async(action:string,payload:unknown={})=>{const {data,error}=await db.rpc('odap_rpc',{p_id:c.id,p_password:c.pw,p_role:c.role,p_action:action,p_payload:payload});if(error)throw Error(error.message);return data;};
  await rpc('profile');
  if(b.action==='prepare_upload'){
   if(c.role!=='teacher')return reply({error:'교사 전용'},403);
   if(!Number.isSafeInteger(b.bytes)||b.bytes<1||b.bytes>40*1024*1024)throw Error('1바이트~40MB 파일만 보관할 수 있습니다.');
   const extension=String(b.filename||'').split('.').pop()?.toLowerCase();
   if(!['hwp','hwpx','pdf','json','txt','gz'].includes(extension!))throw Error('지원하지 않는 파일 형식입니다.');
   let path='sources/'+crypto.randomUUID()+'.'+extension;
   if(b.kind==='packet'){
    const packet=await rpc('GET /api/packet',{id:b.packet_id});
    if(!packet||packet.status==='published')throw Error('제작할 초안 자료를 확인하세요.');
    if(!['hwp','hwpx','pdf'].includes(extension!))throw Error('자료 파일 형식을 확인하세요.');
    path='packets/'+packet.id+'/'+crypto.randomUUID()+'.'+extension;
   }
   const {data,error}=await db.storage.from('odap-private').createSignedUploadUrl(path);
   if(error)throw Error(error.message);return reply({path,url:data.signedUrl});
  }
  if(b.action==='download'){
   const permit=await rpc('asset_permission',{kind:b.kind,id:b.id,path:b.path});
   const path=permit.path||b.path;
   if(!path||(!permit.path&&!permit.allowed))throw Error('파일 접근 권한이 없습니다.');
   const {data,error}=await db.storage.from('odap-private').createSignedUrl(path,120);
   if(error)throw Error(error.message);return reply({url:data.signedUrl,filename:permit.filename||b.filename||'오답정리.pdf'});
  }
  return reply({error:'지원하지 않는 파일 작업'},400);
 }catch(e){return reply({error:e instanceof Error?e.message:'처리하지 못했습니다.'},400);}
});
