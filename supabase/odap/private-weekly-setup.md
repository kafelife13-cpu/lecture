# 개인 주간 테스트 서버 설치

이 문서는 배포 소스와 연결 계약이다. 운영 DB 적용·Google Apps Script 배포·실제 계정 응시 성공을 의미하지 않는다.

## 설치 대상

- SQL: `supabase/odap/private-weekly.sql`. 기존 `users`, `authenticate_user`가 있어야 한다.
- Edge: `supabase/functions/odap-private-weekly/index.ts`와 상대 import인 `odap/private-weekly-core.mjs`를 함께 번들한다. 함수 이름은 `odap-private-weekly`.
- Drive: `supabase/functions/odap-private-weekly/drive-gateway.gs`를 별도 Apps Script 프로젝트에 설치한다. 전용 비공개 폴더를 사용한다. 기존 공유 원본 폴더를 변경하지 않는다.

## 필요한 관리 연결과 설정

1. 운영 Supabase 관리자 연결: SQL 적용과 Edge 배포 권한. DB 백업·실제 스키마 확인 후 SQL 적용.
2. Apps Script 소유자 계정의 Drive 권한과 웹 앱 배포. 실행 주체는 소유자, 서버 요청을 받을 수 있게 웹 앱을 배포한다. 모든 실제 작업은 HMAC 검증 뒤에만 실행한다.
3. Script Properties: `PRIVATE_FOLDER_ID`와 32자 이상의 무작위 `HMAC_SECRET`. 전용 폴더·파일은 링크 공개 및 추가 편집자·뷰어 없이 비공개여야 한다.
4. Edge secrets: `ODAP_PRIVATE_DRIVE_URL` (`https://script.google.com/macros/s/.../exec`), `ODAP_PRIVATE_DRIVE_SECRET` (위 HMAC 값과 동일). `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge 서버 환경에서만 사용한다.
5. 웹 앱의 현재 공개 API 키로 함수 진입 가능 여부를 확인한다. 이 서비스는 기존 ID/비밀번호를 `authenticate_user`로 매 요청 검증하는 커스텀 인증이다. Supabase Auth JWT를 사용하지 않는 기존 공개 키가 Gateway에서 거부되면 해당 함수만 custom-auth 배포 설정을 적용해야 한다. 인증 검증 코드를 제거하거나 서비스 키를 브라우저에 넣지 않는다.

비밀번호·HMAC·서비스 키는 코드, GitHub, 문서, 채팅에 저장하지 않는다. Apps Script는 Authorization 헤더를 받는 계약이 아니다. Edge가 JSON 본문에 단기 서명 토큰을 넣는다. ContentService의 `script.googleusercontent.com` 리다이렉트는 응답 GET만 허용하며 토큰 본문을 전달하지 않는다.

## API 계약

POST Edge JSON: `{credentials:{id,pw,role},action,payload}`.

- `list`: 본인 공개 배정 목록. 교사는 모든 상태, 선택적으로 `payload.student_id` 필터. 결과 배열 항목: `id,week_start,title,status,submitted_at,correct,total`.
- `create` (교사): `student_id,school,week_start,packet`. 주차는 월요일. `{id,status:'draft',week_start,title}` 반환.
- `revise` (교사): `{id,packet}`. draft만 새 Drive 파일로 교체한다. 대상 학생·학교·주차는 바꿀 수 없다. 동시 수정은 이전 해시로 검증한다.
- `approve` (교사): `{id,confirmed:true}`. 모든 문항 검수·출처·학교 프린트·작년 기출 조건을 검증한 뒤 approved.
- `publish` (교사): `{id,confirmed:true}`. approved만 published. 게시 후 변경하지 못한다.
- `open`: `{id}`. `{id,week_start,status,packet,attempt}`. 학생 packet에는 정답·해설·근거가 없다. 교사는 검수용 원본을 받는다. 제출한 학생만 attempt에서 본인 답·정답·해설을 확인한다.
- `submit` (학생): `{id,answers:{문항ID:'1'~'5' 또는 'O'/'X'}}`. `{submitted_at,correct,total:40,score,results:[{id,correct,answer,explanation}]}`. 점수는 서버 계산하며 전달된 점수 필드는 무시한다.

packet: `{schema:1,title,items:[...]}`. items는 객관식 20개, OX 20개. 각 문항은 `id,type:'mcq'|'ox',text,passage?,choices?(5개),answer,explanation,reviewed,evidence,images?`.

images: `[{data:'data:image/png;base64,...' 또는 JPEG,alt?}]`; 문항당 4개, 이미지 문자열당 150만자 이하. SVG·외부 이미지 URL은 허용하지 않는다. UTF-8 본문 파일은 8MB 이하, HTTP JSON 요청은 12MB 이하.

승인 근거: `[{source_id,page:'1',quote,approved:true,kind,school,year}]`. 교사가 실제 원문을 대조해 승인한다. 일반 문제은행은 학교 일치를 요구하지 않지만 학교 자료와 OX 근거는 배정 학교와 같아야 한다. OX 근거 전체에 학교 프린트와 주차 연도-1인 학교/내신 기출을 모두 포함해야 한다. 단순 `approved` 표시는 자동 원문 대조 결과가 아니며 교사 검수 책임을 대신하지 않는다.

## 저장·실패 처리

문항·정답·해설·이미지는 비공개 Drive 파일이다. DB에는 학생/주차/상태/파일ID/해시/승인자와 40개 단답형 제출·집계만 저장한다. 직접 테이블 접근과 브라우저 RPC를 차단하고 서비스역할 Edge만 RPC를 실행한다. 학생 소유권을 확인한 뒤 Drive를 조회한다. Drive 전체 파일 해시가 달라지면 출제·채점을 거부한다.

학생/주차 배정 UNIQUE와 배정별 제출 PK, 행 잠금으로 한 번의 제출만 저장한다. 제출 응답이 유실되면 재제출 대신 open으로 저장된 결과를 확인한다. 파일 저장 뒤 DB 등록이 실패하면 비공개 미참조 파일이 남을 수 있다. 자동 삭제하지 않는다. 등록 승인 실패는 draft로 남으며 revise 후 재승인한다. 교사 승인·게시 이후 같은 주 자료의 수정/취소는 현재 버전에서 지원하지 않는다.

## 검증

`npm install --no-save --ignore-scripts @electric-sql/pglite@0.5.8` 후 `node scripts/check-odap-private-weekly.cjs` (Node 24). 합성 계정·자료로 실제 Edge handler와 SQL을 실행하며 Drive 통신은 HMAC 검증 모의 서버다. 소유권 격리, 승인 조건, 정답 제거, 이미지 보존, 서버 채점, 중복 제출, 파일 변조, 서비스전용 RPC를 검사한다.

운영 연결 후에는 합성 학생 배정으로 미게시 비공개→승인→게시→본인 응시→정답 공개→다른 학생 거부→재제출 거부를 확인한다. 이 점검 전에는 실제 학생 응시가 연결됐다고 표시하지 않는다. Google 계정별 Apps Script 할당량/시간 제한과 100명 동시 응시는 별도 운영 확인 대상이다.
