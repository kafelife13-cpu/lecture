'use strict';
const fs=require('node:fs'),path=require('node:path');
const {plan,hash}=require('./engine.cjs');const {render}=require('./print.cjs');
function batch(input,output){
 if(!Array.isArray(input.students)||new Set(input.students.map(s=>s.id)).size!==input.students.length)throw Error('Unique students required');
 const report=[];fs.mkdirSync(output,{recursive:true});
 for(const student of input.students){
  try{
   const packet=plan({...input,student}),dir=path.join(output,hash(student.id).slice(0,20),packet.week_start,packet.id);
   fs.mkdirSync(dir,{recursive:true});
   for(const [name,content] of [['packet.json',JSON.stringify(packet,null,2)],['student.html',render(packet)],['teacher.html',render(packet,true)]]){
    const file=path.join(dir,name);if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==content)throw Error('Existing version differs; not overwritten');}else fs.writeFileSync(file,content,{flag:'wx'});
   }
   report.push({student_id:student.id,packet_id:packet.id,status:packet.status,counts:packet.counts,missing:packet.missing,directory:dir});
  }catch(e){report.push({student_id:student.id,status:'failed',error:e.message});}
 }
 const file=path.join(output,`batch-${hash(report).slice(0,20)}.json`);if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(report,null,2),{flag:'wx'});
 return report;
}
if(require.main===module){
 const [source,output]=process.argv.slice(2);if(!source||!output)throw Error('node batch.cjs input.json PRIVATE_OUTPUT_DIRECTORY (or --demo)');
 const data=source==='--demo'?require('./fixture.cjs').fixture():JSON.parse(fs.readFileSync(source,'utf8'));
 const resolved=path.resolve(output),repo=path.resolve(__dirname,'../..');if(resolved===repo||resolved.startsWith(repo+path.sep))throw Error('Output must be outside public repository');
 const report=batch(data,resolved);console.log(JSON.stringify({students:report.length,review:report.filter(r=>r.status==='review').length,blocked:report.filter(r=>r.status==='blocked').length,failed:report.filter(r=>r.status==='failed').length}));
 if(report.some(r=>r.status==='failed'))process.exitCode=1;
}
module.exports={batch};
