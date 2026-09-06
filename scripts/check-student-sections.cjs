const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../student-sections.js'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const {replacement,noticeMatches}=require('../student-sections.js');
(async()=>{
 assert.equal(replacement({}),false);assert.equal(replacement({access_kind:'review'}),false);assert.equal(replacement({access_kind:'replacement'}),true);
 assert.equal(noticeMatches({},'general'),true);assert.equal(noticeMatches({notice_kind:'clinic'},'general'),false);
 const els={'access-grant-submit':{disabled:false},'access-grant-student':{selectedOptions:[{value:'s1'},{value:'s2'}]},'access-grant-video':{value:'v'},'access-grant-kind':{value:'replacement'},'access-absence-date':{value:'2026-09-06'},'student-replacement-list':{},'student-review-list':{}};
 const writes=[];let fail=false;
 const c={document:{getElementById:id=>els[id],addEventListener:()=>{}},session:{id:'t',role:'teacher'},studentPreviewMode:false,
 db:{users:[{id:'s1',name:'학생1'},{id:'s2',name:'학생2'}],videos:[{id:'v',title:'대체수업',category:'review'},{id:'r',title:'자율복습',category:'review'}],access:[],requests:[]},
 crypto:require('node:crypto').webcrypto,isAccessExpired:a=>!!a.expired,getPct:()=>25,accessExpiry:()=>new Date('2026-09-14'),
 notify:(msg,type)=>{c.notice={msg,type};},logVideoAccessGrant:async()=>{},renderAccessPanel:()=>{},renderDashboard:()=>{},
 sb:{from:()=>({upsert:async row=>{writes.push(row);return fail&&row.student_id==='s2'?{error:{message:'write failed'}}:{};}})},
 thumb:()=>'',getLastPos:()=>0,pctColor:()=>'',pctBadge:()=>'',pctLabel:()=>'',reviewVideoVisible:v=>v.student_visible!==false,
 };
 c.activeStudents=()=>c.db.users;c.reviewVideos=()=>c.db.videos;c.hasAccess=(sid,vid)=>c.db.access.some(a=>a.student_id===sid&&a.video_id===vid&&!a.expired);c.hasRequested=()=>false;
 c.window=c;vm.createContext(c);vm.runInContext(script,c);
 await c.grantVideoAssignment();assert.equal(writes.length,2);assert.equal(c.db.access.length,2);assert.equal(c.db.access[0].absence_date,'2026-09-06');assert.equal(c.db.access[0].access_kind,'replacement');assert.equal(c.db.access[0].expires_at,null);
 c.session={id:'s1',role:'student'};c.renderReplacementLectures();assert.match(els['student-replacement-list'].innerHTML,/대체수업/);assert.doesNotMatch(els['student-replacement-list'].innerHTML,/자율복습/);
 const a=html.indexOf('function renderStudentReview(){'),b=html.indexOf('function ',a+15);
 vm.runInContext(html.slice(a,b),c);c.renderStudentReview();assert.doesNotMatch(els['student-review-list'].innerHTML,/대체수업/);assert.match(els['student-review-list'].innerHTML,/자율복습/);
 c.session={id:'t',role:'teacher'};fail=true;await c.grantVideoAssignment();assert.equal(c.notice.type,'error');assert.match(c.notice.msg,/1명.*완료.*실패 1명/);assert.equal(els['access-grant-submit'].disabled,false);
 const before=writes.length;c.session={id:'s1',role:'student'};await c.grantVideoAssignment();assert.equal(writes.length,before,'students cannot use teacher assignment UI');
 for(const id of ['s-exam-clinic-groups','s-exam-list-homework','s-exam-list-mini-mock','s-exam-list-mock']){const card={};els[id]={closest:()=>card};}
 c.showSExamView=()=>{};c.sExamVisibleForStudent=()=>true;c.renderSExamClinicGroups=()=>{};c.renderSExamListCards=arr=>arr.map(e=>e.id).join(',');c.studentExamScope=null;
 c.sb={from:table=>({select:()=>({order:async()=>({data:[{id:'clinic',category:'school'},{id:'homework',category:'homework'},{id:'mock',category:'mock'}]}),eq:async()=>({data:[]})})})};
 const examStart=html.indexOf('async function renderSExam(scope)'),examEnd=html.indexOf('function renderSExamClinicGroups()',examStart);vm.runInContext(html.slice(examStart,examEnd),c);
 await c.renderSExam('clinic');assert.equal(c.sExamClinicCache.length,1);assert.equal(els['s-exam-list-homework'].closest().hidden,true);assert.doesNotMatch(els['s-exam-list-homework'].innerHTML,/homework/);
 await c.renderSExam('homework');assert.equal(c.sExamClinicCache.length,0);assert.match(els['s-exam-list-homework'].innerHTML,/homework/);assert.equal(els['s-exam-clinic-groups'].closest().hidden,true);
 els['s-announce-list']={};els['s-clinic-notice-list']={};c.myAnnounceItems=()=>[{id:'general',title:'과제 공지',created_at:'2026-09-06'},{id:'clinic',title:'클리닉 준비물',notice_kind:'clinic',created_at:'2026-09-06'}];c.isAnnounceRead=()=>false;c.announceImageUrls=()=>[];
 vm.runInContext(html.slice(html.indexOf('function isAnnounceAlert(item)'),html.indexOf('function announceReadCount')),c);
 const noticeStart=html.indexOf('function renderSAnnounceList(kind)'),noticeEnd=html.indexOf('async function openAnnounceView',noticeStart);assert.ok(noticeEnd>noticeStart);vm.runInContext(html.slice(noticeStart,noticeEnd),c);
 c.renderSAnnounceList();c.renderSAnnounceList('clinic');assert.match(els['s-announce-list'].innerHTML,/과제 공지/);assert.doesNotMatch(els['s-announce-list'].innerHTML,/클리닉 준비물/);assert.match(els['s-clinic-notice-list'].innerHTML,/클리닉 준비물/);
 const {PGlite}=require(process.env.PGLITE_PATH||'@electric-sql/pglite');const db=new PGlite();
 await db.exec("create table video_access(id text);create table video_access_log(id text);create table announcements(id text);insert into video_access values('legacy');insert into announcements values('old');");
 const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260906091000_student_sections.sql'),'utf8');await db.exec(migration);await db.exec(migration);
 assert.equal((await db.query('select access_kind from video_access')).rows[0].access_kind,'review');assert.equal((await db.query('select notice_kind from announcements')).rows[0].notice_kind,'general');
 await assert.rejects(db.exec("update video_access set access_kind='invalid'"));await db.close();
 console.log('PASS: replacement/review separation, batch assignment and partial failure, teacher guard, scoped exam/notice lists, legacy-safe SQL migration');
})().catch(e=>{console.error(e);process.exitCode=1;});
