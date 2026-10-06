# 매출 조회 API Mongo composition

2026-10-01 기준 `/api/sales/lookup`을 `SALES_LOOKUP_BACKEND` selector에 연결했다. 기본값은 PostgreSQL이며 `mongodb-shadow`에서 operations·Salesmap source port·request audit를 같은 잠금 scope로 연다. 공유 토큰 인증, 운영현황 우선 조회, 고객사/과정 필터, Salesmap 폴백과 응답 계약을 유지한다.

실제 loopback MongoDB replica set에서 코스ID·고객사 조회, 잘못된 토큰 401, Salesmap 미설정 응답, 요청 감사, 인증 토큰 비저장, PostgreSQL 접근 0건과 부분 namespace 무수정 거부를 확인했다. 실제 Salesmap·운영 데이터·production 설정은 사용하지 않았다. 운영 이전은 미완료다.
