# Clarify: mongodb-snapshot-privacy

## 대상

coverage의 `snapshot companyName/courseName`은 `DriveImportResult.companyName`과 `DriveImportResult.courseName`이다. 두 값은 Drive 실행 시점의 표시 snapshot이며 기업·과정명에 개인 이름이 포함될 수 있다. 현재 inventory는 operational이고 PG·Mongo에 평문 저장된다.

## 보존할 의미

- writer 입력과 승인된 history/admin 응답은 원문을 반환한다.
- latest run 결과는 `candidateCount desc`, `companyName asc`, `courseName asc` 순서와 limit를 유지한다.
- latest result의 `operationId` 조회와 run/session 관계는 변하지 않는다.
- 동일 이름은 허용되므로 HMAC companion은 non-unique다.
- 생산 기본 PG, 실제 원천·운영 데이터·배포는 건드리지 않는다.

## 전환 정책

두 String을 encrypted로 분류하고 기존 String 정책과 같은 HMAC companion을 추가한다. PG encrypted ordering은 기존 privacy wrapper의 bounded decrypt-sort를 사용하고, Mongo는 기존 전체 문서 decode 후 정렬을 유지한다. 이전 정책 Mongo namespace는 자동 수리하지 않고 새 namespace 재복사를 기본 절차로 둔다.
