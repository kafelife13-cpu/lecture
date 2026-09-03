var classAttendancePin='',classAttendanceRun=0,classAttendanceBusy=false;
function initClassAttendance(){
  var date=document.getElementById('class-attendance-date'),sel=document.getElementById('class-attendance-filter');
  if(!date||!sel)return;
  if(!date.value)date.value=ClassAttendance.dateKey();
  if(!sel.options.length)sel.innerHTML='<option value="">모든 수업</option>'+ClassAttendance.classes.map(function(c){return '<option value="'+c.id+'">'+c.label+'</option>';}).join('');
  renderClassAttendance();
}
async function renderClassAttendance(){
  if(!session||session.role!=='teacher')return;
  var run=++classAttendanceRun,body=document.getElementById('class-attendance-body'),summary=document.getElementById('class-attendance-summary');
  var date=document.getElementById('class-attendance-date').value,filter=document.getElementById('class-attendance-filter').value;
  if(!date)return;
  body.innerHTML='<tr><td colspan="4">출결 확인 중…</td></tr>';
  try{
    if(!classAttendancePin){summary.innerHTML='<button class="btn btn-sm" onclick="unlockAttendance()">교사 PIN으로 출결 열기</button>';body.innerHTML='';return;}
    var result=await attendanceSb.rpc('teacher_read_attendance',{p_pin:classAttendancePin,p_kind:'class',p_start:date+'T00:00:00+09:00',p_end:date+'T23:59:59.999+09:00'});
    if(result.error)throw result.error;if(run!==classAttendanceRun)return;
    var students=activeStudents(),day=ClassAttendance.dayKey(date),unassigned=students.filter(function(s){return !ClassAttendance.find(s.group_id);}).length;
    var rows=students.map(function(s){return {student:s,cls:ClassAttendance.find(s.group_id)};}).filter(function(r){return r.cls&&r.cls.day===day&&(!filter||r.cls.id===filter);});
    rows.sort(function(a,b){return a.cls.start.localeCompare(b.cls.start)||a.student.name.localeCompare(b.student.name,'ko');});
    var count=0;
    body.innerHTML=rows.map(function(r){
      var rec=(result.data||[]).find(function(a){return ClassAttendance.matches(a,r.student.id,r.cls.id,date);});if(rec)count++;
      var status=ClassAttendance.status(rec,r.cls,date),future=date>ClassAttendance.dateKey();
      return '<tr><td data-label="학생">'+escHtml(r.student.name)+'</td><td data-label="수업">'+r.cls.label+'</td><td data-label="출결">'+dashStatusCell(status)+'</td><td data-label="처리"><button class="btn btn-sm'+(rec?'':' blue')+'" data-class-student="'+escHtml(r.student.id)+'" data-class-action="'+(rec?'cancel':'present')+'"'+(future?' disabled':'')+'>'+(rec?'출석 취소':'출석 처리')+'</button></td></tr>';
    }).join('')||'<tr><td colspan="4" style="padding:20px;color:var(--text2)">선택한 날짜에 해당하는 수업이 없습니다.</td></tr>';
    summary.textContent=date+' · '+count+' / '+rows.length+'명 출석'+(unassigned?' · 반 미배정 '+unassigned+'명 (학생 관리에서 배정)':'');
  }catch(e){if(run!==classAttendanceRun)return;if(String(e.message).includes('invalid teacher pin'))classAttendancePin='';summary.innerHTML='<button class="btn btn-sm" onclick="unlockAttendance()">교사 PIN 다시 입력</button>';body.innerHTML='<tr><td colspan="4">출결을 불러오지 못했습니다. 새로고침해 주세요.</td></tr>';}
}
async function editClassAttendance(studentId,action){
  if(classAttendanceBusy||!session||session.role!=='teacher')return;
  var student=activeStudents().find(function(s){return s.id===studentId;}),cls=student&&ClassAttendance.find(student.group_id),date=document.getElementById('class-attendance-date').value;
  if(!cls||ClassAttendance.dayKey(date)!==cls.day)return;
  if(!confirm(student.name+' · '+cls.label+'\n'+date+' '+(action==='cancel'?'출석을 취소할까요?':'출석 처리할까요?')))return;
  if(!classAttendancePin){classAttendancePin=prompt('출결프로그램의 교사 PIN을 입력하세요.')||'';if(!classAttendancePin)return;}
  classAttendanceBusy=true;
  try{
    var result=await attendanceSb.rpc('teacher_edit_class_attendance',{p_pin:classAttendancePin,p_action:action,p_student_id:student.id,p_student_name:student.name,p_class_id:cls.id,p_lesson_date:date});
    if(result.error)throw result.error;
    await renderClassAttendance();
  }catch(e){if(String(e.message).includes('invalid teacher pin')){classAttendancePin='';alert('교사 PIN이 맞지 않습니다.');}else alert('출결 저장 실패: '+e.message);}
  finally{classAttendanceBusy=false;}
}
function unlockAttendance(){
  if(!session||session.role!=='teacher')return;
  var box=document.getElementById('attendance-pin-dialog');
  if(!box){
    box=document.createElement('div');box.id='attendance-pin-dialog';
    box.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px';
    box.innerHTML='<form style="background:var(--card,#fff);color:var(--text,#111);padding:24px;border-radius:16px;width:100%;max-width:360px" onsubmit="event.preventDefault();submitAttendancePin()"><h3 style="margin-bottom:12px">교사 PIN으로 출결 열기</h3><label for="attendance-pin-input">출결프로그램 교사 PIN</label><input id="attendance-pin-input" class="form-input" type="password" inputmode="numeric" autocomplete="off" required style="margin:12px 0;font-size:22px"><div style="display:flex;gap:8px"><button type="button" class="btn" onclick="closeAttendancePin()">취소</button><button type="submit" class="btn blue">출결 열기</button></div></form>';
    document.body.appendChild(box);
  }
  document.getElementById('attendance-pin-input').focus();
}
function closeAttendancePin(){var box=document.getElementById('attendance-pin-dialog');if(box)box.remove();}
function submitAttendancePin(){
  var input=document.getElementById('attendance-pin-input');
  if(!input||!input.value.trim())return;
  classAttendancePin=input.value.trim();input.value='';closeAttendancePin();
  renderClassAttendance();if(typeof dashLoadAttendance==='function')dashLoadAttendance(dashPerformanceRun);
}
function renderStudentClassAttendance(){
 var box=document.getElementById('home-class-attendance');if(!box||!session||session.role!=='student')return;
 var student=(db.users||[]).find(function(s){return s.id===session.id;})||session,cls=ClassAttendance.find(student.group_id);
 box.innerHTML='<div class="card-head"><h3>🏫 내 수업 시간</h3></div><div class="card-body">'+(cls?cls.label:'반 배정을 선생님께 확인해 주세요.')+'</div>';
}
document.addEventListener('click',function(e){var b=e.target.closest('[data-class-student]');if(b)editClassAttendance(b.dataset.classStudent,b.dataset.classAction);});
setInterval(function(){if(document.hidden)return;var panel=document.querySelector('#page-teacher #panel-dashboard');if(session&&session.role==='teacher'&&panel&&panel.classList.contains('active')&&!classAttendanceBusy)initClassAttendance();},10000);
