const fs=require('node:fs'),R=require('../grammar-review.js'),D=require('../grammar-daily.js');
const files=['grammar-ox-data.js','grammar-ox-data-kimhayan.js'];
const all=[];for(const file of files){const Q=require('../'+file);Q.forEach(q=>q.level=D.levelFor(q));const global=file.includes('kimhayan')?'GRAMMAR_OX_KIMHAYAN':'GRAMMAR_OX';fs.writeFileSync(file,"(function(r){const Q="+JSON.stringify(Q,null,2)+";if(typeof module!=='undefined')module.exports=Q;else r."+global+"=Q;})(typeof window==='undefined'?globalThis:window);\n");all.push(...Q);}
// Public source only. Never put commercial textbook content in this seed or repo.
if(all.some(q=>/왓칭|마더텅|mother|워크북|날개달기|gym_teacher|트레이닝짐/i.test(q.src)))throw Error('Protected source in public seed');
const quote=v=>"'"+String(v).replace(/'/g,"''")+"'";
const rows=R.mergeBanks(all.filter(q=>R.bank(q)==='seoro'),all.filter(q=>R.bank(q)==='kimhayan')).map(q=>'('+[quote(q.id),q.level,quote(q.topic),'array['+R.grammarElementTags(q).map(quote).join(',')+']::text[]',quote(JSON.stringify(q))+'::jsonb',"'public'",quote(q.src)].join(',')+')');
fs.writeFileSync(process.argv[2],"begin;\ninsert into public.grammar_ox_bank(id,level,topic,tags,data,source_kind,source_title) values\n"+rows.join(',\n')+"\non conflict(id) do update set level=excluded.level,tags=excluded.tags,data=excluded.data,source_title=excluded.source_title where grammar_ox_bank.source_kind='public';\ncommit;\n");
console.log('Public levels',all.reduce((a,q)=>(a[q.level]=(a[q.level]||0)+1,a),{}));
