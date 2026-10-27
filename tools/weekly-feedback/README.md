# 주간 개인 피드백 프로그램 v1

현재 범위: 로컬 선정/채점 엔진, 100명 배치, 인쇄 HTML, 가상 학생 웹 시험판. **국어왕 운영 앱에 아직 연결되지 않았다.** 실제 학생 자료를 이 디렉터리에 저장하지 않는다.

Node.js 24 이상. 추가 패키지 설치 불필요.

```powershell
node --test tests/weekly-feedback.cjs
node tools/weekly-feedback/batch.cjs --demo '..\build\synthetic-100'
node tools/weekly-feedback/demo-server.cjs '..\build\synthetic-web'
```

직접 브라우저에서 http://127.0.0.1:8787 로 접속하면 가상 문항 40개, 빈칸, 제출 후 정답/해설을 확인한다. 이 서버는 loopback 전용이며 실제 학생 인증 기능이 없다. 외부에 공개하지 않는다. 가상 제출은 주차별 파일에 보존되고 재제출 시 최초 결과가 반환된다. 학생 이름을 입력하는 기능은 없다.

실제 비공개 입력: `node tools/weekly-feedback/batch.cjs PRIVATE_INPUT.json PRIVATE_OUTPUT_DIRECTORY`. 결과는 학생 id 해시/주차/내용 해시 폴더 아래 packet.json, student.html, teacher.html, 배치 보고서다. 출력은 저장소 외부만 허용한다. 동일 입력 재실행은 동일 버전을 재사용하며 기존 파일을 덮어쓰지 않는다. 인쇄 HTML은 브라우저 PDF 출력용 중간 산출물이다. 실제 교재의 지문/옛한글/선택지 페이지 검수는 아직 필요하다.

입력 구조는 fixture.cjs 참조. `students`, `records`, `bank`, `reviewed_links`, `week_start`, `cutoff`, `core_concepts`, 선택적 `history`를 받는다. `week_start`는 월요일 YYYY-MM-DD, cutoff는 오프셋 포함 시각을 사용한다. records의 graded/correct는 실제 채점 결과여야 한다. student_id, school, grade, scope, week_start, channel, exam_id, question_index, response_id, submitted_at을 포함한다.

`adapter.cjs`는 기존 homeworkExportAll의 current_wrongs를 정규화한다. 교사가 `context.students`의 학교/학년/범위, `context.exams`의 주차/채널을 확인해야 한다. 누적 clinic.wrongs를 현재 오답으로 사용하지 않는다. 누락·충돌은 issues로 반환한다. 원문·정답·개념이 바뀌면 연결 fingerprint가 무효가 되어 재검수를 요구한다.

문항의 `evidence`에는 source_id/page/quote/approved/school/scope/kind/year를 둔다. kind는 school_print 또는 past_exam. 실제 유사문항은 origin_type=existing, 자작은 generated. 원문 연결은 origin(`exam_id:question_index`), question_id, role(similar/concept), reason, approved, origin_fingerprint가 필요하다. fingerprint는 `hash({text,answer,concepts})`이다.

부족분 없는 plan은 review, 부족하면 blocked. 교사 검수 후 approve를 호출한다. studentView는 정답/해설/출처/학생 id를 제거한다. grade/submit은 서버 전용이며 개인 packet.json은 학생에게 보내지 않는다. 운영 서버는 인증된 student_id로만 호출하고 `(student_id, week_start)`의 원자적 유일성을 보장해야 한다. 현재 demo-server는 가상 학생 1명만 검증한다.

`drafts.cjs`는 승인된 학교 프린트의 정확한 단어를 빈칸으로 바꾸고, 교사가 사실로 승인한 문장을 OX 초안으로 만든다. 모두 pending 상태다. 클리닉 변형용 AI 요청은 원문과 승인 근거만 포함하고 학생 메타데이터를 제외한다. 실제 AI 호출 및 반환 문항의 내용 검수는 연결 전이다.

AI API 호출, 비공개 Drive 업로드, 운영 인증/제출 DB 연결, 주간 예약은 아직 미구현이다. 검수된 문항만 조합하며 빈 수량을 임의 생성하여 채우지 않는다. 다음 구현은 docs/weekly-feedback-plan.md의 운영 연결 단계에 따른다.
