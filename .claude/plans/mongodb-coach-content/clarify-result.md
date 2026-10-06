# 코치 콘텐츠 저장 경계 재개 — 2026-09-29

목표: 코치 메모, 콘텐츠 피드, 월 일정 등록 현황과 관리자 삭제 코치 수를 명시 repository context로 전환한다. 기본 backend는 PostgreSQL을 유지한다.

시작: `e1b97490eeded7cf34dc9c3e491fa3c4ef1d7235`, `feature/20260929-mongodb-coach-content`, clean clone. 과거 임시 clone 및 9/23 검사 결과는 이번 구현의 검증 근거로 사용하지 않는다.

금지: 운영 DB/Atlas/실제 원천 접근, 운영 키·env·배포 변경, 원본 workspace 변경, 새 업무 스키마·의존성·삭제 정책 추가. 총괄 통합은 별도 담당한다.

기존 계약: workspace 권한과 admin 페이지 권한을 유지한다. NOTE 쓰기와 EDIT_HISTORY는 원자적이며 수정 시 최초 작성자를 보존한다. 삭제된 메모와 EDIT_HISTORY도 기존 id+coachId 조건을 유지한다. 피드는 NOTE 300개와 평가 300개, 삭제 코치도 포함한다. 월 상태는 ACTIVE/미삭제 코치의 접근 로그 기준이다.

성공 기준: 실제 합성 Mongo replica set 및 격리 PG 비교, 실제 handler·권한·감사·암호화·삭제 경합 검사, 전체 test/typecheck/lint/build와 독립 리뷰. 실행하지 못한 검사는 PASS로 기록하지 않는다. commit/push 후 원격 SHA 확인.

열린 제품 결정 없음. 동일 시각 정렬과 PG collation 차이는 검증하고 한계를 명시한다. 전체 앱·운영 전환 및 브라우저 초안 암호화 완료를 주장하지 않는다.
