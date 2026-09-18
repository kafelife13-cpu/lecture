const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8'),ctx={};vm.createContext(ctx);
for(const name of ['renderHomeworkEntry','examQuestionNumber','parseHomeworkWrongNumbers']){let a=html.indexOf('function '+name+'('),b=html.indexOf('\n}',a)+2;vm.runInContext(html.slice(a,b),ctx);}
ctx.renderSExamListCards=xs=>xs.map(x=>x.name).join('|');
const out=ctx.renderHomeworkEntry([{name:'치동 3주차',clinic_week:'9월 2주차',created_at:'2026-09-12'},{name:'치동 4주차',clinic_week:'9월 4주차',created_at:'2026-09-19'},{name:'치동 1주차',clinic_week:'10월 1주차',created_at:'2026-10-01'}],[]);
assert.ok(out.indexOf('10월 1주차')<out.indexOf('9월 4주차'));assert.ok(out.indexOf('9월 4주차')<out.indexOf('9월 3주차'));assert.equal((out.match(/ open/g)||[]).length,1);assert.ok(ctx.renderHomeworkEntry([],[]).includes('없어요'));
const e={total_q:4,questions:[{num:51},{num:87},{num:'B1'},{num:'B18'}]};assert.equal(ctx.examQuestionNumber(e,2),'B1');assert.equal(JSON.stringify(ctx.parseHomeworkWrongNumbers('51, b1 B18 51',e)),'[0,2,3]');assert.throws(()=>ctx.parseHomeworkWrongNumbers('1',e));assert.equal(ctx.examQuestionNumber({questions:[{num:'<img>'}]},0),1);
console.log('PASS: week ordering, latest expanded, empty list, numeric and B question numbers');
