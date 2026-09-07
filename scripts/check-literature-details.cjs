const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),base=path.join(root,'assets/literature'),read=f=>fs.readFileSync(f,'utf8').replaceAll('\r\n','\n'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const audit=JSON.parse(read(path.join(base,'detail-review.json')));
assert.deepEqual(audit.pages.map(p=>p.page),Array.from({length:35},(_,i)=>i+94));
for(const p of audit.pages)assert.equal(hash(read(path.join(root,'docs/literature-proofread',String(p.page).padStart(3,'0')+'.txt')).replaceAll('\r\n','\n')),p.sha256,'reviewed source page '+p.page);
const rounds=[];
for(let n=1;n<=10;n++){
 const nn=String(n).padStart(2,'0'),d=JSON.parse(read(path.join(base,'round-'+nn+'.json')));rounds.push(d);
 const covered=d.works.flatMap(w=>Array.from({length:w.to-w.from+1},(_,i)=>w.from+i));assert.deepEqual(covered,Array.from({length:17},(_,i)=>i+1));
 for(const q of d.exam.questions){
  assert.equal(q.detailedReviewed,true);assert.equal(q.detailVersion,audit.version);assert.equal(q.fullExplanationOcr,q.detailedExplanation);
  assert.ok(q.detailedExplanation.startsWith('정답 풀이\n'));assert.ok(q.detailedExplanation.includes(q.explanation));assert.ok(q.explanationPages.length>0);
  assert.ok(q.explanationPages.every(p=>p>=94&&p<=128));assert.ok(!/[\uE000-\uF8FF\uFFFD]|\(\)/u.test(q.detailedExplanation));
  if(n!==6||![15,17].includes(q.num))assert.ok(q.detailedExplanation.includes('오답 풀이'),'missing wrong explanation '+n+'/'+q.num);
 }
 assert.equal(fs.readFileSync(path.join(base,'round-'+nn+'-corrected.pdf')).subarray(0,4).toString(),'%PDF');
 const text=read(path.join(base,'round-'+nn+'-corrected.txt'));for(const q of d.exam.questions)assert.ok(text.includes(q.detailedExplanation));
}
const detail=(r,q)=>rounds[r-1].exam.questions[q-1].detailedExplanation;
assert.ok(detail(4,16).includes('구ᄌᆞᆫ비'));assert.ok(detail(10,9).includes('믉ᄀᆞ'));assert.ok(detail(2,16).includes('ᄆᆡ'));assert.ok(detail(9,12).includes('含憤蓄怨'));assert.ok(detail(10,14).includes('㉣'));
const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',classList:{toggle(){}},remove(){},after(x){nodes.set('feedback',x)},scrollIntoView(){}});return nodes.get(id)};
const context={session:{id:'fixture',role:'teacher'},studentPreviewMode:false,sExamData:rounds[3].exam,document:{getElementById:node,createElement:()=>({}),querySelector:()=>node('tools')},fetch:async url=>({ok:true,json:async()=>rounds[Number(url.match(/round-(\d+)/)[1])-1]}),notify:m=>{throw Error(m)}};
vm.createContext(context);vm.runInContext(read(path.join(root,'literature.js')),context);
(async()=>{
 await context.showLiteratureSolutions(4);assert.ok(node('lit-detail').innerHTML.includes('구ᄌᆞᆫ비'));assert.match(node('lit-detail').innerHTML,/작품 해제·특징·주제/);assert.match(node('lit-detail').innerHTML,/round-04-corrected.pdf/);
 context.session.role='student';context.renderLiteratureFeedback([]);assert.ok(node('feedback').innerHTML.includes('구ᄌᆞᆫ비'));assert.match(node('feedback').innerHTML,/오답 풀이/);
 const before=node('lit-detail').innerHTML;await context.showLiteratureSolutions(1);assert.equal(node('lit-detail').innerHTML,before);
 console.log('PASS 35 reviewed page hashes, 170 detailed explanations, 40 work groups, old Hangul/Hanja anchors, student feedback and teacher rendering');
})().catch(e=>{console.error(e);process.exitCode=1});
