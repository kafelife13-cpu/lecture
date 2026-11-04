const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const ctx={};vm.createContext(ctx);
for(const name of ['isObjectiveAnswer','examDefaultAnswer','examAnswerLabel','examAnswerMatches','examToggleAnswer','repIsWrong','repScore','examQuestionNumber','homeworkWrittenAnswers','sHomeworkRequired','sExamSubmitFull','sExamPickFullAnswer','omrManualEntry']){
 const start=html.indexOf('function '+name+'(');
 assert.ok(start>=0,name);
 const lineEnd=html.indexOf('\n',start),end=html.slice(start,lineEnd).trim().endsWith('}')?lineEnd:html.indexOf('\n}',start)+2;
 vm.runInContext((html.slice(start-6,start)==='async '?'async ':'')+html.slice(start,end),ctx);
}
assert.equal(ctx.isObjectiveAnswer('any:4,5'),true);
for(const key of ['any:4,6','any:4,','any:','4,5'])assert.equal(ctx.isObjectiveAnswer(key),false,key);
for(const value of ['4','5',' 4 '])assert.equal(ctx.examAnswerMatches(value,'any:4,5'),true,value);
for(const value of ['1','2','3','','4,5','any:4,5'])assert.equal(ctx.examAnswerMatches(value,'any:4,5'),false,value);
assert.equal(ctx.examAnswerMatches('1,4','all:1,4'),true);
assert.equal(ctx.examAnswerMatches('4','all:1,4'),false);
assert.equal(ctx.examAnswerMatches('2','2'),true);
assert.equal(ctx.examAnswerMatches('1,4','1,4'),true,'legacy written key preserved');
assert.equal(ctx.examDefaultAnswer('any:4,5'),'4');
assert.equal(ctx.examDefaultAnswer('all:1,4'),'1,4');
assert.equal(ctx.examAnswerLabel('any:4,5'),'4 또는 5');
assert.equal(ctx.examToggleAnswer('4',5,'any:4,5'),'5','choose one alternative');
let saved,rendered=0;
const exam={id:'local-test',category:'school',total_q:25,questions:Array.from({length:25},(_,i)=>({num:i+1,answer:i===5?'any:4,5':'1',points:4}))};
Object.assign(ctx,{sExamData:exam,sExamFullAnswers:{},sExamPriorResponse:null,sOmrCurrentPhoto:null,session:{name:'local-test'},alert:()=>{},sExamIsTimedMock:()=>false,isLiteratureExam:()=>false,renderSExamFullGrid:()=>rendered++,odapSaveResponse:async value=>{saved=value;return {error:{message:'stop after local capture'}};}});
(async()=>{
 for(const value of ['4','5','3','4,5','']){
  ctx.sExamFullAnswers=Object.fromEntries(exam.questions.map((q,i)=>[i,i===5?value:'1']));
  await ctx.sExamSubmitFull(true);
  const correct=['4','5'].includes(value);
  assert.equal(saved.score,correct?100:96,value);
  assert.equal(saved.correct_count,correct?25:24,value);
  assert.equal(saved.total_q,25);assert.equal(saved.points_total,100);
  assert.equal(ctx.repScore(exam,saved).pct,saved.score);
  assert.equal(ctx.repIsWrong(saved,5,exam),!correct);
 }
 ctx.sExamFullAnswers={5:'4'};ctx.sExamPickFullAnswer(5,5);
 assert.equal(ctx.sExamFullAnswers[5],'5');assert.equal(rendered,1);
 const old={answers:{},photo_urls:{omr:'keep'},thoughts:{keep:true}};
 Object.assign(ctx,{tResCurrentExam:exam,document:{getElementById:id=>({value:'local-test',style:{},textContent:''})},sb:{from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:old})})})})})},renderOmrReview:()=>{},notify:()=>{throw Error('unexpected error');}});
 await ctx.omrManualEntry();assert.equal(ctx.omrReadAnswers[5],'4');
 assert.equal(ctx.omrExistingResponse,old);
 console.log('PASS: either 4 or 5 earns full credit, other/combined/blank answers fail; weighted submission, reports, retry and OMR restoration agree; all-answer and legacy keys preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;});
