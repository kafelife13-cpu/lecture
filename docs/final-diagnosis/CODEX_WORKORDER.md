# Codex 작업 지시서 — 기말 진단 분석지

판단 기준은 `ANALYSIS_CRITERIA.md`와 `taxonomy.json`(Claude 기준안)이다. Codex는 이를 구현하고 검증한다. 기준에 없는 판단이 필요하거나 기준이 기존 오답연구소 구조와 맞지 않으면 임의로 정하지 말고 작업 브리지로 Claude에게 질문한다. `AGENTS.md`(Ponytail 최소 변경)를 따른다.

## 0단계 — 현황 보고 (구현 전에 먼저)

국어왕의 오답 정리 시스템(오답연구소 `odap`)이 이미 누적 오답 모음, 문항 분류(`odap_exam_tags`), 오답 원인 기록(`odap_notes`), 프린트 근거(`odap_evidence`), 보강 선정(`odap_clinic`)을 갖고 있다. 아래를 브리지로 보고한다.

1. 운영 DB에 실제 적용된 `supabase/odap/*.sql`과 저장소 상태의 차이(특히 `clinic.sql`, `homework.sql`).
2. `odap_exam_tags.question_types`, `odap_notes.error_type`, `odap_questions.body.error_types`·`question_types`·`concepts`·`difficulty`에 현재 실제로 들어 있는 값 목록과 개수(값만, 학생 정보 제외).
3. 문제은행(`odap_questions`) 승인 문항 수, 난이도별·영역별 수, 개념 태그가 비어 있는 비율.
4. 학교 프린트 근거(`odap_evidence`) 승인 수와 학교별 수.
5. 풀이 사진(`cert_submissions`)과 시험 응답을 학생·시험·문항 단위로 연결할 수 있는 키가 있는지.
6. 클리닉 누적 결과에서 보강 문항별 정답 여부를 다시 읽을 수 있는지.

이 보고를 받아 Claude가 기존 자유 입력 값을 `taxonomy.json` 코드로 옮기는 대응표를 만든다.

## 1단계 — 분류 코드 적용 (대응표 확정 후)

- 기존 자유 입력 칸을 `taxonomy.json` 코드 선택으로 바꾸되, 기존 값은 지우지 않고 대응표로 변환 저장한다.
- 자동 제안 값은 `제안` 상태로 저장하고 교사 확정 전에는 집계에 쓰지 않는다.
- 보강 선정은 기존 `odap_clinic` 매칭 로직을 재사용하고, 우선순위·수량만 기준 문서 6절에 맞춘다.

## 2단계 — 진단 집계와 분석지 초안

- 학생 1명 단위 함수: 기준 문서 5절 판정(반복 취약점·보완점·강점·판정 보류)과 근거 위치를 JSON으로 반환.
- 진단 문장의 원인 해석과 상담 질문 문안은 Claude가 작성한다. Codex는 문장을 지어내지 않고, 집계 JSON을 브리지로 보내거나 기존 `claude-ai` Edge Function을 호출하는 경로를 만든다(경로는 협의).
- 교사용·학생용 분석지는 기존 HWP/PDF 제작 경로(`odap_packets` → 한글 제작 PC)와 브라우저 인쇄를 재사용한다. 학생 공개는 교사 승인 후에만.

## 3단계 — 검증

- 합성 학생·가상 문항으로 `scripts/check-odap*.cjs` 방식의 검사를 추가: 근거 등급 표시, 추정 문장이 학생용에 나오지 않음, 판정 임계값, 보강 부족 수 표시, 학생 간 데이터 격리.
- 운영 데이터는 테스트 목적으로 바꾸지 않는다.

## 금지

- 학생 이름·성적·답안·사고 과정·사진·문제은행 원문을 커밋하거나 브리지 메시지에 원문으로 붙이지 않는다. 브리지에는 집계값·ID·위치만 쓴다. 학생 1명 검토용 원자료가 필요하면 비공개 Storage 경로만 공유한다.
- `main`에 직접 커밋하지 않는다. 작업 브랜치: `codex/final-diagnosis-build` (기준 문서 브랜치 `claude/final-diagnosis-criteria`에서 분기).

