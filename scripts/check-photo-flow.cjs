// The October midterm wrong-photo campaign is retired: wrong-photo-section.js is no longer loaded by
// index.html and, if loaded, only removes any leftover entry buttons. Keep its pure helpers covered.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../wrong-photo-section.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const {photos,valid,itemId}=require('../wrong-photo-section.js');
assert.deepEqual(photos('["a","b"]'),['a','b']);assert.deepEqual(photos(''),[]);assert.deepEqual(photos('https://x/y.jpg'),['https://x/y.jpg']);
assert.equal(valid({type:'image/jpeg',size:1234}),true);assert.equal(valid({type:'image/gif',size:1234}),false);assert.equal(valid({type:'image/png',size:16*1024*1024}),false);
assert.equal(itemId('school'),'ci_wrong_midterm_202610_school');
assert.doesNotMatch(html,/wrong-photo-section\.js/,'retired campaign script is not loaded');
let removed=0,wrapped=0;
const leftover={remove(){removed++;}};
const context={document:{querySelectorAll:s=>s==='[data-wrong-photo-entry]'?[leftover]:[]},crypto:require('node:crypto').webcrypto,console,
 launchStudent(){wrapped++;},launchTeacher(){wrapped++;},returnFromStudentPreview(){wrapped++;}};
context.window=context;
vm.runInNewContext(source,context);
assert.equal(removed,1,'leftover entry removed on load');
context.launchStudent();assert.equal(wrapped,1);assert.equal(removed,2,'entry stays removed after student launch');
console.log('PASS: retired wrong-photo campaign not loaded, leftover entries removed, photo helpers validated');
