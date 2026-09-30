# 팀 단위 원천 승격 CLI Mongo 경계

## 범위

`db:promote-source-only`는 한 팀의 미연결 `OperationSourceRecord`를 가져오기 실행 ID와 무관하게 모두 찾아 운영으로 승격한다. 기본 저장소는 암호화 PostgreSQL이며 exact `--backend=mongodb-shadow`만 이미 준비된 검증용 Mongo namespace를 연다.

```bash
npm run db:promote-source-only -- team_1 --dry-run
npm run db:promote-source-only -- team_1 --apply --backup-confirmed --maintenance-confirmed
npm run db:promote-source-only -- team_1 --dry-run --backend=mongodb-shadow
```

팀 인자는 `team_1`, `team_2`, `unknown`만 허용하며 생략하면 기존처럼 `team_1`이다. 기본은 dry-run이다. 확인 플래그는 백업이나 writer 중단을 수행하지 않는다.

## 기존 의미와 저장 규칙

- 웹 관리자 승격은 import run 한 건 단위이고 Notion 차단·업무키 매칭·삭제 운영 복원이 포함된다. 이 CLI는 기존대로 source team 전체·복수 run을 한 transaction에서 처리하며, 지문 일치만 기존 운영으로 연결한다. 웹 승격 계약은 바꾸지 않는다.
- 기존 비차단 오류 3종은 유지하고 나머지 검증 오류, 기업명·과정명·시작일·종료일 누락을 차단한다. 기존 Member 역할 명단으로 OM/LD 이름을 정규화한다.
- 기존 필드 변환과 `avgSatisfaction`, 원본 검증 오류 저장을 유지한다. 승인된 결과 조회와 달리 저장된 개인정보 필드는 PostgreSQL wrapper와 Mongo authenticated codec으로 암호화한다.
- dry-run은 원천 연결·회사·과정·운영·guard를 쓰지 않는다. 같은 지문이 여러 import run에 있으면 첫 행을 신규, 뒤 행을 기존 연결로 예상해 apply 집계와 일치시킨다.
- apply는 모든 대상 행을 한 transaction으로 처리한다. PostgreSQL은 Serializable과 `P2034` 최대 5회 재시도, Mongo는 snapshot/majority transaction과 기존 과정명 복원 guard를 사용한다. 후반 고유성 실패는 회사·과정·운영·원천 연결을 모두 롤백한다.
- 정상 Mongo CLI는 collection·validator·index·counter·guard를 생성하거나 수리하지 않는다. 이전 정책 또는 부분 namespace는 쓰기 전에 실패하며 새 shadow 재복사를 우선한다.
- 기본 PostgreSQL은 loopback만 허용한다. 비로컬 대상은 별도 운영 확인 뒤 `ALLOW_NON_LOCAL_SOURCE_ONLY_PROMOTION=true`를 명시해야 한다.
- CLI 출력은 원천·신규·기존 연결·차단 건수만 포함하며 이름, 지문, 차단 원문, 저장소 오류를 출력하지 않는다.

## 적용과 복구 순서

1. PostgreSQL과 대상 Mongo의 독립 백업·격리 복원을 확인하고 import/promotion/catalog writer를 점검 모드로 전환한다.
2. PostgreSQL dry-run을 팀별로 실행해 건수만 기록한다. Mongo 검증이면 별도 절차로 새 namespace 복사와 validator/index/counter/guard 준비를 완료한다.
3. apply를 한 번 실행하고 같은 팀을 재실행해 미연결 차단 행만 남는지 확인한다. 승인된 화면 결과와 저장 원문 비노출도 별도로 대조한다.
4. 실패하면 저장 상태를 먼저 확인한다. 트랜잭션 내부 실패는 전체 rollback을 검증하되, 커밋 응답이나 연결 정리가 실패한 경우에는 반영 여부를 추정하지 않는다. 적용 후 업무 검증이 실패하면 writer를 계속 중단하고 각 저장소 백업을 별도로 복원한다. 기존 namespace를 자동 삭제·수리하지 않는다.

## 검증과 한계

- 일반 회귀: 1,150 pass / 130 opt-in skip / 0 fail
- 실제 PostgreSQL 17과 MongoDB 8.0.30 replica set: 각 1 root pass
- command/core/runtime 단위: 7 pass
- PostgreSQL·Mongo package launcher의 dry-run/apply 실행 통과
- typecheck/build 통과, lint 오류 0·기존 경고 7
- 독립 리뷰의 평균 만족도 누락, 중복 지문 dry-run 집계, legacy 자연키 공백 정규화, 커밋 뒤 연결 정리 실패 안내의 P2 네 건을 보완했다. 최종 재리뷰에서 잔여 결함을 찾지 못했다.
- 실제 DB 검증은 복수 import run, 중복 지문, 비차단/차단 오류, dry-run 무쓰기, apply·재실행, 개인정보 평문 비노출, 후반 operationId 충돌 전체 rollback과 재시도를 포함한다.
- 실제 운영 DB·Atlas·원천·키·백업·복원·배포에는 접근하지 않았다. 강제 PostgreSQL `P2034`, guard를 건 실제 두 writer barrier 경합, 운영 규모는 미검증이다.

이 범위는 팀 단위 원천 승격 CLI 하나의 저장소 경계다. 전체 앱 selector, 실제 A/B 백업·각 복원, 실데이터 복사, 최종 운영 전환과 `dev → main`은 완료되지 않았다.
