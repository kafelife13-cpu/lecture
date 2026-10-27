'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../odap/drive-core.js');
const file=i=>({id:`synthetic-${i}`,name:`가상자료${i}.pdf`,mime_type:'application/pdf',bytes:123,modified_time:'2026-10-27T00:00:00Z',parents:['synthetic-folder'],can_download:true});
const manifest=(count=1)=>({schema_version:1,source:'google-drive-connector',scan_complete:true,scan_scope:'PDF and supported documents; HWP is checked separately',scanned_at:'2026-10-27T01:00:00Z',pages:1,account:'connected-google-drive',files:Array.from({length:count},(_,i)=>file(i))});
function store(){
 const rows=new Map(),calls=[],runs=new Map();let next=0,failBatch=0,batches=0;
 const rpc=async(action,p)=>{
  calls.push({action,p});if(action==='begin'){const id=`run-${++next}`;runs.set(id,{status:'running',seen:new Set()});return {id};}
  const r=runs.get(p.run_id);assert(r&&r.status==='running');
  if(action==='batch'){batches++;if(batches===failBatch)throw Error('network failure');for(const f of p.files){rows.set(f.id,f);r.seen.add(f.id);}return {accepted:p.files.length};}
  if(action==='fail'){r.status='failed';return {status:'failed'};}
  assert.equal(action,'finish');assert.equal(p.exhausted,true);assert.equal(r.seen.size,p.unique_files);r.status='complete';return {files:r.seen.size,status:r.status};
 };
 return {rows,calls,runs,rpc,setFailure(n){failBatch=n;}};
}
test('connector manifest validation runs before any RPC',async()=>{
 for(const mutate of [m=>m.scan_complete=false,m=>m.source='untrusted',m=>m.schema_version=2,m=>m.scan_scope='',m=>delete m.scan_scope,m=>m.scan_scope='x'.repeat(201),m=>m.pages=0,m=>m.scanned_at='invalid',m=>m.files.push(m.files[0]),m=>m.files[0].bytes=-1,m=>m.files[0].modified_time='invalid',m=>m.files[0].parents=['bad'],m=>Object.assign(m.files[0],{name:'video.mp4',mime_type:'video/mp4'})]){
  const m=manifest(),s=store();mutate(m);await assert.rejects(()=>core.importConnector(m,s.rpc),/드라이브 목록/);assert.equal(s.calls.length,0);
 }
});
test('metadata allowlist removes bodies, supplied hashes and credentials',async()=>{
 const m=manifest(),s=store();m.credentials={pw:'private'};Object.assign(m.files[0],{text:'private body',token:'private token',sha256:'a'.repeat(64),source_id:'private source'});
 await core.importConnector(m,s.rpc);const saved=s.rows.get('synthetic-0');assert.deepEqual(Object.keys(saved).sort(),['id','name','mime_type','bytes','modified_time','parents','can_download'].sort());assert.equal(JSON.stringify(s.calls).includes('private'),false);
});
test('1000-row batches and repeat import preserve one row per file ID',async()=>{
 const m=manifest(2001),s=store(),progress=[];const result=await core.importConnector(m,s.rpc,p=>progress.push(p.saved));
 assert.deepEqual(progress,[1000,2000,2001]);assert.equal(result.unique_files,2001);assert.deepEqual(s.calls.filter(c=>c.action==='batch').map(c=>c.p.files.length),[1000,1000,1]);
 await core.importConnector(m,s.rpc);assert.equal(s.rows.size,2001);assert.equal([...s.runs.values()].filter(r=>r.status==='complete').length,2);
});
test('partial failure marks run failed; full retry safely completes',async()=>{
 const m=manifest(1001),s=store();s.setFailure(2);await assert.rejects(()=>core.importConnector(m,s.rpc),/network/);assert.equal(s.rows.size,1000);assert.equal(s.runs.get('run-1').status,'failed');assert.equal(s.calls.some(c=>c.action==='finish'),false);
 await core.importConnector(m,s.rpc);assert.equal(s.rows.size,1001);assert.equal(s.runs.get('run-2').status,'complete');
});
test('cancellation after batch cannot mark complete',async()=>{
 const s=store();let cancel=false;await assert.rejects(()=>core.importConnector(manifest(1001),s.rpc,()=>{cancel=true;},()=>cancel),/중단/);assert.equal(s.runs.get('run-1').status,'failed');assert.equal(s.calls.some(c=>c.action==='finish'),false);
});
test('accepted count mismatch is failed rather than finished',async()=>{
 const calls=[];await assert.rejects(()=>core.importConnector(manifest(),async(a,p)=>{calls.push(a);return a==='begin'?{id:'run'}:a==='batch'?{accepted:0}:{};}),/수량/);assert.deepEqual(calls,['begin','batch','fail']);
});
test('Drive UI exposes file import using existing teacher RPC without OAuth',()=>{
 const source=fs.readFileSync('odap/drive.js','utf8');new vm.Script(source);assert(source.includes('확인한 드라이브 목록 가져오기'));assert(source.includes('OdapDrive.importConnector(value,driveRPC'));const start=source.indexOf('async function driveImportManifest()'),end=source.indexOf('async function driveStore(',start);const body=source.slice(start,end);assert(!body.includes('driveConnect('));assert(!body.includes('driveGet('));assert(!body.includes('localStorage'));
});
test('filtered scan scope survives RPC storage and cannot be labeled full scan',async()=>{
 const m=manifest(),s=store(),result=await core.importConnector(m,s.rpc);
 const account=s.calls.find(c=>c.action==='begin').p.account;assert.equal(account,'connected-google-drive|'+m.scan_scope);assert.equal(result.scan_scope,m.scan_scope);
 const label=core.catalogRunLabel({account});assert.equal(label.is_connector,true);assert.equal(label.scope,m.scan_scope);assert(!label.label.includes('전체'));
 assert.equal(core.catalogRunLabel({account:'connected-google-drive'}).is_connector,true);assert(core.catalogRunLabel({account:'connected-google-drive'}).scope.includes('간주하지 않음'));
 assert.equal(core.catalogRunLabel({account:'teacher@example.test'}).is_connector,false);
 const ui=fs.readFileSync('odap/drive.js','utf8');assert(ui.includes('OdapDrive.catalogRunLabel(d.last_complete)'));assert(ui.includes('전체 드라이브 조회 완료가 아닙니다.'));
});
