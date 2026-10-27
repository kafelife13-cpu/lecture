const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const root=process.argv[2]||path.join(__dirname,'..'),out=process.argv[3]||path.join(root,'tmp'),browser=await chromium.launch({headless:true,channel:'msedge'});try{
 fs.mkdirSync(out,{recursive:true});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 await page.route('**/*',r=>r.request().url()==='http://localhost/'?r.fulfill({contentType:'text/html',body:html}):r.abort());
 await page.goto('http://localhost/');await page.addStyleTag({content:fs.readFileSync(path.join(root,'clinic-check.css'),'utf8')});
 await page.evaluate(()=>{
  document.getElementById('loading-screen').remove();document.querySelectorAll('.page,.panel').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-student').classList.add('active');document.querySelector('#page-student #panel-clinic').classList.add('active');
  window.session={id:'s',role:'student'};window.weeklyLogin={id:'s',pw:'test-only',role:'student'};window.padMode=false;window.studentPreviewMode=false;window.fixture=[];
  window.sb={rpc:async(name,args)=>{const a=args.p_action,p=args.p_payload;
   if(a==='get')return {data:{date:'2026-10-27',request:fixture.find(r=>r.student_id===session.id)||null}};
   if(a==='request'){if(window.failSave)return{error:{message:'연결 실패'}};let r={id:1,student_id:session.id,student_name:'가상학생',school_name:'가상학교',kind:p.kind,status:'pending',requested_at:new Date().toISOString()};fixture.push(r);return {data:{request:r}};}
   if(a==='list')return{data:{date:p.date,rows:fixture.map(r=>({...r}))}};
   const r=fixture.find(x=>String(x.id)===String(p.request_id));Object.assign(r,{status:a==='approve'?'approved':'rejected',reviewed_at:new Date().toISOString()});return{data:{...r}};
  }};
 });
 await page.addScriptTag({content:fs.readFileSync(path.join(root,'clinic-home.js'),'utf8')});await page.evaluate(()=>renderStudentClinicHome());
 assert.equal(await page.locator('[data-clinic-home-kind]').count(),2);
 await page.getByRole('button',{name:'클리닉 미완 · 귀가 후 당일 마무리',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('clinic-home-student-status').textContent.includes('승인 대기'));assert.equal(await page.evaluate(()=>fixture[0].status),'pending');
 assert.equal(await page.getByRole('button',{name:'시험지 수령 후 집에서 채점',exact:true}).isDisabled(),true);
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('#clinic-home-student').evaluate(x=>x.scrollWidth<=x.clientWidth),true,'student overflow '+width);}
 await page.setViewportSize({width:390,height:844});await page.locator('#clinic-home-student').screenshot({path:path.join(out,'클리닉_학생_신청대기.png')});
 await page.evaluate(()=>{document.getElementById('page-student').classList.remove('active');document.getElementById('page-teacher').classList.add('active');document.querySelector('#page-teacher #panel-clinic').classList.add('active');session={id:'t',role:'teacher'};weeklyLogin={id:'t',pw:'test-only',role:'teacher'};});
 await page.evaluate(()=>renderClinicCheckout());await page.getByRole('button',{name:'수락',exact:true}).waitFor();
 await page.locator('#clinic-home-teacher').screenshot({path:path.join(out,'클리닉_교사_수락거절.png')});
 await page.getByRole('button',{name:'수락',exact:true}).click();await page.getByText('가상학생 수락됨',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>fixture[0].status),'approved');
 await page.locator('#clinic-home-filter').selectOption('approved');assert.equal(await page.locator('.clinic-home-row').count(),1);
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('#clinic-home-teacher').evaluate(x=>x.scrollWidth<=x.clientWidth),true,'teacher overflow '+width);}
 await page.evaluate(()=>{session={id:'s',role:'student'};weeklyLogin={id:'s',pw:'test-only',role:'student'};});await page.evaluate(()=>renderStudentClinicHome());assert.match(await page.locator('#clinic-home-student-status').textContent(),/수락됨/);
 await page.evaluate(()=>{fixture=[];window.failSave=true;});await page.evaluate(()=>renderStudentClinicHome());await page.evaluate(()=>requestClinicHome('take_home'));assert.match(await page.locator('#clinic-home-student-status').textContent(),/연결 실패/);assert.equal(await page.evaluate(()=>fixture.length),0);
 await page.evaluate(()=>{window.studentPreviewMode=true;});await page.evaluate(()=>renderStudentClinicHome());assert.equal(await page.locator('#clinic-home-student').isHidden(),true);
 assert.deepEqual(errors,[]);console.log('PASS UI: two requests, pending-only, teacher acceptance, filters, refresh, failed save, preview blocked, mobile widths');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
