const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
let sql=fs.readFileSync('supabase/odap/clinic-practice.sql','utf8');
const mutations={
 student:[" or not coalesce(p_id=any(cfg.allowed_student_ids),false)",'RPC_STUDENT_ALLOWLIST'],
 list_week:['    and i.clinic_week=any(cfg.allowed_clinic_weeks)','RPC_LIST_WEEK'],
 submit_week:[' or not coalesce(item.clinic_week=any(cfg.allowed_clinic_weeks),false)','RPC_SUBMIT_WEEK'],
 type:["     and exists(select 1 from jsonb_array_elements_text(original->'question_types') t where jsonb_typeof(q->'question_types')='array' and q->'question_types' ? t)",'BANK_TYPE_OVERLAP']
};
const mutation=process.argv.find(a=>a.startsWith('--mutation='))?.split('=')[1];
if(mutation){const [fragment]=mutations[mutation];assert.equal(sql.split(fragment).length,2,'mutation target must occur once');sql=sql.replace(fragment,'');}
const html=fs.readFileSync('index.html','utf8');
assert.match(html,/<select[^>]+id="tex-category"[\s\S]*?<option value="school">[^<]* 클리닉<\/option>/);
assert.match(html,/clinic_week:document\.getElementById\('tex-clinic-week'\)/);
assert.ok(!/\bdelete\s+from\b|\btruncate\b/i.test(sql),'production migration never deletes records');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table users(id text primary key,name text,role text,status text,school_id text);
 create table qa_schools(id text primary key,name text);
 create table exams(id text primary key,name text,category text,questions jsonb,clinic_week text,clinic_school text,created_at timestamptz default now());
 create table exam_responses(id text primary key default gen_random_uuid()::text,exam_id text,student_name text,answers jsonb,score integer,submitted_at timestamptz default now(),attempt_count integer,regrade_approved boolean default false,regrade_requested boolean default false);
 create function authenticate_user(text,text,text) returns jsonb language sql as $$select to_jsonb(u) from users u where id=$1 and $2='test-only' and role=$3$$;
 insert into users values('t','Synthetic teacher','teacher','active',null),('s','Synthetic student','student','active','school'),('s2','Synthetic other','student','active','school'),('inactive','Synthetic inactive','student','inactive','school');
 insert into qa_schools values('school','합성고');`);
 for(const f of ['migration.sql','identity-save.sql'])await db.exec(fs.readFileSync('supabase/odap/'+f,'utf8'));
 await db.exec("create function odap_clinic_practice_sync() returns trigger language plpgsql as $$begin raise exception using errcode='57014',message='legacy save trigger must be removed';end$$;create trigger odap_clinic_practice_sync after insert or update of answers on exam_responses for each row execute function odap_clinic_practice_sync();");
 await db.exec(sql);
 const query=async(s,p=[])=>(await db.query(s,p)).rows;
 const one=async(s,p=[])=>(await query(s,p))[0];
 const rpc=async(action,payload={},id='s',role='student',pw='test-only')=>(await one('select odap_clinic_practice_rpc($1,$2,$3,$4,$5) r',[id,pw,role,action,JSON.stringify(payload)])).r;
 const teacher=(a,p)=>rpc(a,p,'t','teacher');
 const save=async(exam_id,answers,id='s')=>(await one('select odap_save_response($1,$2,$3,$4) r',['t','test-only','teacher',JSON.stringify({student_id:id,exam_id,answers})])).r;
 const arraySave=async(exam,answers,id='s')=>db.query('insert into exam_responses(exam_id,student_id,student_name,answers) select $1,id,name,$2 from users where id=$3',[exam,JSON.stringify(answers),id]);
 const exam=async(id,questions,extra={})=>db.query('insert into exams(id,name,category,questions,clinic_week,clinic_school,created_at) values($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz,now()))',[id,extra.name||'합성 평가 '+id,extra.category===undefined?'school':extra.category,JSON.stringify(questions),extra.week===undefined?'11월 1주차':extra.week,extra.school||'합성고',extra.date||null]);
 let next=1;
 const body=(text,extra={})=>({text,choices:['가','나','다','라','마'],answer:'1',explanation:'SECRET_EXPLANATION',concepts:['C'],question_types:['T'],...extra});
 const bank=async(text,extra={},status='approved',source=null)=>{const id=uuid(next++);await db.query('insert into odap_questions(id,source_id,body,fingerprint,status) values($1::text::uuid,$2,$3,$1::text,$4)',[id,source,JSON.stringify(body(text,extra)),status]);return id;};
 const map=async(e,i,q,concepts=['C'],verified=true)=>db.query('insert into odap_mappings values($1,$2,$3,$4,$5)',[e,i,q,JSON.stringify(concepts),verified]);
 const rawRows=(e,id='s')=>query('select * from odap_clinic_practice_items where exam_id=$1 and student_id=$2 order by question_index',[e,id]);
 // The app lists first, then calls separately committed, bounded allocation RPCs.
 const prepare=async(id='s')=>{let data=await rpc('list',{},id);for(let n=0;data.enabled&&data.pending;n++){assert.ok(n<100,'allocation must make progress');await rpc('allocate',{},id);data=await rpc('list',{},id);}return data;};
 const rows=async(e,id='s')=>{await prepare(id);return rawRows(e,id);};
 const count=async()=>(await one('select count(*)::int n from odap_clinic_practice_items')).n;
 const cfg=async(enabled=true,ids=['s','s2'],weeks=['11월 1주차'])=>db.query('update odap_clinic_practice_settings set enabled=$1,allowed_student_ids=$2,allowed_clinic_weeks=$3',[enabled,ids,weeks]);
 // Same vectors as the actual app's alternatives check, executed by PostgreSQL.
 const alternatives=fs.readFileSync('tests/clinic-alternatives.cjs','utf8');assert.ok(alternatives.includes("['4','5',' 4 ']"));
 for(const a of ['4','5',' 4 '])assert.equal((await one("select odap_grade($1,'any:4,5') g",[a])).g,true,a);
 for(const a of ['1','2','3','1,2,3','4,5'])assert.equal((await one("select odap_grade($1,'any:4,5') g",[a])).g,false,a);
 for(const a of ['',null,'any:4,5'])assert.equal((await one("select odap_grade($1,'any:4,5') g",[a])).g,null,a);
 // Fixture names deliberately contain no clinic label; only stored category/week identify them.
 const questions=[{num:1,text:'원문1',answer:'1'},{num:2,text:'원문2',answer:'any:4,5'},{num:3,text:'원문3',answer:'all:1,4'},{num:4,answer:'2'},{num:5,answer:'3'},{num:6,answer:'서술형'}];
 await exam('A',questions);
 for(let i=0;i<3;i++){await map('A',i,await bank('원문'+(i+1),{answer:['1','4','4,1'][i],concepts:['C'+i]}),['C'+i]);for(let n=0;n<4;n++)await bank('후보'+i+'-'+n,{concepts:['C'+i]});}
 const answers={0:'2',1:'3',2:'2',3:'2',5:'모름'};
 assert.deepEqual((await one('select enabled,allowed_student_ids,allowed_clinic_weeks from odap_clinic_practice_settings')),{enabled:false,allowed_student_ids:[],allowed_clinic_weeks:[]});
 assert.ok((await save('A',answers)).id);assert.equal(await count(),0);
 await cfg(false);await save('A',answers);assert.equal(await count(),0);
 await cfg(true,['s2']);await save('A',answers);assert.equal(await count(),0);
 await cfg(true,['s'],['other']);await save('A',answers);assert.equal(await count(),0);
 await cfg(true,['s','s2','inactive']);await save('A',answers,'inactive');assert.equal(await count(),0);
 await cfg();await save('A',answers);assert.equal(await count(),0,'saving does not allocate');let a=await rows('A');assert.equal(a.length,3);assert.ok(a.every(i=>i.status==='open'));
 await cfg(true,['s2']);assert.deepEqual(await rpc('list'),{enabled:false,items:[]},'RPC_STUDENT_ALLOWLIST');await assert.rejects(()=>rpc('submit',{id:a[0].id,answer:'1'}));
 await cfg(true,['s','s2'],['other']);assert.equal((await rpc('list')).items.length,0,'RPC_LIST_WEEK');await assert.rejects(()=>rpc('submit',{id:a[0].id,answer:'1'}),undefined,'RPC_SUBMIT_WEEK');await cfg();
 assert.equal(new Set(a.map(i=>i.question_id)).size,3);assert.equal(a[1].question_index,1);
 await save('A',answers);assert.deepEqual((await rows('A')).map(i=>i.id),a.map(i=>i.id),'repeated answer save keeps assignments');
 await save('A',{0:'2',1:'5',2:'2',3:'2'},'s2');assert.equal((await rows('A','s2')).length,2,'any correct not assigned');
 await exam('B',[{text:'뒤 시험',answer:'1'}]);await map('B',0,await bank('뒤 원문',{concepts:['C0']}),['C0']);await arraySave('B',['2']);
 assert.equal((await rows('B')).length,1);assert.equal((await rows('A')).length,3);
 assert.equal(new Set((await query("select question_id from odap_clinic_practice_items where student_id='s' and status='open'")).map(i=>i.question_id)).size,4);
 console.log('PASS: stored school/week identification, any/all grading, defaults, allowlists, inactive users, 3 wrongs -> 3 items, array answers and later papers');
 for(const [id,extra] of [['not-school',{category:'homework'}],['no-week',{week:null}],['null-category',{category:null}]]){await exam(id,[{text:id,answer:'1'}],extra);await save(id,{0:'2'});assert.equal((await rows(id)).length,id==='null-category'?1:0);}
 await cfg(false);assert.deepEqual(await rpc('list'),{enabled:false,items:[]});await assert.rejects(()=>rpc('submit',{id:a[0].id,answer:'1'}));
 const beforeStop=await count();await exam('stopped',[{answer:'1'}]);await save('stopped',{0:'2'});assert.equal(await count(),beforeStop);await cfg();
 // Four bank failures are preserved; fallback separately reports missing correspondence.
 await exam('skips',[0,1,2,3].map(n=>({text:'skip'+n,answer:'1'})));
 await map('skips',1,await bank('conflict',{answer:'2'}));await map('skips',2,await bank('no-type',{question_types:[]}));
 await map('skips',3,await bank('no-candidate',{concepts:['NONE']}),['NONE']);await save('skips',{0:'2',1:'2',2:'2',3:'2'});
 assert.deepEqual((await rows('skips')).map(i=>i.skip_reason),['no_mapping','mapping_conflict','no_type','no_candidate']);
 const summary=(await teacher('summary',{clinic_week:'11월 1주차'})).rows.find(r=>r.exam_id==='skips'&&r.student_id==='s');
 assert.equal(summary.wrong,4);assert.equal(summary.assigned,0);assert.equal(summary.skipped,4);
 for(const k of ['no_mapping','mapping_conflict','no_type','no_candidate'])assert.equal(summary.skip_reasons[k],1);
 assert.equal(summary.skip_reasons.no_domain,4);
 await exam('mapping-boundaries',[0,1,2,3].map(n=>({text:'mapping-boundary'+n,answer:'1'})));
 const mapped=await bank('mapping boundary source');
 await map('mapping-boundaries',0,mapped,['C'],false);await assert.rejects(()=>map('mapping-boundaries',1,mapped,['C'],null));
 await map('mapping-boundaries',2,null);await map('mapping-boundaries',3,mapped,[]);
 await save('mapping-boundaries',{0:'2',1:'2',2:'2',3:'2'});assert.ok((await rows('mapping-boundaries')).every(i=>i.skip_reason==='no_mapping'));
 // Candidate exclusion and ordering use distinct concept counts then UUID, not randomness.
 await exam('rules',[{text:'같은 본문',answer:'1'}]);const orig=await bank('연결 원문',{concepts:['RULE','EXTRA']});await map('rules',0,orig,['RULE','EXTRA','RULE']);
 await bank('concept-only',{concepts:['RULE','EXTRA'],question_types:['different']});await bank('type-only',{concepts:['different']});
 await bank('pending',{concepts:['RULE']},'pending');
 for(const origin_type of ['generated','ai','자작'])await bank('origin-'+origin_type,{concepts:['RULE'],origin_type});
 await bank('body-school',{concepts:['RULE'],school:'다른고'});
 const src=uuid(9000);await db.query("insert into odap_sources(id,title,kind,school) values($1,'Synthetic','paper','다른고')",[src]);await bank('source-school',{concepts:['RULE']},'approved',src);
 await bank('같 은\n본 문',{concepts:['RULE']});
 for(const extra of [{choices:['1','2']},{answer:'any:1,2'},{text:''},{explanation:''}])await bank('incomplete'+next,{concepts:['RULE'],...extra});
 const seen=await bank('already-in-exam',{concepts:['RULE','EXTRA']});await exam('seen',[{text:'seen',answer:'1'}],{category:'homework'});await map('seen',0,seen,['RULE']);await save('seen',{0:'1'});
 await bank('less-overlap',{concepts:['RULE']});const winner=await bank('winner',{concepts:['RULE','EXTRA']});await bank('later-tie',{concepts:['RULE','EXTRA']});
 await save('rules',{0:'2'});assert.equal((await rows('rules'))[0].question_id,winner,'BANK_TYPE_OVERLAP');
 console.log('PASS: emergency stop, four skip reasons and summary, bank validity/school/origin/exam/text exclusions, concept AND type, deterministic ranking');
 // Full response must not leak hidden metadata, including nested image fields.
 await db.query("update odap_questions set body=body||$2 where id=$1",[a[0].question_id,JSON.stringify({evidence:'SECRET_EVIDENCE',source:'SECRET_SOURCE',images:[{data:'data:image/png;base64,AAAA',alt:'그림',answer:'SECRET_IMAGE'},{data:'data:image/jpeg;base64,AAAA',alt:'그림2'},{data:'https://bad.example/x'},{data:'data:image/svg+xml;base64,AAAA'}]})]);
 let list=await rpc('list',{student_id:'s2',exam_id:'A'});assert.equal(list.items.length,3);
 assert.deepEqual(Object.keys(list.items[0]).sort(),['id','exam_name','num','text','passage','choices','images'].sort());
 assert.equal(list.items[0].images.length,2);
 assert.ok(!/SECRET_|question_id|answer|explanation|concepts|question_types|evidence|source/.test(JSON.stringify(list)));
 await assert.rejects(()=>rpc('list',{},'s','student','bad'));
 await assert.rejects(async()=>rpc('submit',{id:(await rows('A','s2'))[0].id,answer:'1'}));
 for(const action of ['summary','withdraw','reports','report_resolve'])await assert.rejects(()=>rpc(action,{id:a[0].id}));
 await assert.rejects(()=>rpc('submit',{id:a[0].id,answer:'1,2'}));
 const result=await rpc('submit',{id:a[0].id,answer:'2',correct:true,student_id:'s2'});assert.equal(result.correct,false);assert.equal(result.my_answer,'2');assert.equal(result.answer,'1');
 await db.query("update odap_questions set body=body||'{\"answer\":\"2\",\"explanation\":\"changed\"}' where id=$1",[a[0].question_id]);
 assert.deepEqual(await rpc('submit',{id:a[0].id,answer:'1'}),result);
 await db.query("update odap_questions set status='pending' where id=$1",[a[1].question_id]);
 assert.equal((await rpc('list',{exam_id:'A'})).items.length,2);await assert.rejects(()=>rpc('submit',{id:a[1].id,answer:'1'}));
 await db.query("update odap_questions set status='approved' where id=$1",[a[1].question_id]);
 await save('A',{0:'1',1:'5',2:'1,4',3:'2'});a=await rows('A');assert.deepEqual(a.map(i=>i.status),['answered','retired','retired']);assert.deepEqual(a[0].result,result);
 // Reports are own-item only and cannot override ownership.
 await assert.rejects(async()=>rpc('report',{id:(await rows('A','s2'))[0].id,reason:'타인'}));
 for(const reason of ['', '  ', '가'.repeat(501)])await assert.rejects(()=>rpc('report',{id:a[0].id,reason}));
 await rpc('report',{id:a[0].id,reason:'가'.repeat(500),student_id:'s2'});await rpc('report',{id:a[0].id,reason:'duplicate'});
 let reports=await teacher('reports');assert.equal(reports.length,1);assert.equal(reports[0].student_id,'s');await teacher('report_resolve',{id:reports[0].id});assert.equal((await teacher('reports'))[0].status,'resolved');
 const beforeWithdraw=await count(),impact=await teacher('withdraw',{question_id:a[0].question_id,dry_run:true});assert.equal(impact.students,2);
 await assert.rejects(()=>teacher('withdraw',{question_id:a[0].question_id,expected_items:999}));
 await teacher('withdraw',{question_id:a[0].question_id,expected_items:impact.items});assert.equal(await count(),beforeWithdraw);assert.deepEqual((await rows('A'))[0].result,result);assert.equal((await rows('A'))[0].status,'withdrawn');
 assert.ok(!(await rpc('list')).items.some(i=>i.id===a[0].id));
 const b=(await rows('B'))[0];await teacher('withdraw',{id:b.id});assert.equal((await rows('B'))[0].status,'withdrawn');
 console.log('PASS: allowlisted pre-submit response, image filtering, authenticated ownership, server-only immutable grading, approval withdrawal, retirement, reports and non-deleting withdrawal');
 // Real-shaped homework fallback: original choices live in text/passage, no invented choice content.
 const realQuestion=(text,domain='현대시(진달래꽃)',extra={})=>({num:1,text,type:'객관식',answer:'2',domain,points:4,passage:'① 원문 선지 A ② 원문 선지 B ③ C ④ D ⑤ E',explanation:'SECRET_HOMEWORK',...extra});
 const originals=[realQuestion('오답 시 원문'),realQuestion('오답 시 원문2'),realQuestion('오답 문법','중세 국어')];
 await exam('fallback',originals);await exam('hw-other',[realQuestion('타교 후보','문학(현대시)')],{category:'homework',name:'타교 기말 진달래꽃',school:'다른고'});
 await exam('hw-old',[realQuestion('지난 범위','문학(현대시)')],{category:'homework',name:'합성고 기말 진달래꽃',date:'2000-01-01'});
 await exam('hw-not-final',[realQuestion('중간 후보','문학(현대시)')],{category:'homework',name:'합성고 중간'});
 await exam('hw-match',[realQuestion('시 후보 본문','문학(현대시)'),realQuestion('풀었던 본문','문학(현대시)'),realQuestion('남은 문법 본문',null,{type:'문법'}),realQuestion('오답 시 원문','문학(현대시)'),realQuestion('복수정답 제외','문학(현대시)',{answer:'any:1,2'}),realQuestion('해설 없음','문학(현대시)',{explanation:''}),realQuestion('','문학(현대시)'),realQuestion('영역 다름','문학(고전소설)')],{category:'homework',name:'합성고 기말 진달래꽃'});
 await exam('hw-split',[realQuestion('시 후보\n 본문','문학(현대시)'),realQuestion('풀었던 본문','문학(현대시)')],{category:'homework',name:'합성고 기말 분할'});
 await exam('hw-other-work',[realQuestion('다른 작품 본문','문학(현대시)')],{category:'homework',name:'합성고 기말 다른 작품'});
 await exam('hw-completed',[realQuestion('이미 맞힌 본문','문학(현대시)'),realQuestion('풀었던 본문','문학(현대시)')],{category:'homework',name:'합성고 기말 진달래꽃'});
 await exam('hw-completed-copy',[realQuestion('이미 맞힌\n 본문','문학(현대시)')],{category:'homework',name:'합성고 기말 진달래꽃 분할'});
 await save('hw-completed',{1:'3'});await save('hw-completed',{});await save('fallback',{0:'1',1:'1',2:'1'});
 const f=await rows('fallback');assert.equal(f.length,3);assert.ok(f.every(i=>i.status==='open'&&i.question_id===null));
 assert.deepEqual(f.map(i=>i.practice_body.text),['시 후보 본문','다른 작품 본문','남은 문법 본문']);assert.equal(f[0].homework_exam_id,'hw-match');
 assert.equal(new Set(f.map(i=>i.content_key)).size,3);assert.ok(!f.some(i=>i.practice_body.text==='풀었던 본문'));
 const fallbackList=await rpc('list',{exam_id:'fallback'});assert.equal(fallbackList.items.length,3);assert.deepEqual(fallbackList.items[0].choices,[]);assert.match(fallbackList.items[0].passage,/① 원문/);
 assert.ok(!/SECRET_|question_id|answer|explanation|practice_body|homework_exam_id/.test(JSON.stringify(fallbackList)));
 const fr=await rpc('submit',{id:f[0].id,answer:'2',correct:false});assert.equal(fr.correct,true);assert.equal(fr.explanation,'SECRET_HOMEWORK');
 await rpc('report',{id:f[0].id,reason:'과제 문항 신고'});await teacher('withdraw',{content_key:f[0].content_key});assert.equal((await rows('fallback'))[0].status,'withdrawn');assert.deepEqual((await rows('fallback'))[0].result,fr);
 const practiceSummary=(await teacher('summary',{clinic_week:'11월 1주차'})).rows.find(r=>r.exam_id==='fallback'&&r.student_id==='s');
 assert.deepEqual([practiceSummary.wrong,practiceSummary.assigned,practiceSummary.skipped,practiceSummary.answered,practiceSummary.correct],[3,3,0,1,1],'withdrawal preserves completed counts');
 // Consumed duplicate text cannot refill a later wrong; wrong domains never fill gaps.
 await exam('fallback-exhausted',[realQuestion('새 오답 시')]);await save('fallback-exhausted',{0:'1'});assert.equal((await rows('fallback-exhausted'))[0].status,'skipped');assert.equal((await rows('fallback-exhausted'))[0].fallback_skip_reason,'no_homework_candidate');
 for(const [input,output] of [['고전소설(춘향전)','문학(고전소설)'],['현대시(진달래꽃)','문학(현대시)'],['고전시가(속미인곡)','문학(고전시)'],['현대 국어 문법','문법'],['중세 국어','문법'],['한글 맞춤법','문법']])assert.equal((await one('select odap_clinic_practice_domain($1) d',[input])).d,output);
 // Explicit current-scope IDs can include a paper whose name omits the final label.
 await db.query('update odap_clinic_practice_settings set homework_exam_ids=$1',[['hw-not-final']]);await save('fallback-exhausted',{0:'1'});assert.equal((await rows('fallback-exhausted'))[0].homework_exam_id,'hw-not-final');
 console.log('PASS: homework fallback by stored school/current scope/domain, work-title priority, embedded choices, input-question exclusion, full/split text dedup, no filler, grading/report/withdrawal');
 // No choice array or complete embedded options: retain an explicit skipped reason.
 await exam('hw-no-choices',[realQuestion('윗글의 내용과 일치하지 않는 것은?','문법',{passage:''}),realQuestion('누락 선택지 ① A ⑤ E','문법',{passage:''}),realQuestion('빈 선지 배열','문법',{choices:['','','','',''],passage:''})],{category:'homework',name:'합성고 기말 선택지 누락'});
 await db.query('update odap_clinic_practice_settings set homework_exam_ids=$1',[['hw-no-choices']]);
 await exam('no-choices',[realQuestion('선택지 검사 오답','현대 국어 문법')]);await save('no-choices',{0:'1'});
 const missingChoices=(await rows('no-choices'))[0];assert.equal(missingChoices.status,'skipped');assert.equal(missingChoices.fallback_skip_reason,'no_choices');
 assert.equal((await teacher('summary',{clinic_week:'11월 1주차'})).rows.find(r=>r.exam_id==='no-choices'&&r.student_id==='s').skip_reasons.no_choices,1);
 for(const q of [realQuestion('선택지 없는 발문','문법',{passage:''}),realQuestion('① A ⑤ E','문법',{passage:''}),{choices:['A','B','C','D','']}])assert.equal((await one('select odap_clinic_practice_has_choices($1) ok',[JSON.stringify(q)])).ok,false);
 for(const q of [realQuestion('선택지 있는 발문'),{choices:['A','B','C','D','E']}])assert.equal((await one('select odap_clinic_practice_has_choices($1) ok',[JSON.stringify(q)])).ok,true);
 // Revocation is global for future students, including bank edits and duplicated homework sources.
 await exam('global-bank',[{text:'전역 회수 오답',answer:'1'}]);await map('global-bank',0,await bank('전역 연결',{concepts:['GLOBAL']}),['GLOBAL']);const badBank=await bank('회수 은행 본문',{concepts:['GLOBAL']});
 await save('global-bank',{0:'2'});const badBankItem=(await rows('global-bank'))[0];assert.equal(badBankItem.question_id,badBank);
 await teacher('withdraw',{id:badBankItem.id});await db.query("update odap_questions set body=jsonb_set(body,'{text}','\"회수 이후 바뀐 본문\"') where id=$1",[badBank]);
 await save('global-bank',{0:'2'},'s2');assert.equal((await rows('global-bank','s2'))[0].status,'skipped');assert.ok(!(await rpc('list',{},'s2')).items.some(i=>i.text==='회수 이후 바뀐 본문'));
 await exam('hw-global',[realQuestion('회수 과제 본문','문학(고전소설)')],{category:'homework',name:'합성고 기말 춘향전'});
 await exam('hw-global-copy',[realQuestion('회수 과제\n 본문','문학(고전소설)')],{category:'homework',name:'합성고 기말 춘향전 분할'});
 await db.query('update odap_clinic_practice_settings set homework_exam_ids=$1',[['hw-global','hw-global-copy']]);
 await exam('global-homework',[realQuestion('전역 과제 오답','고전소설(춘향전)')]);await save('global-homework',{0:'1'});const badHomework=(await rows('global-homework'))[0];assert.equal(badHomework.status,'open');
 await teacher('withdraw',{content_key:badHomework.content_key});await save('global-homework',{0:'1'},'s2');assert.equal((await rows('global-homework','s2'))[0].status,'skipped');
 assert.ok(!(await rpc('list',{},'s2')).items.some(i=>String(i.text).replace(/\s/g,'')==='회수과제본문'));
 console.log('PASS: wrong-only/OMR correct-key omissions and copied papers excluded; missing options skipped with no_choices; withdrawn bank/homework blocked for another student');
 // SQL reapplication must preserve all settings, records and frozen results.
 const settings=await query('select * from odap_clinic_practice_settings'),savedItems=await query('select * from odap_clinic_practice_items order by id'),savedReports=await query('select * from odap_clinic_practice_reports order by id'),savedBlocks=await query('select * from odap_clinic_practice_blocks order by key');
 await db.exec(sql);assert.deepEqual(await query('select * from odap_clinic_practice_settings'),settings);assert.deepEqual(await query('select * from odap_clinic_practice_items order by id'),savedItems);assert.deepEqual(await query('select * from odap_clinic_practice_reports order by id'),savedReports);
 assert.deepEqual(await query('select * from odap_clinic_practice_blocks order by key'),savedBlocks);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  for(const table of ['odap_clinic_practice_settings','odap_clinic_practice_items','odap_clinic_practice_reports','odap_clinic_practice_blocks']){
   await assert.rejects(()=>db.query('select * from '+table));await assert.rejects(()=>db.query('insert into '+table+' default values'));await assert.rejects(()=>db.query('update '+table+' set '+(table.endsWith('settings')?'enabled=false':table.endsWith('blocks')?'key=key':"status='open'")));await assert.rejects(()=>db.query('delete from '+table));
  }
  await assert.rejects(()=>db.query("select odap_clinic_practice_allocate('s')"),e=>e.code==='42501');
  await assert.rejects(()=>db.query("select * from odap_clinic_practice_work('s')"),e=>e.code==='42501');
  assert.equal((await rpc('list')).enabled,true,'RPC remains executable');await db.exec('reset role');
 }
 const rls=await query("select relrowsecurity from pg_class where relname in ('odap_clinic_practice_settings','odap_clinic_practice_items','odap_clinic_practice_reports','odap_clinic_practice_blocks')");assert.equal(rls.length,4);assert.ok(rls.every(r=>r.relrowsecurity));
 // Same scales as review. Time is evidence, not a flaky machine-specific pass threshold.
 if(!mutation)for(const [papers,perPaper,history,wrongs] of [[4,50,20,5],[12,67,60,10],[24,50,60,15]]){
  await db.exec('begin');
  try{
   await db.exec(`insert into users values('perf','Synthetic performance','student','active','school');
    insert into exams(id,name,category,clinic_school,questions)
    select 'perf-hw-'||p,'합성고 기말 규모 '||p,'homework','합성고',jsonb_agg(jsonb_build_object('text','후보 '||p||'-'||n,'domain','문법','answer','1','explanation','합성 해설','passage','① A ② B ③ C ④ D ⑤ E')) from generate_series(1,${papers})p cross join generate_series(1,${perPaper})n group by p;
    insert into exams(id,name,category,clinic_school,questions)
    select 'perf-past-'||p,'과거 합성 '||p,'homework','합성고',jsonb_agg(jsonb_build_object('text','과거 '||p||'-'||n,'domain','문법','answer','1','explanation','합성 해설')) from generate_series(1,${history})p cross join generate_series(1,${perPaper})n group by p;
    insert into exam_responses(exam_id,student_id,student_name,answers) select 'perf-past-'||n,'perf','Synthetic performance','{"1":"3"}'::jsonb from generate_series(1,${history})n;
    insert into exams(id,name,category,clinic_week,clinic_school,questions) select 'perf-clinic','합성 평가','school','11월 1주차','합성고',jsonb_agg(jsonb_build_object('text','오답 '||n,'domain','현대 국어 문법','answer','1')) from generate_series(1,${wrongs})n;`);
   await db.query('update odap_clinic_practice_settings set allowed_student_ids=$1,homework_exam_ids=$2',[['perf'],Array.from({length:papers},(_,i)=>'perf-hw-'+(i+1))]);
   const input=Object.fromEntries(Array.from({length:wrongs},(_,i)=>[i,'2'])),times={};await save('perf-clinic',input,'perf');
   for(const enabled of [false,true]){
    await db.query('update odap_clinic_practice_settings set enabled=$1',[enabled]);await db.exec("set role anon;set statement_timeout='1s'");
    const samples=[];for(let i=0;i<5;i++){const start=performance.now();await save('perf-clinic',input,'perf');samples.push(performance.now()-start);}
    times[enabled?'on':'off']=samples.sort((a,b)=>a-b)[2];await db.exec('reset role;reset statement_timeout');
   }
   assert.equal((await rawRows('perf-clinic','perf')).length,0,'no candidate work at save');
   const start=performance.now();const loaded=await prepare('perf');const allocationMs=performance.now()-start;assert.equal(loaded.items.length,wrongs);
   console.log(`PASS scale ${papers}x${perPaper}, history=${history}, wrongs=${wrongs}: save off median=${times.off.toFixed(1)}ms, on median=${times.on.toFixed(1)}ms; separate batches=${allocationMs.toFixed(1)}ms`);
  }finally{await db.exec('rollback');}
 }
 if(!mutation){
  await db.exec("insert into users values('bankperf','Synthetic bank performance','student','active','school')");
  await cfg(true,['bankperf','s']);
  await db.exec(`insert into odap_questions(id,body,fingerprint,status)
   select md5('scale-bank-'||n)::uuid,jsonb_build_object('text','합성 후보 '||n||' '||repeat('긴 본문 ',200),'answer','1','explanation','합성 해설',
    'choices',jsonb_build_array('가','나','다','라','마'),'concepts',jsonb_build_array('ScaleC'),'question_types',jsonb_build_array('ScaleT')),md5('scale-bank-'||n),'approved'
   from generate_series(1,2000)n;`);
  const wrongs=Array.from({length:15},(_,i)=>({text:'규모 원문 '+i,answer:'1'}));await exam('bank-scale',wrongs);
  for(let i=0;i<15;i++)await map('bank-scale',i,await bank(wrongs[i].text,{concepts:['ScaleC'],question_types:['ScaleT']}),['ScaleC']);
  await save('bank-scale',Object.fromEntries(wrongs.map((_,i)=>[i,'2'])),'bankperf');
  const listStart=performance.now(),initial=await rpc('list',{},'bankperf'),listMs=performance.now()-listStart;assert.equal(initial.items.length,0);assert.equal(initial.pending,15);
  const batchTimes=[];async function batch(){const start=performance.now();const result=await rpc('allocate',{limit:999,student_id:'s'},'bankperf');batchTimes.push(performance.now()-start);return result;}
  assert.equal((await batch()).pending,12);const committed=await rawRows('bank-scale','bankperf');assert.equal(committed.length,3,'bounded server batch');
  await db.exec("create function synthetic_batch_timeout() returns trigger language plpgsql as $$begin if new.student_id='bankperf' then raise exception using errcode='57014',message='batch canceled';end if;return new;end$$;create trigger synthetic_batch_timeout before insert on odap_clinic_practice_items for each row execute function synthetic_batch_timeout();");
  await assert.rejects(()=>rpc('allocate',{},'bankperf'),e=>e.code==='57014');
  const visible=await rpc('list',{},'bankperf');assert.equal(visible.items.length,3,'allocation cancellation must not hide committed items');assert.equal(visible.pending,12);
  assert.deepEqual((await rawRows('bank-scale','bankperf')).map(i=>i.id),committed.map(i=>i.id));
  const waiting=(await teacher('summary',{clinic_week:'11월 1주차'})).rows.find(r=>r.student_id==='bankperf'&&r.exam_id==='bank-scale');assert.equal(waiting.pending,12);assert.equal(waiting.assigned,3);
  await db.exec('drop trigger synthetic_batch_timeout on odap_clinic_practice_items;drop function synthetic_batch_timeout()');
  assert.equal((await batch()).pending,9,'retry resumes after committed work');while((await rpc('list',{},'bankperf')).pending)await batch();
  assert.equal(batchTimes.length,5);assert.equal((await rpc('list',{},'bankperf')).items.length,15);
  assert.ok(committed.every(old=>(visible.items.some(i=>i.id===old.id))));
  console.log(`PASS bank 2000 / wrongs 15: pure list=${listMs.toFixed(1)}ms; 5 committed batches (3 each), max=${Math.max(...batchTimes).toFixed(1)}ms, total=${batchTimes.reduce((a,b)=>a+b,0).toFixed(1)}ms; 57014 preserves 3 visible items / 12 pending and retry resumes`);
  await exam('bank-empty',wrongs.map((q,i)=>({...q,text:'후보 없는 원문 '+i})));
  for(let i=0;i<15;i++)await map('bank-empty',i,await bank('후보 없는 원문 '+i,{concepts:['ScaleC'],question_types:['MissingType']}),['ScaleC']);
  await save('bank-empty',Object.fromEntries(wrongs.map((_,i)=>[i,'2'])),'bankperf');await prepare('bankperf');
  const skipped=await rawRows('bank-empty','bankperf');assert.equal(skipped.length,15);assert.ok(skipped.every(i=>i.status==='skipped'&&i.skip_reason==='no_candidate'));
  const repeatStart=performance.now();for(let i=0;i<3;i++)assert.equal((await rpc('allocate',{},'bankperf')).pending,0);
  assert.deepEqual(await rawRows('bank-empty','bankperf'),skipped,'no-candidate decisions are not recomputed on every call');
  console.log(`PASS no-candidate progress: 15 skipped reasons saved, 3 repeat empty allocations=${(performance.now()-repeatStart).toFixed(1)}ms; no repeated pool scan`);
 }
 // No practice trigger can add errors, cancellation, locks or candidate work to an answer save.
 assert.equal((await one("select count(*)::int n from pg_trigger where tgrelid='exam_responses'::regclass and tgname='odap_clinic_practice_sync'")).n,0);
 await exam('failure',[{text:'장애 오답',answer:'1'}]);await db.exec("create function synthetic_allocation_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic outage';end$$;create trigger synthetic_failure before insert on odap_clinic_practice_items for each row execute function synthetic_allocation_failure();");
 const failureSaved=await save('failure',{0:'2'});assert.ok(failureSaved.id);await assert.rejects(()=>rpc('allocate'),/synthetic outage/);assert.deepEqual((await one('select answers from exam_responses where id=$1',[failureSaved.id])).answers,{0:'2'});assert.equal((await rawRows('failure')).length,0);
 await db.exec("create or replace function synthetic_allocation_failure() returns trigger language plpgsql as $$begin raise exception using errcode='57014',message='synthetic query canceled';end$$;set role anon;set statement_timeout='1s';");
 await assert.rejects(()=>rpc('allocate'),e=>e.code==='57014');await rpc('list');await save('failure',{0:'3'});await db.exec('reset role;reset statement_timeout');assert.deepEqual((await one('select answers from exam_responses where id=$1',[failureSaved.id])).answers,{0:'3'});
 assert.deepEqual(await rpc('list',{},'inactive'),{enabled:false,items:[]});
 console.log('PASS: RLS/ACL, idempotent migration; no save trigger, allocation errors and SQLSTATE 57014 cannot roll back saved answers');
}finally{await db.close();}
if(!mutation)for(const [name,[,marker]] of Object.entries(mutations)){
 const r=require('node:child_process').spawnSync(process.execPath,[__filename,'--mutation='+name],{encoding:'utf8',timeout:30000});
 assert.equal(r.status,1,'mutation must fail: '+name+'\n'+r.stdout+'\n'+r.stderr);assert.ok(r.stderr.includes(marker),'expected guard must catch mutation '+name+'\n'+r.stderr);
 console.log('PASS mutation killed: '+name+' ('+marker+')');
}
})().catch(e=>{console.error(e);process.exitCode=1;});
