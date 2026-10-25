const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('student-sections.js','utf8'),removed=[];
const context={document:{getElementById:id=>({remove:()=>removed.push(id)})}};
vm.runInNewContext(source.slice(source.indexOf(' function refreshSentenceNotice(){'),source.indexOf(' root.renderWeeklyExtras=')),context);
context.refreshSentenceNotice();assert.deepEqual(removed,['sentence-study-popup','sentence-study-card']);
assert.ok(!source.includes('문장 분석 영상 · 해설 자료'));
console.log('PASS: retired sentence card and popup removed for every student');
