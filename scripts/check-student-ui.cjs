// Local UI fixture: real markup/styles/navigation, no network or student records.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 await page.route('**/*',route=>route.abort());
 await page.setContent(fixture);
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'student-ui.css'),'utf8')});
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'weekly-homework.css'),'utf8')});
 await page.evaluate(()=>{
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-student').classList.add('active');
  document.getElementById('loading-screen').remove();
  window.padMode=false;
  window.renderWeeklyHomework=()=>{};
  window.renderStudentClassAttendance=()=>{};
  window.renderReplacementLectures=()=>{};
  for(const name of ['renderLectures','renderClinicLectures','renderStudentReview','renderMyPage','renderSQaSchoolList','renderSQaMyList','clearQaBadge','renderSCertList','renderSClinicList','renderSStudy','renderSOxReview','renderSExam','renderSGrades','renderVocabEntry','renderSAnnounceList','renderSHome'])window[name]=()=>{};
 });
 const start=html.indexOf("document.addEventListener('keydown',function(e){var menu=document.getElementById('student-menu')");
 await page.addScriptTag({content:html.slice(start,html.indexOf('\nfunction renderClinicRequiredPicker()',start))});
 await page.screenshot({path:path.join(root,'tmp/student-home-mobile.png'),fullPage:true});
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal overflow at ${width}`);
  await page.locator('#student-menu summary').click();
  assert.equal(await page.locator('#s-tabbar [data-ms]').count(),17);
  if(width===390)await page.screenshot({path:path.join(root,'tmp/student-menu-mobile.png'),fullPage:true});
  const panels=await page.locator('#s-tabbar [data-ms]').evaluateAll(bs=>bs.map(b=>b.dataset.ms));
  for(const panel of panels){
   if(!await page.locator('#student-menu').evaluate(e=>e.open))await page.locator('#student-menu summary').click();
   await page.locator('#s-tabbar [data-ms="'+panel+'"]').click();
   assert.equal(await page.locator('#page-student #panel-'+panel).evaluate(e=>e.classList.contains('active')),true,panel);
   assert.equal(await page.locator('#student-menu').evaluate(e=>e.open),false);
  }
  await page.getByRole('button',{name:'공부 홈으로 이동'}).click();
  assert.equal(await page.locator('.student-section-card').count(),4);
  for(const section of ['weekly','clinic-hub','announce','video-hub']){
   await page.locator('[data-student-section="'+section+'"]').click();
   assert.equal(await page.locator('[data-student-section="'+section+'"]').getAttribute('aria-current'),'page');
   if(section==='video-hub'){
    assert.equal(await page.locator('#panel-video-hub .student-clinic-actions button').count(),3);
    if(width===390)await page.screenshot({path:path.join(root,'tmp/student-video-hub-mobile.png'),fullPage:true});
   }
   if(section==='clinic-hub')assert.equal(await page.locator('#panel-clinic-hub .student-clinic-actions button').count(),3);
   if(section==='announce')assert.equal(await page.locator('#panel-notice-hub .student-clinic-actions button').count(),2);
  }
  await page.getByRole('button',{name:'공부 홈으로 이동'}).click();
  await page.locator('#student-menu summary').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#student-menu').evaluate(e=>e.open),false);
 }
 await browser.close();
 console.log('PASS: 4 primary sections and 17 destinations at 320/390/768/1280px, no overflow, home, menu close and Escape');
})().catch(e=>{console.error(e);process.exitCode=1;});
