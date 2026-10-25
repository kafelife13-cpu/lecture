// Read a locally reviewed draft. Protected text and SQL stay outside this repository.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [input,outdir]=process.argv.slice(2);if(!input||!outdir)throw Error('Usage: node tools/prepare-hanbaek-ox.cjs PRIVATE_DRAFT PRIVATE_OUTPUT_DIRECTORY');
const repo=path.resolve(__dirname,'..'),out=path.resolve(outdir),rel=path.relative(repo,out);
if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw Error('Output must be outside repository');
const R=require('../grammar-review.js'),draft=JSON.parse(fs.readFileSync(input,'utf8'));
const normalize=s=>s.normalize('NFKC').replace(/[\s‘’“”'"「」]/g,'');
const seen=new Set([...require('../grammar-ox-data.js'),...require('../grammar-ox-data-kimhayan.js')].map(q=>normalize(q.prompt))),ids=new Set(),duplicates=[];
const forbidden=/왓칭|마더텅|mother|워크북|날개달기|gym|트레이닝/i;
const accepted=[];for(const q of draft){
 assert.ok(/^hb-[a-z]+-\d{3}$/.test(q.id)&&!ids.has(q.id),'unique stable id');ids.add(q.id);
 assert.ok(q.prompt&&q.explanation&&q.from&&q.basis?.length&&q.choiceExplanations?.length===2);
 assert.ok([0,1].includes(q.answer)&&Number.isInteger(q.page)&&q.page>=1&&q.page<=37);
 assert.ok([1,2,3,4].includes(q.level)&&q.topic==='expression'&&q.tags.length===1&&R.elementNames.includes(q.tags[0]));
 assert.ok(['public','protected'].includes(q.source_kind));
 if(q.source_kind==='public')assert.ok(!forbidden.test(q.from+' '+JSON.stringify(q.basis)),'commercial source marked public: '+q.id);
 const key=normalize(q.prompt);if(seen.has(key)){duplicates.push(q.id);continue;}seen.add(key);accepted.push(q);
}
const publicRows=accepted.filter(q=>q.source_kind==='public'),protectedRows=accepted.filter(q=>q.source_kind==='protected');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'grammar-ox-data-hanbaek.js'),"(function(r){const Q="+JSON.stringify(publicRows,null,2)+";if(typeof module!=='undefined')module.exports=Q;else r.GRAMMAR_OX_HANBAEK=Q;})(typeof window==='undefined'?globalThis:window);\n");
fs.writeFileSync(path.join(out,'hanbaek-protected.json'),JSON.stringify(protectedRows,null,2));
const quote=v=>"'"+String(v).replace(/'/g,"''")+"'";
const values=accepted.map(q=>'('+[quote(q.id),q.level,quote(q.topic),'array['+q.tags.map(quote).join(',')+']::text[]',quote(JSON.stringify(q))+'::jsonb',quote(q.source_kind),quote(q.from)].join(',')+')');
fs.writeFileSync(path.join(out,'hanbaek-seed.sql'),'begin;\ninsert into public.grammar_ox_bank(id,level,topic,tags,data,source_kind,source_title) values\n'+values.join(',\n')+'\non conflict(id) do update set level=excluded.level,topic=excluded.topic,tags=excluded.tags,data=excluded.data,source_kind=excluded.source_kind,source_title=excluded.source_title;\ncommit;\n');
const count=key=>accepted.reduce((a,q)=>(a[q[key]]=(a[q[key]]||0)+1,a),{});
const report={draft:draft.length,accepted:accepted.length,public:publicRows.length,protected:protectedRows.length,duplicates,levels:count('level'),tags:count('tags'),pending:'Not deployed; content review and production RPC verification remain.'};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
// Deterministic pseudo-random sample makes independent content review reproducible.
const crypto=require('node:crypto'),sample=accepted.slice().sort((a,b)=>crypto.createHash('sha256').update(a.id).digest('hex').localeCompare(crypto.createHash('sha256').update(b.id).digest('hex'))).slice(0,30);
fs.writeFileSync(path.join(out,'review-sample.json'),JSON.stringify(sample,null,2));console.log(JSON.stringify(report));
