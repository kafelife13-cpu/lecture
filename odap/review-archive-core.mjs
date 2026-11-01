// Teacher-prepared review material. Independent of the one-attempt OX test.
const fail=message=>{throw Error(message);};
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
function quizItem(q){
 if(!q||!text(q.text,25000)||!Array.isArray(q.choices)||q.choices.length!==5||q.choices.some(c=>!text(c,8000))||new Set(q.choices).size!==5||!text(q.explanation,15000)||typeof q.answer!=='string'||!/^([1-5]|all:[1-5](,[1-5]){1,4})$/.test(q.answer))fail('퀴즈의 문제·선택지·정답·해설을 확인하세요.');
 const answers=q.answer.replace(/^all:/,'').split(',');if(new Set(answers).size!==answers.length)fail('퀴즈 정답이 중복되었습니다.');
 const result={text:q.text,choices:q.choices.slice(),answer:q.answer,explanation:q.explanation};
 for(const key of ['passage','box','source','match'])if(q[key]!==undefined){if(typeof q[key]!=='string'||q[key].length>30000)fail('퀴즈 지문 형식을 확인하세요.');result[key]=q[key];}
 for(const key of ['underline','passage_underlines'])if(q[key]!==undefined){if(!Array.isArray(q[key])||q[key].length>100||q[key].some(s=>!text(s,1000)))fail('밑줄 표시를 확인하세요.');result[key]=q[key].slice();}
 if(q.table!==undefined){if(!Array.isArray(q.table)||!q.table.length||q.table.length>50||q.table.some(r=>!Array.isArray(r)||!r.length||r.length>10||r.some(c=>typeof c!=='string'||c.length>4000)))fail('퀴즈 표를 확인하세요.');result.table=q.table.map(r=>r.slice());}
 return result;
}
export function validateArchive(value){
 if(!value||value.schema!==1||!text(value.student_id,100)||!text(value.title,100)||!text(value.week_label,100)||!text(value.school,100))fail('학생·학교·자료 제목을 확인하세요.');
 const date=new Date(value.week_start+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value.week_start)||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value.week_start||date.getUTCDay()!==1)fail('주차 시작일은 월요일이어야 합니다.');
 if(!Array.isArray(value.files)||(!value.files.length&&!value.practice?.items)||value.files.length>3)fail('학생별 자료를 확인하세요.');
 const ids=new Set();
 const files=value.files.map(f=>{
  if(!f||!text(f.id,80)||!/^[a-zA-Z0-9_-]+$/.test(f.id)||ids.has(f.id)||!text(f.name,150)||!f.name.toLowerCase().endsWith('.pdf')||!text(f.data,4000000)||!/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(f.data))fail('PDF 파일 형식이 올바르지 않습니다.');
  ids.add(f.id);return {id:f.id,name:f.name,data:f.data};
 });
 if(!value.practice||!Number.isInteger(value.practice.count)||value.practice.count<1||value.practice.count>100||(!value.practice.items&&!ids.has(value.practice.file_id))||(value.practice.file_id&&!ids.has(value.practice.file_id)))fail('개별 보완 자료와 문항 수를 확인하세요.');
 const practice={count:value.practice.count,...(value.practice.file_id?{file_id:value.practice.file_id}:{})};
 if(value.practice.items!==undefined){if(!Array.isArray(value.practice.items)||value.practice.items.length!==value.practice.count)fail('퀴즈 문항 수가 일치하지 않습니다.');practice.items=value.practice.items.map(quizItem);}
 if(!Array.isArray(value.originals)||!value.originals.length||value.originals.length>200)fail('연결할 원래 오답이 필요합니다.');
 const seen=new Set();
 const originals=value.originals.map(q=>{
  if(!q||!text(q.exam_id,100)||!text(q.exam_name,150)||!text(String(q.num??''),30)||!text(q.text,25000)||!text(q.answer,100)||!text(q.my_answer,100)||typeof q.explanation!=='string'||q.explanation.length>15000)fail('원래 문제·당시 답·정답을 확인하세요.');
  const key=q.exam_id+':'+q.num;if(seen.has(key))fail('같은 원래 문제가 중복되었습니다.');seen.add(key);
  if(q.file_id&&(!ids.has(q.file_id)||!Number.isInteger(q.page)||q.page<1||q.page>500))fail('원본 PDF와 쪽수를 확인하세요.');
  const quiz=q.quiz?quizItem(q.quiz):null;if(quiz&&quiz.answer!==q.answer)fail('원래 문제와 퀴즈의 정답이 다릅니다.');
  return {exam_id:q.exam_id,exam_name:q.exam_name,num:q.num,text:q.text,answer:q.answer,my_answer:q.my_answer,explanation:q.explanation,...(q.file_id?{file_id:q.file_id,page:q.page}:{}),...(quiz?{quiz}:{})};
 });
 const packet={schema:1,student_id:value.student_id,school:value.school,title:value.title,week_start:value.week_start,week_label:value.week_label,originals,practice,files};
 if(new TextEncoder().encode(JSON.stringify(packet)).length>8*1024*1024)fail('학생별 자료는 8MB 이하로 줄여 주세요.');
 return packet;
}
export function studentArchive(packet){const {student_id,...body}=validateArchive(packet);return body;}
