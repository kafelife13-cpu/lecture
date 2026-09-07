const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let now=1000000,tick,fail=false;const storage=new Map(),rows=new Map(),messages=[];
class Clock extends Date{constructor(x){super(x===undefined?now:x);}static now(){return now;}}
const c={Date:Clock,Math,JSON,Map,console,session:{id:'fixture',role:'student'},studentPreviewMode:false,padMode:false,sExamData:{id:'e',name:'문학 1회'},isLiteratureExam:()=>true,
 document:{querySelector:()=>null},addEventListener:()=>{},setInterval:fn=>{tick=fn;},notify:m=>messages.push(m),crypto:require('node:crypto').webcrypto,
 navigator:{locks:{request:async(k,fn)=>fn()}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},loadStudyData:async()=>{},
 sb:{from:()=>{const b={select:()=>b,eq:()=>b,like:()=>b,gte:async()=>({data:[]}),is:async()=>({data:[]}),upsert:async row=>{if(fail)return{error:Error('offline')};rows.set(row.id,row);return{};}};return b;}}};
c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(require.resolve('../literature-study.js'),'utf8'),c);
const state=()=>JSON.parse([...storage.values()][0]);const total=()=>[...rows.values()].reduce((n,r)=>n+(new Date(r.end_time)-new Date(r.start_time)),0);
(async()=>{
 await c.startLiteratureStudy();assert.equal(state().running,true);now+=16000;await c.pauseLiteratureStudy();assert.equal(total(),16000);
 now+=60000;await c.startLiteratureStudy();now+=24000;await c.finishLiteratureStudy();assert.equal(total(),40000,'paused gap not accumulated');
 const count=rows.size;await c.retryLiteratureStudy();assert.equal(rows.size,count);assert.equal(total(),40000,'save retry does not duplicate time');
 await c.startLiteratureStudy();now+=10000;fail=true;assert.equal(await c.pauseLiteratureStudy(),false);assert.equal(state().running,false);assert.equal(total(),40000);
 fail=false;await c.retryLiteratureStudy();assert.equal(total(),50000,'pending local duration recovers after failure');
 await c.startLiteratureStudy();now+=90000;await c.pauseLiteratureStudy();assert.equal(total(),50000,'closed or suspended browser does not accrue unobserved gap');
 console.log('PASS actual timer flow: pause/resume, backend study duration, repeated save, failed-save recovery, stale reload');
})().catch(e=>{console.error(e);process.exitCode=1;});

