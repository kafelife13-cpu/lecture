const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
let revision='first',modal=false,renders=0;
const label={textContent:''};
const c={page:'students',sid:'student-test',students:[],schools:[],document:{hidden:false,activeElement:{tagName:'BODY'},querySelector:()=>modal,getElementById:()=>label},window:{researchReady:new Promise(()=>{}),scrollY:120,scrollTo:()=>{}},api:async p=>p==='/api/sync'?revision:{students:[{id:'student-test'}],schools:[]},navigate:async()=>{renders++;},setInterval:()=>{}};
vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../odap/auto-sync.js'),'utf8'),c);
(async()=>{
 await c.checkKkakkaUpdates();assert.equal(renders,0);
 revision='new-response';await c.checkKkakkaUpdates();assert.equal(renders,1);
 modal=true;revision='new-exam';await c.checkKkakkaUpdates();assert.equal(renders,1);
 modal=false;await c.checkKkakkaUpdates();assert.equal(renders,2);
 c.page='packets';revision='new-student';await c.checkKkakkaUpdates();assert.equal(renders,2);
 c.page='home';c.document.activeElement.tagName='INPUT';await c.checkKkakkaUpdates();assert.equal(renders,2);
 c.document.activeElement.tagName='BODY';await c.checkKkakkaUpdates();assert.equal(renders,3);
 c.document.hidden=true;revision='later';await c.checkKkakkaUpdates();assert.equal(renders,3);
 console.log('PASS: automatic shared-record refresh, deferred changes, modal/form/draft protection, hidden-tab pause');
})().catch(e=>{console.error(e);process.exitCode=1;});
