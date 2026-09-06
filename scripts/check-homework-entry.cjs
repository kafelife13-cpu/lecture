const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function source(start,end){const i=html.indexOf(start);assert.ok(i>=0);return html.slice(i,html.indexOf(end,i));}
const fields={};let saved;
const c={document:{getElementById:id=>fields[id]||(fields[id]={value:'',textContent:'',innerHTML:''})},
  session:{id:'test',name:'test'},sExamCheckMode:'full',sWrongChecked:{},sExamAnswers:{},sExamPhotos:{},sExamThoughts:{},sExamPriorResponse:null,
  alert:msg=>{throw Error(msg)},sendStudentActivity:()=>{},showSExamView:()=>{},renderSExamResultView:()=>{},
  renderSExamAnswerGrid:()=>{},renderSExamListCards:list=>list.map(x=>x.name).join(','),
  sb:{from:()=>({upsert:async row=>{saved=row;return {};}})}};
vm.createContext(c);
vm.runInContext(source('function sHomeworkAllowsWrongOnly','function renderSExamClinicGroups'),c);
vm.runInContext(source('async function sExamSubmitScore','// 클리닉 오답 재풀이'),c);
(async()=>{
 const required={category:'homework',total_q:40,name:'필수시험'};
 const other={category:'homework',total_q:50,name:'추가시험'};
 assert.equal(c.sHomeworkWrongOnly(required),false);assert.equal(c.sHomeworkWrongOnly(other),false);
 assert.equal(c.sHomeworkAllowsWrongOnly(other),true);c.sExamCheckMode='wrongonly';assert.equal(c.sHomeworkWrongOnly(other),true);
 assert.equal(c.sHomeworkWrongOnly({category:'school',total_q:50}),false);
 const sections=c.renderHomeworkEntry([required,other],{}).split('<section style=');
 assert.match(sections[0],/필수 40문항/);assert.match(sections[0],/필수시험/);assert.doesNotMatch(sections[0],/추가시험/);assert.match(sections[1],/추가시험/);
 vm.runInContext(source('function renderSExamListCards','function showSExamView'),c);
 assert.match(c.renderSExamListCards([other],{},''),/전체 답안 입력/);
 assert.match(c.renderSExamListCards([other],{},''),/오답 번호만 입력/);
 assert.doesNotMatch(c.renderSExamListCards([required],{},''),/오답 번호만 입력/);
 const saveClient=c.sb;c.sExamVisibleForStudent=()=>true;c.sExamTimerStart=()=>{};
 let found=other;c.sb={from:table=>({select:()=>({eq:()=>({single:async()=>({data:found}),eq:()=>({maybeSingle:async()=>({data:null})})})})})};
 vm.runInContext(source('async function sExamOpenForGrading','/* ── FULL 모드:'),c);
 for(const id of ['s-exam-check-full','s-exam-check-wrong','s-exam-full-choice','s-exam-full-camera','s-exam-full-loading','s-exam-full-grid-wrap','s-mock-score-only','s-mock-score-only-btn','s-mock-entry-notice'])fields[id]={style:{}};
 await c.sExamOpenForGrading('test');assert.equal(c.sExamCheckMode,'full');
 await c.sExamOpenForGrading('test','wrongonly');assert.equal(c.sExamCheckMode,'wrongonly');
 found=required;await c.sExamOpenForGrading('test','wrongonly');assert.equal(c.sExamCheckMode,'full');
 c.sb=saveClient;c.sExamCheckMode='wrongonly';
 assert.equal(JSON.stringify(c.parseHomeworkWrongNumbers('2, 5 2,50',50)),'[1,4,49]');
 for(const input of ['0','51','-1','2.5','1-3','abc'])assert.throws(()=>c.parseHomeworkWrongNumbers(input,50));
 c.sExamData={...other,id:'test-exam',questions:Array.from({length:50},()=>({answer:1,points:1}))};
 fields['s-homework-wrong-numbers']={value:'2, 5, 50'};
 await c.sExamSubmitScore();assert.deepEqual(Object.keys(saved.answers),['1','4','49']);assert.equal(saved.correct_count,47);assert.equal(saved.score,94);
 fields['s-homework-wrong-numbers'].value='';await c.sExamSubmitScore();assert.equal(saved.score,100);assert.equal(Object.keys(saved.answers).length,0);
 saved=null;fields['s-homework-wrong-numbers'].value='51';await c.sExamSubmitScore();assert.equal(saved,null);
 const full=source('async function sExamSubmitFull(forceSubmit)','  const savedAnswers={};');
 c.sExamData={...required,questions:Array.from({length:40},()=>({answer:1}))};c.sExamFullAnswers={};c.isObjectiveAnswer=()=>true;
 vm.runInContext(full+'}',c);await assert.rejects(c.sExamSubmitFull(true),/필수 40문항/);
 console.log('PASS: 40-question routing, clinic unchanged, wrong-number validation/deduplication, saved errors, all-correct and required-answer guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
