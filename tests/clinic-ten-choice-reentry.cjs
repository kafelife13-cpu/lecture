const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8'),ctx={};vm.createContext(ctx);
for(const name of ['sExamOpenForGrading','clinicChoiceExplanation']){
 const start=html.indexOf('function '+name+'('),end=html.indexOf('\n}',start)+2;
 vm.runInContext((name==='sExamOpenForGrading'?'async ':'')+html.slice(start,end),ctx);
}
const exam={id:'local-only',category:'school',name:'clinic',total_q:23,questions:[]};
const old={regrade_approved:true,answers:{0:'2',12:'2'},photo_urls:{omr:'keep-photo'}};
const elements={};
Object.assign(ctx,{session:{name:'local'},document:{getElementById:id=>elements[id]||(elements[id]={style:{}})},sb:{from:table=>({select:()=>({eq:()=>table==='exams'?{single:async()=>({data:exam})}:{eq:()=>({maybeSingle:async()=>({data:old})})}})})},sExamVisibleForStudent:()=>true,sHomeworkNumbersOnly:()=>false,sHomeworkWrongOnly:()=>false,examQuestionNumber:(_,i)=>i+1,sMockSourceLinks:()=>'',sExamTimerStart:()=>{},showSExamView:v=>ctx.view=v,escHtml:String});
(async()=>{
 await ctx.sExamOpenForGrading(exam.id);assert.equal(ctx.view,'check');assert.equal(JSON.stringify(ctx.sExamFullAnswers),JSON.stringify(old.answers));
 assert.equal(ctx.clinicChoiceExplanation({explanation:'① first ⑥ sixth ⑩ tenth'},'6,10'),'<b>⑥</b> sixth<br><b>⑩</b> tenth');
 assert.equal(ctx.clinicChoiceExplanation({explanation:'① first ⑩ tenth'},'10'),'<b>⑩</b> tenth');
 console.log('PASS: approved clinic reentry restores prior answers; tenth-choice feedback does not select first-choice explanation');
})().catch(e=>{console.error(e);process.exitCode=1;});
