# MongoDB 현장 투입 보정 CLI runtime

`npm run db:backfill:onsite-required-y`는 기존처럼 기본 dry-run, `--apply` 지정 시 적용이며 생산 기본은 PostgreSQL이다. 기존 raw SQL과 암호화 schema 차단 대신 이미 검증된 `operationBackfill` repository를 사용하므로 암호화 저장 경계를 우회하지 않는다.

`--backend=mongodb-shadow`를 한 번 명시하고 합성 shadow DB와 namespace를 제공한 경우에만 준비된 admin maintenance runtime을 연다. CLI는 schema를 준비·수리하지 않고, 누락·부분 namespace나 실행 실패를 PostgreSQL로 fallback하지 않는다. Mongo client는 성공·실패 뒤 닫으며 오류 원문은 출력하지 않는다.

로컬 MongoDB 8.0.30에서 dry-run 무변경, apply 대상 1건, 재실행 0건, 소프트 삭제 행 제외, legacy와 같은 무감사 CLI 의미, 부분 namespace 무변경을 확인했다. 운영 DB·예약·배포에는 적용하지 않았다.
