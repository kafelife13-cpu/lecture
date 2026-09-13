const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function source(start,end){const i=html.indexOf(start);assert.ok(i>=0);return html.slice(i,html.indexOf(end,i));}
const fields={};let saved;
const c={document:{getElementById:id=>fields[id]||(fields[id]={value:'',textContent:'',innerHTML:''})},
  session:{id:'test',name:'test'},sExamCheckMode:'full',sWrongChecked:{},sExamAnswers:{},sExamPhotos:{},sExamThoughts:{},sExamPriorResponse:null,
  alert:msg=>{throw Error(msg)},sendStudentActivity:()=>{},showSExamView:()=>{},renderSExamResultView:()=>{},
  renderWrongDetails:()=>{},renderSExamAnswerGrid:()=>{},renderSExamListCards:list=>list.map(x=>x.name).join(','),
  sb:{from:()=>({upsert:async row=>{saved=row;return {};}})}};
vm.createContext(c);
const objectiveStart=html.indexOf('function isObjectiveAnswer');
vm.runInContext(html.slice(objectiveStart,html.indexOf('\n',objectiveStart)),c);
vm.runInContext(source('function sHomeworkRequired','function renderSExamClinicGroups'),c);
vm.runInContext(source('function homeworkMissingAnswers','function homeworkWrittenAnswers'),c);
vm.runInContext(source('async function sExamSubmitScore','// 클리닉 오답 재풀이'),c);
(async()=>{
 const required={category:'homework',total_q:40,name:'필수시험'};
 const other={category:'homework',total_q:50,name:'추가시험'};
 const hanbaekWeek3={category:'homework',total_q:50,name:'[한백고1] 내신 3주차 필수 과제 1~50번'};
 const hanbaekWeek3Free={category:'homework',total_q:77,name:'[한백고1] 내신 3주차 자유 과제 51~127번'};
 const chidongWeek3={category:'homework',total_q:40,name:'[치동고1] 내신 3주차 필수 과제 1~40번'};
 const chidongWeek3Free={category:'homework',total_q:60,name:'[치동고1] 내신 3주차 자유 과제 41~100번'};
 assert.equal(c.sHomeworkWrongOnly(required),false);assert.equal(c.sHomeworkWrongOnly(other),false);
 assert.equal(c.sHomeworkAllowsWrongOnly(other),true);assert.equal(c.sHomeworkAllowsWrongOnly(required),true);c.sExamCheckMode='wrongonly';assert.equal(c.sHomeworkWrongOnly(other),true);assert.equal(c.sHomeworkWrongOnly(required),true);
 assert.equal(c.sHomeworkWrongOnly({category:'school',total_q:50}),false);
 const sections=c.renderHomeworkEntry([required,other],{}).split('<section style=');
 assert.match(sections[0],/필수 과제 입력/);assert.match(sections[0],/필수시험/);assert.doesNotMatch(sections[0],/추가시험/);assert.match(sections[1],/추가시험/);
 vm.runInContext(source('function renderSExamListCards','function showSExamView'),c);
 assert.match(c.renderSExamListCards([other],{},''),/전체 답안 입력/);
 assert.match(c.renderSExamListCards([other],{},''),/틀린 문제만 입력/);
 for(const exam of [required,hanbaekWeek3,hanbaekWeek3Free,chidongWeek3,chidongWeek3Free])assert.match(c.renderSExamListCards([exam],{},''),/틀린 문제만 입력/);
 const saveClient=c.sb;c.sExamVisibleForStudent=()=>true;c.sExamTimerStart=()=>{};
 let found=other;c.sb={from:table=>({select:()=>({eq:()=>({single:async()=>({data:found}),eq:()=>({maybeSingle:async()=>({data:null})})})})})};
 vm.runInContext(source('async function sExamOpenForGrading','/* ── FULL 모드:'),c);
 for(const id of ['s-exam-check-full','s-exam-check-wrong','s-exam-full-choice','s-exam-full-camera','s-exam-full-loading','s-exam-full-grid-wrap','s-mock-score-only','s-mock-score-only-btn','s-mock-entry-notice'])fields[id]={style:{}};
 await c.sExamOpenForGrading('test');assert.equal(c.sExamCheckMode,'full');
 await c.sExamOpenForGrading('test','wrongonly');assert.equal(c.sExamCheckMode,'wrongonly');
 found=hanbaekWeek3;await c.sExamOpenForGrading('test','wrongonly');assert.equal(c.sExamCheckMode,'wrongonly');assert.equal(fields['s-homework-wrong-input'].hidden,false);
 found=chidongWeek3;await c.sExamOpenForGrading('test','wrongonly');assert.equal(c.sExamCheckMode,'wrongonly');assert.equal(fields['s-homework-wrong-input'].hidden,false);
 c.sb=saveClient;c.sExamCheckMode='wrongonly';
 assert.equal(JSON.stringify(c.parseHomeworkWrongNumbers('2, 5 2,50',50)),'[1,4,49]');
 for(const input of ['0','51','-1','2.5','1-3','abc'])assert.throws(()=>c.parseHomeworkWrongNumbers(input,50));
 c.sExamData={...other,id:'test-exam',questions:Array.from({length:50},()=>({answer:1,points:1}))};
 fields['s-homework-wrong-numbers']={value:'2, 5, 50'};
 fields['s-homework-wrong-numbers'].value='2, ';c.sHomeworkApplyWrongNumbers(true);assert.equal(fields['s-homework-wrong-numbers'].value,'2, ');
 fields['s-homework-wrong-numbers'].value='2, 5, 50';
 assert.ok(html.indexOf('id="s-wrong-details"')<html.indexOf('id="s-exam-q-grid"'));
 assert.match(html,/oninput="sHomeworkApplyWrongNumbers\(true\)"/);
 await c.sExamSubmitScore();assert.equal(saved,undefined);assert.match(fields['s-exam-check-err'].textContent,/선택한 답/);
 c.sExamAnswers={1:'1',4:'2',49:'3'};await c.sExamSubmitScore();assert.equal(saved,undefined);assert.match(fields['s-exam-check-err'].textContent,/일치하지/);
 c.sExamAnswers={1:'4',4:'2',49:'3'};
 await c.sExamSubmitScore();assert.equal(saved.answers[1],'4');assert.deepEqual(Object.keys(saved.answers),['1','4','49']);assert.equal(saved.correct_count,47);assert.equal(saved.score,94);
 c.sExamData={...hanbaekWeek3,id:'hanbaek-week-3',questions:Array.from({length:50},()=>({answer:1,points:1}))};
 fields['s-homework-wrong-numbers'].value='2';c.sExamAnswers={1:'4'};await c.sExamSubmitScore();assert.equal(saved.exam_id,'hanbaek-week-3');assert.equal(saved.answers[1],'4');assert.equal(saved.correct_count,49);
 c.sExamData={...other,id:'test-exam',questions:Array.from({length:50},()=>({answer:1,points:1}))};
 fields['s-homework-wrong-numbers'].value='';await c.sExamSubmitScore();assert.equal(saved.score,100);assert.equal(Object.keys(saved.answers).length,0);
 saved=null;fields['s-homework-wrong-numbers'].value='51';await c.sExamSubmitScore();assert.equal(saved,null);
 const full=source('async function sExamSubmitFull(forceSubmit)','  const savedAnswers={};');
 c.sExamData={...required,questions:Array.from({length:40},()=>({answer:1}))};c.sExamFullAnswers={};
 vm.runInContext(full+'}',c);await assert.rejects(c.sExamSubmitFull(true),/필수 40문항/);
 vm.runInContext(source('function tResBuildPrintHTML','function tResPrintHTML'),c);
 const printed=c.tResBuildPrintHTML('test',{answers:{0:'4'}},{name:'test',total_q:1,questions:[{num:41,answer:2,type:'객관식'}]});assert.match(printed,/41번/);assert.match(printed,/내 답 4번/);
 assert.doesNotMatch(source('function renderWrongDetails','function sExamPickAnswer'),/sHomeworkWrongOnly/);
 console.log('PASS: every homework supports wrong-only entry, week 3 routing/storage, clinic unchanged, validation/deduplication, saved errors, all-correct and required full-answer guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
