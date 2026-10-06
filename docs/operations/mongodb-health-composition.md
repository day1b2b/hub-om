# Health API Mongo composition

2026-10-01 기준 `/api/health`에 `HEALTH_BACKEND` selector를 연결했다. 기본은 PostgreSQL이며 정확한 `mongodb-shadow`만 `databaseHealth` 단일 잠금 scope에서 Mongo database ping을 실행한다. 기존 성공 200과 실패 503 공개 응답을 유지한다.

실제 로컬 MongoDB 8.0.30 replica set에서 ping 성공, PostgreSQL 연결 0건, collection 생성 0건을 확인했다. 설정·연결·runtime 오류는 PostgreSQL로 fallback하지 않고 기존 `unavailable` 503 응답으로 숨긴다.

이 검사는 연결 liveness만 의미한다. schema, collection validator·index, 복호화 키 호환, 데이터 완전성이나 cutover readiness를 보증하지 않는다. 운영 DB·Atlas·키·환경·배포 설정과 `dev`·`main`은 변경하지 않았다.
