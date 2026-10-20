const assert=require('node:assert/strict');
const a=require('../wrong-photo-section.js');
assert.deepEqual(a.photos(JSON.stringify(['url'])),['url']);
assert.deepEqual(a.photos('url'),['url']);
assert(a.valid({type:'image/jpeg',size:100}));
assert(!a.valid({type:'image/svg+xml',size:100}));
assert(!a.valid({type:'image/png',size:16000000}));
assert.equal(a.itemId('school'),'ci_wrong_midterm_202610_school');
console.log('photo validation passed');

