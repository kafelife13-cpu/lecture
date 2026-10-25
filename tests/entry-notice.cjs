const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../consultation.js'),'utf8');
new vm.Script(source);
const nodes=new Map(),events=[];
const document={hidden:false,getElementById:id=>nodes.get(id),querySelector:()=>null,createElement:()=>({style:{},setAttribute(){},showModal(){this.open=true;},addEventListener(k,fn){this[k]=fn;},remove(){nodes.delete(this.id);}}),body:{append(el){nodes.set(el.id,el);}}};
const c={showModal:el=>el.showModal(),dismissModal:el=>el?.remove(),window:{},document,session:{id:'preview',role:'student',school_id:'sc_chidong'},padMode:false,sNav:(p,scope)=>events.push(scope?p+':'+scope:p),openConsultation:()=>events.push('consultation')};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf(' window.isExamConsultationNoticeStudent='),source.indexOf(' function entry(){')),c);
for(const school of ['sc_chidong','sc_hanbaek'])assert.equal(c.window.isExamConsultationNoticeStudent({role:'student',school_id:school}),true);
assert.equal(c.window.isExamConsultationNoticeStudent({role:'teacher',school_id:'sc_chidong'}),false);
assert.equal(c.window.isExamConsultationNoticeStudent({role:'student',school_id:'other'}),false);

for(const school of ['sc_hanbaek','sc_chidong','other']){
 c.session={id:'test',role:'student',school_id:school};
 c.showEntryNotice();assert.equal(nodes.size,0);
 nodes.set('exam-consultation-notice',{remove(){nodes.delete('exam-consultation-notice');}});
 c.showEntryNotice();assert.equal(nodes.size,0);
}
assert.ok(source.includes("score.onclick=()=>sNav('exam','naeshin')"));
assert.ok(source.includes("card.querySelector('button').onclick=openConsultation"));
console.log('PASS: no automatic score popup; existing popup dismissed; manual score and consultation entry retained');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
assert.ok(html.includes("studentExamScope==='naeshin'?e.category==='naeshin':true"));
assert.ok(html.includes("studentExamScope==='naeshin'?i!==4:i!==1"));
