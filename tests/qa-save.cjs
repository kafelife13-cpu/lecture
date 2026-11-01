const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const code=html.slice(html.indexOf('async function submitFreeQa()'),html.indexOf('var qaChatHistory=[]'));
async function check(fail){
  const fields={'free-qa-title':{value:'질문 제목'},'free-qa-content':{value:'질문 내용'}},activity=[];
  let payload;
  const c={session:{id:'student',name:'학생'},qaDb:{schools:[{id:'sc_hanbaek'}],weeks:[{school_id:'sc_hanbaek'}],questions:[]},document:{getElementById:id=>fields[id]},sb:{from:()=>({upsert:async q=>{payload=q;return{error:fail?{message:'offline'}:null}}})},notify:()=>{},sendStudentActivity:(...a)=>activity.push(a),renderSQaMyList:()=>{},renderQaReview:()=>{},updateAllBadges:()=>{}};
  vm.createContext(c);vm.runInContext(code,c);await c.submitFreeQa();
  assert.equal(payload.prob_num,null);assert.equal('category' in payload,false);
  assert.equal(c.qaDb.questions.length,fail?0:1);assert.equal(activity.length,fail?0:1);
  assert.equal(fields['free-qa-content'].value,fail?'질문 내용':'');
}
Promise.all([check(false),check(true)]).then(()=>console.log('PASS: free questions match schema; failed saves retain input and do not announce success'));
