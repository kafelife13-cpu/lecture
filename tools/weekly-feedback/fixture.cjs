'use strict';
const {hash}=require('./engine.cjs');
function fixture(count=100){
 const scope={school:'가상학교',grade:'1',scope:'가상 범위'},students=Array.from({length:count},(_,i)=>({id:`synthetic-${i+1}`,...scope}));
 const base={...scope,week_start:'2026-10-26',channel:'clinic',exam_id:'synthetic-exam',graded:true,correct:false,concepts:['가상개념'],text:'가상 원문',answer:'1',submitted_at:'2026-10-27T01:00:00Z'};
 const records=students.flatMap(s=>Array.from({length:12},(_,i)=>({...base,student_id:s.id,response_id:`r-${s.id}-${i}`,question_index:i,text:`가상 원문 ${i}`})));
 const evidence=[{approved:true,source_id:'synthetic-print',page:1,quote:'검사용 가상 인용문',kind:'school_print',...scope},{approved:true,source_id:'synthetic-exam-2025',page:1,quote:'검사용 가상 기출 인용문',kind:'past_exam',year:2025,...scope}];
 const bank=Array.from({length:24},(_,i)=>({id:`m${i}`,...scope,kind:'mcq',text:`가상 객관식 ${i}`,choices:['가상 선택지 1','가상 선택지 2','가상 선택지 3','가상 선택지 4','가상 선택지 5'],answer:'1',explanation:'가상 검증용 해설',concepts:['가상개념'],status:'approved',origin_type:'existing',core:true,evidence}));
 bank.push(...Array.from({length:20},(_,i)=>({id:`o${i}`,...scope,kind:'ox',text:`가상 OX ${i}`,answer:i%2?'X':'O',explanation:'가상 검증용 해설',concepts:['가상개념'],status:'approved',origin_type:'generated',evidence})));
 bank.push({id:'b1',...scope,kind:'blank',text:'가상 개념은 ____이다.',accepted:['가상'],explanation:'가상 빈칸 해설',concepts:['가상개념'],status:'approved',evidence});
 const reviewed_links=Array.from({length:12},(_,i)=>['similar','concept'].map((role,j)=>({origin:`synthetic-exam:${i}`,role,question_id:`m${i*2+j}`,approved:true,reason:'가상 연결 검수',origin_fingerprint:hash({text:`가상 원문 ${i}`,answer:'1',concepts:['가상개념']})}))).flat();
 return {students,records,bank,reviewed_links,week_start:'2026-10-26',cutoff:'2026-10-28T00:00:00Z',core_concepts:['가상개념']};
}
module.exports={fixture};
