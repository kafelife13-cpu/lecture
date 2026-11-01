const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
const ctx={crypto:require('node:crypto').webcrypto,TextEncoder};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../homework-split.js'),'utf8'),ctx);
for(const name of ['examQuestionNumber','parseHomeworkWrongNumbers']){
  const start=html.indexOf('function '+name+'(');
  vm.runInContext(html.slice(start,html.indexOf('\n}',start)+2),ctx);
}
(async()=>{
  const source={id:'515ce06d-469c-4021-ad59-b8e39d05750a',name:'[치동고1] 기말대비 2주차 과제 · 춘향전 (100문항)',
    category:'homework',total_q:100,clinic_school:'치동고',clinic_week:'기말대비 2주차',teacher_id:'teacher',created_at:'2026-10-31T00:00:00Z',
    questions:Array.from({length:100},(_,i)=>({num:i+1,answer:i===23?'all:1,4':i===50?'서술형 모범 답안':'3',points:2,explanation:'해설 '+(i+1),text:'문제 '+(i+1)}))};
  const before=JSON.stringify(source),rows=await ctx.homeworkSplitRows(source);
  assert.equal(JSON.stringify(source),before,'source questions must never be mutated');
  assert.equal(rows.length,2);
  assert.equal(JSON.stringify(rows.map(e=>e.total_q)),'[50,50]');
  assert.equal(rows[1].questions[0].num,51);
  assert.equal(rows[1].questions.at(-1).num,100);
  assert.equal(rows[0].questions[23].answer,'all:1,4');
  assert.equal(rows[1].questions[0].answer,'서술형 모범 답안');
  assert.equal(rows[1].clinic_week,source.clinic_week);
  assert.ok(rows[1].name.includes('51~100번 · 50문항'));
  const restored=rows.flatMap(e=>e.questions.map(q=>{const copy={...q};delete copy.homework_split;return copy;}));
  assert.equal(JSON.stringify(restored),JSON.stringify(source.questions),'all answers, questions and explanations preserved');
  assert.equal(JSON.stringify((await ctx.homeworkSplitRows(source)).map(e=>e.id)),JSON.stringify(rows.map(e=>e.id)),'retry IDs must be stable');
  assert.equal(ctx.homeworkSplitSourceIds([source,rows[0]]).size,0,'partial split must not hide source');
  assert.ok(ctx.homeworkSplitSourceIds([source,...rows]).has(source.id));
  assert.equal(ctx.homeworkSplitSourceIds([source,rows[0],rows[0]]).size,0,'duplicate part cannot hide source');
  assert.equal(ctx.homeworkSplitSourceIds([source,...rows.map(e=>({...e,category:'school'}))]).size,0);
  assert.equal(JSON.stringify(ctx.parseHomeworkWrongNumbers('51,100',rows[1])),'[0,49]');
  await assert.rejects(()=>ctx.homeworkSplitRows(rows[0]));
  await assert.rejects(()=>ctx.homeworkSplitRows({...source,total_q:99}));
  assert.ok(html.includes('<script src="homework-split.js?v=20261101"></script>'));
  assert.ok(html.includes('분할 전 과제 · 기존 기록'));
  console.log('PASS: atomic-copy plan, stable retry IDs, original data preservation, split visibility, original question numbers and script syntax');
})().catch(e=>{console.error(e);process.exitCode=1;});
