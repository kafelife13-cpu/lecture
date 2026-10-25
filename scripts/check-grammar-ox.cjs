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
