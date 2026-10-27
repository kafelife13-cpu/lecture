/* Drive metadata intake. Separate from question extraction and approval. */
(function(root){
 'use strict';
 const supported=f=>/\.(hwp|hwpx|pdf|zip|docx|doc)$/i.test(f.name||'')||['application/pdf','application/vnd.google-apps.document'].includes(f.mimeType);
 const normalize=f=>({id:f.id,name:f.name,mime_type:f.mimeType,bytes:Number(f.size||0),modified_time:f.modifiedTime||'',parents:f.parents||[],drive_id:f.driveId||null,sha256:f.sha256Checksum||null,md5:f.md5Checksum||null,can_download:f.capabilities?.canDownload===true});
 async function scan(get,save,progress=()=>{},cancelled=()=>false){
  const drives=[],seen=new Set();let pageToken='',pages=0,scanned=0;
  do{if(cancelled())throw Error('사용자가 조회를 중단했습니다.');const d=await get('drives',{pageSize:100,fields:'nextPageToken,drives(id,name)',...(pageToken?{pageToken}:{})});drives.push(...d.drives||[]);pageToken=d.nextPageToken||'';}while(pageToken);
  for(const corpus of [{corpora:'user'},...drives.map(d=>({corpora:'drive',driveId:d.id}))]){
   pageToken='';const tokens=new Set();
   do{
    if(cancelled())throw Error('사용자가 조회를 중단했습니다.');
    const d=await get('files',{...corpus,q:"trashed = false and mimeType != 'application/vnd.google-apps.folder'",spaces:'drive',pageSize:1000,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,parents,driveId,sha256Checksum,md5Checksum,capabilities(canDownload))',...(pageToken?{pageToken}:{})});
    if(d.incompleteSearch)throw Error('Google이 일부 자료만 반환했습니다. 전체 완료로 처리하지 않았습니다.');
    const files=(d.files||[]).filter(supported).map(normalize);await save(files);
    files.forEach(f=>seen.add(f.id));scanned+=(d.files||[]).length;pages++;progress({pages,scanned,files:seen.size});
    pageToken=d.nextPageToken||'';if(pageToken&&tokens.has(pageToken))throw Error('Google 조회 페이지가 반복되어 중단했습니다.');tokens.add(pageToken);
   }while(pageToken);
  }
  return {unique_files:seen.size,pages,scanned,exhausted:true,shared_drives:drives.length};
 }
 function connectorManifest(value){
  const invalid=message=>{throw Error('드라이브 목록 파일: '+message);};
  if(!value||value.schema_version!==1||value.source!=='google-drive-connector'||value.scan_complete!==true)invalid('기록된 검색 범위의 조회가 완료된 목록만 가져올 수 있습니다.');
  if(typeof value.scan_scope!=='string'||!value.scan_scope.trim()||value.scan_scope.length>200||/[\r\n\x00-\x1f]/.test(value.scan_scope))invalid('검색 범위 설명이 필요합니다. 전체 드라이브 조회와 범위 검색을 구분해야 합니다.');
  if(!Number.isInteger(value.pages)||value.pages<1||typeof value.scanned_at!=='string'||!Number.isFinite(Date.parse(value.scanned_at)))invalid('조회 시각과 페이지 수를 확인하세요.');
  if(!Array.isArray(value.files)||value.files.length>100000)invalid('파일 목록 형식이나 수량을 확인하세요.');
  const seen=new Set(),idPattern=/^[A-Za-z0-9_-]{5,200}$/;
  const files=value.files.map(f=>{
   if(!f||typeof f.id!=='string'||!idPattern.test(f.id)||seen.has(f.id))invalid('파일 ID가 없거나 중복되어 있습니다.');
   seen.add(f.id);
   if(typeof f.name!=='string'||!f.name.trim()||f.name.length>1000||typeof f.mime_type!=='string'||!f.mime_type||f.mime_type.length>150||!supported({name:f.name,mimeType:f.mime_type}))invalid('지원하지 않는 원본 형식입니다.');
   if(!Number.isSafeInteger(f.bytes)||f.bytes<0||typeof f.modified_time!=='string'||!Number.isFinite(Date.parse(f.modified_time))||f.modified_time.length>80||typeof f.can_download!=='boolean')invalid('파일 크기·변경 시각·다운로드 상태가 올바르지 않습니다.');
   if(!Array.isArray(f.parents)||f.parents.length>100||f.parents.some(id=>typeof id!=='string'||!idPattern.test(id)))invalid('상위 폴더 정보가 올바르지 않습니다.');
   // Connector metadata is not byte verification. Never pass supplied hashes,
   // source links, file bodies, credentials, or extra fields to the catalog RPC.
   return {id:f.id,name:f.name,mime_type:f.mime_type,bytes:f.bytes,modified_time:f.modified_time,parents:[...f.parents],can_download:f.can_download};
  });
  const scope=value.scan_scope.trim();
  // The existing runs table has an account label but no scope column. Preserve
  // this non-secret provenance there; never label a filtered import a full scan.
  return {files,pages:value.pages,scanned_at:value.scanned_at,scan_scope:scope,account:'connected-google-drive|'+scope};
 }
 function catalogRunLabel(run){
  const account=String(run?.account||'');
  if(account==='connected-google-drive'||account.startsWith('connected-google-drive|'))return {is_connector:true,label:'범위 목록 가져오기 완료',scope:account.includes('|')?account.slice(account.indexOf('|')+1):'범위 미기록 · 전체 드라이브 조회 완료로 간주하지 않음'};
  return {is_connector:false,label:'전체 목록 조회 완료',scope:'Google 직접 연결로 조회한 지원 자료'};
 }
 async function importConnector(value,rpc,progress=()=>{},cancelled=()=>false){
  const manifest=connectorManifest(value);let run;
  try{
   if(cancelled())throw Error('사용자가 가져오기를 중단했습니다.');
   run=await rpc('begin',{account:manifest.account});
   if(!run||typeof run.id!=='string'||!run.id)throw Error('목록 저장 작업을 시작하지 못했습니다.');
   for(let offset=0;offset<manifest.files.length;offset+=1000){
    if(cancelled())throw Error('사용자가 가져오기를 중단했습니다.');
    const files=manifest.files.slice(offset,offset+1000),saved=await rpc('batch',{run_id:run.id,files});
    if(saved?.accepted!==files.length)throw Error('저장한 목록 수량이 일치하지 않습니다.');
    progress({saved:offset+files.length,total:manifest.files.length});
   }
   if(cancelled())throw Error('사용자가 가져오기를 중단했습니다.');
   const result=await rpc('finish',{run_id:run.id,unique_files:manifest.files.length,exhausted:true});
   if(result?.status!=='complete'||result.files!==manifest.files.length)throw Error('해당 검색 범위의 목록 저장 완료를 확인하지 못했습니다.');
   return {unique_files:manifest.files.length,run_id:run.id,scanned_at:manifest.scanned_at,scan_scope:manifest.scan_scope};
  }catch(e){
   if(run?.id)await rpc('fail',{run_id:run.id,error:'확인한 드라이브 목록 가져오기를 완료하지 못했습니다. 같은 파일로 다시 시작할 수 있습니다.'}).catch(()=>{});
   throw e;
  }
 }
 const api={supported,normalize,scan,connectorManifest,importConnector,catalogRunLabel};if(typeof module==='object')module.exports=api;else root.OdapDrive=api;
})(typeof window==='object'?window:globalThis);
