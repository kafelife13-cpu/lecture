const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../class-attendance-ui.js'),'utf8');
const source=html.slice(html.indexOf('async function sendAttendanceTelegram('),html.indexOf('\nlet session=null'));
const edit=ui.slice(ui.indexOf('async function editClassAttendance('),ui.indexOf('\nfunction unlockAttendance('));
(async()=>{
 const sent=[],warnings=[];let fail=false;
 const c={session:{role:'teacher'},studentPreviewMode:false,classAttendanceBusy:false,classAttendancePin:'test',
  activeStudents:()=>[{id:'s',name:'학생',group_id:'g'}],ClassAttendance:{find:()=>({id:'g',day:'wed',label:'수요일 수업'}),dayKey:()=> 'wed'},
  document:{getElementById:()=>({value:'2026-09-23'})},confirm:()=>true,alert:()=>{},renderClassAttendance:async()=>{},
  attendanceSb:{rpc:async()=>({error:fail?new Error('save failed'):null})},
  sb:{functions:{invoke:async(name,payload)=>{sent.push(payload.body);return {};}}},notify:t=>warnings.push(t),console};
 vm.createContext(c);vm.runInContext(source+edit,c);
 await c.editClassAttendance('s','present');assert.equal(sent.length,1);assert.equal(sent[0].activity,'🟢 등원 체크');
 await c.editClassAttendance('s','cancel');assert.equal(sent.length,1);
 fail=true;await c.editClassAttendance('s','present');assert.equal(sent.length,1);
 c.studentPreviewMode=true;await c.sendAttendanceTelegram({id:'s',name:'학생'},'');assert.equal(sent.length,1);
 c.studentPreviewMode=false;c.sb.functions.invoke=async()=>({error:new Error('offline')});
 await c.sendAttendanceTelegram({id:'s',name:'학생'},'');assert.equal(warnings.length,1);
 const dash=html.slice(html.indexOf('async function dashSetAttendance('),html.indexOf('\nfunction dashSetPerformanceFilter('));
 assert(dash.indexOf('if(inserted.error)throw inserted.error;')<dash.indexOf('await sendAttendanceTelegram('));
 assert(dash.indexOf('await sendAttendanceTelegram(')<dash.indexOf('}else{'));
 console.log('PASS: saved check-in sends; cancel, failed save and preview do not; delivery failure is visible.');
})();
