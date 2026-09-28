const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');const core=require('../odap/drive-core.js');
(async()=>{
 const saved=[];let userPages=0;
 const get=async(path,p)=>{if(path==='drives')return {drives:[{id:'shared'}]};if(p.corpora==='drive')return {files:[{id:'hwp-id',name:'중세국어.HWP',mimeType:'application/octet-stream'}]};userPages++;return p.pageToken?{files:[{id:'hwp-id',name:'중세국어.HWP',mimeType:'application/octet-stream'},{id:'zip-id',name:'기출.zip'}]}:{files:[],nextPageToken:'next'};};
 const scan=await core.scan(get,x=>saved.push(...x));assert.equal(scan.unique_files,2);assert.equal(userPages,2);assert.equal(saved.length,3);assert.equal(scan.shared_drives,1);
 await assert.rejects(()=>core.scan(async p=>p==='drives'?{}:{incompleteSearch:true},()=>{}),/일부/);
 await assert.rejects(()=>core.scan(async p=>p==='drives'?{}:{nextPageToken:'repeat'},()=>{}),/반복/);
 assert.equal(core.supported({name:'문제.hwpx'}),true);assert.equal(core.supported({name:'video.mp4'}),false);
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create table users(id text,name text,role text,status text,school_id text);create table qa_schools(id text,name text);create table exams(id text,questions jsonb);create table exam_responses(id text,exam_id text,student_id text,answers jsonb,thoughts jsonb,submitted_at timestamptz);create table odap_sources(id uuid primary key default gen_random_uuid(),title text,sha256 text,object_path text);create table odap_questions(id uuid,source_id uuid,status text);create table odap_settings(key text primary key,value jsonb);create function authenticate_user(text,text,text) returns jsonb language sql as $$select to_jsonb(u) from users u where id=$1 and $2='test-only' and role=$3$$;insert into users values('teacher','Teacher','teacher','active',null),('s1','Student','student','active',null);create function odap_grade(text,text) returns boolean language sql as $$select case when $1 in ('1','2','3','4','5') and $2 in ('1','2','3','4','5') then $1=$2 else null end$$;`);
 await db.exec(fs.readFileSync('supabase/odap/drive.sql','utf8'));await db.exec(fs.readFileSync('supabase/odap/input-status.sql','utf8'));
 const rpc=async(action,p={},id='teacher')=>(await db.query('select odap_drive($1,$2,$3,$4) d',[id,'test-only',action,JSON.stringify(p)])).rows[0].d;
 await assert.rejects(()=>rpc('list',{},'s1'));const run=await rpc('begin',{account:'teacher@example.test'});
 const f={id:'source-hwp-id',name:'문법.hwp',mime_type:'application/octet-stream',modified_time:'2026-09-28T00:00:00Z'};
 await rpc('batch',{run_id:run.id,files:[f]});await rpc('batch',{run_id:run.id,files:[f]});assert.equal((await rpc('list')).total,1);
 await assert.rejects(()=>rpc('finish',{run_id:run.id,unique_files:1,exhausted:false}));await assert.rejects(()=>rpc('finish',{run_id:run.id,unique_files:2,exhausted:true}));
 await rpc('finish',{run_id:run.id,unique_files:1,exhausted:true});await assert.rejects(()=>rpc('batch',{run_id:run.id,files:[]}));
 assert.equal((await rpc('list',{q:'문법'})).matched,1);assert.equal((await rpc('list',{q:'없는'})).matched,0);
 assert.equal((await rpc('list')).items[0].source_id,null);await rpc('request',{id:f.id});assert.equal((await rpc('list')).requested,1);
 const sha='a'.repeat(64);await db.query('insert into odap_sources(title,sha256,object_path) values($1,$2,$3)',['문법.hwp',sha,'sources/a.hwp']);
 await assert.rejects(()=>rpc('link',{id:f.id,sha256:sha,modified_time:'old'}));await rpc('link',{id:f.id,sha256:sha,modified_time:f.modified_time});
 const r2=await rpc('begin',{account:'teacher@example.test'});await rpc('batch',{run_id:r2.id,files:[{...f,modified_time:'2026-09-29T00:00:00Z'}]});await rpc('fail',{run_id:r2.id,error:'network'});
 const list=await rpc('list');assert.equal(list.changed,1);assert.equal(list.last_complete.id,run.id);assert.equal(list.last_run.status,'failed');
 await db.exec(`insert into exams values('e','[{"answer":"1"},{"answer":"2"},{"answer":"3"}]');insert into exam_responses values('old','e','s1','{"0":"2","1":"1","2":"1"}','{}','2026-09-20'),('new','e','s1','{"0":"1","1":"1"}','{"_mock_wrong_notes":{"1":{"reason":"개념 혼동"}}}','2026-09-29'),('unlinked','e',null,'{"0":"2"}','{}','2026-09-29');`);
 let status=(await db.query("select odap_input_status('teacher','test-only') d")).rows[0].d;assert.equal(status.items[0].wrong,1);assert.equal(status.items[0].reasons,1);assert.equal(status.items[0].ungraded,1);assert.equal(status.unlinked_responses,1);
 await db.exec(`update exam_responses set thoughts='{}' where id='new'`);status=(await db.query("select odap_input_status('teacher','test-only') d")).rows[0].d;assert.equal(status.items[0].reasons,0);
 await assert.rejects(()=>db.query("select odap_input_status('s1','test-only')"));await db.exec('set role anon');await assert.rejects(()=>db.query('select * from odap_drive_files'));
 }finally{await db.close();}
 for(const f of ['drive-core.js','drive.js','input-status.js','cloud.js'])new vm.Script(fs.readFileSync('odap/'+f,'utf8'));
 console.log('PASS: full pagination, shared drives, HWP/ZIP detection, incomplete scans, idempotence, changed originals, teacher isolation, latest attempts and live wrong reasons');
})().catch(e=>{console.error(e);process.exitCode=1;});
