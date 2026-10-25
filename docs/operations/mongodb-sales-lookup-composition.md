# 매출 조회 API Mongo composition

2026-10-01 기준 `/api/sales/lookup`을 `SALES_LOOKUP_BACKEND` selector에 연결했다. 기본값은 PostgreSQL이며 `mongodb-shadow`에서 operations·Salesmap source port·request audit를 같은 잠금 scope로 연다. 공유 토큰 인증, 운영현황 우선 조회, 고객사/과정 필터, Salesmap 폴백과 응답 계약을 유지한다.

실제 loopback MongoDB replica set에서 코스ID·고객사 조회, 잘못된 토큰 401, Salesmap 미설정 응답, 요청 감사, 인증 토큰 비저장, PostgreSQL 접근 0건과 부분 namespace 무수정 거부를 확인했다. 실제 Salesmap·운영 데이터·production 설정은 사용하지 않았다. 운영 이전은 미완료다.

## 회차 함께 받기 (`rounds=1`, 2026-10-14)

`/api/sales/lookup?courseId=…&rounds=1` 처럼 `rounds=1`을 붙인 코스ID 조회에만, 운영현황에서 찾은 경우 응답에 `rounds` 배열을 더한다. 결과보고서 빌더(edu-report)가 교육 기간·시간·교육 형태·강사를 미리 채우는 용도다.

- 한 줄: `processId · company · courseName · roundNo · startDate · endDate · educationDates · timeText · educationFormat · instructors`
- 매출·비용·담당자·링크·메모는 넣지 않는다(`src/lib/data/courseLookupRounds.ts`).
- 코스ID는 정규화 비교, 시작일 순, 최근 60회차까지.
- `rounds`를 붙이지 않은 기존 호출의 응답은 바뀌지 않는다. 고객사 검색 모드·세일즈맵 폴백에는 회차가 없다.
- 회차는 `OperationRepository.listOperations()`로 읽는다 — PostgreSQL·`mongodb-shadow` 둘 다 같은 인터페이스다.
