// Local fixture only: no production requests or student data.
const fs=require('node:fs'),assert=require('node:assert/strict');
const I=require('../ildong-ox-data.js'),Y=require('../yeonhaeng-ox-data.js'),M=require('../ildong-ox.js'),Q=I.concat(Y);
// 문항 데이터(작품별): 60문항 이상, O·X 비율, 여섯 구간 모두 포함, X 해설에 정답 해석 포함.
const counts={};
for(const [work,list] of [['ildong',I],['yeonhaeng',Y]]){
 assert.ok(list.length>=60,work);assert.ok(list.every(q=>q.work===work));
 const o=list.filter(q=>q.answer==='O').length,x=list.filter(q=>q.answer==='X').length;counts[work]=[list.length,o,x];
 assert.equal(o+x,list.length);assert.ok(Math.abs(o-x)<=list.length*0.1,'O:X 1:1 근처 '+work);
 assert.equal(new Set(list.map(q=>q.section)).size,6);
}
assert.equal(new Set(Q.map(q=>q.id)).size,Q.length);
for(const q of Q){assert.ok(q.line&&q.say&&q.why);if(q.answer==='X')assert.match(q.why,/정답: /,q.id);}
assert.equal(M.poolFor('mix',Q).length,Q.length);assert.equal(M.poolFor('yeonhaeng',Q).length,Y.length);
for(const word of ['고쵸상토','빈혀','굿 보는'])assert.ok(Q.some(q=>q.line.includes(word)&&q.answer==='X'),word);
// 무작위 10문항: 중복 없이 전체 풀에서.
const round=M.makeRound(Q);assert.equal(round.length,10);assert.equal(new Set(round.map(q=>q.id)).size,10);
assert.equal(M.makeRound(Q.slice(0,3)).length,3);
assert.ok(M.isHanbaek({school_id:'sc_hanbaek'})&&M.isHanbaek({group_id:'hanbaek_sat_1030'}));
assert.ok(!M.isHanbaek({school_id:'sc_chidong',group_id:'chidong_x'})&&!M.isHanbaek(null));
// index.html 연결.
const html=fs.readFileSync('index.html','utf8');
for(const s of ['ildong-ox-data.js?v=1','yeonhaeng-ox-data.js?v=1','ildong-ox.js?v=1','id="s-ildong-ox-body"',"panel==='ildong-ox'",'syncIldongOxNav()'])assert.ok(html.includes(s),s);
assert.ok(fs.readFileSync('sw.js','utf8').includes('/lecture/ildong-ox.js?v=1'));
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.abort());
  await page.setContent('<div id="page-student"><div class="nav-item" data-p="ildong-ox" style="display:none">일동</div></div><nav id="s-tabbar"><button data-ms="ildong-ox" style="display:none">일동</button></nav><div id="s-ildong-ox-body"></div>');
  await page.addStyleTag({path:'grammar-ox.css'});
  await page.addScriptTag({content:"var session={id:'s1',name:'학생',role:'student',school_id:'sc_chidong',group_id:'chidong_a'};let padMode=false;var studentPreviewMode=false;window.rows=[];window.fail=false;if(!crypto.randomUUID)crypto.randomUUID=()=>String(Math.random());window.confirm=()=>true;window.sb={from:t=>{const q={upsert:async row=>{if(window.fail)return {error:{message:'fail'}};window.rows.push({...row,table:t});return {};},select(){return q;},eq(){return q;},in(){return q;},order(){return q;},range(){return Promise.resolve({data:window.rows.slice().reverse()});}};return q;}};"});
  await page.addScriptTag({path:'ildong-ox-data.js'});await page.addScriptTag({path:'yeonhaeng-ox-data.js'});await page.addScriptTag({path:'ildong-ox.js'});
  // 다른 학교: 메뉴 숨김, 화면은 안내만.
  await page.evaluate(()=>renderIldongOx());
  assert.equal(await page.locator('[data-p="ildong-ox"]').evaluate(e=>e.style.display),'none');
  assert.ok((await page.textContent('#s-ildong-ox-body')).includes('한백고 학생'));
  assert.equal(await page.locator('[data-ildong="start"]').count(),0);
  // 한백고: 메뉴 표시, 10문항 풀이.
  await page.evaluate(()=>{session.school_id='sc_hanbaek';session.group_id='hanbaek_sat_1030';renderIldongOx();});
  assert.equal(await page.locator('[data-ms="ildong-ox"]').evaluate(e=>e.style.display),'');
  assert.equal(await page.locator('[data-ildong="start"]').count(),3);
  await page.click('[data-ildong="start"][data-work="yeonhaeng"]');
  for(let i=0;i<10;i++){
   assert.ok((await page.textContent('#s-ildong-ox-body')).includes((i+1)+' / 10문항'));
   await page.click('[data-ildong="answer"][data-choice="'+(i%2?'X':'O')+'"]');
   const text=await page.textContent('#s-ildong-ox-body');assert.match(text,/정답입니다|틀렸어요 · 정답 [OX]/);
   assert.ok(await page.locator('[data-ildong="answer"]').first().isDisabled());
   await page.click('[data-ildong="next"]');
  }
  const result=await page.textContent('#s-ildong-ox-body');assert.match(result,/10문항 중 \d+개 정답/);
  const rows=await page.evaluate(()=>window.rows);assert.equal(rows.length,10);
  assert.ok(rows.every(r=>r.table==='grammar_ox_attempts'&&r.topic==='yeonhaeng'&&r.question_id.startsWith('yeonhaeng-')&&r.student_id==='s1'&&[0,1].includes(r.choice)));
  assert.equal(new Set(rows.map(r=>r.set_id)).size,1);
  const wrong=rows.filter(r=>!r.is_correct).length;
  assert.equal(await page.locator('.gox details').count(),wrong);
  if(wrong){await page.click('[data-ildong="retry-wrong"]');assert.ok((await page.textContent('#s-ildong-ox-body')).includes('1 / '+wrong+'문항'));await page.click('[data-ildong="leave"]');}else await page.click('[data-ildong="home"]');
  // 섞기: 두 작품 모두에서 출제될 수 있음(일동장유가만 고르면 일동장유가만).
  await page.click('[data-ildong="start"][data-work="ildong"]');
  for(let i=0;i<10;i++){await page.click('[data-ildong="answer"][data-choice="O"]');await page.click('[data-ildong="next"]');}
  assert.ok((await page.evaluate(()=>window.rows)).slice(10).every(r=>r.topic==='ildong'));
  await page.click('[data-ildong="home"]');
  // 저장 실패해도 풀이는 계속.
  await page.evaluate(()=>{window.fail=true;});
  await page.click('[data-ildong="start"][data-work="mix"]');await page.click('[data-ildong="answer"][data-choice="O"]');
  await page.waitForSelector('[role="alert"]');assert.ok(await page.locator('[data-ildong="next"]').isVisible());
  // 미리보기는 저장하지 않음.
  await page.evaluate(()=>{window.fail=false;studentPreviewMode=true;renderIldongOx();});
  const before=await page.evaluate(()=>window.rows.length);
  await page.click('[data-ildong="start"][data-work="mix"]');await page.click('[data-ildong="answer"][data-choice="X"]');
  assert.equal(await page.evaluate(()=>window.rows.length),before);
  assert.deepEqual(errors,[]);
  console.log('PASS: 고전시가 해석 OX — 일동장유가 '+counts.ildong.join('/')+', 연행가 '+counts.yeonhaeng.join('/')+' (전체/O/X), 한백고 전용, 작품 선택·10문항 풀이·기록·다시 풀기');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
