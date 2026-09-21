const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const host={innerHTML:''},events={};
const context={window:{},document:{getElementById:()=>host,addEventListener:(n,f)=>events[n]=f},navigator:{},session:{id:'a'},certDb:{items:[{id:'now',created_at:'2026-09-09',title:'청산별곡',week_id:'w'},{id:'other',created_at:'2026-09-09',title:'다른 학생'},{id:'old',created_at:'2026-08-01',title:'완료된 과거 과제'},{id:'future',created_at:'2026-09-20',title:'미래 과제'}],targets:{now:['a'],other:['b'],old:['a'],future:['a']},submissions:[{item_id:'old',student_id:'a',status:'approved'}],weeks:[{id:'w',name:'이번 주'}]},myAnnounceItems:()=>[{title:'이번 주 안내',content:'<img> 과제',created_at:'2026-09-06'}],certDisplayTitle:i=>i.title};
vm.createContext(context);vm.runInContext(fs.readFileSync('student-sections.js','utf8'),context);
context.window.renderWeeklyExtras('2026-09-07');
assert.match(host.innerHTML,/청산별곡/);assert.match(host.innerHTML,/data-cert-open="now"/);assert.doesNotMatch(host.innerHTML,/이번 주 안내/);
assert.doesNotMatch(host.innerHTML,/다른 학생|완료된 과거 과제|미래 과제/);
const html=fs.readFileSync('index.html','utf8');
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
console.log('weekly assignment targeting, dates, escaping and inline syntax passed');

const state=vm.runInContext("("+fs.readFileSync('student-sections.js','utf8').match(/function sokTaskState[\s\S]*?\n }/)[0]+")",context);
const now=Date.parse('2026-09-23T12:00:00+09:00');
assert.equal(state({id:'a'},['a'],null,now).done,false);
for(const status of ['pending','approved'])assert.equal(state({id:'a'},['a'],{status},now).done,true);
assert.equal(state({id:'a'},['a'],{status:'rejected'},now).done,false);
assert.equal(state({id:'b'},['a'],null,now).assigned,false);
assert.equal(state({id:'a'},['a'],null,Date.parse('2026-09-28T00:00:00+09:00')).active,false);

assert.equal(state({id:'new',school_id:'sc_hanbaek'},[],null,now).assigned,true);
assert.equal(state({id:'wed',school_id:'sc_hanbaek',group_id:'hanbaek_wed_1800'},['wed'],null,now).assigned,false);
assert.equal(state({id:'chi',school_id:'sc_chidong'},[],null,now).assigned,false);
context.session={id:'a',role:'student',school_id:'sc_hanbaek'};
context.padMode=false;
context.Date=class extends Date {static now(){return now;}};
let popup;
context.document.getElementById=()=>null;
context.document.createElement=()=>({setAttribute(){}});
context.document.body={appendChild(el){popup=el;}};
context.window.refreshSokTask(true).then(()=>{
 assert.equal(popup.id,'sok-task-popup');
 assert.match(popup.innerHTML,/4주차 김까까 과제 앞장/);
 assert.match(popup.innerHTML,/속미인곡 영상보기/);
 assert.doesNotMatch(html,/renderMockScoreNotice|announce-mock-score-link/);
 assert.match(html,/a.id!=='an_mock_score_202609'/);
 console.log('PASS: Hanbaek login popup without network wait, Wednesday excluded, retired score notice hidden');
});
