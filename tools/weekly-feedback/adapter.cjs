'use strict';
// The export must contain teacher-verified scope and graded outcomes.
// Never infer current correctness from the cumulative clinic wrongs list.
function fromHomeworkExport(data,context){
 if(!Array.isArray(data.records)||!Array.isArray(data.students))throw Error('Expected homeworkExportAll JSON');
 const records=[],issues=[];
 for(const row of data.records){
  const b=row.body||{},student=data.students.find(s=>s.id===row.student_id),scope=context.students[row.student_id];
  if(!student||!scope){issues.push({student_id:row.student_id,reason:'학교/학년/주차 범위 지정 필요'});continue;}
  for(const w of b.current_wrongs||[]){
   const meta=context.exams[w.exam_id];
   if(!meta||!['homework','clinic'].includes(meta.channel)){issues.push({student_id:row.student_id,exam_id:w.exam_id,reason:'시험의 주차·채널 지정 필요'});continue;}
   if(w.answer_key_conflict||!w.response_id||!w.attempts?.[0]?.date){issues.push({student_id:row.student_id,exam_id:w.exam_id,reason:'정답 충돌 또는 응시 근거 누락'});continue;}
   records.push({...w,...scope,...meta,student_id:row.student_id,submitted_at:w.attempts[0].date,graded:true,correct:false});
  }
 }
 return {students:data.students.filter(s=>context.students[s.id]).map(s=>({id:s.id,...context.students[s.id]})),records,issues,notice:'current_wrongs snapshot only; refresh export before each batch'};
}
module.exports={fromHomeworkExport};
