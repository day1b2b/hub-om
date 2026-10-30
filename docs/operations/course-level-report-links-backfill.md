# 과정 레벨 결과보고서/강의관리 안전 반영

기존 회차별 결과보고서 링크·강의관리 링크/메모를 유지하면서, 동일 과정의 회차별 값이 모두 같은 항목만 빈 과정 레벨 필드에 반영한다.

## 판정 기준

- `resultReportLink`, `lectureManagementLink`, `lectureManagementNote`를 각각 독립적으로 판정한다.
- 링크는 공유링크 쿼리스트링·해시(`?gid=`, `#gid=` 등)만 다르면 같은 문서로 본다 — origin+pathname만 비교한다.
- 비어 있지 않은 회차별 값이 (정규화 기준으로) 하나뿐이면 자동 반영 후보로 본다.
- 정규화 기준으로도 서로 다른 값이 둘 이상이면 직접 확인 대상으로 남긴다.
- 이미 과정 레벨 필드에 값이 있으면 덮어쓰지 않는다.
- 회차별 값은 수정하거나 삭제하지 않는다(이번 백필은 add-only — 회차 컬럼 정리는 별도 cleanup PR).

## 실행

기본값은 `DATABASE_URL`이 가리키는 PostgreSQL이다. MongoDB 운영 selector를 사용하는 환경에서는 `--backend=mongodb-shadow`를 명시한다. 대상 환경을 확인한 뒤 먼저 조회 전용으로 실행한다.

```sh
npm run db:backfill:course-level-report-links
npm run db:backfill:course-level-report-links -- --backend=mongodb-shadow
```

실제 반영은 현재 백업과 작업 시간대가 확인된 경우에만 두 확인 플래그를 함께 사용한다.

```sh
npm run db:backfill:course-level-report-links -- --apply --backup-confirmed --maintenance-confirmed
npm run db:backfill:course-level-report-links -- --backend=mongodb-shadow --apply --backup-confirmed --maintenance-confirmed
```

출력에는 과정 수와 필드별 판정 수, 충돌 건의 과정명/기업명만 포함하며 실제 링크·메모 값은 출력하지 않는다. 반영 후 dry-run을 다시 실행해 후보가 0건인지 확인한다.

## 운영 Mongo validator 반영 범위 밖

이 PR은 `mongoRuntimeContracts.json`에 Course 컬렉션 필드 3개를 추가한다. [운영 Mongo validator 변경 절차](mongodb-operation-validator-change.md)의 자동 도구(`apply-mongodb-operation-validator.ts`)는 enum 값 추가만 처리하므로, 이번 필드 추가의 운영 validator 반영은 데이터/기술 책임자와 별도 계획이 필요하다. dev 머지 전에 반드시 확인한다.
