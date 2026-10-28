import { createClient } from 'npm:@supabase/supabase-js@2';
import { validatePacket, studentPacket, gradePacket, contentHash } from '../../../odap/private-weekly-core.mjs';

const allowedOrigins = new Set(['https://kafelife13-cpu.github.io', 'http://127.0.0.1:8876']);
const MAX_BYTES = 12 * 1024 * 1024;
async function boundedJSON(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw Error('내용이 없습니다.');
  const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) throw Error('자료가 12MB를 초과합니다. 이미지를 줄여 주세요.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function drive(action: string, payload: Record<string,unknown>) {
  const url = Deno.env.get('ODAP_PRIVATE_DRIVE_URL'), secret = Deno.env.get('ODAP_PRIVATE_DRIVE_SECRET');
  if (!url || !secret || secret.length<32 || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) throw Error('비공개 Drive 연결 설정이 필요합니다.');
  const base64 = (bytes:Uint8Array) => { let s=''; for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s); };
  const url64 = (bytes:Uint8Array) => base64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const now=Math.floor(Date.now()/1000), op=action==='put'?'upload':'read';
  const claims:Record<string,unknown>={aud:'storage-drive-v1',op,iat:now,exp:now+90,jti:payload.request_id||crypto.randomUUID(),subject:'odap-private-weekly',role:'teacher',kind:'teacher-body'};
  let data;
  if(op==='upload'){
    const bytes=new TextEncoder().encode(JSON.stringify(payload.content));
    if(bytes.length>8*1024*1024)throw Error('자료 본문이 8MB를 초과합니다. 이미지를 줄여 주세요.');
    Object.assign(claims,{bytes:bytes.length,sha256:payload.content_hash,mime:'application/json'});data=base64(bytes);
  }else claims.file_id=payload.file_id;
  const encoded=url64(new TextEncoder().encode(JSON.stringify(claims)));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=url64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(encoded))));
  let response = await fetch(url, {method:'POST', redirect:'manual', signal:AbortSignal.timeout(30000), headers:{'Content-Type':'application/json'}, body:JSON.stringify({op,token:encoded+'.'+sig,...(data?{data}:{})})});
  // Apps Script ContentService redirects its response to a Google-hosted GET URL.
  // Never forward the signed request body or secret to the redirect destination.
  if([302,303].includes(response.status)){
    const location=response.headers.get('location');
    if(!location || new URL(location).origin!=='https://script.googleusercontent.com')throw Error('Drive 응답 주소가 올바르지 않습니다.');
    response=await fetch(location,{redirect:'error',signal:AbortSignal.timeout(30000)});
  }
  if (!response.ok) throw Error('비공개 Drive 처리에 실패했습니다.');
  const body=await boundedJSON(response.body);
  if(body.ok!==true || !body.result)throw Error('비공개 Drive 요청이 거절되었습니다.');
  if(op==='upload')return body.result;
  if(body.result.mime!=='application/json'||typeof body.result.data!=='string'||body.result.data.length>12*1024*1024)throw Error('Drive 자료 형식이 올바르지 않습니다.');
  const raw=atob(body.result.data);if(raw.length>8*1024*1024)throw Error('Drive 자료가 너무 큽니다.');
  return {content:JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))))};
}
Deno.serve(async req => {
  const origin = req.headers.get('origin') || '';
  const headers = {'Content-Type':'application/json', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'https://kafelife13-cpu.github.io', 'Access-Control-Allow-Headers':'apikey,content-type,authorization', 'Access-Control-Allow-Methods':'POST,OPTIONS', Vary:'Origin'};
  const reply = (data:unknown,status=200) => new Response(JSON.stringify(data),{status,headers});
  if (origin && !allowedOrigins.has(origin)) return reply({error:'허용되지 않은 출처입니다.'},403);
  if (req.method==='OPTIONS') return new Response('',{headers});
  if (req.method!=='POST') return reply({error:'POST만 지원합니다.'},405);
  try {
    const b = await boundedJSON(req.body), c = b.credentials, p = b.payload || {};
    if (!c || !['teacher','student'].includes(c.role) || typeof c.id!=='string' || typeof c.pw!=='string') return reply({error:'로그인이 필요합니다.'},401);
    if (!['list','open','submit','create','revise','approve','publish'].includes(b.action)) throw Error('지원하지 않는 작업입니다.');
    const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const rpc = async (action:string,payload:unknown={}) => {
      const {data,error} = await db.rpc('odap_private_weekly_rpc',{p_id:c.id,p_password:c.pw,p_role:c.role,p_action:action,p_payload:payload});
      if (error) throw Error(error.code==='23505'?'이번 주 자료 또는 제출이 이미 있습니다.':error.message);
      return data;
    };
    await rpc('profile');
    if (b.action==='list') return reply(await rpc('list',c.role==='teacher'?{student_id:p.student_id}:{}));
    if (b.action==='create' || b.action==='revise') {
      if (c.role!=='teacher') return reply({error:'교사 전용입니다.'},403);
      const previous=b.action==='revise'?await rpc('get',{id:p.id}):null;
      if(previous){if(previous.status!=='draft')throw Error('검수 대기 자료만 수정할 수 있습니다.');Object.assign(p,{student_id:previous.student_id,school:previous.school,week_start:previous.week_start});}
      if (typeof p.student_id!=='string' || typeof p.school!=='string' || !p.school.trim() || typeof p.week_start!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.week_start)) throw Error('학생·학교·주차를 확인하세요.');
      const date = new Date(p.week_start+'T00:00:00Z');
      if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0,10)!==p.week_start || date.getUTCDay()!==1) throw Error('주차는 월요일이어야 합니다.');
      validatePacket(p.packet,p,false);
      const hash = await contentHash(p.packet);
      // Gateway creates immutable private files, idempotent for this random request UUID.
      const saved = await drive('put',{request_id:crypto.randomUUID(),content:p.packet,content_hash:hash});
      if (!saved || typeof saved.file_id!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(saved.file_id)) throw Error('Drive 파일 ID가 올바르지 않습니다.');
      // Read-after-write: do not register an unreadable or corrupted file.
      const check = await drive('get',{file_id:saved.file_id});
      if (!check.content || await contentHash(check.content)!==hash) throw Error('Drive 저장 내용이 일치하지 않습니다.');
      const row = await rpc(b.action,{id:previous?.id,previous_hash:previous?.content_hash,student_id:p.student_id,school:p.school,week_start:p.week_start,title:p.packet.title,drive_file_id:saved.file_id,content_hash:hash});
      return reply({id:row.id,status:row.status,week_start:row.week_start,title:row.title});
    }
    if (typeof p.id!=='string') throw Error('배정 ID가 필요합니다.');
    const row = await rpc('get',{id:p.id}); // Ownership check before any Drive read.
    const stored = await drive('get',{file_id:row.drive_file_id});
    if (!stored.content || await contentHash(stored.content)!==row.content_hash) throw Error('승인 자료의 파일 버전이 다릅니다.');
    const packet = validatePacket(stored.content,row,row.status!=='draft');
    if (b.action==='approve' || b.action==='publish') {
      if (c.role!=='teacher' || p.confirmed!==true) return reply({error:'교사 검수 확인이 필요합니다.'},403);
      validatePacket(packet,row,true);
      return reply(await rpc(b.action,{id:row.id,content_hash:row.content_hash,confirmed:true}));
    }
    if (b.action==='open') {
      let attempt = null;
      if (row.attempt) {
        const grade = gradePacket(packet,row.attempt.answers);
        attempt = {...grade,submitted_at:row.attempt.submitted_at};
      }
      return reply({id:row.id,week_start:row.week_start,status:row.status,packet:c.role==='teacher'?packet:studentPacket(packet),attempt});
    }
    if (c.role!=='student') return reply({error:'본인 학생 계정으로 응시하세요.'},403);
    const grade = gradePacket(packet,p.answers);
    const saved = await rpc('submit',{id:row.id,content_hash:row.content_hash,answers:grade.answers,correct:grade.correct});
    return reply({...saved,results:grade.results});
  } catch (e) { return reply({error:e instanceof Error?e.message:'처리하지 못했습니다.'},400); }
});
