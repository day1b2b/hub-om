# 코치 일정 현황 API Mongo composition

2026-10-01 기준 관리자 일정 등록 현황과 일정 상태 조회 API를 기존 `CHANGES_BACKEND` selector에 연결했다. 기본 PostgreSQL을 유지하며 정확한 `mongodb-shadow`에서 coachContent·requestActivity 잠금 scope를 연다. 실제 Mongo에서 두 GET의 DTO·월 검증·요청 감사, PostgreSQL 접근 0건과 부분 namespace 불변을 확인했다. 운영 이전은 미완료다.
