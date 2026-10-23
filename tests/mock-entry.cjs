const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const elements={};let saved,alerts=[],confirms=[],deferred=0;
const ctx={document:{getElementById:id=>elements[id]||(elements[id]={value:'',style:{},focus(){}})},alert:m=>alerts.push(m),confirm:m=>(confirms.push(m),true),session:{id:'test',role:'student',name:'test'},weeklyLogin:{id:'test',pw:'local-test',role:'student'},studentPreviewMode:false,padMode:false,sExamPriorResponse:null,sOmrCurrentPhoto:null,sExamFullAnswers:{},sHomeworkRequired:()=>false,homeworkWrittenAnswers:()=>({}),sendStudentActivity:()=>{},isLiteratureExam:()=>false,sExamTimerStop:()=>{},showSExamView:()=>{},renderSExamResultView:()=>{},renderSExam:()=>deferred++,notify:()=>{},sb:{rpc:async (name,args)=>(assert.equal(name,'odap_save_response'),saved=args.p_payload,{error:null})}};
vm.createContext(ctx);
for(const name of ['odapSaveResponse','examAnswerMatches','isObjectiveAnswer','examQuestionNumber','parseHomeworkWrongNumbers','sExamIsScoreOnlyResponse','sMockSubmitWrongOnly','sExamSubmitFull','sExamSubmitReportedScore','repIsWrong','repScore','repDomainStats','sMockDeferGrading']){
 const start=html.indexOf((['odapSaveResponse','sMockSubmitWrongOnly','sExamSubmitFull','sExamSubmitReportedScore'].includes(name)?'async ':'')+'function '+name+'(');
 assert.ok(start>=0,name);const end=name==='isObjectiveAnswer'?html.indexOf('\n',start):html.indexOf('\n}',start)+2;vm.runInContext(html.slice(start,end),ctx);
}
ctx.sExamData={id:'test',category:'mock',total_q:45,questions:Array.from({length:45},(_,i)=>({num:i+1,answer:String(i%5+1),points:[3,6,14,16,22,27,33,38,42,45].includes(i+1)?3:2,domain:i<10?'언어':'문학'}))};
(async()=>{
 elements['s-mock-wrong-input']={value:'3, 14 45,3'};await ctx.sMockSubmitWrongOnly();assert.equal(saved.score,91);assert.equal(saved.correct_count,42);assert.equal(Object.keys(saved.answers).length,45);assert.equal(ctx.repScore(ctx.sExamData,saved).pct,91);assert.equal(ctx.sExamIsScoreOnlyResponse(saved),false);
 elements['s-mock-wrong-input'].value='46';saved=null;await ctx.sMockSubmitWrongOnly();assert.equal(saved,null);assert.ok(alerts.length);
 elements['s-mock-wrong-input'].value='';await ctx.sMockSubmitWrongOnly();assert.equal(saved.score,100);assert.equal(ctx.sExamIsScoreOnlyResponse(saved),false);
 elements['s-mock-wrong-input'].value=Array.from({length:45},(_,i)=>i+1).join(',');await ctx.sMockSubmitWrongOnly();assert.equal(saved.score,0);assert.equal(ctx.sExamIsScoreOnlyResponse(saved),false);assert.equal(ctx.repScore(ctx.sExamData,saved).pct,0);assert.ok(Object.keys(ctx.repDomainStats(ctx.sExamData,saved)).length);
 ctx.sExamFullAnswers=Object.fromEntries(ctx.sExamData.questions.map((q,i)=>[i,q.answer]));await ctx.sExamSubmitFull();assert.equal(saved.score,100);
 elements['s-mock-score-input']={value:''};saved=null;await ctx.sExamSubmitReportedScore();assert.equal(saved,null);
 elements['s-mock-score-input'].value='87';await ctx.sExamSubmitReportedScore();assert.equal(saved.score,87);assert.equal(ctx.sExamIsScoreOnlyResponse(saved),true);assert.equal(ctx.repScore(ctx.sExamData,saved).pct,87);assert.equal(Object.keys(ctx.repDomainStats(ctx.sExamData,saved)).length,0);
 saved=null;ctx.sMockDeferGrading();assert.equal(saved,null);assert.ok(deferred);
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
 console.log('PASS: score only, weighted wrong numbers, full answers, invalid numbers, blank score, 0/100, reports, deferral without submission, syntax');
})().catch(e=>{console.error(e);process.exitCode=1;});
