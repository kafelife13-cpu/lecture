const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url()==='http://localhost/'?r.fulfill({contentType:'text/html',body:html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')}):r.abort());
 await page.goto('http://localhost/');
 for(const f of ['student-ui.css','weekly-homework.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,f),'utf8')});
 await page.evaluate(()=>{
  document.getElementById('loading-screen').remove();document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.getElementById('page-student').classList.add('active');
  window.session={id:'test-student',role:'student',name:'검증용 학생'};window.weeklyLogin={id:session.id,role:'student',pw:'test-only'};window.padMode=false;window.studentPreviewMode=false;
  window.STUDENT_CLASSES=[{id:'class',label:'치동고1'}];window.qaDb={weeks:[]};window.notify=(msg)=>{window.lastNotice=msg;};
  window.schoolName=()=> '치동고1';window.vocabCurrentWeekUnits=()=>[1];window.clinicVideos=()=>[{id:'v',title:'클리닉 해설'}];
  window.startVocabUnit=n=>{window.startedUnit=n;};
  window.renderStudentClassAttendance=()=>{};
  window.plan={id:'00000000-0000-0000-0000-000000000001',title:'이번 주 필수 과제',week_start:'2026-09-07',group_id:'class',config:{exam_ids:['e'],vocab_units:[1],qa_week_id:'q',video_id:'v',questions:[{prompt:'수업 개념 확인 문항 (화면 검증용)'}]},students:[{id:session.id,name:session.name,states:{vocab:{status:'done',done:1,total:1},omr:{status:'todo',done:0,total:1},qa:{status:'todo',done:2,total:5},notebook:{status:'todo'},study:{status:'done',done:2,total:2},concept:{status:'todo'}},work:{}}]};
  window.fixtureExams=[
   {id:'e',name:'지난 과제',category:'homework',total_q:40,questions:[{text:'훈민정음 창제 원리',answer:'1',explanation:'해설'}]},
   {id:'c',name:'클리닉 시험',category:'school',total_q:1,questions:[{text:'중세국어 개념',answer:'1',explanation:'해설'}]}
  ];
  window.sb={rpc:async(name,args)=>{
   window.lastRpc=args;
   if(args.p_action==='list')return {data:[window.plan]};
   if(args.p_action==='concept'){plan.students[0].states.concept={status:'approved'};plan.students[0].work.concept={status:'approved'};return {data:{score:1,total:1,questions:[{answer:'O',explanation:'검증용 해설'}]}};}
   if(args.p_action==='notebook'){plan.students[0].states.notebook={status:'pending'};plan.students[0].work.notebook={status:'pending',data:{mode:'clinic',photos:[]}};return {data:{ok:true}};}
   return {data:{ok:true}};
  },from:table=>{
   if(table==='exams')return {select:()=>({in:()=>({order:async()=>({data:window.fixtureExams})})})};
   if(table==='exam_responses')return {select:()=>({eq:async()=>({data:[{student_name:'학생',answers:{0:'2'}}]})})};
   return {select:async()=>({data:[{id:'q',name:'질문 주차',school_id:'school'}]})};
  },storage:{from:()=>({upload:async()=>({}),getPublicUrl:()=>({data:{publicUrl:'https://invalid.test/photo.png'}})})}};
  window.repIsWrong=(r,i,e)=>Object.prototype.hasOwnProperty.call(r.answers||{},i)&&String(r.answers[i])!==String(e.questions[i].answer);
  window.callClaudeServer=async()=>({content:[{text:'[{"prompt":"훈민정음은 음소 문자이다.","answer":"O","explanation":"초성을 기준으로 합용한다."}]'}]});
  for(const name of ['renderLectures','renderClinicLectures','renderStudentReview','renderMyPage','renderSQaSchoolList','renderSQaMyList','clearQaBadge','renderSCertList','renderSClinicList','renderSStudy','renderSOxReview','renderSExam','renderSGrades','renderVocabEntry','renderSAnnounceList','renderSHome'])window[name]=()=>{};
 });
 const start=html.indexOf("document.addEventListener('keydown',function(e){var menu=document.getElementById('student-menu')");
 await page.addScriptTag({content:html.slice(start,html.indexOf('\nfunction renderClinicRequiredPicker()',start))});
 await page.addScriptTag({content:fs.readFileSync(path.join(root,'weekly-homework.js'),'utf8')});
 await page.evaluate(()=>sNav('weekly'));
 await page.locator('.weekly-task').first().waitFor();
 await page.locator('#s-weekly-date').fill('2026-09-07');
 await page.locator('#s-weekly-date').dispatchEvent('change');
 assert.equal(await page.locator('.weekly-task').count(),6);
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(root,'tmp/weekly-homework-mobile.png'),fullPage:true});
 await page.locator('[data-task="vocab"]').click();
 await page.locator('#page-student [data-weekly-action="vocab-unit"]').click();
 assert.equal(await page.evaluate(()=>window.startedUnit),1);
 await page.evaluate(()=>sNav('weekly'));
 await page.locator('[data-task="concept"]').click();
 await page.locator('#weekly-concept-form input[value="O"]').check();
 await page.locator('#weekly-concept-form [type="submit"]').click();
 await page.getByText('개념 복습 OX를 모두 맞혔어요!').waitFor();
 await page.evaluate(()=>sNav('weekly'));
 await page.locator('[data-task="notebook"]').click();
 await page.locator('#weekly-note-files').setInputFiles({name:'note.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
 await page.locator('#weekly-note-form [type="submit"]').click();
 await page.getByText('제출한 사진을 선생님이 확인해요.').waitFor();
 assert.equal(await page.evaluate(()=>plan.students[0].states.notebook.status),'pending');
 await page.evaluate(()=>{session={id:'teacher',role:'teacher'};weeklyLogin={id:'teacher',role:'teacher',pw:'test-only'};document.getElementById('page-student').classList.remove('active');document.getElementById('page-teacher').classList.add('active');document.querySelectorAll('#page-teacher .panel').forEach(p=>p.classList.toggle('active',p.id==='panel-weekly'));renderWeeklyHomework();});
 await page.locator('#t-weekly-body .weekly-table').waitFor();
 assert.equal(await page.locator('#t-weekly-body tbody tr').count(),1);
 await page.locator('[data-weekly-action="review"]').click();
 await page.locator('#t-weekly-review').waitFor({state:'visible'});
 await page.evaluate(()=>{plan.config.questions=[{prompt:'교사 편집 검증',answer:'O',explanation:'해설'}];});
 await page.locator('[data-weekly-action="edit"]').click();
 await page.locator('#weekly-create-form').waitFor();
 assert.equal(await page.locator('#weekly-create-form [name="group_id"]').inputValue(),'class');
 assert.match(await page.locator('#weekly-create-form [name="questions"]').inputValue(),/교사 편집 검증/);
 assert.equal(await page.locator('#weekly-ox-source option').count(),1);
 await page.locator('#weekly-ox-count').fill('1');
 await page.locator('#weekly-ox-source-kind').selectOption('clinic');
 assert.match(await page.locator('#weekly-ox-source').inputValue(),/c/);
 await page.locator('#weekly-ox-count').fill('3');
 await page.evaluate(()=>{callClaudeServer=async()=>({content:[{text:'[{"prompt":"개념1","answer":"O","explanation":"해설1"},{"prompt":"개념2","answer":"X","explanation":"해설2"},{"prompt":"개념3","answer":"O","explanation":"해설3"}]'}]});});
 await page.locator('[data-weekly-action="generate-ox"]').click();
 await page.waitForFunction(()=>document.querySelector('[name="questions"]').value.includes('개념3 | O | 해설3'));
 await page.locator('#weekly-create-form [type="submit"]').click();
 await page.waitForFunction(()=>window.lastNotice==='필수 과제를 등록했어요.');
 await page.evaluate(async()=>{
  session={id:'student',role:'student'};weeklyLogin={id:'student',role:'student',pw:'test-only'};
  document.getElementById('page-teacher').classList.remove('active');document.getElementById('page-student').classList.add('active');
  sb.rpc=async()=>({data:[]});window.renderSExam=scope=>{window.openedExamScope=scope;};
  sNav('weekly');await renderWeeklyHomework();
 });
 assert.equal(await page.locator('[data-weekly-action="browse-task"]').count(),6);
 await page.locator('[data-weekly-action="browse-task"][data-task="omr"]').click();
 assert.equal(await page.evaluate(()=>window.openedExamScope),'homework');
 await page.evaluate(async()=>{sb.rpc=async()=>({error:{message:'test connection error'}});sNav('weekly');await renderWeeklyHomework();});
 assert.equal(await page.locator('[data-weekly-action="browse-task"]').count(),6);
 await page.locator('[data-weekly-action="browse-task"][data-task="study"]').click();
 assert.ok(await page.locator('#page-student #panel-study').isVisible());
 assert.deepEqual(errors,[]);
 console.log('PASS: six tasks, mobile layout, OX submission, notebook photo submission, teacher table/review');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
