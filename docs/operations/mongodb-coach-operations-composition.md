# 코치 일정·예약·투입 API Mongo composition

2026-10-01 기준 코치 관리자 일정 조회, 예약 생성·취소, 투입 목록·생성·수정 API에 `COACH_OPERATIONS_BACKEND` selector를 연결했다. 기본값은 PostgreSQL이며 정확한 `mongodb-shadow`만 coachEngagement·coachSchedule·requestActivity를 하나의 등록·잠금 shadow scope로 연다.

실제 로컬 MongoDB replica set에서 여섯 handler를 연속 실행해 일정 조회, 예약, 투입 생성·조회·수정, 예약 취소와 요청 감사 6건을 확인했다. Mongo 선택 중 PostgreSQL 접근은 차단했고, 코치명·예약자·감사 행위자의 평문이 저장되지 않는지 확인했다. 기존 scheduling/catalog guard와 원자 롤백을 유지하며 부분 준비된 namespace는 자동 수리하거나 변경하지 않는다.

운영 selector 설정, 운영 데이터 복사, 브라우저 전체 흐름, A/B 백업과 각 복원, 최종 전환은 완료하지 않았다. 생산 기본 backend는 계속 PostgreSQL이다.
