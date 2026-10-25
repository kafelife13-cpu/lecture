const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_PATH||'@electric-sql/pglite');
(async()=>{const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create table ox_attempts(id text primary key,student_id text);alter table ox_attempts enable row level security;create policy existing_read on ox_attempts for select to anon using (true);create policy existing_insert on ox_attempts for insert to anon with check(student_id<>'');grant select,insert on ox_attempts to anon;grant select on ox_attempts to authenticated;");
 const sql=fs.readFileSync('supabase/migrations/20261025090000_grammar_ox.sql','utf8');await db.exec(sql);await db.exec(sql);
 const policies=async t=>(await db.query("select policyname,permissive,roles,cmd,qual,with_check from pg_policies where tablename=$1 order by policyname",[t])).rows;
 assert.deepEqual(await policies('grammar_ox_attempts'),await policies('ox_attempts'));
 const acl=async t=>(await db.query("select grantee,privilege_type,is_grantable from information_schema.table_privileges where table_name=$1 order by grantee,privilege_type",[t])).rows;
 assert.deepEqual(await acl('grammar_ox_attempts'),await acl('ox_attempts'));
 await db.exec("set role anon;insert into grammar_ox_attempts(id,student_id,set_id,question_id,topic,choice,is_correct) values('one','s1','set','q1','parts',0,true);");
 await assert.rejects(()=>db.exec("insert into grammar_ox_attempts(id,student_id,set_id,question_id,topic,choice,is_correct) values('two','s1','set','q1','parts',1,false)"));
 await assert.rejects(()=>db.exec("insert into grammar_ox_attempts(id,student_id,set_id,question_id,topic,choice,is_correct) values('two','','set','q2','parts',1,false)"));
 await assert.rejects(()=>db.exec("insert into grammar_ox_attempts(id,student_id,set_id,question_id,topic,choice,is_correct) values('two','s1','set','q2','parts',2,false)"));
 console.log('PASS: repeatable migration; exact live-source policies/grants copied; RLS, unique set/question, choice constraint');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
