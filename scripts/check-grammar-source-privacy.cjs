const assert=require('node:assert/strict'),fs=require('node:fs'),{studentText,studentBasis}=require('../grammar-ox.js');
const q={src:'시험 출처',from:'책 이름',basis:[{name:'국립국어원 · 표준 발음법',where:'제18항',url:'https://korean.go.kr/rule'},{name:'시판 교재',where:'12쪽',url:'https://example.com'}]};
assert.equal(studentText('[2019 수능] 원문 선지 ①: 판단',q),'판단');assert.equal(studentText('시험 출처 책 이름\n본문',q),'본문');assert.equal(studentText('원문 해설 — 아래 번호는 원래 문제의 선지 번호입니다.\n근거',q),'근거');
assert.equal(studentText('‘값이’는 [갑씨]로 발음한다.',q),'‘값이’는 [갑씨]로 발음한다.');
assert.deepEqual(studentBasis(q),[{name:'표준 발음법 제18항',where:'',url:'https://korean.go.kr/rule'}]);assert.equal(studentBasis({basis:[{name:'한글 맞춤법',url:'https://korean.go.kr.evil.example'}]})[0].url,'');
for(const file of ['grammar-ox-data.js','grammar-ox-data-kimhayan.js','grammar-ox-data-hanbaek.js'])if(fs.existsSync(file))for(const item of require('../'+file)){const before=JSON.stringify(item);for(const value of [item.prompt,item.passage,item.explanation,...item.choiceExplanations])assert.ok(!studentText(value,item).includes(item.src));assert.equal(JSON.stringify(item),before);}
console.log('PASS: source labels removed, original data unchanged, grammar notation preserved, official rule links only');
