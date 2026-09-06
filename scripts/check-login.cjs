// Run: node scripts/check-login.cjs (no server or student credentials required)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const auth = html.slice(html.indexOf('var studentRestoreRunning='), html.indexOf('function showSignup()'));
function setup(result) {
  const values = new Map([['lms_remember_student', 'student']]);
  const storage = {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const els = {'login-id':{value:'student'},'login-pw':{value:'password'},'login-remember':{checked:true},'login-btn':{disabled:false},'login-err':{}};
  const events = {};
  const c = {session:null,padMode:false,studentPreviewMode:false,currentRole:'student',STUDENT_REMEMBER_KEY:'lms_remember_student',
    localStorage:storage,sessionStorage:storage,navigator:{onLine:true},
    document:{getElementById:id=>els[id],addEventListener:(name,fn)=>events[name]=fn},
    window:{addEventListener:(name,fn)=>events[name]=fn},selectRole:()=>{},
    studentVaultGet:async()=>({id:'student',pw:'password'}),sb:{rpc:async()=>result},
    saveRememberedStudentLogin:async()=>{},notify:()=>{},sendStudentActivity:()=>{},
    loadAll:async()=>{},loadQaData:async()=>{},loadCertData:async()=>{},loadClinicData:async()=>{},loadStudyData:async()=>{},loadAnnounceData:async()=>{},
    launchStudent:()=>{c.launched=true;},launchTeacher:()=>{c.launched=true;}};
  vm.createContext(c);vm.runInContext(auth,c);
  return {c,values,els,events};
}
(async()=>{
  let t=setup({error:{message:'network unavailable'},data:null});
  await t.c.restoreRememberedStudentLogin();
  assert.equal(t.values.has('login_failures'),false,'network errors must not count as bad passwords');
  assert.equal(t.values.get('lms_remember_student'),'student');
  assert.equal(t.c.studentRestoreRetry,true);
  t.c.sb.rpc=async()=>({data:{id:'student',role:'student',status:'active'}});
  await t.c.restoreRememberedStudentLogin();
  assert.equal(t.c.launched,true,'retry must reauthenticate and open the app');
  assert.equal(t.c.studentRestoreRetry,false);

  t=setup({data:null});
  for(let i=0;i<5;i++)await t.c.doLogin();
  assert.ok(Number(t.values.get('login_lock_until'))>Date.now(),'wrong passwords must still lock');
  assert.equal(t.c.session,null);

  t=setup({data:{id:'student',role:'student',status:'active'}});
  let passwordManagerUsed=false;
  t.c.navigator.credentials={get:()=>{passwordManagerUsed=true;throw new Error('password manager should not be needed');}};
  t.c.saveRememberedStudentLogin=async()=>{throw new Error('storage unavailable');};
  await t.c.restoreRememberedStudentLogin();
  assert.equal(t.c.launched,true,'storage failure must not block a valid login');
  assert.equal(passwordManagerUsed,false,'use the device vault before the password manager');

  t=setup({data:{id:'student',role:'student',status:'pending'}});
  await t.c.restoreRememberedStudentLogin();
  assert.equal(t.c.session,null,'approval must still be required');

  const handler=html.match(/addEventListener\('controllerchange',function\(\)\{([\s\S]*?)\n    \}\);/)[1];
  let reloads=0;
  const sw={session:{id:'student'},studentRestoreRunning:false,refreshing:false,document:{getElementById:()=>({disabled:false})},location:{reload:()=>reloads++}};
  vm.createContext(sw);
  vm.runInContext('(function(){'+handler+'})()',sw);
  assert.equal(reloads,0,'updates must not reload an active login');
  sw.session=null;
  vm.runInContext('(function(){'+handler+'})()',sw);
  assert.equal(reloads,1);
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  console.log('PASS: login recovery, network failures, lockout, approval, storage failure, update reload, inline JS syntax');
})().catch(e=>{console.error(e);process.exitCode=1;});
