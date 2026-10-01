# 운영 쓰기 API Mongo composition

운영 생성·회차 추가·순서 변경·삭제 API에 `OPERATION_WRITE_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 Calendar-aware operation runtime을 open-only로 연다.

실제 MongoDB 8.0.30과 합성 Calendar에서 생성→추가→재정렬→삭제, Calendar 이벤트, request audit, PG 접근 0건과 부분 namespace 무변경 거부를 확인했다. 외부 원천은 호출하지 않았고 source-read 대역을 명시적으로 격리했다.

실제 Google Calendar·운영 selector·실데이터·A/B 백업과 복원·복사·최종 전환은 미완료다.
