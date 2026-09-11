const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const ctx={};vm.createContext(ctx);
for(const name of ['isObjectiveAnswer','examQuestionNumber','homeworkMissingAnswers','homeworkWrittenAnswers','renderHomeworkWrittenAnswers']){
 const start=html.indexOf('function '+name+'('),end=html.indexOf('\n}',start)+2;
 // isObjectiveAnswer is a one-line function.
 const code=name==='isObjectiveAnswer'?html.slice(start,html.indexOf('\n',start)):html.slice(start,end);
 vm.runInContext(code,ctx);
}
ctx.escHtml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const exam={category:'homework',total_q:40,questions:Array.from({length:40},(_,i)=>({num:i+1,answer:i===26?'주관식':'1'}))};
const answers=Object.fromEntries(exam.questions.map((_,i)=>[i,'1']));answers[26]='  ';
assert.equal(JSON.stringify(ctx.homeworkMissingAnswers(exam,answers)),'[27]');
answers[26]='ⓐ 을, ⓑ ㅅ';assert.equal(ctx.homeworkMissingAnswers(exam,answers).length,0);
const written=ctx.homeworkWrittenAnswers(exam,answers);assert.equal(Object.keys(written).length,1);assert.equal(written[26],answers[26]);
assert.ok(ctx.renderHomeworkWrittenAnswers(exam,{thoughts:{_subjective_answers:{26:'<script>bad</script>'}}}).includes('&lt;script&gt;'));
const optional={category:'homework',questions:[{num:43,answer:'주관식'}]};assert.equal(JSON.stringify(ctx.homeworkMissingAnswers(optional,{})),'[43]');
assert.equal(Object.keys(ctx.homeworkWrittenAnswers(optional,{})).length,0);
assert.ok(html.includes('_subjective_answers:homeworkWrittenAnswers(sExamData,sExamFullAnswers)'));
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
console.log('PASS: required written answer, numbering, storage, escaping, script syntax');
(async()=>{
 const start=html.indexOf('async function sExamSubmitFull('),end=html.indexOf('\n}',start)+2;
 vm.runInContext(html.slice(start,end),ctx);
 let saved=null;ctx.sExamData=exam;ctx.session={name:'local test'};ctx.sExamFullAnswers={...answers,26:' '};
 ctx.sExamPriorResponse={thoughts:{existing:'keep'}};ctx.sOmrCurrentPhoto=null;ctx.alert=()=>{};
 ctx.sb={from:()=>({upsert:async data=>{saved=data;return {error:{message:'local test stops after payload'}};}})};
 await ctx.sExamSubmitFull(true);assert.equal(saved,null,'27 must block forced submission');
 ctx.sExamFullAnswers[26]='ⓐ 을, ⓑ ㅅ';await ctx.sExamSubmitFull(true);
 assert.equal(saved.thoughts._subjective_answers[26],'ⓐ 을, ⓑ ㅅ');assert.equal(saved.thoughts.existing,'keep');
 assert.equal(saved.total_q,39);assert.equal(saved.score,100);assert.equal(Object.hasOwn(saved.answers,'26'),false);
 console.log('PASS: submission blocks blank 27, stores written response, preserves notes and objective score');
})().catch(e=>{console.error(e);process.exitCode=1;});
(async()=>{
 const c={};vm.createContext(c);
 for(const name of ['isObjectiveAnswer','sExamSubmitScore']){
  const start=html.indexOf((name==='sExamSubmitScore'?'async ':'')+'function '+name+'(');
  const end=name==='isObjectiveAnswer'?html.indexOf('\n',start):html.indexOf('\n}',start)+2;
  vm.runInContext(html.slice(start,end),c);
 }
 let saved;Object.assign(c,{session:{name:'local test'},sExamData:{category:'homework',total_q:3,questions:[{num:41,answer:'1',points:2},{num:42,answer:'2',points:2},{num:43,answer:'',points:1}]},sWrongChecked:{1:true},sExamAnswers:{1:'3'},sExamPhotos:{},sExamThoughts:{},sExamPriorResponse:{thoughts:{_subjective_answers:{2:'keep'}}},sHomeworkWrongOnly:()=>true,sHomeworkApplyWrongNumbers:()=>true,document:{getElementById:()=>({})},alert:()=>{},sb:{from:()=>({upsert:async data=>{saved=data;return {error:{message:'stop after payload'}};}})}});
 await c.sExamSubmitScore();assert.equal(saved.total_q,2);assert.equal(saved.score,50);assert.equal(saved.points_total,4);assert.equal(saved.thoughts._subjective_answers[2],'keep');
 console.log('PASS: wrong-only scoring excludes subjective items and preserves written answers');
})().catch(e=>{console.error(e);process.exitCode=1;});
