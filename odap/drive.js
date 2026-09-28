/* Private catalog and on-demand read-only Google Drive connection. Tokens stay in memory. */
let driveToken='',driveExpires=0,driveBusy=false,driveStop=false,driveQuery='',driveKind='',driveOffset=0,driveClient='',driveRows=[];
const driveRPC=(action,data={})=>api('/api/drive',{action,...data});
async function driveGet(path,params={},binary=false){
 if(!driveToken||Date.now()>=driveExpires)throw Error('Google 연결이 만료됐습니다. 다시 연결한 뒤 전체 새로고침을 눌러 주세요.');
 const url='https://www.googleapis.com/drive/v3/'+path+'?'+new URLSearchParams(params);
 for(let attempt=0;attempt<4;attempt++){
  const r=await fetch(url,{headers:{Authorization:'Bearer '+driveToken},signal:AbortSignal.timeout(60000)});
  if(r.status===429||r.status>=500){if(attempt<3){await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));continue;}}
  if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error?.message||'Google Drive 조회 실패 ('+r.status+')');}
  return binary?r:r.json();
 }
}
function driveConnect(){
 if(!driveClient)throw Error('Google 연결 설정에서 웹 클라이언트 ID를 저장하세요.');
 if(!window.google?.accounts?.oauth2)throw Error('Google 연결 화면을 준비 중입니다. 잠시 뒤 다시 눌러 주세요.');
 google.accounts.oauth2.initTokenClient({client_id:driveClient,scope:'https://www.googleapis.com/auth/drive.readonly',include_granted_scopes:false,
  callback:r=>{if(r.error){toast('Google 연결을 완료하지 못했습니다.');return;}if(!google.accounts.oauth2.hasGrantedAllScopes(r,'https://www.googleapis.com/auth/drive.readonly')){toast('드라이브 읽기 권한이 필요합니다.');return;}
   driveToken=r.access_token;driveExpires=Date.now()+(Number(r.expires_in)-30)*1000;toast('Google Drive 읽기 전용 연결 완료');action(()=>driveSync());},
  error_callback:()=>toast('Google 연결 창이 닫혔습니다. 다시 연결할 수 있습니다.')
 }).requestAccessToken({prompt:'select_account'});
}
async function driveSync(){
 if(driveBusy)return;driveBusy=true;driveStop=false;let run;
 const report=text=>{const e=$('drive-progress');if(e)e.textContent=text;};
 try{
  report('Google 계정과 공유 드라이브를 확인합니다…');
  const about=await driveGet('about',{fields:'user(emailAddress)'});
  run=await driveRPC('begin',{account:about.user.emailAddress});
  const result=await OdapDrive.scan(driveGet,files=>driveRPC('batch',{run_id:run.id,files}),p=>report(`자료 조회 중 · ${N(p.scanned)}개 파일 확인 / ${N(p.files)}개 한글·PDF·문서·압축파일 연결 · ${p.pages}페이지`),()=>driveStop);
  if(driveStop)throw Error('사용자가 조회를 중단했습니다.');
  await driveRPC('finish',{run_id:run.id,...result});
  toast(N(result.unique_files)+'개 자료의 전체 목록 연결을 완료했습니다. 문항 추출·검수는 별도입니다.');
 }catch(e){if(run)await driveRPC('fail',{run_id:run.id,error:e.message}).catch(()=>{});toast(e.message);}
 finally{driveBusy=false;if(page==='drive')await drivePage();}
}
async function drivePage(){
 const [d,c]=await Promise.all([driveRPC('list',{q:driveQuery,kind:driveKind,offset:driveOffset}),driveRPC('config')]);driveClient=c.client_id;driveRows=d.items;
 const date=v=>v?new Date(v).toLocaleString('ko-KR'):'아직 없음';
 $('main').innerHTML=heading('구글드라이브 자료','내 드라이브·공유받은 자료·공유 드라이브에서 원본을 찾아 연결합니다.',`<button id="drive-connect" class="primary" ${driveBusy?'disabled':''}>${driveToken?'Google 계정 다시 연결':'Google Drive 연결'}</button>`)+
 stats([['연결된 원본',d.total,'개','HWP·HWPX·PDF·문서·ZIP'],['문제은행 원본 연결',d.linked,'개','내용 해시로 확인한 동일 원본'],['추출 요청',d.requested,'개','문항 추출 완료와 별도'],['원본 변경 확인',d.changed,'개','기존 문항에 자동 덮어쓰지 않음']])+
 `<section class="card"><div class="row"><button id="drive-sync" ${driveBusy?'disabled':''}>전체 목록 새로고침</button><button id="drive-stop" ${driveBusy?'':'disabled'}>조회 중단</button><button id="drive-disconnect" ${driveBusy?'disabled':''}>이 화면의 Google 연결 해제</button></div><p id="drive-progress" role="status">${driveBusy?'전체 자료 조회 중…':`마지막 전체 조회 완료: ${E(date(d.last_complete?.finished_at))} · ${N(d.last_complete?.files||0)}개`}</p><p class="muted">${d.last_run&&d.last_run.status!=='complete'?`최근 조회: ${d.last_run.status==='running'?'진행 중 또는 중단됨':'완료하지 못함'} · ${E(d.last_run.error||'아직 전체 완료로 확인되지 않았습니다.')}<br>`:''}원본 목록과 링크를 교사 전용 DB에 보관합니다. 새로고침하면 추가·변경된 자료를 반영합니다. Google 연결은 이 탭에서만 유지되며, 닫힌 동안 자동 조회하지 않습니다.</p><details><summary>Google 연결 설정</summary><label>웹 클라이언트 ID<input id="drive-client" value="${E(driveClient)}" placeholder="…apps.googleusercontent.com"></label><button id="drive-config">설정 저장</button></details></section>`+
 `<section class="card"><form id="drive-search-form" class="filters"><label>자료명 검색<input id="drive-query" value="${E(driveQuery)}" placeholder="예: 한백고, 문법, 문장, 중세국어"></label><label>자료 형식<select id="drive-kind">${[['','전체'],['hwp','한글'],['pdf','PDF'],['zip','압축파일'],['requested','추출 요청']].map(([v,l])=>`<option value="${v}" ${driveKind===v?'selected':''}>${l}</option>`).join('')}</select></label><button class="primary">검색</button></form><p>${N(d.matched)}개 검색 결과 · 원본 연결만으로 문제 검수가 완료되지는 않습니다.</p><div class="table-wrap"><table><thead><tr><th>자료</th><th>연결 상태</th><th>작업</th></tr></thead><tbody>${d.items.map(f=>`<tr><td><a href="https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view" target="_blank" rel="noopener noreferrer">${E(f.name)} ↗</a><br><small>${(f.bytes/1048576).toFixed(1)} MB · ${E(date(f.modified_time))}</small></td><td>${f.source_id?`원본 보관 · 후보 ${N(f.questions)} / 검수 ${N(f.approved)}${f.modified_time!==f.source_modified_time?'<br>원본 변경 · 재대조 필요':''}`:'목록 연결 · 문항 미추출'}${f.requested_at?'<br>추출 요청됨':''}</td><td><button data-drive-request="${E(f.id)}">문항 추출 요청</button>${f.can_download&&/\.(hwp|hwpx|pdf)$/i.test(f.name)&&f.bytes<=40*1048576?`<button data-drive-store="${E(f.id)}" ${driveBusy?'disabled':''}>원본 보관·연결</button>`:''}</td></tr>`).join('')}</tbody></table></div><div class="pagination"><button id="drive-prev" ${driveOffset===0?'disabled':''}>← 이전</button><span>${N(Math.min(driveOffset+50,d.matched))} / ${N(d.matched)}</span><button id="drive-next" ${driveOffset+50>=d.matched?'disabled':''}>다음 →</button></div><p class="notice">문항 추출 요청은 대기 목록에 저장됩니다. ZIP 내부 파일·스캔 PDF·옛한글은 별도의 추출과 원문 검수가 필요합니다. 검수한 문항부터 학생별 오답·유형·개념 자료에 사용할 수 있습니다.</p></section>`;
 on('drive-connect',driveConnect);on('drive-sync',driveSync);on('drive-stop',()=>{driveStop=true;});
 on('drive-disconnect',()=>{driveToken='';driveExpires=0;toast('이 탭의 Google 연결을 해제했습니다. 보관한 목록은 유지됩니다.');});
 on('drive-config',async()=>{await driveRPC('configure',{client_id:$('drive-client').value.trim()});driveClient=$('drive-client').value.trim();toast('Google 연결 설정을 저장했습니다.');});
 $('drive-search-form').onsubmit=e=>{e.preventDefault();driveQuery=$('drive-query').value;driveKind=$('drive-kind').value;driveOffset=0;action(drivePage);};
 on('drive-prev',()=>{driveOffset-=50;return drivePage();});on('drive-next',()=>{driveOffset+=50;return drivePage();});
 document.querySelectorAll('[data-drive-request]').forEach(b=>b.onclick=()=>action(async()=>{await driveRPC('request',{id:b.dataset.driveRequest});toast('추출 요청을 저장했습니다.');await drivePage();},b));
 document.querySelectorAll('[data-drive-store]').forEach(b=>b.onclick=()=>action(()=>driveStore(b.dataset.driveStore),b));
}
async function driveStore(id){
 const f=driveRows.find(f=>f.id===id);if(!f)throw Error('자료 목록을 새로 불러오세요.');
 const r=await driveGet('files/'+encodeURIComponent(id),{alt:'media',supportsAllDrives:true},true);
 if(Number(r.headers.get('content-length'))>40*1048576)throw Error('40MB 초과 원본은 드라이브 링크로 보관합니다.');
 const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>40*1048576)throw Error('40MB 초과 원본은 드라이브 링크로 보관합니다.');
 const after=await driveGet('files/'+encodeURIComponent(id),{fields:'modifiedTime',supportsAllDrives:true});
 if(after.modifiedTime!==f.modified_time)throw Error('다운로드 중 원본이 변경됐습니다. 전체 목록을 새로고침하세요.');
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 await api('/api/source',{title:f.name,kind:'드라이브 자료',filename:f.name,data:btoa(binary)});
 await driveRPC('link',{id,sha256,modified_time:f.modified_time});toast('원본 파일 보관과 문제은행 원본 연결을 완료했습니다.');await drivePage();
}
const driveNavigate=navigate;navigate=async function(name){if(name!=='drive')return driveNavigate(name);page=name;charts.forEach(c=>c.destroy());charts=[];document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));$('breadcrumb').textContent='구글드라이브 자료';try{await drivePage();}catch(e){$('main').innerHTML=empty('드라이브 목록을 불러오지 못했습니다',e.message);}};
const driveNav=document.createElement('button');driveNav.dataset.page='drive';driveNav.textContent='☁ 구글드라이브 자료';driveNav.onclick=()=>action(()=>navigate('drive'),driveNav);document.querySelector('nav').append(driveNav);
const driveBlock=syncBlocked;syncBlocked=()=>driveBusy||driveBlock();
window.addEventListener('beforeunload',e=>{if(driveBusy){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{driveToken='';driveExpires=0;});
const gis=document.createElement('script');gis.src='https://accounts.google.com/gsi/client';gis.async=true;document.head.append(gis);
