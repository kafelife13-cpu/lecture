# 오답연구소 서버 설치

기존 `users`, `exams`, `exam_responses`, `qa_schools`, `authenticate_user`를 사용합니다. 학생 계정을 복제하지 않습니다. 학생 제출 저장 함수가 먼저 설치되어야 새 클라이언트가 동작합니다.

1. 운영 DB 백업과 실제 스키마·고유 제약을 확인합니다.
2. `migration.sql`, `identity-save.sql`, `storage-and-schedule.sql`, `linked-data.sql`, `fast-sync.sql`, `fast-search.sql` 순서로 적용합니다.
3. `odap-assets.ts`를 `odap-assets` Edge Function으로 배포합니다. Gateway JWT 검사는 유지하고 내부 `odap_rpc`에서 기존 계정을 매 요청 인증합니다. 서비스 키는 함수 환경 변수에만 보관합니다.
4. 비공개 문제은행과 원본을 이관하고 수량·원본 해시를 확인합니다. 문제·답안·학생 정보는 이 공개 저장소에 올리지 않습니다.
5. 교사 인증과 학생별 공개 자료 격리, Storage 접근을 확인한 뒤 웹 변경을 배포합니다.

문항은 검수 후 자료에 포함하며 자료 승인 후 해당 학생에게만 공개합니다. 예약 생성은 한국 시간 04:00에 실행하되 관리 화면의 자동 생성 설정이 켜져 있을 때만 동작합니다. 검수 명제가 부족하면 중복 문제로 채우지 않습니다.

한글 제작은 Windows의 별도 작업자가 `worker_claim` / `worker_finish`로 연결합니다. 제작 PC가 꺼져 있으면 작업은 대기합니다. 브라우저 인쇄와 PDF 저장은 별도로 가능합니다.

기존 이름 기준 고유 제약은 유지됩니다. 동명이인이 같은 시험에 제출할 때 기록을 덮어쓰지 않고 오류를 반환합니다. 구형 클라이언트 사용과 실제 제약을 확인한 뒤 ID 기준 고유 제약으로 전환해야 두 학생의 동시 제출을 지원합니다.

현재 규칙 OX는 참 명제(O), 빈칸은 명제 내 지정어를 사용합니다. AI 객관식 변형은 기존 Claude 함수를 이용합니다. 핵심명제 정규화 중복 검사이며 서로 다른 표현의 의미 유사도 모델은 아닙니다. 모든 생성 결과는 교사 승인 대기 상태입니다.

검증: `node scripts/check-odap.cjs`; `npm install --no-save --ignore-scripts @electric-sql/pglite@0.5.8` 후 `node scripts/check-odap-db.cjs`. 합성 학생으로 인증·소유권·승인·중복·재응시 이력과 RLS를 확인하며 운영 데이터는 변경하지 않습니다.
