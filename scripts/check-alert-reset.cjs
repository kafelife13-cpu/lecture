const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const c={session:{id:'student'},announceDb:{reads:[]}};vm.createContext(c);
vm.runInContext(html.slice(html.indexOf('function isAnnounceRead(id)'),html.indexOf('function announceReadCount')),c);
const old={id:'old',created_at:'2026-10-25T19:41:05.999+09:00'};
const latest={id:'latest',created_at:'2026-10-25T19:41:06+09:00'};
const next={id:'next',created_at:'2026-10-26T00:00:00+09:00'};
assert.equal(c.isAnnounceAlert(old),false);assert.equal(c.isAnnounceRead(old.id),false);
assert.equal(c.isAnnounceAlert(latest),true);assert.equal(c.isAnnounceAlert(next),true);
c.announceDb.reads.push({announcement_id:'latest',student_id:'student'});
assert.equal(c.isAnnounceAlert(latest),false);
c.session={id:'other'};assert.equal(c.isAnnounceAlert(latest),true);assert.equal(c.isAnnounceAlert(old),false);
assert.equal(c.announceDb.reads.length,1);console.log('PASS: old alerts cleared for all students, latest/future preserved, real read receipts unchanged');

const el={innerHTML:'old alert'};c.document={getElementById:()=>el};c.certDb={items:[old],targets:{old:['other']},submissions:[]};
vm.runInContext(html.slice(html.indexOf('function renderStudentCertAlert(){'),html.indexOf('async function renderWeeklyStudentDashboard()')),c);
c.renderStudentCertAlert();assert.equal(el.innerHTML,'');assert.equal(c.certDb.items.length,1);
c.certDb.items.push(next);c.certDb.targets.next=['other'];c.renderStudentCertAlert();assert.match(el.innerHTML,/1개/);
console.log('PASS: old certification reminders hidden, future reminders retained, records preserved');
