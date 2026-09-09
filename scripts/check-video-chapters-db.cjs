// Run with an external PGlite module path; no production credentials or student data.
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;
    create table public.users(id text primary key,role text,status text);
    create table public.videos(id text primary key,url text);
    insert into users values('student-a','student','active'),('student-b','student','active'),('teacher-a','teacher','active');
    insert into videos values('lesson','https://youtu.be/sJsIw7F6r_w');
    create function public.authenticate_user(p_id text,p_password text,p_role text) returns jsonb language sql as $$
      select to_jsonb(u) from public.users u where id=p_id and role=p_role and p_password='offline-test-only'
    $$;`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260910090000_video_chapter_watch.sql'),'utf8'));
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.video_chapter_watch'),/permission denied/);
  async function call(id,role,action,extra={},password='offline-test-only'){
    const r=await db.query('select public.video_chapter_watch_rpc($1,$2,$3,$4,$5) as value',[id,password,role,action,JSON.stringify({video_id:'lesson',source_id:'sJsIw7F6r_w',...extra})]);return r.rows[0].value;
  }
  assert.deepEqual((await call('student-a','student','save',{seconds:[960,961,961]})).seconds,[960,961]);
  assert.deepEqual((await call('student-a','student','save',{seconds:[961,962],student_id:'student-b'})).seconds,[960,961,962]);
  assert.deepEqual(await call('student-b','student','read'),[],'students cannot read each other');
  assert.deepEqual((await call('student-b','student','save',{seconds:[]})).seconds,[]);
  assert.deepEqual((await call('student-b','student','save',{seconds:[]})).seconds,[],'empty retries remain valid');
  assert.equal((await call('teacher-a','teacher','read'))[0].student_id,'student-a');
  await assert.rejects(call('teacher-a','teacher','save',{seconds:[0]}),/Action not permitted/);
  await assert.rejects(call('student-a','student','read',{},'wrong'),/Authentication required/);
  await assert.rejects(call('student-a','teacher','read'),/Authentication required/);
  await assert.rejects(call('student-a','student','save',{source_id:'8TwCCPBPyrA',seconds:[0]}),/Video source mismatch/);
  for(const seconds of [[-1],[1.5],['1'],[1000000],null])await assert.rejects(call('student-a','student','save',{seconds}),/Invalid watched seconds/);
  await db.exec('reset role');
  await db.exec("update videos set url='https://www.youtube.com/watch?v=8TwCCPBPyrA' where id='lesson'");
  await db.exec('set role anon');
  assert.deepEqual(await call('student-a','student','read',{source_id:'8TwCCPBPyrA'}),[],'changed videos do not inherit history');
  await db.close();console.log('PASS: SQL migration, private table, authenticated own writes, teacher reads, deduplication/merge, invalid input and changed-source isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
