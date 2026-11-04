const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(require('node:path').join(__dirname,'../consultation.js'),'utf8');
async function scenario(mode){
 const all=[],pending=[],calls=[];let nativeCloses=[];
 class El{
  constructor(tag){this.tag=tag;this.nodes={};this.events={};this.children=[];this.style={};this.dataset={};this.attrs={};this.open=false;this.isConnected=false;all.push(this);if(mode==='missing')this.showModal=undefined;}
  setAttribute(k,v){this.attrs[k]=v;if(k==='open')this.open=true;}
  append(e){e.parentNode=this;e.isConnected=true;this.children.push(e);} prepend(e){this.append(e);}
  insertBefore(e){this.append(e);} remove(){this.isConnected=false;}
  querySelector(s){return this.nodes[s]??=new El('control');} querySelectorAll(){return [];}
  addEventListener(k,f){this.events[k]=f;} removeEventListener(k){delete this.events[k];}
  showModal(){if(mode==='throws')throw Error('unsupported modal');this.open=true;}
  close(){this.open=false;const handler=this.events.close;if(handler)nativeCloses.push(handler);}
  focus(){document.activeElement=this;} getClientRects(){return [{}];}
 }
 const document={createElement:t=>new El(t),getElementById:id=>all.find(e=>e.id===id&&e.isConnected),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},body:new El('body'),head:new El('head')};
 const context={document,session:{id:'s1',role:'student',school_id:'sc_hanbaek'},weeklyLogin:{id:'s1',pw:'test',role:'student'},padMode:false,studentPreviewMode:false,URLSearchParams,location:{search:''},Intl,console,clearInterval(){},setInterval(){return 1;},addEventListener(){},launchStudent(){},launchTeacher(){},doLogout(){},sNav(){},sendStudentActivity(){},confirm:()=>true,
 currentHomeworkNotice:()=>({id:'synthetic-notice',title:'합성 안내',content:'합성 본문',created_at:'2026-11-01T00:00:00+09:00'}),isAnnounceRead:()=>false,announceImageUrls:()=>[],localStorage:{getItem:()=>null,setItem(){}},recordAnnounceRead(){}};
 context.window=context;context.sb={rpc:async(name,args)=>{calls.push(args);if(pending.length)return pending.shift();return {data:{eligible:true,slots:[{starts_at:'2036-10-23T09:30:00Z',ends_at:'2036-10-23T09:45:00Z',available:true,mine:false}]}};}};
 vm.runInNewContext(source,context);
 const initial=document.getElementById('exam-consultation-notice');assert(initial.open,'entry notice opens');
 await context.openConsultation();let current=all.filter(e=>e.tag==='dialog'&&e.isConnected).at(-1);
 assert(current.open,'consultation opens');assert.match(current.nodes['[data-slots]'].innerHTML,/이 시간 신청/);assert(!initial.isConnected,'entry notice removed before opening');
 const first=current;await context.openConsultation();current=all.filter(e=>e.tag==='dialog'&&e.isConnected).at(-1);nativeCloses.splice(0).forEach(f=>f());assert(current.isConnected,'delayed close of previous dialog must not close new dialog');assert(!first.isConnected);
 let rejectOld;pending.push(new Promise((_,reject)=>rejectOld=reject));const oldRefresh=context.openConsultation();await context.openConsultation();current=all.filter(e=>e.tag==='dialog'&&e.isConnected).at(-1);rejectOld(Error('old request failed'));await oldRefresh;assert.notEqual(current.nodes['[data-message]']?.textContent,'old request failed','stale error cannot overwrite current request');
 pending.push(Promise.resolve({data:{eligible:true,slots:[],preparations:[{mine:true,starts_at:'2036-10-23T09:30:00Z',booking_id:'prep'}]}}));await context.openConsultation();current=all.filter(e=>e.tag==='dialog'&&e.isConnected).at(-1);assert.match(current.nodes['[data-status]'].textContent,/사전 작성 등원/);assert.match(current.nodes['[data-slots]'].innerHTML,/상담 시간과 별도/);
 const before=calls.length;context.studentPreviewMode=true;await context.openConsultation();current=all.filter(e=>e.tag==='dialog'&&e.isConnected).at(-1);assert.equal(calls.length,before,'preview cannot call student RPC');assert.match(current.nodes['[data-message]'].textContent,/본인 계정/);
 context.studentPreviewMode=false;context.weeklyLogin.id='other';await context.openConsultation();assert.equal(calls.length,before,'mismatched account blocked');
 context.doLogout();assert(!all.some(e=>e.tag==='dialog'&&e.isConnected),'logout closes dialogs');
 console.log('PASS UI:',mode,'notice, opening, stale close/error, preview/account guards, logout');
}
async function browserChecks(){
 let chromium;
 try{({chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright'));}
 catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;console.log('NOT RUN: real browser Esc/focus/reload checks (Playwright unavailable; set PLAYWRIGHT_PATH).');process.exitCode=2;return;}
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const section=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)+start.length));
 const functions=section('function weekMonday(value)','function sameClinicWeek')+section('function announceImageUrls(a)','function announceReadCount')+section('function myAnnounceItems()','function updateAnnounceBadge()');
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  for(const mode of ['native','missing','throws']){
   const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>r.request().url()==='http://homework.test/'?r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>합성 팝업 검사</title></head><body><button id="before">시작</button><div id="s-announce-list"></div><div id="s-clinic-notice-list"></div></body></html>'}):r.abort());
   await page.addInitScript(mode=>{
    if(mode==='missing')HTMLDialogElement.prototype.showModal=undefined;
    if(mode==='throws')HTMLDialogElement.prototype.showModal=function(){throw Error('synthetic unavailable showModal');};
    window.session={id:'synthetic-student',role:'student',school_id:'synthetic-school'};window.padMode=false;window.studentPreviewMode=false;
    window.announceDb={items:[{id:'synthetic-week',title:'합성 주간 안내',content:'맨 위부터 읽는 긴 합성 안내\n'.repeat(80)+'https://example.invalid/guide.pdf',created_at:new Date().toISOString()}],reads:[]};
    window.saved=[];window.activities=[];
    window.sb={from(table){if(table!=='announcement_reads')throw Error('unexpected table');return {async upsert(row){saved.push(row);return {error:null};}};}};
    window.updateAnnounceBadge=window.renderHomeAnnounceBanner=window.launchStudent=window.launchTeacher=window.doLogout=window.sNav=()=>{};
    window.sendStudentActivity=(...args)=>activities.push(args);
   },mode);
   const load=async()=>{await page.addScriptTag({content:functions});await page.addScriptTag({content:source});};
   await page.goto('http://homework.test/');await load();
   const popup=page.locator('#exam-consultation-notice');await popup.waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>document.activeElement.id),'homework-entry-title',mode+' initial heading focus');
   assert.equal(await popup.evaluate(el=>el.scrollTop),0,mode+' long notice starts at top');
   assert.equal(await popup.getAttribute('aria-labelledby'),'homework-entry-title');assert.equal(await popup.getAttribute('aria-describedby'),'homework-entry-content');
   await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-homework-close')),true,mode+' reverse tab stays inside');
   await page.keyboard.press('Escape');await popup.waitFor({state:'detached'});
   await page.waitForFunction(()=>saved.length===1&&announceDb.reads.length===1);
   assert.equal(await page.evaluate(()=>saved[0].student_id),'synthetic-student');assert.equal(await page.evaluate(()=>activities.length),0);
   await page.evaluate(()=>{dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await popup.count(),0,mode+' no reopen after Esc');
   await page.reload();await load();assert.equal(await popup.count(),0,mode+' device marker survives reload');assert.equal(await page.evaluate(()=>saved.length),0);
   await page.evaluate(()=>{announceDb.items[0].id='synthetic-new-week';dispatchEvent(new Event('pageshow'));});await popup.waitFor({state:'visible'});
   await page.locator('[data-homework-close]').click();await popup.waitFor({state:'detached'});await page.waitForFunction(()=>saved.length===1);
   await page.evaluate(()=>dispatchEvent(new Event('pageshow')));assert.equal(await popup.count(),0,mode+' no reopen after button');
   await page.reload();await page.evaluate(()=>announceDb.items[0].id='synthetic-new-week');await load();assert.equal(await popup.count(),0,mode+' button marker survives reload');
   assert.deepEqual(errors,[]);await context.close();
   console.log('PASS browser:',mode,'Esc/button, heading focus/top, reverse Tab, no reopen/reload, one silent own-ID read');
  }
 }finally{await browser.close();}
}
(async()=>{for(const mode of ['native','missing','throws'])await scenario(mode);await browserChecks();})().catch(e=>{console.error(e);process.exitCode=1;});
