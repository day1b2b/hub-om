# 과정 레벨 결과보고서 여부 승격

기존 회차별 결과보고서 여부(`operation_sessions.has_result_report`)를 유지하면서, 과정(Course) 레벨에
값이 없는 과정만 회차별 값으로 승격해 과정당 1개의 값으로 만든다.

## 판정 기준

과정 레벨에 이미 값이 있으면 보존하고(덮어쓰지 않음), 없는 과정만 아래 우선순위로 회차별 값을
승격한다.

1. 회차 중 하나라도 `유`면 과정 레벨은 `유`.
2. 전부 `불필요`면 과정 레벨은 `불필요`(결과보고서 자체가 필요 없는 과정).
3. `유`는 없고 `불필요`가 일부만 섞여 있으면(일부 회차는 필요 없다고 했는데 일부는 아직
   확인되지 않았다) `확인필요`로 남긴다. 자동으로 `무`로 단정하지 않는다.
4. 전부 `무`면 과정 레벨은 `무`.
5. 그 외(`확인필요`가 섞여 있거나 애매한 조합)는 `확인필요`로 기운다.

애매한 조합을 자동으로 "완료"(`유`)나 "불필요 없음"(`무`)으로 단정하면 실제로 안 된 일을
덮어버릴 수 있어, 확인이 더 필요한 쪽(`확인필요`)으로 보수적으로 판정한다.

회차별 `operation_sessions.has_result_report`는 이번 변경으로 지우거나 바꾸지 않는다(add-only).
회차별 값을 그대로 보고 싶으면 운영 상세의 회차 목록에서 확인한다(결과보고서 "여부" 칼럼은
과정 레벨 토글로 옮겼지만, 결과보고서 "링크" 칼럼은 회차별로 남아 있다).

## 실행

기본값은 `DATABASE_URL`이 가리키는 PostgreSQL이다. MongoDB 운영 selector를 사용하는 환경에서는
`--backend=mongodb-shadow`를 명시한다. 대상 환경을 확인한 뒤 먼저 조회 전용으로 실행한다.

```sh
npm run db:backfill:result-report-status -- --dry-run
npm run db:backfill:result-report-status -- --backend=mongodb-shadow --dry-run
```

실제 반영은 현재 백업과 작업 시간대가 확인된 경우에만 두 확인 플래그를 함께 사용한다.

```sh
npm run db:backfill:result-report-status -- --apply --backup-confirmed --maintenance-confirmed
npm run db:backfill:result-report-status -- --backend=mongodb-shadow --apply --backup-confirmed --maintenance-confirmed
```

출력에는 과정 수와 판정 결과별(유/무/불필요/확인필요) 건수만 포함한다. 반영 후 dry-run을 다시
실행해 승격 대상이 0건인지(모두 보존 또는 완료) 확인한다.

재실행해도 과정 레벨에 이미 값이 있으면 다시 쓰지 않으므로 멱등하다.

## Mongo 운영 validator 반영

`src/lib/data/mongoRuntimeContracts.json`에 `Course.hasResultReport` 코드 계약을 추가했다. 이번
PR은 코드 계약만 바꾸고 운영 Mongo validator는 바꾸지 않는다 — dev 머지 전 하연희님 확인이
필요하고, 실제 운영 validator 반영은
[mongodb-operation-validator-change.md](mongodb-operation-validator-change.md)의 "B. nullable
필드 추가" 절차를 따른다(PR #762와 같은 사유).
