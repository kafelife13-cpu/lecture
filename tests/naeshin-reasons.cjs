const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
function extract(name){let a=html.indexOf('async function '+name+'(');return html.slice(a,html.indexOf('\n}',a)+2);}
(async()=>{
 let saved=null,errors={textContent:''},focused=false;
 const c={session:{id:'local-test'},sExamData:{category:'naeshin',total_q:2,questions:[{answer:'5',points:3.6},{answer:'2',points:3.8}]},sWrongChecked:{0:true},sExamAnswers:{0:'3'},sExamThoughts:{0:'   '},sExamPhotos:{},sExamPriorResponse:null,sHomeworkWrongOnly:()=>false,examQuestionNumber:(_,i)=>i+1,document:{getElementById:id=>id==='s-exam-check-err'?errors:{focus(){focused=true},scrollIntoView(){}}},odapSaveResponse:async p=>{saved=p;return {error:{message:'test ends at save'}}},alert:()=>{}};
 c.examAnswerMatches=(a,b)=>String(a)===String(b);
 vm.createContext(c);vm.runInContext(extract('sExamSubmitScore'),c);
 await c.sExamSubmitScore();assert.equal(saved,null);assert.ok(errors.textContent.includes('1번'));assert.ok(focused);
 c.sExamThoughts[0]='사실감이 있다고 생각했다. 프린트에서 본 기억으로 ③을 골랐다.';
 await c.sExamSubmitScore();assert.equal(saved.thoughts[0],c.sExamThoughts[0]);assert.equal(saved.points_total,7.4);assert.equal(saved.points_earned,3.8);
 const parse=html.match(/points:(parseFloat\(document.getElementById\('rqp-'\+i\)\?\.value\)\|\|q.points\|\|1)/)[1];
 assert.equal(vm.runInNewContext(parse,{i:0,q:{points:2},document:{getElementById:()=>({value:'3.6'})}}),3.6);
 saved=null;c.sExamThoughts[0]='생각 작성됨';c.sExamAnswers[0]='';await c.sExamSubmitScore();assert.equal(saved,null,'missing wrong choice must block');
 c.sExamAnswers[0]='5';await c.sExamSubmitScore();assert.equal(saved,null,'correct choice cannot be marked wrong');
 for(const name of ['repIsWrong','repScore']){const start=html.indexOf('function '+name+'(');vm.runInContext(html.slice(start,html.indexOf('\n}',start)+2),c);}
 c.isObjectiveAnswer=()=>true;
 assert.equal(c.repScore({category:'naeshin',questions:[{answer:'5',points:3.6},{answer:'2',points:96.4}]},{answers:{0:'3'}}).pct,96.4);
 console.log('PASS: blank midterm reason blocks saving, written thought persists, decimal points preserved, scripts parse');
})().catch(e=>{console.error(e);process.exitCode=1});

