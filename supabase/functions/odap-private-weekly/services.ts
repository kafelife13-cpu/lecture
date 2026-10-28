import { parseClaudeJSON } from '../../../odap/private-weekly-review.mjs';
const MAX_BYTES = 12 * 1024 * 1024;
export async function boundedJSON(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw Error('내용이 없습니다.');
  const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) throw Error('자료가 12MB를 초과합니다. 이미지를 줄여 주세요.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function claude(system:string,messages:unknown[],maxTokens:number) {
  const key=Deno.env.get('ANTHROPIC_API_KEY');
  if(!key)throw Error('Claude 서버 연결 설정이 필요합니다.');
  const model=Deno.env.get('ODAP_CLAUDE_MODEL')||'claude-sonnet-5-5';
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(90000),headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:maxTokens,system,messages})});
  if(!response.ok)throw Error('Claude 요청 실패('+response.status+'). 자료는 게시하지 않았습니다.');
  return {value:parseClaudeJSON(await boundedJSON(response.body)),model};
}
export async function drive(action: string, payload: Record<string,unknown>) {
  const url = Deno.env.get('ODAP_PRIVATE_DRIVE_URL'), secret = Deno.env.get('ODAP_PRIVATE_DRIVE_SECRET');
  if (!url || !secret || secret.length<32 || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) throw Error('비공개 Drive 연결 설정이 필요합니다.');
  const base64 = (bytes:Uint8Array) => { let s=''; for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s); };
  const url64 = (bytes:Uint8Array) => base64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const now=Math.floor(Date.now()/1000), op=action==='put'?'upload':'read';
  const claims:Record<string,unknown>={aud:'storage-drive-v1',op,iat:now,exp:now+90,jti:payload.request_id||crypto.randomUUID(),subject:'odap-private-weekly',role:'teacher',kind:'teacher-body'};
  let data;
  if(op==='upload'){
    const bytes=new TextEncoder().encode(JSON.stringify(payload.content));
    if(bytes.length>8*1024*1024)throw Error('자료 본문이 8MB를 초과합니다. 이미지를 줄여 주세요.');
    Object.assign(claims,{bytes:bytes.length,sha256:payload.content_hash,mime:'application/json'});data=base64(bytes);
  }else claims.file_id=payload.file_id;
  const encoded=url64(new TextEncoder().encode(JSON.stringify(claims)));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=url64(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(encoded))));
  let response = await fetch(url, {method:'POST', redirect:'manual', signal:AbortSignal.timeout(30000), headers:{'Content-Type':'application/json'}, body:JSON.stringify({op,token:encoded+'.'+sig,...(data?{data}:{})})});
  // Apps Script ContentService redirects its response to a Google-hosted GET URL.
  // Never forward the signed request body or secret to the redirect destination.
  if([302,303].includes(response.status)){
    const location=response.headers.get('location');
    if(!location || new URL(location).origin!=='https://script.googleusercontent.com')throw Error('Drive 응답 주소가 올바르지 않습니다.');
    response=await fetch(location,{redirect:'error',signal:AbortSignal.timeout(30000)});
  }
  if (!response.ok) throw Error('비공개 Drive 처리에 실패했습니다.');
  const body=await boundedJSON(response.body);
  if(body.ok!==true || !body.result)throw Error('비공개 Drive 요청이 거절되었습니다.');
  if(op==='upload')return body.result;
  if(body.result.mime!=='application/json'||typeof body.result.data!=='string'||body.result.data.length>12*1024*1024)throw Error('Drive 자료 형식이 올바르지 않습니다.');
  const raw=atob(body.result.data);if(raw.length>8*1024*1024)throw Error('Drive 자료가 너무 큽니다.');
  return {content:JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))))};
}
