// Keep the original exam and its submissions intact; only complete sets replace it in the input list.
function homeworkSplitSourceIds(exams){
  const sources=new Set();
  for(const source of exams){
    if(source.category!=='homework')continue;
    const parts=exams.filter(e=>e.category==='homework'&&e.questions?.[0]?.homework_split?.source_id===source.id);
    const count=Math.ceil(Number(source.total_q)/50);
    if(count<2||parts.length!==count)continue;
    if(Array.from({length:count},(_,i)=>i).every(i=>parts.some(e=>{
      const meta=e.questions[0].homework_split;
      const size=Math.min(50,source.total_q-i*50);
      return meta.part===i&&meta.parts===count&&e.total_q===size&&e.questions.length===size;
    })))sources.add(source.id);
  }
  return sources;
}

async function homeworkSplitRows(source){
  if(source.category!=='homework'||!Array.isArray(source.questions)||source.questions.length!==Number(source.total_q)||source.total_q<=50||source.questions[0]?.homework_split){
    throw new Error('50문항을 초과하는 원본 과제만 분할할 수 있어요.');
  }
  const parts=Math.ceil(source.total_q/50),rows=[];
  const title=source.name.replace(/\s*\(\d+문항\)\s*$/,'');
  for(let part=0;part<parts;part++){
    const start=part*50;
    const questions=source.questions.slice(start,start+50).map((q,i)=>({...q,num:q.num||start+i+1}));
    questions[0].homework_split={source_id:source.id,part,parts};
    // Deterministic IDs make retries and simultaneous clicks safe without touching existing children.
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('homework-split-v1:'+source.id+':'+part)));
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
    const id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
    rows.push({...source,id,name:title+' ('+questions[0].num+'~'+questions.at(-1).num+'번 · '+questions.length+'문항)',
      total_q:questions.length,questions,
      created_at:new Date(new Date(source.created_at).getTime()+parts-part).toISOString()});
  }
  return rows;
}

var homeworkSplitBusy=false;
async function splitHomeworkExam(examId){
  if(homeworkSplitBusy)return;
  homeworkSplitBusy=true;
  try{
    const {data:source,error}=await sb.from('exams').select('*').eq('id',examId).single();
    if(error||!source)throw new Error(error?.message||'과제를 불러오지 못했어요.');
    const rows=await homeworkSplitRows(source);
    if(!confirm(rows.map(e=>e.name).join('\n')+'\n\n각 묶음을 따로 입력하도록 나눌까요? 원본과 기존 제출 기록은 보존됩니다.'))return;
    // One database statement: either all parts are stored or none are. Never overwrite an edited part on retry.
    const saved=await sb.from('exams').upsert(rows,{onConflict:'id',ignoreDuplicates:true});
    if(saved.error)throw saved.error;
    const check=await sb.from('exams').select('*').in('id',rows.map(e=>e.id));
    if(check.error||!homeworkSplitSourceIds([source,...(check.data||[])]).has(source.id))throw new Error('분할 저장 상태를 확인하지 못했어요. 목록을 새로 확인해 주세요.');
    await renderTExam();
    alert('분할 저장 완료! 각 묶음에서 전체 답안 또는 틀린 문제만 따로 입력할 수 있어요.');
  }catch(e){alert('과제 분할 오류: '+e.message);}
  finally{homeworkSplitBusy=false;}
}
