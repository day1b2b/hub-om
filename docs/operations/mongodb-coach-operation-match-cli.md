# 코치 운영 매칭 CLI Mongo 경계

## 범위

`db:diagnose:coach-operation-matches`와 `db:backfill:coach-operation-matches`는 기본적으로 PostgreSQL을 사용한다. 준비된 검증용 shadow를 사용할 때만 다음 선택자를 추가한다.

```bash
npm run db:diagnose:coach-operation-matches -- --backend=mongodb-shadow
npm run db:backfill:coach-operation-matches -- --apply --backend=mongodb-shadow
```

Mongo 실행에는 `MONGODB_URI`, `MONGODB_SHADOW_DATABASE`, `MONGODB_SHADOW_NAMESPACE`가 필요하다. CLI는 namespace를 생성·수리·삭제하지 않는다. 빈 namespace 준비는 별도의 검증 setup에서만 수행한다.

## 보존한 동작

- 진단 기본 limit 30과 `--limit=N`, 과정별 상위 15개, 후보 점수 표를 유지한다.
- 백필은 기본 dry-run이며 `--apply`일 때만 연결한다.
- 기존 `matchOperation` 점수·모호성 기준을 그대로 사용한다.
- 이미 연결된 투입은 덮어쓰지 않고 재실행 시 업데이트 0건이다.
- 실제 갱신 건수를 보고하므로 동시 실행 중 다른 writer가 먼저 연결한 행을 성공으로 과대 계산하지 않는다.

진단 표의 코치명과 후보명은 명시적으로 요청한 관리자 CLI 응답이다. PostgreSQL과 Mongo의 저장 문서, 오류 메시지, 보조 인덱스에는 복호화 값을 새로 남기지 않는다.

## 동시성·복구

Mongo apply는 coach catalog guard를 먼저 갱신한 transaction에서 살아 있는 운영 회차를 확인하고 `operationSessionId: null`인 투입만 연결한다. 최초 guard upsert의 duplicate-key 충돌은 transaction 전체를 최대 5회 재시도한다. PostgreSQL도 같은 catalog advisory lock과 조건부 `updateMany`를 사용한다.

실패 시 transaction 전체가 롤백된다. 부분 namespace, validator/index 불일치, 키 불일치, 연결·종료 실패는 고정 오류로 종료하며 PostgreSQL로 fallback하지 않는다. 기존 shadow를 자동 수리하지 말고 새 run ID/namespace로 다시 복사한다.

## 검증 결과와 한계

- 일반 회귀: 1,115 pass / 112 opt-in skip / 0 fail
- 실제 MongoDB 8.0.30 replica set: 1 pass
- 실제 합성 PostgreSQL 17: 연속 2회 pass
- typecheck/build 통과
- lint: 오류 0, 기존 경고 7
- 독립 리뷰: 잔여 P0~P3 없음

실제 운영 DB·Atlas·Notion/Google 원천·운영 키·배포 설정에는 접근하지 않았다. 이 범위는 두 CLI의 저장소 경계만 완료했으며 운영 데이터 실행, 전체 앱 전환, 백업·복원 리허설, 실제 복사와 최종 전환은 완료하지 않았다.
