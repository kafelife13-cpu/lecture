// Import only question array literals from the supplied public bundle.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.argv[2],'utf8'),questions=[];
for(const match of source.matchAll(/[\w$]+=\[\{id:/g)){
 const start=match.index+match[0].indexOf('[');let depth=0,quote='',escape=false,end=start;
 for(;end<source.length;end++){
  const c=source[end];
  if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}
  if('"\'`'.includes(c)){quote=c;continue;}
  if(c==='[')depth++;if(c===']'&&!--depth)break;
 }
 const literal=source.slice(start,end+1);
 const rows=vm.runInNewContext('('+literal+')',Object.create(null),{timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});
 if(rows[0]?.prompt)questions.push(...rows);
}
const counts={};for(const q of questions){const k=q.era+'/'+q.topic+'/'+q.source?.kind;counts[k]=(counts[k]||0)+1;}
console.log(JSON.stringify({total:questions.length,distribution:counts},null,2));
assert.equal(questions.length,360,'Unexpected question count; stop import');
assert.equal(new Set(questions.map(q=>q.id)).size,360,'Duplicate IDs');
assert.deepEqual(counts,{'modern/parts/authored':50,'modern/spelling/authored':100,'modern/phonology/education':30,'modern/words/education':30,'modern/parts/education':30,'modern/sentences/education':30,'modern/expression/education':30,'modern/spelling/education':30,'medieval/medieval/education':30});
const clean=questions.map(q=>{
 const {source,...row}=q;
 row.src=source.kind==='authored'?'자체 창작':`${source.year} ${source.month}월 전국연합 ${String(source.grade).startsWith('고')?source.grade:'고'+source.grade}`;
 const urls=String(source.title||'').match(/https?:\/\/[^\s|]+/g)||[];
 if(urls.length)row.basis=urls.map(url=>({name:String(source.title).split('|')[0].trim(),where:'',url}));
 if(row.passage){row.passage=row.passage.split('\n').filter(line=>!line.includes('원문 판단 조건:')).join('\n').trim();if(!row.passage)delete row.passage;}
 row.level=require('../grammar-daily.js').levelFor(row);
 return row;
});
fs.writeFileSync(process.argv[3]||'grammar-ox-data.js',"(function(r){const Q="+JSON.stringify(clean,null,2)+";if(typeof module!=='undefined')module.exports=Q;else r.GRAMMAR_OX=Q;})(typeof window==='undefined'?globalThis:window);\n");
