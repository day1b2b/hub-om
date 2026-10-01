# MongoDB 원천 읽기 상태 runtime

`/api/source-reads/status`의 원천 reader와 요청 감사를 하나의 명시 Mongo shadow scope로 조립한다. 생산 기본 reader 선택과 PostgreSQL 요청 감사는 명시 scope 밖에서 그대로 유지한다.

빈 namespace만 준비하며 기존·부분 namespace는 read-only readiness에서 실패한다. 실제 MongoDB 8.0.30에서 네 원천의 기존 병렬 상태·개수 응답, 요청 감사, PG·비합성 fetch 0, 재준비 mutation 0, legacy 부분 namespace 불변, 두 포트의 누락·다른 namespace 혼입 차단을 확인했다.

실제 Calendar·Salesmap·Slack·이메일·과정 원천, production selector, 데이터 이전·복원·최종 전환은 실행하지 않았다.
