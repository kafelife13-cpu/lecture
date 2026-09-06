const assert=require('node:assert/strict');
const {parseGeneratedQuestions}=require('../weekly-homework.js');
const rows=parseGeneratedQuestions('설명```json\n[{"prompt":"문항 1|추가","answer":"o","explanation":"해설\\n한 줄"},{"prompt":"문항 2","answer":"X","explanation":"해설 2"}]```',2);
assert.deepEqual(rows,[{prompt:'문항 1 추가',answer:'O',explanation:'해설 한 줄'},{prompt:'문항 2',answer:'X',explanation:'해설 2'}]);
for(const value of ['[]','[{"prompt":"문항","answer":"A","explanation":"해설"}]','not json'])assert.throws(()=>parseGeneratedQuestions(value,1));
console.log('PASS: generated OX JSON extraction, sanitization, exact count and O/X validation');
