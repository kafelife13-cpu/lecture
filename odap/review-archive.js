/* A reusable reader for the exact teacher PDFs and the original wrong answers. */
(function(){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const answer=s=>String(s).replace(/^all:/,'').replace(/[1-5]/g,n=>'①②③④⑤'[Number(n)-1]);
 const rich=(s,phrases=[])=>{
  const terms=[...new Set(phrases)].filter(Boolean).sort((a,b)=>b.length-a.length);if(!terms.length)return esc(s);
  const pattern=new RegExp(terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');let end=0,out='';
  for(const m of String(s??'').matchAll(pattern)){out+=esc(s.slice(end,m.index))+'<u>'+esc(m[0])+'</u>';end=m.index+m[0].length;}return out+esc(String(s??'').slice(end));
 };
 // ponytail: this is repeatable practice, not an official test. Only choices and
 // progress are kept on this device; add authenticated server sync if requested.
 function quiz(host,items,key,label){
  const initial=()=>({queue:items.map((_,i)=>i),index:0,answers:{},done:false});let state=initial(),storageOK=!!key;
  const correct=(i,selected)=>[...selected].sort().join(',')===items[i].answer.replace(/^all:/,'').split(',').sort().join(',');
  if(key)try{const s=JSON.parse(localStorage.getItem(key)||'null');if(s&&Array.isArray(s.queue)&&s.queue.length&&s.queue.every(i=>Number.isInteger(i)&&items[i])&&new Set(s.queue).size===s.queue.length&&Number.isInteger(s.index)&&s.index>=0&&s.index<s.queue.length&&typeof s.done==='boolean'&&s.answers&&typeof s.answers==='object'&&!Array.isArray(s.answers)){
   const answers={};for(const [i,a] of Object.entries(s.answers))if(items[i]&&a&&Array.isArray(a.selected)&&a.selected.every(n=>/^[1-5]$/.test(n))&&new Set(a.selected).size===a.selected.length&&(items[i].answer.startsWith('all:')||a.selected.length<=1)&&typeof a.checked==='boolean'&&(!a.checked||a.selected.length))answers[i]={selected:a.selected,checked:a.checked};
   state={...s,answers};if(state.done&&!state.queue.every(i=>answers[i]?.checked))state.done=false;
  }}catch{storageOK=false;}
  const save=()=>{if(key)try{localStorage.setItem(key,JSON.stringify(state));storageOK=true;}catch{storageOK=false;}};
  const note=()=>key?(storageOK?'이 기기의 브라우저에 저장되어 다음에 이어 풀 수 있어요.':'이 브라우저에서는 진행 상황을 저장할 수 없어요. 창을 닫기 전에 마쳐 주세요.'):'교사용 미리보기 · 학생의 풀이 기록에는 반영되지 않아요.';
  function render(focus=false){
   const checked=state.queue.filter(i=>state.answers[i]?.checked),wrong=checked.filter(i=>!correct(i,state.answers[i].selected));
   if(state.done){
    host.innerHTML=`<section class="review-quiz"><p class="eyebrow">${esc(label)}</p><h3 tabindex="-1">복습을 마쳤어요!</h3><p class="quiz-score">${state.queue.length-wrong.length} / ${state.queue.length}<span>이번 복습에서 맞힌 문제</span></p><p>${wrong.length?'틀린 '+wrong.length+'문제를 한 번 더 풀어 보세요.':'모두 맞혔어요. 수고했어요!'}</p><div class="quiz-actions">${wrong.length?'<button class="primary" data-quiz-retry>틀린 문제만 다시 풀기</button>':''}<button data-quiz-restart>전체 다시 풀기</button></div><p class="muted">${note()}</p></section>`;
    const retry=host.querySelector('[data-quiz-retry]');if(retry)retry.onclick=()=>{wrong.forEach(i=>delete state.answers[i]);state.queue=wrong;state.index=0;state.done=false;save();render(true);};
    host.querySelector('[data-quiz-restart]').onclick=()=>{state=initial();save();render(true);};
   }else{
    const i=state.queue[state.index],q=items[i],a=state.answers[i]||{selected:[],checked:false},multi=q.answer.startsWith('all:'),ok=a.checked&&correct(i,a.selected),ul=q.underline||[];
    host.innerHTML=`<section class="review-quiz"><div class="quiz-heading"><p class="eyebrow">${esc(label)}</p><strong>${state.index+1} / ${state.queue.length}</strong></div><progress max="${state.queue.length}" value="${checked.length}" aria-label="푼 문제 수"></progress>${q.originalLabel?`<p class="muted">${esc(q.originalLabel)} · 당시 내 답 ${esc(answer(q.previousAnswer))}</p>`:''}<h3 tabindex="-1">${i+1}. ${rich(q.text,ul)}</h3>${q.passage?`<div class="quiz-passage review-text">${rich(q.passage,q.passage_underlines||ul)}</div>`:''}${q.box?`<div class="quiz-passage review-text">${rich(q.box,ul)}</div>`:''}${q.table?`<div class="quiz-table"><table>${q.table.map(row=>'<tr>'+row.map(cell=>'<td>'+rich(cell,ul)+'</td>').join('')+'</tr>').join('')}</table></div>`:''}<form><fieldset><legend>${multi?'정답을 모두 선택하세요.':'정답 하나를 선택하세요.'}</legend>${q.choices.map((c,n)=>{const v=String(n+1),selected=a.selected.includes(v),isAnswer=q.answer.replace(/^all:/,'').split(',').includes(v);return `<label class="quiz-choice ${a.checked?(isAnswer?'is-correct':selected?'is-wrong':''):selected?'is-selected':''}"><input type="${multi?'checkbox':'radio'}" name="quiz-answer" value="${v}" ${selected?'checked':''} ${a.checked?'disabled':''}><span class="quiz-choice-number">${'①②③④⑤'[n]}</span><span>${rich(c.replace(/^[①②③④⑤]\s*/,''),ul)}</span>${a.checked&&isAnswer?'<b class="quiz-choice-tag">정답</b>':''}</label>`;}).join('')}</fieldset><div class="quiz-feedback" ${a.checked?'':'hidden'} role="status">${a.checked?`<h4>${ok?'정답이에요!':'다시 확인해 보세요.'}</h4><p>내 답 ${esc(answer(a.selected.join(',')))} · 정답 <strong>${esc(answer(q.answer))}</strong></p><p class="review-text">${esc(q.explanation)}</p>${q.match?`<p class="muted">연결 오답: ${esc(q.match)}</p>`:''}`:''}</div><div class="quiz-actions"><button type="button" data-quiz-prev ${state.index===0?'disabled':''}>이전</button>${a.checked?`<button type="button" class="primary" data-quiz-next>${state.index===state.queue.length-1?'결과 보기':'다음 문제'}</button>`:`<button type="submit" class="primary" data-quiz-check ${a.selected.length?'':'disabled'}>정답 확인</button>`}</div></form><p class="muted" data-quiz-storage>${note()}</p></section>`;
    host.querySelectorAll('input').forEach(input=>input.onchange=()=>{const selected=[...host.querySelectorAll('input:checked')].map(x=>x.value);state.answers[i]={selected,checked:false};host.querySelectorAll('.quiz-choice').forEach(el=>el.classList.toggle('is-selected',el.querySelector('input').checked));host.querySelector('[data-quiz-check]').disabled=!selected.length;save();host.querySelector('[data-quiz-storage]').textContent=note();});
    host.querySelector('form').onsubmit=ev=>{ev.preventDefault();const selected=state.answers[i]?.selected;if(!selected?.length||state.answers[i].checked)return;state.answers[i].checked=true;save();render();host.querySelector('.quiz-feedback').scrollIntoView?.({behavior:'smooth',block:'nearest'});};
    host.querySelector('[data-quiz-prev]').onclick=()=>{if(state.index>0){state.index--;save();render(true);}};
    const next=host.querySelector('[data-quiz-next]');if(next)next.onclick=()=>{if(state.index===state.queue.length-1)state.done=true;else state.index++;save();render(true);};
   }
   if(focus){host.querySelector('h3').focus?.({preventScroll:true});host.scrollIntoView?.({behavior:'smooth',block:'start'});}
  }
  render(true);
 }
 let pdfLibrary;
 function loadPDF(){
  if(window['pdfjs-dist/build/pdf'])return Promise.resolve(window['pdfjs-dist/build/pdf']);
  if(!pdfLibrary)pdfLibrary=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';script.onload=()=>resolve(window['pdfjs-dist/build/pdf']);script.onerror=()=>{pdfLibrary=null;script.remove();reject(Error('PDF 보기를 불러오지 못했어요. PDF 저장을 이용하거나 다시 열어 주세요.'));};document.head.append(script);});
  return pdfLibrary;
 }
 window.reviewArchiveReader=function(host){
  let urls=[],pdfGeneration=0,pdfTask=null;
  const closePDF=()=>{pdfGeneration++;pdfTask?.destroy().catch(()=>{});pdfTask=null;};
  const clear=()=>{closePDF();host.replaceChildren();urls.forEach(u=>URL.revokeObjectURL(u));urls=[];};
  const dispose=()=>{clear();window.removeEventListener('pagehide',dispose);};
  window.addEventListener('pagehide',dispose);
  return {clear,dispose,show(packet,progressKey=''){
   clear();
   const files=new Map(packet.files.map(f=>{
    const bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));urls.push(url);return [f.id,{name:f.name,url,bytes}];
   }));
   const practice=files.get(packet.practice.file_id);
   const originalItems=packet.originals.filter(q=>q.quiz).map(q=>({...q.quiz,match:q.exam_name+' '+q.num+'번',originalLabel:q.exam_name+' · '+q.num+'번',previousAnswer:q.my_answer}));
   host.innerHTML=`<section class="card review-archive"><p class="eyebrow">${esc(packet.week_label)} · ${esc(packet.week_start)} 주간</p><h2>${esc(packet.title)}</h2><p>틀린 원래 문제 ${packet.originals.length}개 · 개별 보완 ${packet.practice.count}문항</p>${packet.practice.items?`<div class="quiz-intro"><h3>한 문제씩, 내 속도로</h3><p>답을 고르고 해설을 확인하세요.<br>틀린 문제는 다시 풀 수 있어요.</p><div class="quiz-launch"><button data-quiz-originals><strong>틀린 문제 다시보기</strong><span>내가 틀린 원래 문제 ${packet.originals.length}문항</span></button><button class="primary" data-quiz-practice><strong>비슷한 유형 풀어보기</strong><span>나에게 맞춘 보완 퀴즈 ${packet.practice.count}문항 · 이어 풀기</span></button></div></div><div data-quiz-body></div>`:''}${practice?`<details class="review-paper"><summary>종이 자료도 함께 보기</summary><button type="button" data-review-practice>개별 보완 자료 열기</button> <a href="${practice.url}" download="${esc(practice.name)}">PDF 저장</a></details>`:''}<div class="review-pdf" hidden></div><details class="review-history" ${packet.practice.items?'':'open'}><summary>당시 오답 기록 ${packet.originals.length}개 보기</summary><p class="muted">이 주차에 확인한 답안을 보관한 기록이에요.</p>${packet.originals.map((q,i)=>`<article class="review-original"><p class="muted">${esc(q.exam_name)} · ${esc(q.num)}번</p><p class="review-text">${esc(q.text)}</p>${q.file_id?`<button type="button" data-review-original="${i}">원본 시험지 ${q.page}쪽 열기</button>`:''}<p>당시 내 답 <strong>${esc(answer(q.my_answer))}</strong></p><details><summary>정답·해설 확인</summary><p>정답 <strong>${esc(answer(q.answer))}</strong></p><p class="review-text">${esc(q.explanation||'해설은 선생님 자료를 확인해 주세요.')}</p></details></article>`).join('')}</details></section>`;
   const start=(items,kind,label)=>{closePDF();host.querySelector('.review-pdf').hidden=true;quiz(host.querySelector('[data-quiz-body]'),items,progressKey?progressKey+':'+kind:'',label);};
   const launch=host.querySelector('[data-quiz-practice]');if(launch)launch.onclick=()=>start(packet.practice.items,'practice','비슷한 유형 풀어보기');
   const originals=host.querySelector('[data-quiz-originals]');if(originals)originals.onclick=()=>{if(originalItems.length)start(originalItems,'originals','틀린 문제 다시보기');else{const history=host.querySelector('.review-history');history.open=true;history.scrollIntoView?.({behavior:'smooth',block:'start'});}};
   const pdf=host.querySelector('.review-pdf');
   async function open(file,page=1){
    closePDF();const token=pdfGeneration;
    pdf.hidden=false;pdf.innerHTML=`<p><strong>${esc(file.name)}</strong> <button type="button" data-review-close>접기</button></p><p><a href="${file.url}#page=${page}" target="_blank" rel="noopener">PDF 새 창으로 열기</a> · <a href="${file.url}" download="${esc(file.name)}">PDF 저장</a></p><div class="review-pdf-tools"><button type="button" data-pdf-prev disabled>이전 쪽</button><label>쪽<input type="number" min="1" value="${page}" aria-label="PDF 쪽 번호" disabled></label><span data-pdf-total></span><button type="button" data-pdf-next disabled>다음 쪽</button><label>확대<select aria-label="PDF 확대" disabled><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label></div><p role="status">PDF를 열고 있어요.</p><div class="review-pdf-page"><canvas role="img" aria-label="PDF ${page}쪽"></canvas></div>`;
    pdf.querySelector('[data-review-close]').onclick=()=>{closePDF();pdf.hidden=true;pdf.replaceChildren();};
    pdf.scrollIntoView?.({behavior:'smooth',block:'start'});
    const status=pdf.querySelector('[role="status"]'),previous=pdf.querySelector('[data-pdf-prev]'),next=pdf.querySelector('[data-pdf-next]'),input=pdf.querySelector('input'),zoom=pdf.querySelector('select'),canvas=pdf.querySelector('canvas');
    const current=()=>token===pdfGeneration&&host.isConnected;
    try{
     const lib=await loadPDF();if(!current())return;
     lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
     // Reuse the app's PDF.js with eval disabled for teacher-uploaded PDFs.
     pdfTask=lib.getDocument({data:file.bytes.slice(),isEvalSupported:false});
     const doc=await pdfTask.promise;if(!current())return;
     pdf.querySelector('[data-pdf-total]').textContent='/ '+doc.numPages;input.max=doc.numPages;
     async function render(){
      if(!current())return;previous.disabled=next.disabled=input.disabled=zoom.disabled=true;status.textContent='문제지를 표시하고 있어요.';
      try{
       const p=await doc.getPage(page);if(!current())return;
       const base=p.getViewport({scale:1}),width=Math.max(240,pdf.querySelector('.review-pdf-page').clientWidth||720)*Number(zoom.value),ratio=Math.min(window.devicePixelRatio||1,2),viewport=p.getViewport({scale:width/base.width*ratio});
       canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.style.width=width+'px';canvas.style.height=viewport.height/ratio+'px';canvas.setAttribute('aria-label',file.name+' '+page+'쪽');
       await p.render({canvasContext:canvas.getContext('2d'),viewport}).promise;if(!current())return;
       input.value=page;status.textContent=page+' / '+doc.numPages+'쪽';previous.disabled=page<=1;next.disabled=page>=doc.numPages;input.disabled=zoom.disabled=false;
      }catch(error){if(current())status.textContent='문제지를 표시하지 못했어요. 위의 PDF 저장을 이용해 주세요.';}
     }
     previous.onclick=()=>{page--;return render();};next.onclick=()=>{page++;return render();};input.onchange=()=>{const n=Number(input.value);if(Number.isInteger(n)&&n>=1&&n<=doc.numPages)page=n;return render();};zoom.onchange=render;
     await render();
    }catch(error){if(current())status.textContent=error.message||'PDF를 열지 못했어요. PDF 저장을 이용해 주세요.';}
   }
   const paper=host.querySelector('[data-review-practice]');if(paper)paper.onclick=()=>open(practice);
   host.querySelectorAll('[data-review-original]').forEach(b=>b.onclick=()=>{const q=packet.originals[Number(b.dataset.reviewOriginal)];return open(files.get(q.file_id),q.page);});
  }};
 };
 window.mountReviewArchive=async function(credentials,container){
  const auth={id:credentials.id,pw:credentials.pw,role:'student'};
  let generation=0,disposed=false;
  container.innerHTML='<section class="card"><h2>주차별 오답 다시보기</h2><label>복습할 주차<select aria-label="복습할 주차" disabled></select></label><p role="status">자료를 불러오고 있어요.</p><button type="button" data-review-refresh>새로고침</button></section><div data-review-body></div>';
  const select=container.querySelector('select'),status=container.querySelector('[role="status"]'),refresh=container.querySelector('[data-review-refresh]'),reader=window.reviewArchiveReader(container.querySelector('[data-review-body]'));
  const call=async(action,payload={})=>{const response=await fetch('https://zniwzwanlvvmzkkcmikh.supabase.co/functions/v1/odap-review-archive',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(120000),headers:{apikey:'sb_publishable_IbfVcXs5TmXfumrnK4Somg_7MzygCdh','Content-Type':'application/json'},body:JSON.stringify({credentials:auth,action,payload})});const data=await response.json();if(!response.ok||data.error)throw Error(data.error||'자료를 불러오지 못했습니다.');return data;};
  const current=token=>!disposed&&container.isConnected&&token===generation;
  const open=async()=>{
   const token=++generation;reader.clear();if(!select.value)return;
   status.textContent='선택한 주차의 자료를 열고 있어요.';
   try{const data=await call('open',{id:select.value});if(!current(token))return;reader.show(data.packet,'review-quiz:v1:'+encodeURIComponent(auth.id)+':'+data.id);status.textContent='지난 자료도 주차를 바꿔 언제든 다시 볼 수 있어요.';}
   catch(error){if(current(token))status.textContent=error.message;}
  };
  const load=async()=>{
   const token=++generation;reader.clear();select.disabled=true;refresh.disabled=true;status.textContent='자료를 불러오고 있어요.';
   try{const rows=await call('list');if(!current(token))return;select.innerHTML=rows.map(r=>`<option value="${esc(r.id)}">${esc(r.title||r.week_label)} · ${esc(r.week_start)}</option>`).join('');select.disabled=!rows.length;if(rows.length)await open();else status.textContent='아직 공개된 주차별 자료가 없어요. 선생님이 자료를 공개하면 여기에 표시돼요.';}
   catch(error){if(current(token))status.textContent=error.message;}
   finally{if(!disposed)refresh.disabled=false;}
  };
  select.onchange=open;refresh.onclick=load;
  const dispose=()=>{disposed=true;generation++;auth.id='';auth.pw='';reader.dispose();container.replaceChildren();window.removeEventListener('pagehide',dispose);};
  window.addEventListener('pagehide',dispose);
  await load();return dispose;
 };
})();
