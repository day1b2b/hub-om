# 코치 본인 포털 Mongo composition

2026-10-01 기준 `/api/coach/me`와 `/api/coach/schedule/[yearMonth]`에 `COACH_PORTAL_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`일 때만 기존 coach-portal runtime을 연다. 설정·namespace 준비 실패는 `COACH_PORTAL_COMPOSITION_FAILED`로 닫고 PostgreSQL로 fallback하지 않는다.

기존 토큰 인증, 프로필의 `private, no-store`, 월 검증, 월 일정 전체 교체와 요청·업무 감사를 유지한다. 실제 로컬 MongoDB 8.0.30 replica set에서 프로필 조회, 빈 일정, 일정 저장·재조회, 무토큰 401, 요청별 `token_request` 감사와 PUT 변경 감사, PostgreSQL 접근 0건을 확인했다. Coach 이름·access token·source ID는 저장 문서의 평문 검색에서 발견되지 않았다. 이미 다른 정책의 collection이 있는 부분 namespace는 자동 수리하지 않고 저장 상태를 그대로 보존했다.

운영 selector·운영 데이터·실제 브라우저 흐름·A/B 백업과 각 복원·실제 복사·최종 전환은 수행하지 않았다. 생산 기본 backend는 계속 PostgreSQL이다.
