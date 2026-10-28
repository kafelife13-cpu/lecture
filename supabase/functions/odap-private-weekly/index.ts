import { boundedJSON, claude, drive } from './services.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { validatePacket, studentPacket, gradePacket, gradeStoredAttempt, contentHash } from '../../../odap/private-weekly-core.mjs';
import { reviewEvidence, reviewMessages, REVIEW_SYSTEM, validateReview, GENERATE_SYSTEM, generatedPacket } from '../../../odap/private-weekly-review.mjs';

const allowedOrigins = new Set(['https://kafelife13-cpu.github.io', 'http://127.0.0.1:8876']);
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
    if (!['list','open','submit','create','revise','approve','publish','generate_ox','review_publish'].includes(b.action)) throw Error('지원하지 않는 작업입니다.');
    const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const rpc = async (action:string,payload:unknown={}) => {
      const {data,error} = await db.rpc('odap_private_weekly_rpc',{p_id:c.id,p_password:c.pw,p_role:c.role,p_action:action,p_payload:payload});
      if (error) throw Error(error.code==='23505'?'이번 주 자료 또는 제출이 이미 있습니다.':error.message);
      return data;
    };
    await rpc('profile');
    // No client checkbox or asserted reviewed flag can bypass the independent server review.
    if(['approve','publish'].includes(b.action))return reply({error:'Claude 자동 검수와 게시를 사용하세요.'},403);
    if (b.action==='list') return reply(await rpc('list',c.role==='teacher'?{student_id:p.student_id}:{}));
    if (b.action==='create' || b.action==='revise') {
      if (c.role!=='teacher') return reply({error:'교사 전용입니다.'},403);
      const previous=b.action==='revise'?await rpc('get',{id:p.id}):null;
      if(previous){if(previous.status!=='draft')throw Error('검수 대기 자료만 수정할 수 있습니다.');Object.assign(p,{student_id:previous.student_id,school:previous.school,week_start:previous.week_start});}
      if (typeof p.student_id!=='string' || typeof p.school!=='string' || !p.school.trim() || typeof p.week_start!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.week_start)) throw Error('학생·학교·주차를 확인하세요.');
      const date = new Date(p.week_start+'T00:00:00Z');
      if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0,10)!==p.week_start || date.getUTCDay()!==1) throw Error('주차는 월요일이어야 합니다.');
      validatePacket(p.packet,p,false);
      delete p.packet.review;
      for(const item of p.packet.items)item.reviewed=false;
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
    if (b.action==='generate_ox' || b.action==='review_publish') {
      if(c.role!=='teacher')return reply({error:'교사 전용입니다.'},403);
      // Recover a response lost after approval/publication without repeating paid model calls.
      if(b.action==='review_publish'&&row.status!=='draft'){
        if(packet.review?.provider!=='anthropic'||packet.review?.state!=='passed')throw Error('Claude 검수를 거치지 않은 기존 승인 자료입니다.');
        const result=row.status==='published'?{id:row.id,status:row.status}:await rpc('publish',{id:row.id,content_hash:row.content_hash,confirmed:true});
        return reply({...result,review:packet.review});
      }
      if(row.status!=='draft')throw Error('게시 전 초안만 생성·검수할 수 있습니다.');
      const evidence=reviewEvidence(packet);
      let updated;
      if(b.action==='generate_ox'){
        // Only verified same-school school-print/last-year quotes are OX generation inputs.
        const sources=evidence.filter(e=>e.school===row.school&&(e.kind==='학교 프린트'||(['학교 기출','내신 기출'].includes(e.kind)&&e.year===Number(row.week_start.slice(0,4))-1)));
        if(!sources.some(e=>e.kind==='학교 프린트')||!sources.some(e=>['학교 기출','내신 기출'].includes(e.kind)))throw Error('학교 프린트와 작년 기출 근거가 부족하여 생성하지 않았습니다.');
        const result=await claude(GENERATE_SYSTEM,[{role:'user',content:JSON.stringify({sources:sources.map(e=>({source_id:e.source_id,page:e.page,quote:e.quote,kind:e.kind,year:e.year,original_exam_verified:e.original_exam_verified}))})}],14000);
        updated=generatedPacket(packet,sources,result.value);
        validatePacket(updated,row,false);
      }else{
        validatePacket({...packet,items:packet.items.map(q=>({...q,reviewed:true}))},row,true);
        // Separate, blind-answer reviewer calls; no student title/name/id/answers are sent.
        const batches=[];for(let i=0;i<packet.items.length;i+=10)batches.push(packet.items.slice(i,i+10));
        const reports=await Promise.all(batches.map(async items=>{const result=await claude(REVIEW_SYSTEM,reviewMessages(items),6000);return {items:validateReview(items,result.value),model:result.model};}));
        updated={...packet,items:packet.items.map(q=>({...q,reviewed:true})),review:{provider:'anthropic',state:'passed',model:reports[0].model,reviewed_at:new Date().toISOString(),reviewed_content_hash:row.content_hash,scope:'provided_source_quotes_and_images',items:reports.flatMap(r=>r.items)}};
        validatePacket(updated,row,true);
      }
      const hash=await contentHash(updated);
      const saved=await drive('put',{request_id:crypto.randomUUID(),content:updated,content_hash:hash});
      if(!saved||typeof saved.file_id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(saved.file_id))throw Error('Drive 파일 ID가 올바르지 않습니다.');
      const check=await drive('get',{file_id:saved.file_id});
      if(!check.content||await contentHash(check.content)!==hash)throw Error('Drive 저장 내용이 일치하지 않습니다.');
      const revised=await rpc('revise',{id:row.id,previous_hash:row.content_hash,title:updated.title,drive_file_id:saved.file_id,content_hash:hash});
      if(b.action==='generate_ox')return reply({...revised,generated:20});
      await rpc('approve',{id:row.id,content_hash:hash,confirmed:true});
      return reply({...await rpc('publish',{id:row.id,content_hash:hash,confirmed:true}),review:updated.review});
    }
    if (b.action==='open') {
      let attempt = null;
      if (row.attempt) {
        const grade = gradeStoredAttempt(packet,row.attempt.answers);
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
