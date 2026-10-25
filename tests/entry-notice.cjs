const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../consultation.js'),'utf8');
new vm.Script(source);
const nodes=new Map(),events=[];
const document={hidden:false,getElementById:id=>nodes.get(id),querySelector:()=>null,createElement:()=>({style:{},button:{},querySelector(){return this.button;},setAttribute(){},showModal(){this.open=true;},addEventListener(k,fn){this[k]=fn;},remove(){nodes.delete(this.id);}}),body:{append(el){nodes.set(el.id,el);}}};
const c={showModal:el=>el.showModal(),dismissModal:el=>el?.remove(),window:{},document,session:{id:'preview',role:'student',school_id:'sc_chidong'},padMode:false,sNav:(p,scope)=>events.push(scope?p+':'+scope:p),openConsultation:()=>events.push('consultation')};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf(' window.isExamConsultationNoticeStudent='),source.indexOf(' function entry(){')),c);
c.esc=String;
const notices=[{id:'an_1792925427850',school_id:'sc_hanbaek',title:'한백고 기말대비',content:'높임 사동 피동'}, {id:'an_1792925445084',school_id:'sc_chidong',title:'치동고 기말대비',content:'속미인곡 진달래꽃'}];
c.myAnnounceItems=()=>notices.filter(a=>a.school_id===c.session.school_id);
for(const school of ['sc_chidong','sc_hanbaek'])assert.equal(c.window.isExamConsultationNoticeStudent({role:'student',school_id:school}),true);
assert.equal(c.window.isExamConsultationNoticeStudent({role:'teacher',school_id:'sc_chidong'}),false);
assert.equal(c.window.isExamConsultationNoticeStudent({role:'student',school_id:'other'}),false);

for(const school of ['sc_hanbaek','sc_chidong']){
 c.session={id:'test',role:'student',school_id:school};
 c.showEntryNotice();assert.equal(nodes.size,1);
 const modal=nodes.get('exam-consultation-notice');assert.ok(modal.open);
 assert.ok(modal.innerHTML.includes(notices.find(a=>a.school_id===school).content));
 c.showEntryNotice();assert.equal(nodes.get('exam-consultation-notice'),modal);
 modal.button.onclick();assert.equal(nodes.size,0);
 c.showEntryNotice();assert.equal(nodes.size,0);
}
c.session={id:'other',role:'student',school_id:'other'};c.showEntryNotice();assert.equal(nodes.size,0);
c.session={id:'teacher',role:'teacher'};c.showEntryNotice();assert.equal(nodes.size,0);
c.session={id:'new',role:'student',school_id:'sc_hanbaek'};
c.myAnnounceItems=()=>[{id:'old',title:'과거 과제',content:'과거 공지'}];c.showEntryNotice();assert.equal(nodes.size,0);
assert.ok(source.includes("score.onclick=()=>sNav('exam','naeshin')"));
assert.ok(source.includes("card.querySelector('button').onclick=openConsultation"));
console.log('PASS: only approved school homework popup; no duplicate/reopen after dismiss; no old/teacher popup; manual consultation retained');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
assert.ok(html.includes("studentExamScope==='naeshin'?e.category==='naeshin':true"));
assert.ok(html.includes("studentExamScope==='naeshin'?i!==4:i!==1"));
