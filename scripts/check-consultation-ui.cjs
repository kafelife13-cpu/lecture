const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
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
 const context={document,session:{id:'s1',role:'student',school_id:'sc_hanbaek'},weeklyLogin:{id:'s1',pw:'test',role:'student'},padMode:false,studentPreviewMode:false,URLSearchParams,location:{search:''},Intl,console,clearInterval(){},setInterval(){return 1;},addEventListener(){},launchStudent(){},launchTeacher(){},doLogout(){},sNav(){},sendStudentActivity(){},confirm:()=>true};
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
(async()=>{for(const mode of ['native','missing','throws'])await scenario(mode);})().catch(e=>{console.error(e);process.exitCode=1;});
