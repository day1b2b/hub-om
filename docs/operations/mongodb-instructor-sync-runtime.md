# MongoDB 강사 Notion 동기화 runtime

`/api/admin/sync-notion-instructors`의 저장 repository, 합성 Notion source와 요청 감사를 하나의 명시 Mongo shadow namespace로 조립한다. 생산 기본 backend와 실제 Notion 연결은 유지한다.

빈 namespace만 준비하며 기존·부분 namespace는 read-only readiness에서 실패한다. 실제 MongoDB 8.0.30에서 bearer POST, 요청 감사, PG·비합성 fetch 0, 재준비 mutation 0, legacy 부분 namespace의 validator·index·문서 불변, scope 누락·혼합 차단을 확인했다. 기존 매칭·수동 필드 보존·행별 부분 성공은 검증된 repository를 그대로 사용한다.

실제 Notion·Coolify 예약·production selector·운영 데이터 이전·복원·최종 전환은 실행하지 않았다.
