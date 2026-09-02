(function(root){
  'use strict';
  var classes=[
    {id:'hanbaek_wed_1800',label:'한백 수요일 18:00–21:00',day:'wed',start:'18:00',end:'21:00',kind:'wednesday'},
    {id:'hanbaek_sat_1030',label:'한백 토요일 10:30–13:30',day:'sat',start:'10:30',end:'13:30',kind:'weekend'},
    {id:'hanbaek_sat_1430',label:'한백 토요일 14:30–17:30',day:'sat',start:'14:30',end:'17:30',kind:'weekend'},
    {id:'chidong_sat_1800',label:'치동 토요일 18:00–21:00',day:'sat',start:'18:00',end:'21:00',kind:'weekend'},
    {id:'hanbaek_sun_1030',label:'한백 일요일 10:30–13:30',day:'sun',start:'10:30',end:'13:30',kind:'weekend'},
    {id:'chidong_sun_1430',label:'치동 일요일 14:30–17:30',day:'sun',start:'14:30',end:'17:30',kind:'weekend'}
  ];
  function dateKey(value){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value||Date.now()));}
  function dayKey(date){return ['sun','mon','tue','wed','thu','fri','sat'][new Date(date+'T12:00:00+09:00').getUTCDay()];}
  function find(id){return classes.find(function(c){return c.id===id;})||null;}
  function matches(row,studentId,classId,date){return !!row&&!row.cancelled_at&&row.student_id===studentId&&row.class_id===classId&&row.lesson_date===date;}
  function status(record,cls,date,now){
    if(record)return {state:'ok',label:'출석',detail:new Date(record.checked_in_at).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})};
    if(!cls)return {state:'na',label:'반 미배정',detail:''};
    if(dayKey(date)!==cls.day)return {state:'na',label:'수업 없음',detail:cls.label};
    return new Date(now||Date.now())<new Date(date+'T'+cls.start+':00+09:00')?{state:'na',label:'예정',detail:cls.label}:{state:'miss',label:'미출석',detail:cls.label};
  }
  var api={classes:classes,dateKey:dateKey,dayKey:dayKey,find:find,matches:matches,status:status};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ClassAttendance=api;
})(typeof window==='object'?window:this);
