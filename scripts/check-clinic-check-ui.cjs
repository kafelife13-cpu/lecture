const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const root=path.join(__dirname,'..'),browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 await page.route('**/*',r=>r.request().url()==='http://localhost/'?r.fulfill({contentType:'text/html',body:html}):r.abort());
 await page.goto('http://localhost/');await page.addStyleTag({content:fs.readFileSync(path.join(root,'clinic-check.css'),'utf8')});
 await page.evaluate(()=>{
  document.getElementById('loading-screen').remove();document.querySelectorAll('.page,.panel').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-teacher').classList.add('active');document.querySelector('#page-teacher #panel-clinic').classList.add('active');
  window.session={id:'t',role:'teacher'};window.weeklyLogin={id:'t',pw:'test-only',role:'teacher'};window.padMode=false;window.studentPreviewMode=false;
  window.fixture=[{student_id:'s',student_name:'테스트 학생',school_name:'한백고',slot_id:'slot',slot_label:'한백고 · 수 · 18:00',mode:'unchecked',completed:false,version:0},{student_id:'u',student_name:'미배정 학생',school_name:'치동고',slot_id:null,slot_label:'시간대 미배정',mode:'unchecked',completed:false,version:0}];
  window.sb={rpc:async(name,args)=>{if(args.p_action==='list')return {data:JSON.parse(JSON.stringify(fixture))};if(window.failSave)return {error:{message:'연결 오류'}};const row=fixture.find(x=>x.student_id===args.p_payload.student_id);Object.assign(row,args.p_payload,{version:row.version+1,updated_at:new Date().toISOString()});return {data:{...row}};}};
 });
 await page.addScriptTag({content:fs.readFileSync(path.join(root,'clinic-check.js'),'utf8')});await page.evaluate(()=>renderClinicCheckout());
 assert.equal(await page.locator('[data-check-id]').count(),2);
 await page.getByRole('combobox',{name:'테스트 학생 수행 방식',exact:true}).selectOption('take_home');
 await page.getByRole('checkbox',{name:'테스트 학생 가정 수행 완료',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>fixture[0].completed),false);
 await page.getByRole('checkbox',{name:'테스트 학생 가정 수행 완료',exact:true}).check();
 await page.getByText('수행 완료',{exact:true}).last().waitFor();
 await page.evaluate(()=>renderClinicCheckout());assert.equal(await page.getByRole('checkbox',{name:'테스트 학생 가정 수행 완료',exact:true}).isChecked(),true);
 await page.evaluate(()=>window.failSave=true);await page.getByRole('combobox',{name:'테스트 학생 수행 방식',exact:true}).selectOption('onsite');
 await page.getByText('저장되지 않았습니다:',{exact:false}).waitFor();assert.equal(await page.getByRole('combobox',{name:'테스트 학생 수행 방식',exact:true}).inputValue(),'take_home');
 await page.locator('#clinic-check-filter').selectOption('unchecked');assert.equal(await page.locator('[data-check-id]').count(),1);
 await page.locator('#clinic-check-filter').selectOption('all');
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.locator('#clinic-check-card').evaluate(x=>x.scrollWidth<=x.clientWidth),true,'no card overflow at '+width);}
 await page.setViewportSize({width:390,height:844});await page.locator('#clinic-check-card').screenshot({path:path.join(root,'tmp/clinic-check-mobile.png')});
 assert.deepEqual(errors,[]);console.log('PASS checkout UI: mobile layout, persistence, failed-save rollback, filters');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
