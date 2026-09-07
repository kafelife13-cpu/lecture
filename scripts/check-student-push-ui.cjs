const fs=require('fs');const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('var studentPushPromptShown='),html.indexOf('\nfunction renderSHome(){'));
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:320,height:740}});
 for(const state of ['needed','denied','unsupported','enabled','unsaved','pad','teacher']){
 await page.setContent('<style>:root{--green:#22c55e;--bg2:#fff;--text:#111;--text2:#555}body{margin:0}dialog::backdrop{background:#0008}button{min-height:44px}</style><div id="page-student"><button id="s-push-btn"></button><main class="main"><section><div id="home-push-banner"></div></section></main></div>');
 await page.evaluate(state=>{
 window.session={id:'test',role:state==='teacher'?'teacher':'student'};window.padMode=state==='pad';window.clicked=0;
 window.subscribeToPush=()=>window.clicked++;
 window.Notification=state==='unsupported'?undefined:{permission:['enabled','unsaved'].includes(state)?'granted':state==='denied'?'denied':'default'};
 window.PushManager=function(){};
 Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{ready:Promise.resolve({pushManager:{getSubscription:async()=>({endpoint:'test-endpoint'})}})}});
 window.sb={from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:state==='enabled'?{student_id:'test'}:null,error:null})})})})})};
 },state);
 await page.addScriptTag({content:source});await page.evaluate(()=>updatePushBtnState());
 const open=await page.locator('dialog[open]').count();
 assert.equal(open,['needed','denied','unsupported','unsaved'].includes(state)?1:0,state);
 if(open){
 assert.ok(await page.locator('dialog').evaluate(e=>e.getBoundingClientRect().right<=window.innerWidth),'mobile fit');
 if(state==='needed'){await page.getByRole('button',{name:'지금 알림 켜기 → 허용'}).click();assert.equal(await page.evaluate(()=>clicked),1);}
 await page.locator('dialog button').last().click();assert.equal(await page.locator('dialog[open]').count(),0);
 await page.evaluate(()=>updatePushBtnState());assert.equal(await page.locator('dialog[open]').count(),0,'once per login');
 }
 if(!['pad','teacher'].includes(state))assert.equal(await page.locator('#home-push-banner').evaluate(e=>e.parentElement.className),'main');
 }
 console.log('PASS: student notification prompt, device capability/permission/server state, mobile fit, once-per-login, shared-pad and teacher exclusion');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
