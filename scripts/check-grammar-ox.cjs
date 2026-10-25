const assert=require('node:assert/strict'),fs=require('node:fs');
const Q=require('../grammar-ox-data.js'),{filterQuestions,makeSet,wrongQuestions}=require('../grammar-ox.js');
assert.equal(Q.length,360);assert.equal(new Set(Q.map(q=>q.id)).size,360);
for(const q of Q){for(const k of ['id','era','topic','concept','difficulty','prompt','explanation','src'])assert.ok(typeof q[k]==='string'&&q[k].trim(),q.id+': '+k);assert.ok([0,1].includes(q.answer));assert.deepEqual(q.choices,['O','X']);assert.equal(q.choiceExplanations.length,2);assert.ok(q.choiceExplanations.every(x=>typeof x==='string'&&x.trim()));assert.ok(!JSON.stringify(q).includes('"file":'));assert.ok(!JSON.stringify(q).includes('원문 판단 조건'));assert.ok(!q.src.includes('고고'));}
for(const era of ['','modern','medieval'])for(const topic of ['',...new Set(Q.map(q=>q.topic))])for(const difficulty of ['normal','hard'])for(const count of [5,10,20]){
 const f={era,topic,difficulty},pool=filterQuestions(Q,f),set=makeSet(Q,f,count);assert.equal(set.length,Math.min(count,pool.length));assert.equal(new Set(set.map(q=>q.id)).size,set.length);assert.ok(set.every(q=>pool.includes(q)));
 const o=pool.filter(q=>q.answer===0).length,x=pool.length-o,n=set.length,got=set.filter(q=>q.answer===0).length;assert.ok(got>=Math.min(o,Math.floor(n/2)));assert.ok(n-got>=Math.min(x,Math.floor(n/2)));
}
const concept=Q[0].concept;assert.ok(makeSet(Q,{concept},20).every(q=>q.concept===concept));
const rows=[{question_id:Q[0].id,is_correct:false,submitted_at:'2026-10-24T00:00:00Z'},{question_id:Q[0].id,is_correct:true,submitted_at:'2026-10-25T00:00:00Z'},{question_id:Q[1].id,is_correct:false,submitted_at:'2026-10-25T00:00:00Z'}];
assert.deepEqual(wrongQuestions(Q,rows).map(q=>q.id),[Q[1].id]);assert.deepEqual(wrongQuestions(Q,rows.reverse()).map(q=>q.id),[Q[1].id]);
const html=fs.readFileSync('index.html','utf8');assert.ok(html.includes("if(panel==='grammar-ox')renderGrammarOx();"));assert.ok(html.includes("if(panel==='grammar-ox')renderGrammarOxTeacher();"));
console.log('PASS: 360 validated questions; filtered, balanced, unique sets; latest-answer retry; menu hooks');
const K=require('../grammar-ox-data-kimhayan.js'),R=require('../grammar-review.js'),merged=R.mergeBanks(Q,K);
assert.equal(K.length,627);assert.equal(merged.length,987);assert.equal(new Set(merged.map(q=>q.id)).size,987);
for(const q of K){assert.ok(q.id.startsWith('kh-'));assert.ok([0,1].includes(q.answer));assert.ok(q.basis.length);assert.ok(!('audit' in q));assert.ok(!('claim' in q));assert.ok(q.variantOf.every(id=>id.startsWith('kh-')));assert.ok(q.choiceExplanations[q.answer].startsWith('맞습니다.'));}
assert.equal(R.mergeBanks([{prompt:'“같은 문장”'}],[{prompt:'같은문장'}]).length,1);
for(const bank of [Q,K]){const expr=bank.filter(q=>q.topic==='expression');assert.equal(expr.length,bank===Q?30:103);assert.ok(expr.every(q=>R.grammarElementTags(q).length));assert.ok(expr.filter(q=>R.grammarElementTags(q).includes('기타')).length<=10);console.log(bank===Q?'서로국어':'김하얀T',Object.fromEntries(R.elementNames.map(t=>[t,expr.filter(q=>R.grammarElementTags(q).includes(t)).length])));console.log('단원 분포',Object.fromEntries([...new Set(merged.map(q=>q.topic))].map(t=>[t,bank.filter(q=>q.topic===t).length])));}
assert.ok(Q.filter(q=>q.topic!=='expression').every(q=>R.grammarElementTags(q).length===0));
assert.equal(filterQuestions(merged,{topic:'expression',tags:[]}).length,0);
assert.equal(filterQuestions(merged,{source:'kimhayan'}).length,627);
const D=R.DAY,t=Date.parse('2026-01-01T00:00:00Z'),at=(day,correct=true,extra={})=>({id:String(day),question_id:'q',is_correct:correct,submitted_at:new Date(t+day*D).toISOString(),...extra});
assert.equal(R.reviewCards([at(0)],t).q.due,t+D);
assert.equal(R.reviewCards([at(0),at(.5)],t+D).q.due,t+D);
assert.equal(R.dueQuestions([{id:'q'}],[at(0),at(.5)],t+D).length,0);
let history=[at(0),at(1),at(4),at(11),at(25),at(55)];
for(const [n,stage,due] of [[2,2,4],[3,3,11],[4,4,25],[5,5,55],[6,5,85]]){const c=R.reviewCards(history.slice(0,n),t+90*D).q;assert.equal(c.stage,stage);assert.equal(c.due,t+due*D);}
assert.equal(R.reviewCards([at(0,false),at(1)],t+2*D).q.stage,2);
assert.equal(R.reviewCards([at(0),at(1,false)],t+2*D).q.stage,0);
assert.equal(R.reviewCards([at(0),at(1,true,{question_id:'variant',target_question_id:'q'})],t+2*D).q.stage,2);
assert.equal(R.reviewSuccess([at(0)],'q',t+D),true);
const original={id:'q',topic:'parts',concept:'c',objectiveId:'o'},variant={id:'v',variantOf:['q']},objective={id:'o',objectiveId:'o'},conceptQ={id:'c',topic:'parts',concept:'c'};
assert.equal(R.replacementQuestion(original,[original,conceptQ,objective,variant],[]).id,'v');assert.equal(R.replacementQuestion(original,[original,conceptQ,objective],[]).id,'o');assert.equal(R.replacementQuestion(original,[original,conceptQ],[]).id,'c');assert.equal(R.replacementQuestion(original,[original],[]).id,'q');
assert.equal(R.validateQuestion('가'.repeat(300),[],'s','q').length,300);assert.throws(()=>R.validateQuestion('가'.repeat(301),[],'s','q'));assert.throws(()=>R.validateQuestion(' ',[],'s','q'));assert.throws(()=>R.validateQuestion('질문',[{student_id:'s',question_id:'q',seen_at:null}],'s','q'));
const output=R.csv([{id:'s',name:'=위험',group_id:'a'}],[at(0,false,{student_id:'s'})],[original],[{id:'a',label:'반'}],t+2*D);assert.ok(output.startsWith('\ufeff'));assert.ok(output.includes("'=위험"));assert.equal(output.split('\r\n').length,2);assert.ok(output.includes('"1","1","0","0","1","1"'));
console.log('PASS: 987 questions, evidence, tags, due stages 0–5, early/exact due, alternatives, question validation, CSV');
