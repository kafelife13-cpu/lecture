// Local fixture only: no production requests or student data.
const fs=require('node:fs'),assert=require('node:assert/strict');
const I=require('../ildong-ox-data.js'),Y=require('../yeonhaeng-ox-data.js'),M=require('../ildong-ox.js'),C=require('../classical-quiz.js'),Q=I.concat(Y);
// 해석 OX 데이터(작품별): 60문항 이상, O·X 비율, 여섯 구간 모두 포함, X 해설에 정답 해석 포함.
const counts={};
for(const [work,list] of [['ildong',I],['yeonhaeng',Y]]){
 assert.ok(list.length>=60,work);assert.ok(list.every(q=>q.work===work));
 const o=list.filter(q=>q.answer==='O').length,x=list.filter(q=>q.answer==='X').length;
 assert.equal(o+x,list.length);assert.ok(Math.abs(o-x)<=list.length*0.1,'O:X 1:1 근처 '+work);
 assert.equal(new Set(list.map(q=>q.section)).size,6);
 // 추가 유형: 해석 고르기 40+, 표현기법 고르기 30+, 표현기법 OX 40+(O·X 같은 수), 순서 맞히기.
 const b=C.build(work,list),lines=new Set(C.LINES[work].map(l=>l[1]));
 assert.ok(list.every(q=>lines.has(q.line)),'OX 구절 = 프린트 구절 '+work);
 assert.ok(b.mc.length>=40&&b.tmc.length>=30&&b.tox.length>=40&&b.ord.length>=20,work);
 for(const q of b.mc.concat(b.tmc)){assert.equal(q.options.length,4,q.id);assert.equal(new Set(q.options).size,4,q.id);assert.equal(q.answer,0);assert.ok(q.why);}
 for(const q of b.mc)assert.equal(q.options[0],C.LINES[work].find(l=>l[1]===q.line)[2],q.id);
 const to=b.tox.filter(q=>q.answer==='O').length;assert.equal(to,b.tox.length-to,'표현기법 OX 1:1 '+work);
 for(const [idx,used,no] of C.TECH[work]){assert.ok(used.length&&no.length>=3);assert.ok(!no.some(t=>used.includes(t)),idx);}
 for(const q of b.ord){const order=C.LINES[work].map(l=>l[1]);const pos=q.parts.map(p=>order.indexOf(p.line));assert.ok(pos.every((v,i)=>v>=0&&(!i||v>pos[i-1])),q.id);}
 counts[work]={ox:[list.length,o,x],mc:b.mc.length,tmc:b.tmc.length,tox:[b.tox.length,to],ord:b.ord.length};
}
const ALL=Q.concat(...['ildong','yeonhaeng'].map(w=>{const b=C.build(w,w==='ildong'?I:Y);return b.mc.concat(b.tmc,b.tox,b.ord);}));
assert.equal(new Set(ALL.map(q=>q.id)).size,ALL.length,'문항 id 중복 없음');
for(const q of Q){assert.ok(q.line&&q.say&&q.why);if(q.answer==='X')assert.match(q.why,/정답: /,q.id);}
assert.equal(M.poolFor('mix',ALL,'ox').length,Q.length);assert.equal(M.poolFor('mix',ALL,'all').length,ALL.length);
for(const word of ['고쵸상토','빈혀','굿 보는'])assert.ok(Q.some(q=>q.line.includes(word)&&q.answer==='X'),word);
// 무작위: 출제 순서·보기 순서가 매번 섞임(정답 위치 고정 아님), 구절 순서대로 나오지 않음.
const firsts=new Set(),answerPos=new Set();
for(let k=0;k<30;k++){const r=M.makeRound(M.poolFor('ildong',ALL,'ox'));assert.equal(new Set(r.map(q=>q.id)).size,10);firsts.add(r[0].id);
 const p=M.prepare(M.poolFor('ildong',ALL,'mc')[0]);answerPos.add(p.order.indexOf(0));assert.ok(M.isCorrect(p,p.order.indexOf(0)));
 const o=M.prepare(M.poolFor('ildong',ALL,'ord').find(q=>q.type==='ord'));assert.ok(!o.show.every((v,i)=>v===i),'섞인 순서');assert.ok(M.isCorrect(o,[...o.parts.keys()]));assert.ok(!M.isCorrect(o,o.show));
 const om=M.prepare(M.poolFor('ildong',ALL,'ord').find(q=>q.type==='ordmc'));assert.equal(om.seqs.length,4);assert.ok(M.isCorrect(om,om.seqs.indexOf(om.right)));}
assert.ok(firsts.size>5&&answerPos.size>=3,'무작위 출제·보기 섞기');
assert.ok(M.isHanbaek({school_id:'sc_hanbaek'})&&M.isHanbaek({group_id:'hanbaek_sat_1030'}));
assert.ok(!M.isHanbaek({school_id:'sc_chidong',group_id:'chidong_x'})&&!M.isHanbaek(null));
// index.html 연결.
const html=fs.readFileSync('index.html','utf8');
for(const s of ['ildong-ox-data.js?v=1','yeonhaeng-ox-data.js?v=1','ildong-ox.js?v=2','classical-quiz.js?v=1','id="s-ildong-ox-body"',"panel==='ildong-ox'",'syncIldongOxNav()'])assert.ok(html.includes(s),s);
assert.ok(fs.readFileSync('sw.js','utf8').includes('/lecture/classical-quiz.js?v=1'));
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.abort());
  await page.setContent('<div id="page-student"><div class="nav-item" data-p="ildong-ox" style="display:none">일동</div></div><nav id="s-tabbar"><button data-ms="ildong-ox" style="display:none">일동</button></nav><div id="s-ildong-ox-body"></div>');
  await page.addStyleTag({path:'grammar-ox.css'});
  await page.addScriptTag({content:"var session={id:'s1',name:'학생',role:'student',school_id:'sc_chidong',group_id:'chidong_a'};let padMode=false;var studentPreviewMode=false;window.rows=[];window.fail=false;if(!crypto.randomUUID)crypto.randomUUID=()=>String(Math.random());window.confirm=()=>true;window.sb={from:t=>{const q={upsert:async row=>{if(window.fail)return {error:{message:'fail'}};window.rows.push({...row,table:t});return {};},select(){return q;},eq(){return q;},in(){return q;},order(){return q;},range(){return Promise.resolve({data:window.rows.slice().reverse()});}};return q;}};"});
  for(const f of ['ildong-ox-data.js','yeonhaeng-ox-data.js','classical-quiz.js','ildong-ox.js'])await page.addScriptTag({path:f});
  const text=()=>page.textContent('#s-ildong-ox-body');
  // 다른 학교: 메뉴 숨김, 화면은 안내만.
  await page.evaluate(()=>renderIldongOx());
  assert.equal(await page.locator('[data-p="ildong-ox"]').evaluate(e=>e.style.display),'none');
  assert.ok((await text()).includes('한백고 학생'));
  assert.equal(await page.locator('[data-ildong="start"]').count(),0);
  // 한백고: 메뉴 표시, 작품×유형 선택.
  await page.evaluate(()=>{session.school_id='sc_hanbaek';session.group_id='hanbaek_sat_1030';renderIldongOx();});
  assert.equal(await page.locator('[data-ms="ildong-ox"]').evaluate(e=>e.style.display),'');
  assert.equal(await page.locator('[data-ildong="pick-work"]').count(),3);assert.equal(await page.locator('[data-ildong="pick-type"]').count(),6);
  async function tapAll(){const n=await page.locator('[data-ildong="tap"]').count();assert.ok(await page.locator('[data-ildong="submit-order"]').isDisabled());for(let k=0;k<n;k++)await page.locator('[data-ildong="tap"]:not([disabled])').first().click();await page.click('[data-ildong="submit-order"]');}
  async function play(work,type,solve){
   await page.click('[data-ildong="pick-work"][data-value="'+work+'"]');await page.click('[data-ildong="pick-type"][data-value="'+type+'"]');await page.click('[data-ildong="start"]');
   for(let i=0;i<10;i++){
    assert.ok((await text()).includes((i+1)+' / 10문항'),type+' '+i);
    await solve(i);
    assert.match(await text(),/정답입니다|틀렸어요/);
    await page.click('[data-ildong="next"]');
   }
   assert.match(await text(),/10문항 중 \d+개 정답/);
  }
  // 해석 OX (연행가)
  await play('yeonhaeng','ox',i=>page.click('[data-ildong="answer"][data-choice="'+(i%2?'X':'O')+'"]'));
  let rows=await page.evaluate(()=>window.rows);assert.equal(rows.length,10);
  assert.ok(rows.every(r=>r.table==='grammar_ox_attempts'&&r.topic==='yeonhaeng'&&/^yeonhaeng-\d{3}$/.test(r.question_id)&&r.student_id==='s1'&&[0,1].includes(r.choice)));
  const wrong=rows.filter(r=>!r.is_correct).length;assert.equal(await page.locator('.gox details').count(),wrong);
  if(wrong){await page.click('[data-ildong="retry-wrong"]');assert.ok((await text()).includes('1 / '+wrong+'문항'));await page.click('[data-ildong="leave"]');}else await page.click('[data-ildong="home"]');
  // 해석 고르기·표현기법 고르기·표현기법 OX
  await play('ildong','mc',()=>page.click('[data-ildong="answer"][data-choice="0"]'));await page.click('[data-ildong="home"]');
  await play('mix','tmc',()=>page.click('[data-ildong="answer"][data-choice="1"]'));await page.click('[data-ildong="home"]');
  await play('ildong','tox',()=>page.click('[data-ildong="answer"][data-choice="O"]'));await page.click('[data-ildong="home"]');
  // 순서 맞히기: 누르기형은 보이는 순서대로 눌러 제출, 객관식형은 보기 선택.
  await play('mix','ord',async()=>{if(await page.locator('[data-ildong="tap"]').count())await tapAll();else await page.click('[data-ildong="answer"][data-choice="0"]');});
  rows=await page.evaluate(()=>window.rows);assert.equal(rows.length,50);
  assert.ok(rows.some(r=>/-mc-/.test(r.question_id))&&rows.some(r=>/-t\d{3}-[un]/.test(r.question_id))&&rows.some(r=>/-t\d{3}-[oxg]/.test(r.question_id))&&rows.some(r=>/-ord-/.test(r.question_id)));
  assert.ok(rows.every(r=>[0,1].includes(r.choice)&&['ildong','yeonhaeng'].includes(r.topic)));
  // 전체 섞기, 저장 실패해도 풀이는 계속.
  await page.click('[data-ildong="home"]');await page.evaluate(()=>{window.fail=true;});
  await page.click('[data-ildong="pick-type"][data-value="all"]');await page.click('[data-ildong="start"]');
  if(await page.locator('[data-ildong="tap"]').count())await tapAll();else await page.locator('[data-ildong="answer"]').first().click();
  await page.waitForSelector('[role="alert"]');assert.ok(await page.locator('[data-ildong="next"]').isVisible());
  // 미리보기는 저장하지 않음.
  await page.evaluate(()=>{window.fail=false;studentPreviewMode=true;renderIldongOx();});
  const before=await page.evaluate(()=>window.rows.length);
  await page.click('[data-ildong="pick-type"][data-value="ox"]');await page.click('[data-ildong="start"]');await page.click('[data-ildong="answer"][data-choice="X"]');
  assert.equal(await page.evaluate(()=>window.rows.length),before);
  assert.deepEqual(errors,[]);
  console.log('PASS: 고전시가 퀴즈 '+JSON.stringify(counts)+' — 한백고 전용, 작품×유형 선택, 무작위 출제·보기 섞기, 풀이·기록·다시 풀기');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
