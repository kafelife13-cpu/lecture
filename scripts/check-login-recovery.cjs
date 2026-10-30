const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const code=html.slice(html.indexOf('async function boundedSupabaseFetch'),html.indexOf('const sb=supabase'));
(async()=>{
 let cleared=false,fire,signal;
 const ctx={AbortController,Response,setTimeout:f=>(fire=f,1),clearTimeout:()=>cleared=true,fetch:async(_,o)=>{signal=o.signal;return {status:200,statusText:'OK',headers:{},arrayBuffer:()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))))}}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const pending=ctx.boundedSupabaseFetch('test',{});await new Promise(setImmediate);assert.equal(cleared,false);fire();await assert.rejects(pending,/aborted/);assert.equal(cleared,true);
 ctx.fetch=async()=>new Response('{"ok":true}',{status:200});assert.deepEqual(await (await ctx.boundedSupabaseFetch('test',{})).json(),{ok:true});
 assert(!html.includes('maxAttempts=10'));assert(html.includes('await loadAll(0,0)'));
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
 console.log('PASS: body timeout aborts; JSON preserved; startup not gated; login retries bounded; scripts parse');
})().catch(e=>{console.error(e);process.exitCode=1});

