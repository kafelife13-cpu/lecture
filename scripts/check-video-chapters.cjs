const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
function element(){return {children:[],style:{},attrs:{},hidden:false,classList:{add(){},remove(){}},replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this[k]=fn;}};}
const elements={};const document={createElement:element,getElementById(id){return elements[id]||(elements[id]=element());}};
const c={document};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'video-chapters.js'),'utf8'),c);
const chapter=c.KkakkaVideoChapters;
const numbers=[];
for(const [id,duration] of [['sJsIw7F6r_w',2928],['8TwCCPBPyrA',2839]]){
  const rows=chapter.get(id);assert.ok(rows.length);let previous=-1;
  for(const row of rows){assert.ok(Number.isInteger(row.seconds)&&row.seconds>=0&&row.seconds<duration);assert.ok(row.seconds>previous);previous=row.seconds;if(/^\d+번$/.test(row.label))numbers.push(parseInt(row.label));}
}
assert.deepEqual(numbers,Array.from({length:26},(_,i)=>i+1));
assert.equal(chapter.get('constructor').length,0);
const actual=new Set();
chapter.observe(actual,-1,960,2928);assert.equal(actual.size,0,'a click alone is not watched');
chapter.observe(actual,960,963,2928);assert.deepEqual([...actual],[960,961,962]);
chapter.observe(actual,960,963,2928);assert.equal(actual.size,3,'replay is deduplicated');
chapter.observe(actual,963,1150,2928);assert.equal(actual.size,3,'skipped questions are not watched');
chapter.observe(actual,1150,1150,2928);assert.equal(actual.size,3,'stationary playback is not watched');
chapter.observe(actual,1150,960,2928);assert.equal(actual.size,3,'backward seeks are not watched');
assert.equal(chapter.restore({youtubeId:'other',seconds:[960]},'sJsIw7F6r_w').size,0);
const firstQuestion=Array.from({length:38},(_,i)=>960+i);
const result=chapter.stats('sJsIw7F6r_w',{youtubeId:'sJsIw7F6r_w',seconds:firstQuestion},2928);
assert.equal(result[1].percent,95);assert.equal(result[1].status,'완료');assert.equal(result[2].status,'기록 없음');
assert.equal(chapter.stats('sJsIw7F6r_w',null,2928)[1].status,'기록 없음','legacy percent never invents question history');
const panel=element();const selected=[];chapter.render(panel,'8TwCCPBPyrA',t=>selected.push(t));
assert.equal(panel.hidden,false);const buttons=panel.children[2].children;
assert.equal(buttons[0].type,'button');buttons[0].click();assert.deepEqual(selected,[0]);
const status=panel.children[3];assert.match(status.textContent,/9번/);
chapter.render(panel,'sJsIw7F6r_w',()=>false);panel.children[2].children[1].click();assert.equal(panel.children[3].textContent,undefined);
chapter.render(panel,'unknown',()=>{});assert.equal(panel.hidden,true);assert.equal(panel.children.length,0);
let seek,played=0,notifications=0,callback;
Object.assign(c,{db:{videos:[{id:'lesson',url:'sJsIw7F6r_w',title:'lesson',category:'clinic'}]},session:{id:'test'},getLastPos:()=>0,getPct:()=>0,ytId:x=>x,startVideoPresenceMonitor:async()=>true,sendStudentActivity(){},notify(){notifications++;},ytApiReady:true,initYT(){},currentVid:null,lastPos:30,totalDur:2928,watchedSet:new Set([1,2,3]),ytPlayer:{seekTo(t){seek=t;},playVideo(){played++;},getVideoData(){return {video_id:'sJsIw7F6r_w'};}},KkakkaVideoChapters:{render(el,id,fn){callback=fn;}}});
vm.runInContext(html.slice(html.indexOf('async function openPlay('),html.indexOf('function initYT(')),c);
(async()=>{
  c.KkakkaVideoChapters.get=()=>[];
  c.playRequest=0;
  await c.openPlay('lesson',true);
  assert.equal(callback(960),true);assert.equal(seek,960);assert.equal(played,1);assert.equal(c.lastPos,-1);assert.deepEqual([...c.watchedSet],[1,2,3]);
  assert.equal(callback(-1),false);assert.equal(callback(2928),false);assert.equal(callback(NaN),false);assert.equal(played,1);
  c.currentVid='other';assert.equal(callback(0),false);assert.equal(played,1);
  c.currentVid='lesson';c.ytPlayer.getVideoData=()=>({video_id:'other'});assert.equal(callback(0),false);assert.equal(played,1);
  c.ytPlayer.getVideoData=()=>({video_id:'sJsIw7F6r_w'});c.totalDur=0;assert.equal(callback(0),false);assert.ok(notifications>=3);
  Object.assign(c,{chapterTrackingEnabled:true,chapterWatchedSet:new Set([960,961]),watchedSet:new Set([960,961]),YT:{PlayerState:{PLAYING:1,PAUSED:2,ENDED:0}},stopTracking(){},scheduleSave(){},doAutoSave(){},updateTrackUI(){},totalDur:2928});
  vm.runInContext(html.slice(html.indexOf('function onYTState('),html.indexOf('function startTracking(')),c);
  c.onYTState({data:0});assert.equal(c.watchedSet.size,2,'jumping to the end does not complete unviewed questions');
  const writes=[];let savedQuestions=0;
  c.watchedSet=new Set(Array.from({length:100},(_,i)=>960+i));
  Object.assign(c,{currentVid:'lesson',session:{id:'test',role:'student'},studentPreviewMode:false,chapterNextSaveAt:0,chapterSavedCount:0,chapterSaveWarning:false,getPct:()=>0,maxRateSeen:1,ytPlayer:{getCurrentTime:()=>963},KkakkaVideoChapters:chapter,
    chapterWatchRpc:async()=>{savedQuestions++;c.currentVid='next-lesson';c.session={id:'next-user'};},
    upsertProgress:async(...args)=>writes.push(args)});
  vm.runInContext(html.slice(html.indexOf('async function doAutoSave('),html.indexOf('function updateTrackUI(')),c);
  await c.doAutoSave(true);assert.equal(savedQuestions,1);assert.equal(writes[0][0],'test');assert.equal(writes[0][1],'lesson','async saves retain their original student and video');
  assert.ok(fs.readFileSync(path.join(root,'sw.js'),'utf8').includes('/lecture/video-chapters.js?v=1'));
  console.log('PASS: 1–26 coverage, valid cues, rendering, unknown videos, seek readiness, stale player rejection, unchanged watched intervals and syntax');
})().catch(e=>{console.error(e);process.exitCode=1;});
