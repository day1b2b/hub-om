# 강사 Notion 동기화 Mongo composition

`/api/admin/sync-notion-instructors` GET/POST에 `INSTRUCTOR_SYNC_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`에서만 준비된 runtime을 open-only로 열어 저장소·Notion source·요청 감사를 같은 잠금 namespace에서 사용한다.

실제 MongoDB 8.0.30에서 route가 selector와 기본 source adapter를 통과하도록 합성 Notion HTTP로 검증했다. PostgreSQL 접근 0건, 준비 재실행 무변이, 부분 namespace callback 0회와 전체 snapshot 불변을 확인했다. 실제 Notion·Coolify 예약·production 배포·운영 데이터·최종 전환은 미완료다.
