// Local fixture only: no production requests or student data.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/*',r=>r.abort());
 await page.setContent('<div id="s-grammar-ox-body"></div><div id="t-grammar-ox-body"></div>');
 for(const m of fs.readFileSync('index.html','utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))await page.addStyleTag({content:m[1]});
 await page.addStyleTag({path:'grammar-ox.css'});await page.addScriptTag({path:'grammar-ox-data.js'});await page.addScriptTag({path:'grammar-ox-data-kimhayan.js'});await page.addScriptTag({path:'grammar-review.js'});
 await page.evaluate(()=>{
  if(!crypto.randomUUID)crypto.randomUUID=()=>String(Math.random());
  window.session={id:'s1',name:'테스트 학생',role:'student'};window.padMode=false;window.studentPreviewMode=false;window.alerts=0;window.sendStudentActivity=()=>alerts++;
  window.STUDENT_CLASSES=[{id:'a',label:'테스트 반'},{id:'b',label:'다른 반'}];window.activeStudents=()=>[{id:'s1',name:'테스트 학생',group_id:'a'},{id:'s2',name:'미응시 학생',group_id:'a'}];
  window.questions=[];window.notify=()=>{};window.sNav=()=>renderGrammarOx();window.records=[];window.fail=false;window.readFail=false;window.calls=0;
  window.sb={from:(table)=>{
   const records=table==='grammar_ox_questions'?window.questions:window.records;let payload=null;
   let filters=[],start=0,end=999;
   const query={async insert(row){records.push({...row,created_at:new Date().toISOString(),seen_at:null,reply:null});return {};},update(row){payload=row;return this;},select(){return this;},order(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},gte(k,v){filters.push(r=>r[k]>=v);return this;},range(a,b){start=a;end=b;return this;},single(){return Promise.resolve(window.readFail?{error:{message:'read failed'}}:{data:records.filter(r=>filters.every(f=>f(r)))[0]});},then(resolve){if(payload)records.filter(r=>filters.every(f=>f(r))).forEach(r=>Object.assign(r,payload));return Promise.resolve({data:records.filter(r=>filters.every(f=>f(r))).sort((a,b)=>(b.submitted_at||b.created_at).localeCompare(a.submitted_at||a.created_at)).slice(start,end+1)}).then(resolve);},async upsert(row){calls++;if(fail)return {error:{message:'offline'}};if(!records.some(r=>r.set_id===row.set_id&&r.question_id===row.question_id))records.push({...row});return {};}};return query;
  }};
 });
 await page.evaluate(()=>{window.sourceLeaks=[];const sources=[...GRAMMAR_OX,...GRAMMAR_OX_KIMHAYAN].map(q=>q.src).filter(Boolean);new MutationObserver(()=>{if(session?.role==='student'||studentPreviewMode){const text=document.getElementById('s-grammar-ox-body').textContent;for(const src of sources)if(text.includes(src))sourceLeaks.push(src);if(document.getElementById('gox-source'))sourceLeaks.push('source filter');}}).observe(document.getElementById('s-grammar-ox-body'),{childList:true,subtree:true});});
 await page.addScriptTag({path:'grammar-ox.js'});await page.evaluate(()=>renderGrammarOx());
 await page.locator('[data-gox=elements]').click();assert.equal(await page.locator('#gox-topic').isDisabled(),true);for(const c of await page.locator('[data-gox-tag]').all())await c.uncheck();assert.equal(await page.locator('#gox-start').isDisabled(),true);await page.locator('[data-gox=all-topics]').click();
 await page.locator('#gox-era').selectOption('medieval');await page.locator('#gox-topic').selectOption('parts');assert.equal(await page.locator('#gox-start').isDisabled(),true);
 await page.locator('#gox-era').selectOption('modern');await page.locator('#gox-topic').selectOption('spelling');assert.equal(await page.locator('#gox-concept-label').isVisible(),true);
 await page.locator('#gox-count').selectOption('5');await page.locator('[data-gox=start]').click();
 await page.evaluate(()=>{fail=true});await page.locator('[data-choice="0"]').click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>records.length),0);
 await page.evaluate(()=>{fail=false;readFail=true});await page.locator('[data-choice="0"]').click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>records.length),1);
 await page.evaluate(()=>{readFail=false});await page.locator('[data-choice="1"]').click();await page.locator('[data-gox=next]').waitFor();assert.equal(await page.evaluate(()=>records.length),1);assert.equal(await page.evaluate(()=>records[0].choice),0);
 await page.getByText('이 문항 질문하기',{exact:true}).click();await page.locator('[data-gox-body]').fill('왜 이런 답인가요?');await page.locator('[data-gox=ask]').click();await page.waitForFunction(()=>questions.length===1);await page.locator('[data-gox-body]').fill('두 번째 질문');await page.locator('[data-gox=ask]').click();await page.getByText('선생님이 아직 확인하지 않은 질문이 있습니다.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>questions.length),1);
 for(let i=0;i<4;i++){await page.locator('[data-gox=next]').click();await page.locator('[data-choice="0"]').click();await page.locator('[data-gox=next]').waitFor();}
 await page.locator('[data-gox=next]').click();assert.equal(await page.evaluate(()=>records.length),5);assert.equal(await page.evaluate(()=>alerts),1);await page.evaluate(()=>renderGrammarOx());assert.equal(await page.evaluate(()=>alerts),1);
 await page.screenshot({path:process.env.TEMP+'/grammar-ox-result-mobile.png',fullPage:true});
 await page.locator('[data-gox=home]').click();await page.locator('[data-gox=history]').click();await page.getByRole('heading',{name:'최근 세트'}).waitFor();
 await page.evaluate(()=>{studentPreviewMode=true;renderGrammarOx();});await page.locator('[data-gox=start]').click();const count=await page.evaluate(()=>calls);await page.locator('[data-choice="0"]').click();assert.equal(await page.evaluate(()=>calls),count);
 await page.evaluate(()=>{document.getElementById('s-grammar-ox-body').hidden=true;session={id:'t1',role:'teacher'};studentPreviewMode=false;renderGrammarOxTeacher();});await page.getByRole('button',{name:'미응시 학생',exact:true}).waitFor();await page.getByRole('button',{name:'미응시 학생',exact:true}).click();assert.match(await page.locator('#gox-student-detail').innerText(),/오답이 없습니다/);
 await page.locator('#gox-class').selectOption('b');assert.equal(await page.locator('#gox-report tbody tr').count(),0);
 await page.locator('#gox-class').selectOption('a');assert.equal(await page.locator('#gox-report tbody tr').count(),2);
 await page.locator('[data-gox=questions]').click();await page.locator('[data-question] textarea').fill('근거를 확인해 보세요.');await page.locator('[data-gox=reply]').click();await page.waitForFunction(()=>questions[0].reply==='근거를 확인해 보세요.');assert.ok(await page.evaluate(()=>questions[0].seen_at));await page.locator('[data-gox=teacher-refresh]').first().click();await page.getByRole('button',{name:'미응시 학생',exact:true}).waitFor();await page.locator('#gox-search').fill('미응시');assert.equal(await page.locator('#gox-report tbody tr').count(),1);
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:process.env.TEMP+'/grammar-ox-teacher.png',fullPage:true});
 page.on('dialog',dialog=>dialog.accept());
 await page.evaluate(()=>{session={id:'s1',role:'student'};document.getElementById('s-grammar-ox-body').hidden=false;document.getElementById('t-grammar-ox-body').hidden=true;studentPreviewMode=false;records.length=0;records.push({id:'old',student_id:'s1',set_id:'old',question_id:GRAMMAR_OX_KIMHAYAN.find(q=>q.topic==='expression').id,topic:'expression',choice:0,is_correct:true,submitted_at:new Date(Date.now()-2*86400000).toISOString()});});
 await page.locator('[data-gox=leave]').click();await page.getByRole('heading',{name:'간격 복습 · 복습 대기 1문항',exact:true}).waitFor();await page.locator('[data-gox=review]').click();
 const correct=await page.evaluate(()=>{const text=document.querySelector('.gox-prompt').textContent;return [...GRAMMAR_OX,...GRAMMAR_OX_KIMHAYAN].find(q=>q.prompt===text).answer;});await page.locator('[data-choice="'+correct+'"]').click();await page.locator('[data-gox=next]').waitFor();assert.equal(await page.evaluate(()=>records[1].target_question_id),await page.evaluate(()=>records[0].question_id));assert.equal(await page.evaluate(()=>records[1].is_review_success),true);await page.locator('[data-gox=next]').click();await page.locator('[data-gox=home]').click();await page.locator('[data-gox=history]').click();await page.getByText('근거를 확인해 보세요.',{exact:true}).waitFor({state:'attached'});
 await page.evaluate(()=>{session={id:'new-hanbaek',role:'student',school_id:'sc_hanbaek'};records.length=0;renderGrammarOx();});
 await page.locator('[data-gox=lesson]').click();
 for(let i=0;i<10;i++){const text=await page.locator('.gox-prompt').innerText();assert.ok(await page.evaluate(t=>[...GRAMMAR_OX,...GRAMMAR_OX_KIMHAYAN].some(q=>q.prompt===t&&q.topic==='expression'&&GrammarReview.grammarElementTags(q).some(tag=>['높임 표현','피동·사동','시간 표현'].includes(tag))),text));await page.locator('[data-choice="0"]').click();await page.locator('[data-gox=next]').click();}
 assert.equal(await page.evaluate(()=>records.length),10,'first-time student finishes ten lesson questions');
 assert.deepEqual(await page.evaluate(()=>sourceLeaks),[]);assert.deepEqual(errors,[]);console.log('PASS: filters, zero pool, save failure/retry, ambiguous success dedupe, five-question flow, one activity, preview no writes, history, teacher/no-attempt/class filter');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
