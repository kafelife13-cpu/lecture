const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function source(start,end){const i=html.indexOf(start);assert.ok(i>=0);const j=html.indexOf(end,i);assert.ok(j>i);return html.slice(i,j);}
const fields={}; let saved;
const exam={id:'test',category:'homework',total_q:69,questions:Array.from({length:69},(_,i)=>({num:i+41,answer:'4',points:2,domain:i<20?'중세·용비':i<60?'용언':'규원가'}))};
exam.questions[31].answer='';
const c={sExamData:exam,sExamFullAnswers:{},sExamCheckMode:'wrongonly',sWrongChecked:{},sExamAnswers:{},sExamPhotos:{},sExamThoughts:{},sExamPriorResponse:null,session:{id:'test'},
 document:{getElementById:id=>fields[id]||(fields[id]={value:'',innerHTML:'',style:{}})},escHtml:s=>s,isObjectiveAnswer:a=>/^[1-5]$/.test(a),updateWrongCountLabel:()=>{},
 sendStudentActivity:()=>{},showSExamView:()=>{},renderSExamResultView:()=>{},sb:{from:()=>({upsert:async row=>{saved=row;return {};}})}};
vm.createContext(c);
vm.runInContext(source('function sHomeworkAllowsWrongOnly','function renderSExamClinicGroups'),c);
vm.runInContext(source('function renderSExamFullGrid()','function sExamPickFullAnswer'),c);
vm.runInContext(source('function renderSExamAnswerGrid()','function sToggleWrong'),c);
vm.runInContext(source('async function sExamSubmitScore','// 클리닉 오답 재풀이'),c);
(async()=>{
 assert.equal(JSON.stringify(c.parseHomeworkWrongNumbers('41, 60 61,100,101,109,41',exam)),'[0,19,20,59,60,68]');
 for(const s of ['1','40','110','41.5','41-45','NaN'])assert.throws(()=>c.parseHomeworkWrongNumbers(s,exam));
 assert.equal(JSON.stringify(c.parseHomeworkWrongNumbers('1,3',3)),'[0,2]');
 c.renderSExamFullGrid();const full=fields['s-exam-full-grid'].innerHTML;
 for(const n of [41,60,61,72,100,101,109])assert.ok(full.includes('>'+n+'번</span>'));
 assert.ok(full.includes('서술형·주관식'));assert.equal((full.match(/<h3 /g)||[]).length,3);
 assert.ok(full.includes('sExamPickFullAnswer(0,4)'));
 c.sWrongChecked={0:true,68:true};c.renderSExamAnswerGrid();assert.equal(fields['s-homework-wrong-numbers'].value,'41, 109');
 assert.ok(fields['s-exam-q-grid'].innerHTML.includes('>109</button>'));
 fields['s-homework-wrong-numbers'].value='41,109';await c.sExamSubmitScore();assert.deepEqual(Object.keys(saved.answers),['0','68']);assert.equal(saved.correct_count,67);
 fields['s-homework-wrong-numbers'].value='1';saved=null;await c.sExamSubmitScore();assert.equal(saved,null);
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 console.log('PASS: paper numbers 41–109, three sections, subjective label, validation, index-safe storage, inline syntax');
})().catch(e=>{console.error(e);process.exitCode=1;});
