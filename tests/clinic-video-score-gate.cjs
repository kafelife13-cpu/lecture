const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const ctx={ytId:url=>url.split('/').pop(),weeklyExamSchoolId:s=>s==='한백고'?'sc_hanbaek':s==='치동고'?'sc_chidong':''};
vm.createContext(ctx);
for(const name of ['clinicVideoSchool','clinicVideoDescription','clinicVideoExamId','clinicVideoScoreState','loadClinicVideoScores','renderClinicLectures','openPlay']){
  const start=html.indexOf('function '+name+'('),lineEnd=html.indexOf('\n',start);
  const end=html.slice(start,lineEnd).trim().endsWith('}')?lineEnd:html.indexOf('\n}',start)+2;
  vm.runInContext((html.slice(start-6,start)==='async '?'async ':'')+html.slice(start,end),ctx);
}
const student={id:'student-a',name:'same-name',role:'student',school_id:'sc_hanbaek'};
const video={id:'week3-video',url:'https://youtu.be/vbZmrNkQd-o',title:'한백고1 기말대비 클리닉 3주 해설강의',category:'clinic'};
const exam={id:'4cd3f973-666a-5f36-acca-9f2b0d4b4ef4',category:'school',name:'기말대비 3주차 클리닉',clinic_school:'한백고'};
const response={exam_id:exam.id,student_id:student.id,score:0};
const state=(responses,exams=[exam],s=student,v=video)=>ctx.clinicVideoScoreState(v,s,exams,responses);
assert.equal(ctx.clinicVideoExamId(video),exam.id);
assert.notEqual(ctx.clinicVideoExamId({...video,url:'https://youtu.be/3pq_DTn7wS0'}),exam.id);
for(const score of [0,50,70,100,'0','100'])assert.equal(state([{...response,score}]).allowed,true);
for(const score of [null,undefined,'',' ',NaN,-1,101,'bad'])assert.equal(state([{...response,score}]).allowed,false);
assert.equal(state([]).allowed,false);
assert.equal(state([{...response,student_id:'another',student_name:'same-name'}]).allowed,false,'names do not unlock another student');
assert.equal(state([{...response,exam_id:'another-week'}]).allowed,false);
assert.equal(state([response],[{...exam,category:'homework'}]).allowed,false);
assert.equal(state([response],[{...exam,clinic_school:'치동고'}]).allowed,false);
assert.equal(state([response],[],student).allowed,false,'deleted exams stay locked');
assert.equal(state([response],[exam],{...student,school_id:'sc_chidong'}).allowed,false);
assert.equal(state([response],[exam],student,{...video,url:'https://youtu.be/unmapped'}).allowed,false);
assert.equal(ctx.clinicVideoExamId({...video,description:'설명 [학교:sc_hanbaek] [시험:explicit-id]'}),'explicit-id');
assert.equal(ctx.clinicVideoDescription({description:'설명 [학교:sc_hanbaek] [시험:explicit-id]'}),'설명');
let filters=[],fail=false;
ctx.sb={from(table){const query={select(){return this;},eq(k,v){filters.push([table,k,v]);return this;},in(){return Promise.resolve({data:table==='exams'?[exam]:[response],error:fail?Error('offline'):null});}};return query;}};
(async()=>{
  const data=await ctx.loadClinicVideoScores([video],student);
  assert.equal(state(data.responses,data.exams).allowed,true);
  assert.ok(filters.some(x=>x[0]==='exam_responses'&&x[1]==='student_id'&&x[2]===student.id));
  fail=true;await assert.rejects(ctx.loadClinicVideoScores([video],student),/성적 확인 실패/);fail=false;
  const list={innerHTML:''};
  Object.assign(ctx,{session:student,clinicVideoListRequest:0,document:{getElementById:()=>list},studentClinicVideosForWeek:()=>[video],allStudentClinicVideos:()=>[video],hasAccess:()=>true,getPct:()=>0,getWatchSec:()=>0,getLastPos:()=>0,thumb:()=>'',pctColor:()=>'',pctBadge:()=>'',pctLabel:()=>'',escHtml:s=>String(s)});
  const queryScores=ctx.loadClinicVideoScores;
  ctx.loadClinicVideoScores=async()=>({exams:[exam],responses:[]});
  await ctx.renderClinicLectures();assert.match(list.innerHTML,/성적 입력하기/);assert.ok(!list.innerHTML.includes('onclick="openPlay'));
  ctx.loadClinicVideoScores=queryScores;await ctx.renderClinicLectures();assert.match(list.innerHTML,/onclick="openPlay/);
  fail=true;await ctx.renderClinicLectures();assert.match(list.innerHTML,/다시 확인/);assert.ok(!list.innerHTML.includes('onclick="openPlay'));fail=false;
  let modal=0,init=0,resume=0,notices=[],nav=[];
  Object.assign(ctx,{session:student,db:{videos:[video]},playRequest:0,studentVideoInScope:()=>true,hasAccess:()=>true,
    notify:msg=>notices.push(msg),sNav:p=>nav.push(p),getLastPos:()=>120,getPct:()=>10,showResumeModal:()=>resume++,
    studentPreviewMode:true,chapterRecords:[],startVideoPresenceMonitor:async()=>true,sendStudentActivity(){},
    KkakkaVideoChapters:{get:()=>[],render(){}},document:{getElementById:()=>({classList:{add:()=>modal++}})},
    ytApiReady:true,initYT:()=>init++,currentVid:null});
  ctx.loadClinicVideoScores=async()=>({exams:[exam],responses:[]});
  await ctx.openPlay(video.id);await ctx.openPlay(video.id,true);
  assert.equal(resume,0,'resume and direct/required playback both check the score first');assert.equal(init,0);assert.equal(modal,0);
  assert.ok(notices.some(x=>x.includes('성적을 먼저')));
  ctx.loadClinicVideoScores=async()=>{throw Error('offline');};
  await ctx.openPlay(video.id,true);assert.equal(init,0,'lookup failure stays locked');
  ctx.loadClinicVideoScores=async()=>({exams:[exam],responses:[response]});
  await ctx.openPlay(video.id);assert.equal(resume,1);
  await ctx.openPlay(video.id,true);assert.equal(init,1,'zero score unlocks the player');
  ctx.loadClinicVideoScores=async()=>{ctx.session={...student,id:'next-student'};return {exams:[exam],responses:[response]};};
  await ctx.openPlay(video.id,true);assert.equal(init,1,'a late result cannot open a new student session');
  ctx.session=student;ctx.loadClinicVideoScores=async()=>{ctx.playRequest++;return {exams:[exam],responses:[response]};};
  await ctx.openPlay(video.id,true);assert.equal(init,1,'a cancelled player request remains closed');
  ctx.loadClinicVideoScores=async()=>{throw Error('non-clinic should not query');};
  video.category='normal';await ctx.openPlay(video.id,true);assert.equal(init,2,'ordinary lessons remain unchanged');
  console.log('PASS: exact exam/student/school, zero score, absent/invalid score, fresh database reads, required/resume/direct entry, lookup errors and stale sessions');
})().catch(error=>{console.error(error);process.exitCode=1;});
