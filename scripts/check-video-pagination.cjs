const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const code=html.slice(html.indexOf('async function loadVideoRows('),html.indexOf('async function loadAll('));
(async()=>{
  for(const count of [0,500,1000,1021]){
    const rows=Array.from({length:count},(_,id)=>({id})),ranges=[];
    const context={sb:{from(table){assert.ok(['progress','video_access'].includes(table));return {select(){return this},order(){return this},async range(a,b){ranges.push([a,b]);return {data:rows.slice(a,b+1),error:null}}}}}};
    vm.createContext(context);vm.runInContext(code,context);
    for(const table of ['progress','video_access'])assert.equal((await context.loadVideoRows(table)).data.length,count);
    assert.ok(ranges.every(([a,b])=>b-a===499));
  }
  const context={sb:{from(){return {select(){return this},order(){return this},async range(){return {error:{message:'offline'}}}}}}};
  vm.createContext(context);vm.runInContext(code,context);
  await assert.rejects(context.loadVideoRows('video_access'),/offline/);
  assert.ok(html.includes("loadVideoRows('video_access')")&&html.includes("loadVideoRows('progress')"));
  console.log('Video access/progress pagination checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
