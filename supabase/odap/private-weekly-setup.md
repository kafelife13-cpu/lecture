# 개인 주간 자료 · Claude 자동 검수 설치 및 운영 계약

이 문서는 코드의 동작과 배포 요건을 설명한다. 파일 변경만으로 운영 서버 적용이나 오늘 클리닉 입력 후 자동 실행이 완료된 것은 아니다. 실제 배포·실제 계정 검증 결과는 별도 작업 기록으로 확인한다.

## 제공 방식

- 교사용: 실제 출처에서 고른 객관식 20문항을 Claude가 검수한다. 통과한 자료는 문제지와 별도 정답·해설지로 인쇄한다. 객관식을 학생 API에 보내지 않는다.
- 학생용: 학교 프린트와 작년 기출 근거로 자작 OX 20문항을 생성한다. 생성 호출과 별개의 Claude 검수 호출을 거쳐 통과한 경우에만 학생 앱에 게시한다. 학생은 주차별로 한 번 제출하고 서버가 채점한다.
- 교사 수동 검수 체크박스는 사용하지 않는다. 다만 근거 부족, 정답 불일치, 모호한 문항, 응답 누락, Claude/Drive 장애가 있으면 게시를 보류한다. AI 검수 통과는 무오류 보증이 아니다.
- 객관식 유사문제는 실제 기출·문제은행 원문을 유지한다. `generate_ox`는 객관식을 새로 만들거나 바꾸지 않는다.

## 설치 대상과 설정

1. `supabase/odap/private-weekly.sql`: 기존 `users`, `authenticate_user` 이후 적용한다. 기존 40답안 제출은 보관하고 신규 학생 제출은 OX 20답안만 허용한다.
2. `supabase/functions/odap-private-weekly/index.ts`: 함수 이름 `odap-private-weekly`. `odap/private-weekly-core.mjs`, `odap/private-weekly-review.mjs`를 함께 번들한다.
3. `supabase/functions/odap-private-weekly/drive-gateway.gs`: 별도 Apps Script 프로젝트에 설치한다. 기존 원본 폴더 대신 전용 비공개 폴더를 쓴다.
4. Script Properties: `PRIVATE_FOLDER_ID`, 무작위 32자 이상 `HMAC_SECRET`. 폴더와 파일은 링크 공개 및 추가 편집자·뷰어 없이 비공개여야 한다.
5. Edge secrets: `ODAP_PRIVATE_DRIVE_URL` (`https://script.google.com/macros/s/.../exec`), `ODAP_PRIVATE_DRIVE_SECRET` (HMAC과 동일), `ANTHROPIC_API_KEY`. 필요 시 `ODAP_CLAUDE_MODEL`을 실제 계정에서 지원하는 모델 ID로 설정한다. 기본 모델과 API 호출 성공 여부는 실제 배포 검증에 포함한다.
6. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 서버 기본 환경에서만 사용한다. 기존 공개 키로 함수에 진입할 수 있어도 각 요청의 기존 국어왕 ID/비밀번호를 `authenticate_user`로 검증한다. 서비스 키를 브라우저에 넣거나 인증 코드를 제거하지 않는다.

Google OAuth 권한 범위는 Drive 전체 파일 접근이지만 저장 서버 코드는 지정 폴더 안의 파일만 취급한다. 웹앱 주소는 외부 호출 가능하며 HMAC 서명·만료·파일 경계 검증을 통과해야 작업한다. Apps Script ContentService의 Google 응답 리다이렉트에는 GET만 보내며 서명 본문을 전달하지 않는다.

비밀번호·HMAC·서비스 키는 코드/GitHub/문서/채팅에 저장하지 않는다. Claude 요청에는 학생 이름·ID·비밀번호·학생 답안을 넣지 않는다. 검수 대상 문항·원문 이미지·출처 인용문만 전달한다. 자동 생성·검수는 유료 Claude API 사용량을 발생시킨다.

## 교사 화면 흐름

1. 학생과 주차를 선택하고 출처가 포함된 40문항 JSON을 불러온다.
2. **저장 · OX 자동 생성 · Claude 검수**를 누르면 `create/revise → generate_ox → review_publish → open` 순서로 실행한다.
3. 서버가 모든 문항의 검수를 통과시키면 OX만 자동 게시하고 객관식 인쇄 버튼을 켠다. 교사 확인이나 별도 게시 클릭은 필요 없다.
4. 생성 없이 현재 문항만 검수하려면 저장된 초안을 불러와 **현재 문항 Claude 검수 · OX 게시**를 사용한다. 필요하면 **OX 다시 생성 · Claude 검수**를 사용한다.
5. 저장된 모든 상태의 자료를 다시 열 수 있다. 통신 응답이 유실되면 서버 `open` 결과로 완료 여부를 복구한다. 실패한 검수를 통과했다고 표시하지 않는다.
6. Claude 통과 원본의 **객관식 문제지 인쇄**에는 객관식 20문항과 답란만 포함한다. **객관식 정답·해설 인쇄**는 별도 20문항 답과 해설이다. 인쇄 창에서 PDF 저장도 가능하다. OX는 두 인쇄물에 섞지 않는다.

이 화면의 버튼 실행과 **오늘 클리닉 답안 입력 이벤트가 서버 작업을 자동 예약하는 것**은 별도 기능이다. 이벤트 연결·작업 큐·실행 주기·재시도·중복 방지를 실제 설치하고 검증하기 전에는 “학생 입력만 하면 자동 생성된다”고 안내하지 않는다. 100명 일괄 자동 실행 또한 별도 운영 검증 대상이다.

## API 계약

POST Edge JSON: `{credentials:{id,pw,role},action,payload}`.

- `list`: 학생은 본인 게시 자료만, 교사는 모든 상태를 조회한다. 교사는 `payload.student_id` 필터 사용 가능. 학생 목록은 객관식 제목/점수 등 상세를 노출하지 않는다.
- `create` (교사): `{student_id,school,week_start,packet}`. 월요일 기준 주차. 서버가 클라이언트의 `packet.review`를 제거하고 문항 `reviewed`를 false로 초기화한 뒤 draft를 저장한다.
- `revise` (교사): `{id,packet}`. draft만 새 비공개 파일로 교체한다. 학생·학교·주차는 변경하지 못하며 이전 해시로 동시 수정 충돌을 차단한다.
- `generate_ox` (교사): `{id}`. 저장된 draft의 같은 학교 프린트와 전년도 기출 인용 근거로 OX 20개를 생성한다. 원본 객관식은 유지하고 결과는 draft로 저장한다. 이 호출만으로 게시하지 않는다.
- `review_publish` (교사): `{id}`. 저장된 문항을 별개 Claude 호출로 검수한다. 정확히 모든 문항에 대한 통과 응답, 정답 일치, 근거 충족을 확인하고 검수 기록을 Drive에 저장한 뒤 승인·게시한다. 클라이언트의 검수 주장으로 우회할 수 없다. 이미 Claude가 통과시킨 approved/published 자료는 유실된 응답을 복구할 수 있다. Claude 기록이 없는 기존 교사 승인 자료는 자동 게시하지 않는다.
- 기존 브라우저 `approve`, `publish`: 서버가 거부한다. 내부 서비스 전용 SQL 단계로만 사용한다.
- `open`: `{id}` → `{id,week_start,status,packet,attempt}`. 교사는 전체 검수본, 학생은 OX 20문항만 받는다. 학생 본문에는 정답·해설·근거·Claude 기록이 없다. 제출 이후 본인 OX 결과만 공개한다. 과거 40답안 기록도 OX 결과만 투영한다.
- `submit` (학생): `{id,answers:{OX문항ID:'O'|'X'}}`. 정확히 OX 20개가 필요하다. 서버 계산 `{submitted_at,correct,total:20,score,results}`. 객관식 답안·추가 키·클라이언트 점수는 허용하지 않거나 사용하지 않는다.

packet: `{schema:1,title,items,review?}`. 정상 교사용 묶음은 객관식 20개+OX 20개이며 공통 검증기는 OX 전용 20개도 처리한다. 교사 JSON 불러오기 화면은 인쇄 자료와 함께 쓰는 40문항 형식이다. 각 문항: `id,type,text,passage?,choices?(객관식5개),answer,explanation,reviewed,evidence,images?`.

images: PNG/JPEG data URI만 허용. 문항당 최대 4개, 이미지 문자열당 150만자 이하. SVG/외부 URL은 거부. Drive 본문 최대8MB, HTTP JSON 최대12MB.

근거: `[{source_id,page,quote,approved:true,kind,school,year,...}]`. 학교 자료와 OX는 배정 학교가 일치해야 하고, 전체 OX 근거에는 학교 프린트와 주차 연도-1의 학교/내신 기출이 있어야 한다. 복원본은 원본 기출로 가장하지 않는다. 출처에 붙은 `approved` 표시는 인용을 사용하는 자격 표시이며, 파일 전체를 Claude가 다시 읽었다거나 원본성을 검증했다는 뜻이 아니다. 검수 기록의 범위는 제공된 인용문과 이미지다. 원문 근거가 부족하면 자동화를 통과시키려고 근거를 지어내지 않는다.

## 저장 및 실패 처리

본문·정답·해설·이미지·Claude 검수 기록은 비공개 Drive에 저장한다. Supabase에는 학생/주차/상태/파일ID/해시와 작은 OX 제출·집계만 둔다. 무료 DB에 큰 생성 본문을 넣지 않는다. 학생 소유권 확인 후 Drive를 읽고 해시가 다르면 출제·채점을 거부한다.

학생/주차 UNIQUE 및 제출 PK와 행 잠금으로 중복 제출을 막는다. 파일 저장 후 DB 변경이 실패하면 미참조 비공개 파일이 남을 수 있으며 자동 삭제하지 않는다. Claude 오류나 검수 탈락은 학생에게 게시하지 않는다. 게시된 주차의 수정·취소는 현재 범위에서 지원하지 않는다. 기존 수동 승인본은 Claude 검수본으로 자동 간주하지 않으며 인쇄 통과 표시도 켜지지 않는다.

## 검증 및 운영 확인

- `node scripts/check-odap-private-weekly.cjs`: 합성 계정으로 SQL/Edge·소유권·OX20 채점·중복 제출·파일 변조·서비스 전용 RPC 검사. PGlite 설치 필요.
- `node scripts/check-odap-private-weekly-ui.cjs`: 학생 OX 전용 화면·정답 비공개·결과 복구.
- `node scripts/check-private-weekly-teacher.cjs`: 생성→검수→게시 연결, 대상 스냅샷과 동시 클릭 방지, 실패 시 게시/인쇄 보류, 위조 검수 기록 제거, 객관식 문제지와 정답·해설 분리.
- Claude 검수 모듈·실제 Edge 모의 호출 검사는 함께 추가된 review 검사 스크립트를 실행한다. 합성 응답 테스트는 실제 Claude 품질 검수 또는 실제 계정 성공을 뜻하지 않는다.

운영 확인은 실제 지원 모델 응답, 서명된 Drive 왕복, 검수 통과/탈락, 학생 본인 OX20 응시와 타인 접근 거부, 정답 공개 시점, 객관식 인쇄 결과를 포함한다. 실제 학생의 주1회 제출을 검증 명목으로 소모하지 않는다. Google 할당량·Edge 실행 시간·Claude 비용과 100명 실행은 별도 확인한다.

## 클리닉 입력 자동 작업 서버(추가 설치)

자동 실행 코드는 다음 두 파일이다. 운영 적용과 예약 호출을 확인하기 전에는 활성화됐다고 표시하지 않는다.

- `supabase/odap/private-weekly-auto.sql`: 기존 주간 SQL 다음에 적용. `exam_responses`의 이번 주 클리닉 신규 답안/답안 변경을 감지하여 학생·주차별 큐를 만든다. 과거 답안은 소급 등록하지 않는다. 입력 후 120초 유예를 두고, 입력이 바뀌면 진행 중 임대를 무효화하여 오래된 자료가 게시되지 않게 한다.
- `supabase/functions/odap-weekly-worker/index.ts`: 교사 브라우저와 독립된 예약 호출용 Edge 함수. 매 요청 한 작업 단계만 처리한다. `ODAP_WEEKLY_WORKER_SECRET`을 32자 이상 임의 값으로 서버에 보관하고 요청의 `x-weekly-worker-secret`으로 인증한다. 공개 브라우저에 이 값을 넣지 않는다. 실제 cron 설정과 함수 호출은 별도로 확인한다.
- 첫 단계는 검증된 오답에 대응하는 실제 객관식20 선정·OX20 생성·비공개 저장이다. 다음 단계는 40문항 독립 검수·저장 검증·OX 게시다. 검수 성공 플래그와 현재 작업 임대가 일치해야 게시 상태를 기록한다.
- 현재 임대는 10분이며 중단 작업 재시도 횟수에 상한이 있다. 명시적인 생성/검수 실패는 `blocked`로 남긴다. 모든 학생에게 억지로20문항을 채우지 않는다. 오답 매핑·원문 정답·세부 개념·같은 학교 프린트·기출 연도·실제 문제은행 후보가 부족하면 보류한다.
- 자동 생성은 학생의 오답 중 최대10개에 유사1+개념1을 우선 선정한다. 오답이 적으면 같은 개념의 확인된 실제 문항으로20개를 보충한다. 이미 학생에게 제시된 원문은 후보에서 제외한다. 동일 주차 자료가 이미 있으면 중복 게시하지 않는다.
- `node scripts/check-odap-private-weekly-auto.cjs`는 실제 SQL 큐/임대 계약을 합성 DB로 검사한다. `node scripts/check-private-weekly-auto.cjs`는 실제 worker handler와 출처 선정 모듈을 실행하여 무인증 호출 차단, Claude 전송 필드 제한, 40개 독립 검수, 실패 보류, 오래된 임대의 게시 거부를 검사한다.

교사 화면의 **클리닉 입력 자동 처리** 구역은 `auto_status`에 선택 학생 ID를 보내 주차·대기/처리 중/보류/게시·단계·보류 사유·갱신 시각을 조회한다. 새로고침 버튼은 조회만 하며 보류 작업을 재실행하지 않는다. 자동 서버가 미설치이거나 조회에 실패하면 연결 안내를 표시하고 기존 자료 조회·인쇄 흐름은 유지한다.
