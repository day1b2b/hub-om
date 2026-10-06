# MongoDB 활동 정리 CLI runtime

`npm run activity:prune`의 무인자 실행은 기존 PostgreSQL을 유지한다. `--backend=mongodb-shadow` 하나를 정확히 지정하고 `MONGODB_URI`, 합성 shadow DB, namespace를 모두 제공한 경우에만 준비된 Mongo operational runtime을 연다. schema 준비·수리와 env 파일 자동 로드는 하지 않으며 누락·오류 뒤 PostgreSQL로 fallback하지 않는다.

로컬 MongoDB 8.0.30에서 만료 요청·변경 삭제, 미준비 namespace 무변경 거부, 소유 client 종료와 합성 DB 소유권을 확인했다. 운영 CLI 설정·예약·데이터에는 적용하지 않았다.
