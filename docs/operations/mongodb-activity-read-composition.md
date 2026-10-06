# 활동 조회 Mongo composition

2026-10-01 기준 `/api/activity-feed`, `/api/admin/activity`, `/api/admin/activity/usage`에 `ACTIVITY_READ_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 기존 `activityReads` repository를 준비된 잠금 scope에서 연다. 이 세 monitoring route는 기존 정책대로 request audit 대상이 아니다.

인증과 입력 검증은 Mongo 연결보다 먼저 실행한다. 따라서 namespace가 준비되지 않았어도 기존 401·403·400 계약을 유지하며, 승인된 조회에서 설정·연결·readiness·repository 오류가 발생하면 각 route의 기존 고정 503 응답을 반환한다. Mongo 오류 원문이나 연결 정보는 응답에 노출하지 않고 PostgreSQL로 fallback하지 않는다.

실제 로컬 MongoDB replica set에서 세 route의 정상 조회, PostgreSQL 연결 0건, 비관리자·잘못된 token·잘못된 필터, 부분 namespace의 503과 전체 collection metadata·index·행 불변을 확인했다. 운영 selector·데이터·배포 설정은 변경하지 않았고 실제 A/B 백업·복원·복사·최종 전환은 별도 단계로 남는다.
