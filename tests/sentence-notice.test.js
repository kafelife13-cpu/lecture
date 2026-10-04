const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../student-sections.js'),'utf8');
const context={};
vm.runInNewContext(source.match(/function sentenceAudience\(student\)\{[^\n]+\}/)[0],context);
assert.equal(context.sentenceAudience({role:'student',school_id:'sc_hanbaek',name:'이승모'}),true);
for(const student of [null,{role:'teacher',school_id:'sc_hanbaek'},{role:'student',school_id:'sc_chidong'},{role:'student',school_id:'sc_hanbaek',name:'이내'}])assert.equal(context.sentenceAudience(student),false);
console.log('Sentence notice audience checks passed');
