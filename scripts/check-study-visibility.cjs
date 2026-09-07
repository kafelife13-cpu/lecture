const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const source=html.slice(html.indexOf("var STUDY_AWAY_KEY="),html.indexOf('\nfunction renderTStudy(){'));
let now=100000,fail=false,writes=0,wakeRequests=0;
const values=new Map(),events={},docEvents={};
const row={id:'test',away_log:JSON.stringify([{sec:20}]),away_seconds:20};
const locks=[];
const ctx={Date:class extends Date{static now(){return now;}},Number,Promise,JSON,Array,console:{error(){},warn(){}},studyActiveSession:row,studyDb:{sessions:[row]},
 document:{hidden:false,hasFocus:()=>true,addEventListener:(k,f)=>docEvents[k]=f},window:{addEventListener:(k,f)=>events[k]=f},
 localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
 notify(){},renderSStudyLog(){},fmtTime:s=>s+'s',
 sb:{from:()=>({update:()=>({eq:async()=>{writes++;return {error:fail?new Error('offline'):null};}})})},
 navigator:{wakeLock:{request:async()=>{wakeRequests++;const lock={released:false,addEventListener(k,f){this.onrelease=f;},async release(){this.released=true;this.onrelease?.();}};locks.push(lock);return lock;}}}};
vm.createContext(ctx);vm.runInContext(source,ctx);
(async()=>{
 ctx.document.hidden=true;docEvents.visibilitychange();now+=2000;events.blur();
 assert.equal(JSON.parse(values.get(ctx.STUDY_AWAY_KEY)).start,100000,'repeat signals retain initial timestamp');
 now+=58000;ctx.document.hidden=false;
 await Promise.all([ctx.resolvePendingStudyAway(),ctx.resolvePendingStudyAway()]);
 assert.equal(writes,1,'concurrent resume saves only once');
 let log=JSON.parse(row.away_log);
 assert.equal(log[1].elapsed_sec,60);assert.equal(log[1].sec,0);assert.equal(row.away_seconds,20);
 assert.deepEqual(log[1].signals,['hidden','blur']);assert.match(ctx.studyHiddenLabel(row),/화면 비활성 60s/);
 assert.match(ctx.studyHiddenDetails(row),/창 포커스 벗어남/);assert.equal(values.size,0);
 ctx.markStudyAwayStart('pagehide');now+=30000;fail=true;
 assert.equal(await ctx.resolvePendingStudyAway(),false);assert.equal(values.size,1,'offline record retained');
 fail=false;await ctx.resolvePendingStudyAway();assert.equal(JSON.parse(row.away_log).length,3);assert.equal(values.size,0);
 events.blur();now+=1000;await ctx.resolvePendingStudyAway();assert.equal(JSON.parse(row.away_log).length,3,'short focus change ignored');
 // Restored pending interval after a reload uses the same durable entry.
 values.set(ctx.STUDY_AWAY_KEY,JSON.stringify({sessionId:row.id,start:now-40000}));
 await ctx.resolvePendingStudyAway();assert.equal(JSON.parse(row.away_log).at(-1).elapsed_sec,40);
 await Promise.all([ctx.requestStudyWakeLock(),ctx.requestStudyWakeLock()]);assert.equal(wakeRequests,1);
 await locks[0].release();await ctx.requestStudyWakeLock();assert.equal(wakeRequests,2,'released lock reacquired');
 ctx.releaseStudyWakeLock();assert.equal(ctx.studyWakeLock,null);
 let resolve;ctx.navigator.wakeLock.request=()=>new Promise(r=>resolve=r);
 const pending=ctx.requestStudyWakeLock();row.end_time=new Date().toISOString();ctx.releaseStudyWakeLock();
 const late={released:false,async release(){this.released=true;}};resolve(late);await pending;
 assert.equal(late.released,true,'late lock after stop released');assert.equal(ctx.studyWakeLock,null);
 delete row.end_time;ctx.navigator.wakeLock=undefined;await ctx.requestStudyWakeLock();assert.equal(ctx.studyWakeLockRequest,null);
 console.log('PASS: script syntax, neutral visibility records, focus/page signals, retries, deduplication, persisted recovery, Wake Lock lifecycle');
})().catch(e=>{console.error(e);process.exitCode=1;});
