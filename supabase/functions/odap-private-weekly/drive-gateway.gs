/* Deployment source, not a claim of live deployment. Secrets only in Script Properties.
 * Tokens MUST be minted by a trusted server after current session + ACL checks.
 * Never embed HMAC_SECRET in the browser or expose an anonymous token issuer.
 */
function fail(message) { throw new Error(message); }
function hash(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join(''); }
function verifyToken(token, operation) {
  var secret=PropertiesService.getScriptProperties().getProperty('HMAC_SECRET');
  if (!secret || secret.length<32) fail('not_configured');
  var parts=String(token||'').split('.');if(parts.length!==2)fail('invalid_token');
  var expected=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0],secret)).replace(/=+$/,'');
  var mismatch=expected.length^parts[1].length;
  for(var i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^(parts[1].charCodeAt(i)||0);
  if(mismatch)fail('invalid_signature');
  var c=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  var now=Math.floor(Date.now()/1000);
  if(c.aud!=='storage-drive-v1'||c.op!==operation||!Number.isInteger(c.iat)||!Number.isInteger(c.exp)||c.iat>now+5||c.exp<=now||c.exp-c.iat>120)fail('invalid_claims');
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(c.jti||'')||!c.subject||!['teacher','student'].includes(c.role))fail('invalid_identity');
  if(c.kind!=='teacher-body'||c.role!=='teacher'||c.subject!=='odap-private-weekly')fail('invalid_identity');
  if(operation==='upload'&&(!Number.isInteger(c.bytes)||c.bytes<1||c.bytes>8*1024*1024||!/^[a-f0-9]{64}$/.test(c.sha256||'')||c.mime!=='application/json'))fail('invalid_payload');
  if(operation==='read'&&!/^[a-zA-Z0-9_-]+$/.test(c.file_id||''))fail('invalid_resource');
  return c;
}
function doPost(e) {
  try {
    var req=JSON.parse(e.postData.contents),c=verifyToken(req.token,req.op);
    var config=PropertiesService.getScriptProperties(),folderId=config.getProperty('PRIVATE_FOLDER_ID');
    if(!folderId)fail('not_configured');
    var folder=DriveApp.getFolderById(folderId),result;
    if(folder.getSharingAccess()!==DriveApp.Access.PRIVATE||folder.getEditors().length||folder.getViewers().length)fail('folder_must_be_private');
    if(req.op==='upload') {
      if(typeof req.data!=='string'||req.data.length>12*1024*1024)fail('invalid_payload');
      var bytes=Utilities.base64Decode(req.data);
      if(bytes.length!==c.bytes||hash(bytes)!==c.sha256)fail('digest_mismatch');
      var lock=LockService.getScriptLock();if(!lock.tryLock(20000))fail('retry_later');
      try {
        // Token jti is server-random and digest-bound: retry returns the same file.
        var existing=folder.getFilesByName(c.jti),file=existing.hasNext()?existing.next():null;
        if(file&&hash(file.getBlob().getBytes())!==c.sha256)fail('idempotency_conflict');
        if(!file)file=folder.createFile(Utilities.newBlob(bytes,c.mime,c.jti));
        if(file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)fail('file_must_be_private');
        result={file_id:file.getId(),sha256:c.sha256,bytes:c.bytes};
      } finally {lock.releaseLock();}
    } else if(req.op==='read') {
      var file=DriveApp.getFileById(c.file_id),parents=file.getParents(),within=false;
      while(parents.hasNext())if(parents.next().getId()===folderId)within=true;
      if(!within||file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)fail('forbidden_resource');
      if(file.getSize()>8*1024*1024)fail('use_streaming_gateway');
      var blob=file.getBlob();result={mime:blob.getContentType(),data:Utilities.base64Encode(blob.getBytes())};
    } else fail('invalid_operation');
    return ContentService.createTextOutput(JSON.stringify({ok:true,result:result})).setMimeType(ContentService.MimeType.JSON);
  } catch(error) {
    // Never echo inputs, tokens, account details or provider exceptions.
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:'request_rejected'})).setMimeType(ContentService.MimeType.JSON);
  }
}
