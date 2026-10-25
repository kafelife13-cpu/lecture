const assert=require('node:assert/strict'),fs=require('node:fs'),R=require('../grammar-review.js');
const Q=require('../grammar-ox-data-hanbaek.js'),base=[...require('../grammar-ox-data.js'),...require('../grammar-ox-data-kimhayan.js')];
assert.equal(Q.length,65);const norm=s=>s.normalize('NFKC').replace(/[\s‘’“”'"「」]/g,'');
const seen=new Set(base.map(q=>norm(q.prompt)));
for(const q of Q){assert.ok(!seen.has(norm(q.prompt)));seen.add(norm(q.prompt));assert.equal(q.source_kind,'public');assert.ok(!/왓칭|마더텅|mother|워크북|날개달기|gym|트레이닝/i.test(q.from+' '+JSON.stringify(q.basis)));assert.ok(q.page>=1&&q.page<=37);assert.ok(q.level>=1&&q.level<=4);assert.ok([0,1].includes(q.answer));assert.ok(q.explanation&&q.basis.length);assert.deepEqual(R.grammarElementTags(q),q.tags);assert.ok(q.choiceExplanations[q.answer].startsWith('맞습니다.'));}
assert.equal(R.mergeBanks(base,Q).length,1052);assert.ok(fs.readFileSync('index.html','utf8').includes('grammar-ox-data-hanbaek.js'));console.log('PASS: 65 public textbook questions; fields, tags, levels, answers, provenance and 1052 unique public questions');
