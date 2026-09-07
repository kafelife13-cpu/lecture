const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),dir=path.join(root,'assets/literature');
const {isLiteratureExam}=require('../literature.js'),{checkoutDay}=require('../clinic-check.js');
const keys=['45231344334352312','24112422153554235','34345433551141235','34413135423433452','11233534151412454','42425151452514151','13254422252131152','13451425523144345','54514543541115545','12415321315444435'];
const exams=keys.map((key,i)=>{
 const n=String(i+1).padStart(2,'0'),e=JSON.parse(fs.readFileSync(path.join(dir,'round-'+n+'.json'))).exam;
 assert.equal(isLiteratureExam(e),true);assert.equal(e.total_q,17);assert.equal(e.questions.map(q=>q.answer).join(''),key);
 assert.deepEqual(e.questions.map(q=>q.num),Array.from({length:17},(_,j)=>j+1));assert.equal(e.questions.reduce((a,q)=>a+q.points,0),38);
 e.questions.forEach(q=>{assert.ok(q.text.length>50);assert.ok(q.explanation.length>25);for(const c of '①②③④⑤')assert.ok(q.text.includes(c),'choices '+n+'/'+q.num);for(const image of q.images)assert.ok(fs.existsSync(path.join(dir,image)));});
 for(const kind of ['questions','explanations'])assert.equal(fs.readFileSync(path.join(dir,'round-'+n+'-'+kind+'.pdf')).subarray(0,4).toString(),'%PDF');return e;
});
assert.equal(isLiteratureExam({category:'mini_mock',questions:[{}]}),false);
for(const [label,day] of [['한백 · 수 · 18:00','수'],['목요일 17:00','목'],['금 · 19:00','금'],['주말 · 10:00','주말'],['토 · 14:00','주말'],['일요일 12:00','주말']])assert.equal(checkoutDay({slot_id:'x',slot_label:label}),day);
assert.equal(checkoutDay({slot_id:null,slot_label:'미배정'}),null);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
function source(a,b){return html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));}
const fields=new Proxy({}, {get:(o,k)=>o[k]||(o[k]={style:{},textContent:'',innerHTML:''})});let saved,rendered,fail=false;
const c={sExamData:exams[0],session:{id:'fixture',name:'Fixture'},sExamFullAnswers:{},isObjectiveAnswer:x=>/^[1-5]$/.test(x),examQuestionNumber:(e,i)=>e.questions[i].num,document:{getElementById:id=>fields[id]},sExamPriorResponse:null,sOmrCurrentPhoto:null,confirm:()=>true,alert:m=>{throw Error(m);},sendStudentActivity:()=>{},sExamTimerStop:()=>{},showSExamView:()=>{},renderSExamResultView:(...args)=>rendered=args,sb:{from:()=>({upsert:async payload=>{if(fail)return {error:{message:'offline'}};saved=payload;return {};}})}};
vm.createContext(c);vm.runInContext(source('async function sExamSubmitFull(forceSubmit)','/* 학생 OMR 사진 촬영 채점'),c);
(async()=>{
 for(const q of exams[0].questions)c.sExamFullAnswers[q.num-1]=q.answer;
 await c.sExamSubmitFull();assert.equal(saved.score,100);assert.equal(saved.correct_count,17);
 c.sExamFullAnswers[0]=c.sExamFullAnswers[0]==='1'?'2':'1';await c.sExamSubmitFull();assert.equal(saved.correct_count,16);assert.equal(saved.points_earned,36);assert.equal(saved.score,95);assert.equal(rendered[2][0].idx,0);
 delete c.sExamFullAnswers[1];await c.sExamSubmitFull(true);assert.equal(saved.correct_count,15);assert.equal(saved.answers[1],'');
 const before=saved;fail=true;await assert.rejects(c.sExamSubmitFull(),/저장에 실패/);assert.equal(saved,before);
 const wrongField={innerHTML:''};const r={document:{getElementById:()=>wrongField},sExamData:exams[0],sMockWrongNotes:{},isLiteratureExam,escHtml:s=>String(s).replaceAll('<','&lt;'),examQuestionNumber:(e,i)=>i+1,literatureQuestionResources:()=>'<details>원문</details>'};
 vm.createContext(r);vm.runInContext(source('function renderSResWrongList(wrong)','function sResRetryPick'),r);
 const wrong=[{idx:0,q:exams[0].questions[0],my:'1'}];r.renderSResWrongList(wrong);assert.match(wrongField.innerHTML,/오답노트 저장/);assert.ok(!wrongField.innerHTML.includes(exams[0].questions[0].explanation));
 r.sMockWrongNotes[0]={retry:'4'};r.renderSResWrongList(wrong);assert.ok(wrongField.innerHTML.includes(exams[0].questions[0].explanation));
 console.log('PASS 170 keys, 38-point totals, complete choices/assets; actual grading, unanswered answers, save failure; wrong-note reveal; weekday groups');
})().catch(e=>{console.error(e);process.exitCode=1;});
