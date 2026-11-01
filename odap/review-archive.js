/* A reusable reader for the exact teacher PDFs and the original wrong answers. */
(function(){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const answer=s=>String(s).replace(/^all:/,'').replace(/[1-5]/g,n=>'①②③④⑤'[Number(n)-1]);
 window.reviewArchiveReader=function(host){
  let urls=[];
  const clear=()=>{host.replaceChildren();urls.forEach(u=>URL.revokeObjectURL(u));urls=[];};
  const dispose=()=>{clear();window.removeEventListener('pagehide',dispose);};
  window.addEventListener('pagehide',dispose);
  return {clear,dispose,show(packet){
   clear();
   const files=new Map(packet.files.map(f=>{
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))],{type:'application/pdf'}));urls.push(url);return [f.id,{...f,url}];
   }));
   const practice=files.get(packet.practice.file_id);
   host.innerHTML=`<section class="card review-archive"><p class="eyebrow">${esc(packet.week_label)} · ${esc(packet.week_start)} 주간</p><h2>${esc(packet.title)}</h2><p>틀린 원래 문제 ${packet.originals.length}개 · 개별 보완 ${packet.practice.count}문항</p><h3>선생님이 준 개별 보완 자료</h3><p>수업에서 받은 문제와 해설을 그대로 다시 확인할 수 있어요.</p><button type="button" data-review-practice>개별 보완 자료 열기</button> <a href="${practice.url}" download="${esc(practice.name)}">PDF 저장</a><div class="review-pdf" hidden></div><h3>내가 틀린 원래 문제</h3><p class="muted">이 주차에 확인한 답안을 보관한 기록이에요.</p>${packet.originals.map((q,i)=>`<article class="review-original"><p class="muted">${esc(q.exam_name)} · ${esc(q.num)}번</p><p class="review-text">${esc(q.text)}</p>${q.file_id?`<button type="button" data-review-original="${i}">원본 시험지 ${q.page}쪽 열기</button>`:''}<p>당시 내 답 <strong>${esc(answer(q.my_answer))}</strong></p><details><summary>정답·해설 확인</summary><p>정답 <strong>${esc(answer(q.answer))}</strong></p><p class="review-text">${esc(q.explanation||'해설은 선생님 자료를 확인해 주세요.')}</p></details></article>`).join('')}</section>`;
   const pdf=host.querySelector('.review-pdf');
   function open(file,page=1){
    pdf.hidden=false;pdf.innerHTML=`<p><strong>${esc(file.name)}</strong> · ${page}쪽 <button type="button" data-review-close>접기</button></p><p><a href="${file.url}#page=${page}" target="_blank" rel="noopener">PDF 새 창으로 열기</a> · <a href="${file.url}" download="${esc(file.name)}">PDF 저장</a></p><iframe title="${esc(file.name)}" src="${file.url}#page=${page}" loading="lazy"></iframe>`;
    pdf.querySelector('[data-review-close]').onclick=()=>{pdf.hidden=true;pdf.replaceChildren();};
    pdf.scrollIntoView?.({behavior:'smooth',block:'start'});
   }
   host.querySelector('[data-review-practice]').onclick=()=>open(practice);
   host.querySelectorAll('[data-review-original]').forEach(b=>b.onclick=()=>{const q=packet.originals[Number(b.dataset.reviewOriginal)];open(files.get(q.file_id),q.page);});
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
