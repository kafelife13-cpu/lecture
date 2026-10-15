const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/student-activity-telegram/index.ts'),'utf8');
const a=source.indexOf('function activityCategory('),b=source.indexOf('\nasync function findLatestPrivateChatId',a),c={};vm.createContext(c);vm.runInContext(source.slice(a,b).replace(': string',''),c);
for(const [activity,category] of [['숙제 채점 제출','homework'],['주간 과제 오답노트 제출','homework'],['클리닉 채점 제출','clinic_grading'],['클리닉 오답 재풀이 통과','clinic_grading'],['중간·기말고사 성적 입력','scores'],['모의고사 점수 제출','scores'],['클리닉 변경 신청','clinic_requests'],['클리닉 신청 취소','clinic_requests'],['🟢 등원 체크','attendance'],['과제 Q&A 질문','qa'],['문항 질문','qa'],['상담 신청','consultation'],['상담 신청 취소','consultation'],['로그인','activity']])assert.equal(c.activityCategory(activity),category,activity);
assert.ok(!source.includes('allow_paid_broadcast'));
assert.ok(source.includes('TELEGRAM_CATEGORY_CHAT_IDS'));
const sent=[],routes={homework:'-1',clinic_grading:'-2',scores:'-3',clinic_requests:'-4',attendance:'-5',qa:'-6',consultation:'-7'};
const sandbox={Response,Intl,Date,String,Number,JSON,Promise,setTimeout:fn=>fn(),Deno:{env:{get:key=>({TELEGRAM_BOT_TOKEN:'unit-test',TELEGRAM_CHAT_ID:'99',TELEGRAM_CATEGORY_CHAT_IDS:JSON.stringify(routes)})[key]},serve:fn=>sandbox.handler=fn},fetch:async(url,options)=>{sent.push(JSON.parse(options.body));return{ok:true,json:async()=>({ok:true})};}};
vm.createContext(sandbox);vm.runInContext(require('node:module').stripTypeScriptTypes(source),sandbox);
(async()=>{for(const activity of ['숙제 채점 제출','클리닉 채점 제출','중간·기말고사 성적 입력','클리닉 변경 신청','등원 체크','문항 질문','상담 신청','로그인']){const response=await sandbox.handler({method:'POST',json:async()=>({activity,student_name:'로컬 테스트'})});assert.equal(response.status,200);const category=c.activityCategory(activity);assert.equal(sent.at(-1).chat_id,routes[category]||'99');}assert.ok(sent.every(x=>!('allow_paid_broadcast' in x)));console.log('PASS: seven routing destinations, general fallback, free-only sends; no network calls');})().catch(e=>{console.error(e);process.exitCode=1});

