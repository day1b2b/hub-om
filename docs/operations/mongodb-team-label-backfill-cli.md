# MongoDB 팀 명칭 보정 CLI

`npm run db:backfill:team-user-team-labels`는 기존처럼 기본 dry-run이며 `--apply`에서 `1팀 → AX 1파트`, `2팀 → AX 2파트` 두 exact 변경만 수행한다. 기존 raw SQL·암호화 schema 차단을 TeamUser 저장 경계의 count/조건부 rename으로 교체하고 생산 기본은 PostgreSQL로 유지한다. 기본 CLI에서 local-file data source는 거부한다.

Mongo는 `--backend=mongodb-shadow` 한 개를 명시한 경우에만 준비된 user-admin shadow runtime을 연다. dry-run은 팀별 count만 읽고 PII를 복호화하지 않는다. apply도 `_id/team`만 읽고 exact 현재 label 조건으로 `team` 필드만 갱신하므로 이름·이메일·Slack ID 암호문과 HMAC companion은 그대로 유지한다. schema 준비·수리·PG fallback은 없다.

로컬 MongoDB 8.0.30에서 dry-run 저장 상태 불변, exact 두 라벨 변경, 공백 변형 제외, 재실행 0건, PII raw byte 불변, 부분 runtime namespace 불변을 확인했다. 운영 데이터·설정·예약·배포에는 적용하지 않았다.
