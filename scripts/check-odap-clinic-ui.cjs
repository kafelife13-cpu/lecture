const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../odap/clinic.js'),'utf8');
let timer,apiGate=null,jobs=[{packet_id:'p1',status:'pending'}];
const elements={'clinic-results':{innerHTML:''},'clinic-job-status':{textContent:''}};
const body={title:'Test',wrongs:[{original_source_verified:true},{}],diagnosis:[],generated:[],by_type:[],by_concept:[],packet_ids:['p1'],type_packets:[],concept_packets:[],graded:2,unknown:0,notice:'Draft',type_missing:6,concept_missing:6};
const run={id:'r1',student_id:'s1',body};
const c={clinicRun:run,sid:'s1',page:'clinic',clinicBusy:false,clinicPoll:null,clinicViewSequence:0,clinicNames:['Original','','','Type','Concept'],clinicCounts:()=>[2,0,0,0,0],clinicKeyWarnings:()=>'',E:String,badge:x=>x,on:()=>{},clinicTagEditor:()=>{},clinicPreview:()=>{},action:()=>{},document:{querySelectorAll:()=>[],querySelector:()=>null},$:id=>elements[id],clearTimeout:()=>{timer=null},setTimeout:(fn,ms)=>{timer={fn,ms};return 1;},api:async url=>{if(url.includes('/api/packet?'))assert.ok(url.includes('metadata_only=true'));if(apiGate)await apiGate;return url.includes('action=jobs')?jobs:{id:'p1',files:[]};}};
vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function showClinic(){'),source.indexOf('function clinicPreview(')),c);
(async()=>{
 await c.showClinic();assert.equal(timer.ms,15000);assert.match(elements['clinic-results'].innerHTML,/원본 연결 확인 1\/2문항/);assert.match(elements['clinic-results'].innerHTML,/15초마다 자동 확인/);
 jobs=[{packet_id:'p1',status:'done'}];await timer.fn();await new Promise(r=>setImmediate(r));assert.equal(timer,null);
 let release;apiGate=new Promise(r=>release=r);const old=elements['clinic-results'].innerHTML;const stale=c.showClinic();c.sid='s2';c.clinicRun={...run,id:'r2',student_id:'s2'};release();await stale;assert.equal(elements['clinic-results'].innerHTML,old);assert.equal(timer,null);
 console.log('PASS: pending-job polling, completed-job stop, original completeness, stale student-response isolation');
})().catch(e=>{console.error(e);process.exitCode=1});

const app=fs.readFileSync(path.join(__dirname,'../odap/app.js'),'utf8'),images={};
vm.createContext(images);vm.runInContext(app.split('\n')[1]+app.slice(app.indexOf('function questionImagesMarkup('),app.indexOf('function questionMarkup(')),images);
const imageHTML=images.questionImagesMarkup([{data:'https://example.com/private',alt:'external'},{data:'data:image/svg+xml;base64,AAAA',alt:'svg'},{data:'data:image/png;base64,AAAA',alt:'<bad>"'}]);
assert.equal((imageHTML.match(/<img /g)||[]).length,1);assert.ok(imageHTML.includes('&lt;bad&gt;&quot;'));assert.ok(!imageHTML.includes('https://'));
console.log('PASS: original-note image preview accepts bounded raster data and escapes labels');
