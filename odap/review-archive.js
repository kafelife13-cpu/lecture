/* A reusable reader for the exact teacher PDFs and the original wrong answers. */
(function(){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const answer=s=>String(s).replace(/^all:/,'').replace(/[1-5]/g,n=>'①②③④⑤'[Number(n)-1]);
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
  return {clear,dispose,show(packet){
   clear();
   const files=new Map(packet.files.map(f=>{
    const bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));urls.push(url);return [f.id,{name:f.name,url,bytes}];
   }));
   const practice=files.get(packet.practice.file_id);
   host.innerHTML=`<section class="card review-archive"><p class="eyebrow">${esc(packet.week_label)} · ${esc(packet.week_start)} 주간</p><h2>${esc(packet.title)}</h2><p>틀린 원래 문제 ${packet.originals.length}개 · 개별 보완 ${packet.practice.count}문항</p><h3>선생님이 준 개별 보완 자료</h3><p>수업에서 받은 문제와 해설을 그대로 다시 확인할 수 있어요.</p><button type="button" data-review-practice>개별 보완 자료 열기</button> <a href="${practice.url}" download="${esc(practice.name)}">PDF 저장</a><div class="review-pdf" hidden></div><h3>내가 틀린 원래 문제</h3><p class="muted">이 주차에 확인한 답안을 보관한 기록이에요.</p>${packet.originals.map((q,i)=>`<article class="review-original"><p class="muted">${esc(q.exam_name)} · ${esc(q.num)}번</p><p class="review-text">${esc(q.text)}</p>${q.file_id?`<button type="button" data-review-original="${i}">원본 시험지 ${q.page}쪽 열기</button>`:''}<p>당시 내 답 <strong>${esc(answer(q.my_answer))}</strong></p><details><summary>정답·해설 확인</summary><p>정답 <strong>${esc(answer(q.answer))}</strong></p><p class="review-text">${esc(q.explanation||'해설은 선생님 자료를 확인해 주세요.')}</p></details></article>`).join('')}</section>`;
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
   host.querySelector('[data-review-practice]').onclick=()=>open(practice);
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
   try{const data=await call('open',{id:select.value});if(!current(token))return;reader.show(data.packet);status.textContent='지난 자료도 주차를 바꿔 언제든 다시 볼 수 있어요.';}
   catch(error){if(current(token))status.textContent=error.message;}
  };
  const load=async()=>{
   const token=++generation;reader.clear();select.disabled=true;refresh.disabled=true;status.textContent='자료를 불러오고 있어요.';
   try{const rows=await call('list');if(!current(token))return;select.innerHTML=rows.map(r=>`<option value="${esc(r.id)}">${esc(r.week_label)} · ${esc(r.week_start)} · ${r.original_count}개 오답</option>`).join('');select.disabled=!rows.length;if(rows.length)await open();else status.textContent='아직 공개된 주차별 자료가 없어요. 선생님이 자료를 공개하면 여기에 표시돼요.';}
   catch(error){if(current(token))status.textContent=error.message;}
   finally{if(!disposed)refresh.disabled=false;}
  };
  select.onchange=open;refresh.onclick=load;
  const dispose=()=>{disposed=true;generation++;auth.id='';auth.pw='';reader.dispose();container.replaceChildren();window.removeEventListener('pagehide',dispose);};
  window.addEventListener('pagehide',dispose);
  await load();return dispose;
 };
})();
