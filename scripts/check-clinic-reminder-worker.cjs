const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
(async()=>{
 let handler,claimed=false,mode='empty',calls=[],finished=[];
 const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/clinic-home-reminder/index.ts'),'utf8');
 const env={SOLAPI_SEND_PIN:'test-pin',SOLAPI_API_KEY:'test-key',SOLAPI_API_SECRET:'test-secret',SOLAPI_SENDER_NUMBER:'01000000000',SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service'};
 vm.runInNewContext(stripTypeScriptTypes(source),{Response,JSON,URLSearchParams,TextEncoder,crypto:require('node:crypto').webcrypto,AbortSignal,
 Deno:{env:{get:k=>env[k]},serve:f=>handler=f},fetch:async(url,init)=>{
  calls.push(url);let data=null;
  if(url.endsWith('prepare_reminders'))data=0;
  if(url.endsWith('claim_message')&&mode!=='empty'&&!claimed){claimed=true;data={id:1,recipient:'01000000000',text:'가상 시험 안내'};}
  if(url.endsWith('finish_message'))finished.push(JSON.parse(init.body));
  if(url.startsWith('https://api.solapi.com')){if(mode==='unknown')throw Error('simulated timeout');data={groupInfo:{groupId:'test',count:{registeredSuccess:1}}};}
  return new Response(JSON.stringify(data),{status:200});
 }});
 const run=pin=>handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({sendPin:pin})}));
 assert.equal((await run('wrong')).status,403);assert.equal(calls.length,0);
 assert.equal((await (await run('test-pin')).json()).accepted,0);assert.ok(!calls.some(u=>u.startsWith('https://api.solapi.com')));
 mode='accepted';assert.equal((await (await run('test-pin')).json()).accepted,1);assert.equal(finished[0].p_status,'accepted');
 mode='unknown';claimed=false;await run('test-pin');assert.equal(finished[1].p_status,'unknown');
 const count=calls.filter(u=>u.startsWith('https://api.solapi.com')).length;await run('test-pin');assert.equal(calls.filter(u=>u.startsWith('https://api.solapi.com')).length,count);
 console.log('PASS worker: PIN gate, no recipients/no sends, provider acceptance, uncertain result held without automatic retry');
})().catch(e=>{console.error(e);process.exitCode=1;});
