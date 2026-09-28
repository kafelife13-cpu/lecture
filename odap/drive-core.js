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
 const api={supported,normalize,scan};if(typeof module==='object')module.exports=api;else root.OdapDrive=api;
})(typeof window==='object'?window:globalThis);
