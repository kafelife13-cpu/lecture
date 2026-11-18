const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const elements={},ctx={EXAM_TYPES:['기타'],DOMAIN_CATEGORIES:[],escHtml:String,session:{id:'local-only'},alert:()=>{},texShowStep:()=>{},closeTExamCreate:()=>{},closeTExamEdit:()=>{}};
ctx.document={getElementById:id=>elements[id]||(elements[id]={value:'',innerHTML:'',style:{},classList:{add(){},remove(){}}})};
vm.createContext(ctx);
for(const name of ['examChoiceNumbers','examAnswerSelected','examDefaultAnswer','isObjectiveAnswer','examValidSelection','examTeacherChoices','renderTeditQList','renderTexStep3','eSelectAnswer','rSelectAnswer','saveTExamEdit','saveTExam','texQuickRegister','parseGradeCuts','parseNumberList','omrWriteBoxes','generateOmrSheet','openOmrSheetForExam','openOmrSheetModal','closeOmrSheetModal','omrBuildPrompt','omrApiBody']){
 const start=html.indexOf('function '+name+'('),lineEnd=html.indexOf('\n',start);
 assert.ok(start>=0,name);
 const end=html.slice(start,lineEnd).trim().endsWith('}')?lineEnd:html.indexOf('\n}',start)+2;
 vm.runInContext((html.slice(start-6,start)==='async '?'async ':'')+html.slice(start,end),ctx);
}
let saved,printed,exam;
ctx.sb={from:table=>{assert.equal(table,'exams','never write student responses');return {
 insert:async value=>{saved=value;return {error:null};},
 update:value=>({eq:async()=>{saved=JSON.parse(JSON.stringify(value));return {error:null};}}),
 select:()=>({eq:()=>({single:async()=>({data:exam})})})
};}};
ctx.window={open:()=>({document:{write:value=>printed=value,close(){}}})};
const field=(id,value)=>ctx.document.getElementById(id).value=value;
(async()=>{
 field('tex-name','local test');
 field('tex-answers-raw','1-① 2-⑤ 3-⑥ 4-⑦ 5-⑧ 6-⑨ 7-⑩ 8-10 9-6 10-all:1,6,10 11-any:6,10 12-주관식');
 ctx.texQuickRegister();
 assert.equal(ctx.parsedQuestions.length,12);
 assert.equal(ctx.parsedQuestions.map(q=>q.answer).join('|'),'1|5|6|7|8|9|10|10|6|all:1,6,10|any:6,10|');
 assert.equal(ctx.parsedQuestions.map(q=>q.choice_count).join(','),'5,5,10,10,10,10,10,10,10,10,10,5');
 assert.match(elements['tex-q-list'].innerHTML,/rSelectAnswer\(6,10\)/);
 assert.doesNotMatch(ctx.examTeacherChoices({answer:'1'},0,'r'),/SelectAnswer\(0,6\)/);
 // Changing only the choice controls must retain the other unsaved fields.
 field('rqtext-0','unsaved text');
 const handler=elements['tex-q-list'].innerHTML.match(/id="rqc-0" onchange="([^"]+)"/)[1];
 ctx.thisSelect={value:'10'};vm.runInContext('(function(){'+handler+'}).call(thisSelect)',ctx);
 assert.equal(ctx.parsedQuestions[0].choice_count,10);assert.equal(elements['rqtext-0'].value,'unsaved text');
 assert.match(elements['rqchoices-0'].innerHTML,/rSelectAnswer\(0,10\)/);
 ctx.rSelectAnswer(0,10);assert.equal(elements['rqanswer-0'].value,'10');
 assert.equal(elements['rqa-0-10'].style.background,'var(--green)');
 field('rqanswer-0','all:1,6,10');field('rqc-0','10');
 await ctx.saveTExam();assert.equal(saved.questions[0].choice_count,10);assert.equal(saved.questions[0].answer,'all:1,6,10');assert.equal(saved.questions[0].text,'unsaved text');
 ctx.editingQuestions=JSON.parse(JSON.stringify(saved.questions));ctx.editingExamId='local-only';
 ctx.renderTeditQList();assert.match(elements['tedit-q-list'].innerHTML,/eSelectAnswer\(0,10\)/);
 ctx.eSelectAnswer(0,6);assert.equal(elements['eqa-0-6'].style.background,'var(--green)');
 field('tedit-name','edited');field('eqanswer-0','all:1,6,10');field('eqc-0','10');
 await ctx.saveTExamEdit();assert.equal(saved.questions[0].answer,'all:1,6,10');assert.equal(saved.questions[0].choice_count,10);
 for(const bad of ['all:1,11','any:0,10','all:1,']){field('eqanswer-0',bad);saved=null;await ctx.saveTExamEdit();assert.equal(saved,null,bad);}
 field('eqanswer-0','any:6,10');field('eqc-0','5');saved=null;await ctx.saveTExamEdit();assert.equal(saved,null,'multiple key exceeds five choices');
 // One legacy row and one ten-choice row print 15 bubbles, with a real exam read only.
 exam={name:'local',total_q:2,questions:[{answer:'1'},{answer:'10',choice_count:10}]};
 await ctx.openOmrSheetForExam('local');ctx.generateOmrSheet();
 assert.equal((printed.match(/class="omr-bubble"/g)||[]).length,15);assert.match(printed,/>10<\/span>/);
 ctx.openOmrSheetModal();field('omr-sheet-count','2');ctx.generateOmrSheet();
 assert.equal((printed.match(/class="omr-bubble"/g)||[]).length,10);
 const payload=JSON.parse(ctx.omrApiBody(2,'fake-image',false,[{answer:'1'},{answer:'all:1,6,10',choice_count:10}]));
 const prompt=payload.messages[0].content.at(-1).text;
 assert.match(prompt,/"choices":10,"multiple":true/);assert.doesNotMatch(prompt,/all:1,6,10/,'never send the key to the reader');
 // The standalone wrong-note analysis must agree with question bounds.
 const cloud=fs.readFileSync(require('node:path').join(__dirname,'../odap/cloud.js'),'utf8');
 const start=cloud.indexOf(' function grade('),end=cloud.indexOf('\n async function analyze',start);
 vm.runInContext(cloud.slice(start,end),ctx);
 for(const n of [6,7,8,9,10]){assert.equal(ctx.grade(String(n),String(n),{choice_count:10}),true);assert.equal(ctx.grade(String(n),String(n),{}),null);}
 assert.equal(ctx.grade('10,6,1','all:1,6,10',{choice_count:10}),true);
 assert.equal(ctx.grade('6,1','all:1,6,10',{choice_count:10}),false);
 assert.equal(ctx.grade('10','any:6,10',{choice_count:10}),true);
 assert.equal(ctx.grade('5','any:6,10',{choice_count:10}),false);
 assert.equal(ctx.grade('6','any:6,10',{}),null);
 assert.equal(ctx.grade('o','O',{}),true);assert.equal(ctx.grade('1,4','1,4',{}),null);
 ctx.parsedQuestions=[];field('tex-answers-raw','1-11 2-all:1,6,11 3-0 4-01');ctx.texQuickRegister();
 assert.equal(ctx.parsedQuestions.length,0,'invalid numeric keys must not become smaller question/answer pairs');
 console.log('PASS: teacher parsing, 5/10 controls, create/edit persistence and validation, mixed OMR sheets, read prompt and wrong-note grading (local mocks only)');
})().catch(e=>{console.error(e);process.exitCode=1;});
