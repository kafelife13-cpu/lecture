'use strict';
const {createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key=w=>`${w.exam_id}:${w.question_index}`;
const sameScope=(a,b)=>a.school===b.school&&a.grade===b.grade&&a.scope===b.scope;
const overlap=(a,b)=>(a||[]).some(x=>(b||[]).includes(x));
const normalize=x=>String(x).normalize('NFC').trim().replace(/\s+/g,' ');
function assert(ok,message){if(!ok)throw Error(message);}
function weekCheck(week){const d=new Date(`${week}T00:00:00Z`);assert(/^\d{4}-\d{2}-\d{2}$/.test(week)&&!isNaN(d)&&d.toISOString().slice(0,10)===week&&d.getUTCDay()===1,'week_start must be a valid Monday');}
function validateBank(bank){
 assert(Array.isArray(bank),'bank must be an array');const ids=new Set();
 for(const q of bank){
  assert(q&&typeof q.id==='string'&&q.id&&!ids.has(q.id),'missing or duplicate question id');ids.add(q.id);
  assert(['mcq','ox','blank'].includes(q.kind),'invalid question kind');
  assert(typeof q.text==='string'&&q.text.trim()&&Array.isArray(q.concepts)&&q.concepts.length,'text/concepts required');
  assert(q.school&&q.grade&&q.scope,'school/grade/scope required');
  if(q.status!=='approved')continue;
  assert(typeof q.explanation==='string'&&q.explanation.trim(),'approved question requires explanation');
  if(q.kind==='mcq')assert(Array.isArray(q.choices)&&q.choices.length===5&&q.choices.every(c=>typeof c==='string'&&c.trim())&&/^[1-5]$/.test(String(q.answer)),'MCQ requires 5 choices and one answer');
  if(q.kind==='ox')assert(['O','X'].includes(q.answer),'invalid OX answer');
  if(q.kind==='blank')assert(Array.isArray(q.accepted)&&q.accepted.length&&q.accepted.every(a=>typeof a==='string'&&a.trim()),'blank accepted answers required');
  assert(Array.isArray(q.evidence)&&q.evidence.some(e=>e.approved===true&&e.source_id&&e.page&&e.quote),'approved source evidence required');
 }
 return bank;
}
// Only explicit graded outcomes enter the ledger; latest correct removes older wrong.
function currentWrongs(records,student,week,cutoff){
 const end=Date.parse(cutoff);assert(Number.isFinite(end),'valid cutoff required');
 const latest=new Map();let excluded=0;
 for(const r of records){
  if(r.student_id!==student.id||!sameScope(r,student)||r.week_start!==week||!['homework','clinic'].includes(r.channel))continue;
  const time=Date.parse(r.submitted_at);
  if(!Number.isFinite(time)||time>end||r.graded!==true||typeof r.correct!=='boolean'||!r.response_id||!r.exam_id||!Number.isInteger(r.question_index)||r.question_index<0){excluded++;continue;}
  const old=latest.get(key(r));
  if(!old||time>Date.parse(old.submitted_at)||(time===Date.parse(old.submitted_at)&&String(r.response_id)>String(old.response_id)))latest.set(key(r),r);
 }
 return {wrongs:[...latest.values()].filter(r=>!r.correct),excluded};
}
function plan({student,week_start,cutoff,records,bank,reviewed_links=[],history=[],core_concepts=[]}){
 weekCheck(week_start);validateBank(bank);assert(student.id&&student.school&&student.grade&&student.scope,'student scope required');
 const {wrongs,excluded}=currentWrongs(records,student,week_start,cutoff);
 const recent=history.filter(h=>h.student_id===student.id&&h.week_start<week_start&&h.submitted===true);
 const failures=new Map();for(const h of recent)for(const c of h.wrong_concepts||[])failures.set(c,(failures.get(c)||0)+1);
 const score=w=>(w.concepts||[]).reduce((n,c)=>n+(failures.get(c)||0)*10+(core_concepts.includes(c)?3:0),0);
 wrongs.sort((a,b)=>score(b)-score(a)||Date.parse(b.submitted_at)-Date.parse(a.submitted_at)||key(a).localeCompare(key(b)));
 const chosen=wrongs.slice(0,10),used=new Set(),items=[],missing=[];
 const originalTexts=new Set(wrongs.map(w=>normalize(w.text||'')).filter(Boolean));
 const originalIds=new Set(wrongs.map(w=>w.bank_id).filter(Boolean));
 const fingerprints=new Set();
 const eligible=q=>q.status==='approved'&&sameScope(q,student)&&!used.has(q.id)&&!originalIds.has(q.id)&&!originalTexts.has(normalize(q.text))&&!fingerprints.has(normalize(q.text));
 const take=(q,role,origin)=>{used.add(q.id);fingerprints.add(normalize(q.text));items.push({...q,role,origin:origin?key(origin):null});};
 for(const w of chosen)for(const role of ['similar','concept']){
  const ids=new Set(reviewed_links.filter(l=>l.approved===true&&l.origin===key(w)&&l.role===role&&l.reason&&l.origin_fingerprint===hash({text:w.text,answer:w.answer,concepts:w.concepts})).map(l=>l.question_id));
  const q=bank.find(q=>eligible(q)&&q.kind==='mcq'&&ids.has(q.id)&&overlap(q.concepts,w.concepts)&&(role!=='similar'||q.origin_type==='existing'));
  if(q)take(q,role,w);else missing.push({kind:'mcq',role,origin:key(w),reason:'검수된 연결 문항 부족 또는 원문 변경'});
 }
 const supplement=20-chosen.length*2;
 const fillers=bank.filter(q=>eligible(q)&&q.kind==='mcq'&&q.core===true&&overlap(q.concepts,core_concepts));
 let filled=0;for(const q of fillers){if(filled===supplement)break;if(eligible(q)){take(q,'core');filled++;}}
 if(filled<supplement)missing.push({kind:'mcq',role:'core',count:supplement-filled,reason:'이번 범위 핵심 개념 보충 문항 부족'});
 const lastYear=Number(week_start.slice(0,4))-1;
 const trusted=q=>(q.evidence||[]).filter(e=>e.approved===true&&e.school===student.school&&e.scope===student.scope&&e.source_id&&e.page&&e.quote);
 const needs=new Set([...core_concepts,...chosen.flatMap(w=>w.concepts||[])]);
 let ox=0;for(const q of bank){if(ox===20)break;if(eligible(q)&&q.kind==='ox'&&overlap(q.concepts,[...needs])&&trusted(q).some(e=>e.kind==='school_print'||(e.kind==='past_exam'&&e.year===lastYear))){take(q,'core_ox');ox++;}}
 if(ox<20)missing.push({kind:'ox',count:20-ox,reason:'학교 프린트/작년 기출 근거 OX 부족'});
 const oxEvidence=items.filter(q=>q.kind==='ox').flatMap(trusted);
 for(const kind of ['school_print','past_exam'])if(!oxEvidence.some(e=>e.kind===kind&&(kind!=='past_exam'||e.year===lastYear)))missing.push({kind:'evidence',reason:`OX 근거 없음: ${kind}`});
 const blanks=bank.filter(q=>eligible(q)&&q.kind==='blank'&&trusted(q).some(e=>e.kind==='school_print')&&overlap(q.concepts,[...needs])).slice(0,10);
 const draft={student_id:student.id,school:student.school,grade:student.grade,scope:student.scope,week_start,cutoff,items,blanks,missing,excluded,selected_origins:chosen.map(key),deferred:wrongs.slice(10).map(key),current_wrong_count:wrongs.length};
 return {...draft,id:hash(draft).slice(0,32),status:missing.length?'blocked':'review',counts:{mcq:items.filter(q=>q.kind==='mcq').length,ox}};
}
function approve(p,reviewer){assert(p.status==='review'&&p.missing.length===0&&p.counts.mcq===20&&p.counts.ox===20,'Incomplete packet cannot be approved');assert(typeof reviewer==='string'&&reviewer.trim(),'reviewer required');return {...p,status:'approved',reviewer};}
function studentView(p){assert(p.status==='approved','Not published');return {id:p.id,week_start:p.week_start,scope:p.scope,items:p.items.filter(q=>q.kind==='ox').map(({id,kind,text,passage,origin_type})=>({id,kind,text,passage,origin_type})),blanks:p.blanks.map(({id,kind,text,passage})=>({id,kind,text,passage}))};}
function grade(p,studentId,answers){
 assert(p.status==='approved'&&p.student_id===studentId,'Access denied');assert(answers&&typeof answers==='object'&&!Array.isArray(answers),'answers required');
 const items=p.items.filter(q=>q.kind==='ox');assert(items.length===20,'20 OX required');
 const ids=new Set(items.map(q=>q.id));assert(Object.keys(answers).length===20&&Object.keys(answers).every(id=>ids.has(id)),'Submit exactly 20 OX answers');
 const results=items.map(q=>{const a=String(answers[q.id]);assert(typeof answers[q.id]==='string'&&['O','X'].includes(a),'Invalid answer');return {question_id:q.id,correct:a===String(q.answer),answer:q.answer,student_answer:a,explanation:q.explanation,concepts:q.concepts};});
 return {packet_id:p.id,student_id:studentId,week_start:p.week_start,submitted:true,score:results.filter(r=>r.correct).length,total:20,wrong_concepts:[...new Set(results.filter(r=>!r.correct).flatMap(r=>r.concepts))],results};
}
function submit(p,studentId,answers,previous){
 assert(p.student_id===studentId,'Access denied');
 if(previous){assert(previous.student_id===studentId&&previous.week_start===p.week_start,'Submission ledger mismatch');return studentResult(p,previous);}
 return grade(p,studentId,answers);
}
function studentResult(p,previous){
 const answers=Object.fromEntries((previous.results||[]).filter(r=>p.items.some(q=>q.kind==='ox'&&q.id===r.question_id)).map(r=>[r.question_id,r.student_answer]));
 return grade(p,p.student_id,answers);
}
function blankGrade(q,answer){assert(q.kind==='blank','blank required');return q.accepted.some(a=>normalize(a)===normalize(answer));}
module.exports={plan,approve,studentView,grade,submit,studentResult,blankGrade,currentWrongs,validateBank,hash};
