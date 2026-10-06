# 운영 JSON 가져오기 CLI Mongo 경계

## 범위

`db:import:operations`는 로컬 표준 JSON의 운영 목록을 회사·과정·운영과 가져오기 실행·원천 행으로 저장한다. 기본 저장소는 암호화 PostgreSQL이며 exact `--backend=mongodb-shadow`만 이미 준비된 검증용 Mongo namespace를 연다.

```bash
npm run db:import:operations -- --file=.local/operations.json --dry-run
npm run db:import:operations -- --file=.local/operations.json --apply --backup-confirmed --maintenance-confirmed
npm run db:import:operations -- --file=.local/operations.json --dry-run --backend=mongodb-shadow
```

기본은 dry-run이다. apply 확인 플래그는 실제 백업이나 writer 중단을 수행하지 않는다. 정상 Mongo CLI는 collection·validator·index·counter·guard를 생성하거나 수리하지 않는다.

## 기존 의미와 저장 규칙

- 배열 또는 `{ "operations": [...] }`를 읽고 기존 연속 공백 정규화, 필수 operationId/companyName, 누락 과정명 대체와 검증 오류, 엄격한 `YYYY-MM-DD` 검사를 유지한다.
- operationId를 먼저 찾고, 없으면 삭제되지 않은 동일 기업·과정·시작일·종료일 중 가장 오래된 운영을 재사용한다. 업무키로 찾은 운영의 기존 operationId는 바꾸지 않는다. 같은 파일의 앞 행에서 만든 운영도 뒤 행이 재사용한다.
- 회사·과정 자연키, 운영 필드 변환, Member 명단 기반 OM/LD 정규화, `legacy-json:<operationId>` 원천 지문과 기존 원천 중복 생략을 유지한다.
- dry-run은 apply와 같은 순차 저장 로직을 격리 transaction에서 실행한 뒤 의도적으로 전체 rollback해 최종 저장을 0건으로 유지한다. 따라서 같은 파일 안 operationId·업무키 변경과 기존 후보 선택까지 apply와 같은 상태 전이로 계산한다. apply는 전체 파일을 한 transaction으로 commit한다.
- PostgreSQL은 Serializable을 사용하고 apply 중 `P2034`를 최대 5회 재시도한다. Mongo는 snapshot/majority transaction, 과정 sequence counter와 과정명 복원 guard를 사용한다.
- 입력은 32MiB·20,000행으로 제한한다. 출력은 운영·신규·갱신·원천 신규/기존 건수만 포함하며 파일명, operationId, 개인정보, 원문 오류를 출력하지 않는다.
- 기본 PostgreSQL은 loopback만 허용한다. 비로컬 대상은 별도 운영 확인 뒤 `ALLOW_NON_LOCAL_OPERATION_IMPORT=true`가 필요하다.

## 적용과 복구 순서

1. PostgreSQL과 대상 Mongo의 독립 백업·격리 복원을 확인하고 import/promotion/catalog writer를 점검 모드로 전환한다.
2. PostgreSQL dry-run의 건수와 승인된 화면 결과를 기록한다. Mongo 검증은 새 namespace 복사와 validator/index/counter/guard 준비를 별도 절차로 완료한다.
3. apply 후 같은 파일을 재실행해 신규 0, 기존 운영 갱신, 원천 중복 생략을 확인한다. 저장된 운영·원천 스냅숏의 개인정보 평문 비노출을 함께 확인한다.
4. 실패 시 저장 상태를 먼저 확인한다. 트랜잭션 내부 실패는 전체 rollback을 확인하되 커밋 응답·연결 정리 실패는 반영 여부를 추정하지 않는다. 업무 검증 실패 시 writer를 계속 중단하고 각 저장소 백업을 별도로 복원한다.

## 검증과 한계

- 일반 회귀: 1,157 pass / 132 opt-in skip / 0 fail
- command/core/runtime 단위: 7 pass, 실제 PostgreSQL·Mongo 각 1 root pass
- PostgreSQL package launcher dry-run/apply/re-run 통과
- typecheck/build 통과, lint 오류 0·기존 경고 7
- 실제 PostgreSQL 17과 MongoDB 8.0.30 replica set에서 dry-run, 같은 파일 업무키 재사용, apply·재실행, 개인정보 저장, 후반 실패 rollback을 검증했다.
- 독립 리뷰가 업무키 예측 캐시의 오래된 매핑 P1과 operationId 별칭·dry-run 이동 후보·기존 후보 순서 P1/P2를 재현했다. 별도 캐시를 제거하고 두 backend 모두 동일 저장 transaction을 dry-run에서 전체 rollback하도록 보완했다.
- 보완 후 최종 독립 재검토에서 추가 수정이 필요한 결함은 발견되지 않았다.
- 실제 운영 파일·DB·Atlas·원천·키·백업·배포에는 접근하지 않았다. 강제 PostgreSQL `P2034`, 실제 writer barrier 경합과 운영 규모는 미검증이다.

이 범위는 운영 JSON 가져오기 CLI 하나의 저장 경계다. production selector, 전체 앱·예약 작업 조립, 실제 A/B 백업·각 복원, 실데이터 복사, 최종 전환과 `dev → main`은 완료되지 않았다.
