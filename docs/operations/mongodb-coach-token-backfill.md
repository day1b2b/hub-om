# 코치 접근 토큰 보완 경계

기존 운영 CLI는 PostgreSQL을 기본으로 사용한다. 이번 구현은 명시 `coachTokenBackfill` context에 Mongo repository를 주입한 검증 경계다. 환경변수나 CLI 플래그로 운영 backend를 자동 변경하지 않는다.

## 기존 동작

보관 행의 tableSchema=public, tableName=coaches, rowKey=코치 sourceCoachId와 completed snapshot만 사용한다. snapshot의 sourceDatabase/sourceSchema를 추가 필터로 사용하지 않는다. snapshot 시작시각 내림차순, 동률은 보관 행 ID 내림차순으로 읽어 가장 최신의 non-null 문자열 access_token을 선택한다. 빈 문자열도 값이다. rowData가 null/scalar/array이면 건너뛰고, 선택에 필요한 access_token이 문자열이 아니면 원문 없는 오류로 실패한다. 이미 최신 값을 찾은 키의 과거 malformed token은 사용하지 않는다.

누락된 토큰만 채우는 기능이 아니다. 현재 토큰과 보관본이 다르면 바꾸며 삭제·비활성 코치도 포함한다. 임의 새 토큰 생성, 중복 회피용 임시 값, 새 삭제 정책은 없다.

## 실행 조건

- 기본 dry-run은 요약만 반환하며 데이터·updatedAt·암호문·감사·guard를 쓰지 않는다. 중복 토큰이 있어도 기존처럼 요약할 수 있으므로 apply 성공 보증이 아니다.
- 기존 `--apply --backup-confirmed --maintenance-confirmed` 확인 조건을 유지한다. 플래그 자체가 백업·복구나 쓰기 중단을 수행하지 않는다.
- 실제 적용 전 백업/복구 확인 및 앱과 원천 적재의 쓰기 중단이 필요하다. 대상 DB와 키·범위·복구 경로를 별도로 확인한다. 이번 작업에서는 운영 적용하지 않는다.
- apply는 단일 transaction이다. 중복 unique·키·데이터·감사·시간 오류는 전체 취소하며 접두 일부만 커밋하지 않는다. 정상 재실행은 changed/updated=0이다.
- CLI 출력은 건수 또는 고정 실패 문구뿐이다. 명시 Mongo context에서는 운영 env파일을 로드하거나 PG client를 생성/종료하지 않는다. 기본 PG CLI는 소유 연결을 finally에서 종료한다. 기존 직접 주입 PG 함수는 호출자가 연결 수명을 관리한다.

## Mongo 검증 경계

준비된 별도 shadow namespace·validator/index·replica set이 필요하다. open은 검사만 하고 DDL은 명시 prepare에 한정한다. snapshot으로 archive/coach를 읽고 달라진 token만 암호화/HMAC 및 updatedAt을 갱신한다. activity context가 있으면 원문을 가린 감사 기록도 같은 transaction에 쓰며, 없는 기존 CLI에서는 감사 기록을 새로 만들지 않는다.

코치와 보관 행을 제한된 page로 읽고 token map은 현재 코치 page 안에 유지한다. 저장 HMAC 후보를 복호화해 원문을 검증하며 같은시각/다중page/BSON짧은batch가 선택순서를 바꾸지 않아야 한다. 전체 수행·재시도의 시간 제한은 성공시간 보장이 아니라 실패·원복 조건이다.

maintenance는 외부 사전조건이다. snapshot이나 write conflict retry만으로 모든 archive writer를 잠그거나 실운영 최신성을 보장하지 않는다. 실패 후 재실행 전 원인과 기존 상태를 먼저 확인한다. 완료 후 토큰을 되돌려야 하는 복구는 사전 보존한 백업과 키 및 별도 승인 범위에 따른다.

실행 증거·검증 한계는 `.claude/plans/mongodb-coach-token-backfill/execution-review.md`를 따른다. schema/migration/dependency/생산 selector/운영키 변경 없음. 전체 앱 전환·실데이터 이전·복원리허설·dev→main은 별도다.
