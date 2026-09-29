# 실행 매니페스트

기준 1a7323bf81108e1a7fe16196cba5b7a3c60c80a7, 브랜치 feature/20260929-mongodb-coach-token-backfill. 기존 격리 clone /Users/ga/workspace/hub-om-mongodb-coach-content 재사용. 원본 사용자 workspace와 별도 총괄 clone은 수정하지 않는다.

## 구현 담당 경계

- 메인: interface, PG adapter, factory/context, command service, 실제 CLI, command/lifecycle 테스트, 문서·최종검증·통합.
- Schrodinger: MongoCoachTokenBackfillRepository 단일 파일.
- Kepler: 공유 합성 fixture와 native Mongo 검증.
- Gauss: 실제 PG migration/동등성 검증.
- Anscombe: 독립 검증기준 v1/v2·계획검토, Gibbs: 메타검토·독립 코드/증거 검토. 읽기 전용 결과를 메인이 저장한다.

기존 coachAccessTokenBackfill.ts의 직접 주입 PG 함수는 그대로 보존한다. 새로운 schema/migration/index/dependency/업무필드/삭제정책/운영 selector 변경을 포함하지 않는다.

## 실행 환경

Node24.19.0, PG17.9 C locale, Mongo8.0.30 단일 replica set. env-i·무작위 임시 키·합성 데이터. 검증 root /private/tmp/hub-om-token-backfill-20260929, PG56609/coach_token_backfill_parity, Mongo27709/tokenbackfill20260929. 이전 작업의 정리된 DB를 재사용하지 않고 새 dbpath로 기동했다. Mongo 배포 binary만 기존 검증 파일을 재사용한다.

run.sh static/backfill/mongo 모드로 묶음 검증하고 소유 root의 logs에 보관한다. 승인 설정이 full access/never로 바뀌어 추가 실행 승인창 없이 진행하지만 운영 데이터·설정 금지는 그대로 유지한다.

## 검증·실패 이력

선행 command+기존PG단위14pass, 연결수명2pass를 실행했다. 이는 실제 DB 검증을 대신하지 않는다. Mongo/실제PG/전체 회귀 및 실패·보완의 최종 근거는 execution-review.md에 기록한다.

초기 참조 검색에서 잘못된 mongoCoachSchedulingLock.ts/루트privacy 경로를 사용한 읽기 오류가 있었으며 실제 mongoCoachSchedulingGuard.ts와 src/lib/privacy/fields.json을 확인했다. 운영 명령 실패나 데이터 변경은 없었다.
