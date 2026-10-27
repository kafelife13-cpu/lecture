const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const start=html.indexOf('async function odapSaveResponse('),end=html.indexOf('async function doLogin(',start);
let saved,calls=0;
const context={weeklyLogin:{id:'student-test',pw:'test-only',role:'student'},session:{id:'student-test',role:'student'},studentPreviewMode:false,padMode:false,db:{users:[]},sb:{rpc:async(name,args)=>{calls++;saved={name,args};return {data:{}};}}};
vm.createContext(context);vm.runInContext(html.slice(start,end),context);
(async()=>{
 const payload={exam_id:'exam-test',student_id:'another-student',answers:{0:'1'}};
 await context.odapSaveResponse(payload);assert.equal(saved.name,'odap_save_response');assert.equal(saved.args.p_payload.student_id,'student-test');assert.equal(payload.student_id,'another-student');
 context.studentPreviewMode=true;assert.ok((await context.odapSaveResponse(payload)).error);assert.equal(calls,1);
 context.studentPreviewMode=false;context.padMode=true;assert.ok((await context.odapSaveResponse(payload)).error);assert.equal(calls,1);
 context.padMode=false;context.session.id='another-student';assert.ok((await context.odapSaveResponse(payload)).error);assert.equal(calls,1);
 assert.equal((html.match(/await odapSaveResponse\(/g)||[]).length,6);
 assert.ok(!/from\('exam_responses'\)\.upsert/.test(html));
 for(const name of ['app.js','cloud.js','student.js'])new vm.Script(fs.readFileSync(path.join(root,'odap',name),'utf8'));
 // Replacing main.innerHTML recreates the select and discards its handler.
 const app=fs.readFileSync(path.join(root,'odap/app.js'),'utf8');
 let picker,markup='',chosen;
 const main={get innerHTML(){return markup;},set innerHTML(value){markup=value;picker={value:'',onchange:null};}};
 const ui={sid:'',selected:['old'],page:'students',currentAnalysis:null,URLSearchParams,window:{},
  $:id=>id==='main'?main:picker,getStudents:async()=>{},heading:()=>'',studentPicker:()=>'<select></select>',empty:()=>'<p>Choose</p>',
  action:fn=>fn(),navigate:async()=>{chosen=ui.sid;}};
 vm.createContext(ui);
 vm.runInContext(app.slice(app.indexOf('function wireStudent()'),app.indexOf('function questionImagesMarkup')),ui);
 vm.runInContext(app.slice(app.indexOf('async function studentPage()'),app.indexOf('function reviewLinks(')),ui);
 await ui.studentPage();
 assert.equal(typeof picker.onchange,'function','initial student picker must survive empty-state rendering');
 picker.value='synthetic-student';await picker.onchange();
 assert.equal(chosen,'synthetic-student');assert.equal(ui.selected.length,0);
 new vm.Script(fs.readFileSync(path.join(root,'odap-entry.js'),'utf8'));
 console.log('PASS: all six submission paths, current identity, payload immutability, preview/pad protection, cloud JS syntax');
})().catch(error=>{console.error(error);process.exitCode=1;});
