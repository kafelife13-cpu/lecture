const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const ctx={};vm.createContext(ctx);
for(const name of ['isObjectiveAnswer','examAnswerMatches','examToggleAnswer','examAnswerSelected','repIsWrong','examQuestionNumber','homeworkWrittenAnswers','sHomeworkRequired','sExamSubmitFull','sExamPickFullAnswer','renderSExamFullGrid']){
 const start=html.indexOf((name==='sExamSubmitFull'?'async ':'')+'function '+name+'(');
 const one=['isObjectiveAnswer','examAnswerSelected','sHomeworkRequired'].includes(name);
 const end=one?html.indexOf('\n',start):html.indexOf('\n}',start)+2;
 vm.runInContext(html.slice(start,end),ctx);
}
assert.equal(ctx.isObjectiveAnswer('all:1,4'),true);
assert.equal(ctx.isObjectiveAnswer('1,4'),false,'legacy written answers unchanged');
for(const v of ['1','4','1,2,4','','14','1,6','all:1,4'])assert.equal(ctx.examAnswerMatches(v,'all:1,4'),false,v);
for(const v of ['1,4','4,1','4, 1'])assert.equal(ctx.examAnswerMatches(v,'all:1,4'),true,v);
assert.equal(ctx.examAnswerMatches('2','2'),true);assert.equal(ctx.examAnswerMatches('2,3','2'),false);
const answers=['3','2','5','2','4','2','5','all:1,4','2','4','1','1','2','5','2','4','3','3','3','1','2','4','5','4','5','2','3','2','5','5'];
const points=[3,3,2,3,4,3,4,4,3,3,4,4,3,2,4,3,4,4,3,4,4,4,4,4,2,4,2,3,2,4];
assert.equal(points.reduce((a,b)=>a+b,0),100);
const exam={id:'local-only',category:'clinic',total_q:30,questions:answers.map((answer,i)=>({num:i+1,answer,points:points[i]}))};
let grid={innerHTML:''},saved;
Object.assign(ctx,{sExamData:exam,sExamFullAnswers:{},escHtml:String,document:{getElementById:()=>grid},sExamIsTimedMock:()=>false,isLiteratureExam:()=>false,session:{name:'local test'},sExamPriorResponse:null,sOmrCurrentPhoto:null,alert:()=>{},sb:{from:()=>({upsert:async data=>{saved=data;return {error:{message:'stop locally'}};}})}});
ctx.sExamPickFullAnswer(7,4);ctx.sExamPickFullAnswer(7,1);assert.equal(ctx.sExamFullAnswers[7],'1,4');
assert.ok(grid.innerHTML.includes('복수 선택'));ctx.sExamPickFullAnswer(7,1);assert.equal(ctx.sExamFullAnswers[7],'4');
(async()=>{
 ctx.sExamFullAnswers=Object.fromEntries(answers.map((a,i)=>[i,a.replace('all:','')]));
 await ctx.sExamSubmitFull(true);assert.equal(saved.score,100);assert.equal(saved.total_q,30);assert.equal(saved.correct_count,30);assert.equal(saved.points_total,100);
 ctx.sExamFullAnswers[7]='1';await ctx.sExamSubmitFull(true);assert.equal(saved.score,96);assert.equal(saved.correct_count,29);assert.equal(ctx.repIsWrong(saved,7,exam),true);
 ctx.sExamFullAnswers[7]='4,1';await ctx.sExamSubmitFull(true);assert.equal(saved.score,100);assert.equal(ctx.repIsWrong(saved,7,exam),false);
 ctx.sExamFullAnswers[29]='2';await ctx.sExamSubmitFull(true);assert.equal(saved.score,96);assert.equal(ctx.repIsWrong(saved,29,exam),true);
 ctx.sExamFullAnswers={};await ctx.sExamSubmitFull(true);assert.equal(saved.score,0);assert.equal(saved.correct_count,0);
 console.log('PASS: 30-question weighted submission, multi selection/toggle, partial/extra/blank answers, result re-opening, corrected q30');
})().catch(e=>{console.error(e);process.exitCode=1;});
