const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/../wrong-photo-section.js','utf8');
async function scenario(preview=false,booked=false){
 const writes=[],uploads=[],rows=[];let modal,fail=false;
 class Element{
  constructor(){this.children=[];this.events={};this.dataset={};this.nodes={};this.style={};this.value='';this.files=[];}
  set innerHTML(v){this.html=v;if(this===modal?.nodes['[data-list]']){this.sections=[...v.matchAll(/data-student="([^"]+)"/g)].map(m=>{const e=new Element();e.dataset.student=m[1];return e;});}}
  get innerHTML(){return this.html||'';}
  querySelector(s){return this.nodes[s]??=new Element();}
  querySelectorAll(s){return Object.values(this.nodes).flatMap(e=>e.sections||[]).flatMap(e=>[e.querySelector('[data-numbers]'),e.querySelector('[data-files]'),e.querySelector('[data-save]')]);}
  addEventListener(t,f){this.events[t]=f;} append(e){this.children.push(e);} prepend(e){this.children.unshift(e);} remove(){} showModal(){} close(){}
 }
 const hosts={}; const document={querySelectorAll:()=>[],querySelector:s=>hosts[s]??=new Element(),body:new Element(),createElement(t){const e=new Element();if(t==='dialog')modal=e;return e;}};
 const student={id:'test-student',name:'검증학생',role:'student',school_id:'school',status:'active'};
 const context={document,session:student,weeklyLogin:{id:preview?'teacher':student.id,pw:'test',role:preview?'teacher':'student'},studentPreviewMode:preview,padMode:false,db:{users:[student]},notify(){},crypto:require('node:crypto').webcrypto,URL,console,launchStudent(){},launchTeacher(){},returnFromStudentPreview(){}};
 context.window=context;
 context.sb={rpc:async()=>({data:{slots:booked?[{mine:!preview,student_id:student.id,booking_id:'b'}]:[]}}),from(table){let filters=[],op='select',payload;const q={select(){return q;},like(){return q;},in(){return q;},eq(k,v){filters.push([k,v]);return q;},insert(p){op='insert';payload=p;return q;},update(p){op='update';payload=p;return q;},then(resolve){if(op!=='select'){writes.push({table,op,payload});if(fail)return resolve({error:{message:'save failed'}});if(op==='insert')rows.push(payload);else Object.assign(rows.find(r=>r.id===payload.id),payload);}return resolve({data:table==='cert_items'?[{id:'ci_wrong_midterm_202610_school'}]:rows.filter(r=>filters.every(([k,v])=>r[k]===v))});}};return q;},storage:{from(){return {upload:async(p,f)=>{uploads.push(p);return {};},getPublicUrl:p=>({data:{publicUrl:'https://example.test/'+p}})};}}};
 vm.runInNewContext(source,context);
 assert.equal(hosts['#page-student #panel-home'].children.length,1);
 await context.openWrongPhotos();
 assert.match(modal.nodes['[data-list]'].innerHTML,booked?/상담 신청 학생:/ : /상담 미신청 학생:/);
 assert.equal(modal.nodes['[data-list]'].sections.length,1);
 function section(){return modal.nodes['[data-list]'].sections[0];}
 async function submit(files,numbers){const e=section();e.querySelector('[data-files]').files=files;e.querySelector('[data-numbers]').value=numbers;await modal.events.click({target:{closest:s=>s==='[data-save]'?{}:e}});return e.querySelector('[data-result]').textContent;}
 const file={type:'image/jpeg',size:1234,name:'test.jpg'};
 if(preview){await submit([file],'3');assert.equal(writes.length,0);assert.equal(section().querySelector('[data-save]').disabled,true);return;}
 assert.match(await submit([],'3'),/선택/);assert.equal(writes.length,0);
 assert.match(await submit([file],'abc'),/문항 번호/);assert.equal(writes.length,0);
 await submit([file],'3, 8');assert.equal(rows.length,1);assert.equal(JSON.parse(rows[0].photo_url).length,1);assert.equal(rows[0].student_id,student.id);
 await context.openWrongPhotos();assert.match(modal.nodes['[data-list]'].innerHTML,/사진 1장 제출/);
 await submit([file],'12');assert.equal(JSON.parse(rows[0].photo_url).length,2);assert.equal(rows.length,1);
 fail=true;assert.match(await submit([file],'15'),/제출 완료되지 않았습니다/);
 assert(writes.every(w=>w.table==='cert_submissions'));assert.equal(JSON.parse(rows[0].photo_url).length,2);
}
(async()=>{await scenario(false,false);await scenario(false,true);await scenario(true,false);await scenario(true,true);console.log('PASS: student/consultation states, validation, upload append, reload, save failure, preview write protection');})().catch(e=>{console.error(e);process.exitCode=1;});

