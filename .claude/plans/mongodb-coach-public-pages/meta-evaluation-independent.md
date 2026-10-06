# Independent Meta Evaluation: mongodb-coach-public-pages

두 독립 검토자는 Validation v1이 일정 페이지의 동기 factory 오류와 비동기 조회 오류를 합친 결함을 정확히 잡았으며, 이를 고친 v2 방향과 7개 페이지별 actual Mongo 정상 경로 검증이 범위에 적합하다고 판정했다. 이 문서는 읽기 전용 계획 검토 결과이며 실행 증거가 아니다.

## 판정

- 구조 축: PASS. 구조 실패 시 결과를 평가하지 않는 규칙과 Core/Shell/Check 구분이 있다.
- 대상 적합성: PASS. factory 선택, 기존 페이지 의미, 실제 Mongo 저장 경계, 백업 후보와 운영 gate를 서로 다른 실패 탐지 수단으로 다룬다.
- 실행 가능성: PASS. 실제 페이지 module과 loopback Mongo를 사용하면서 UI leaf, 비-coach repository, holiday/collaboration만 허용 seam으로 둘 수 있다.
- 과잉 검증: 없음. 7개 페이지가 서로 다른 catch/notFound/redirect/보강 의미를 가지므로 각 정상 경로가 필요하다.

## 실행 전에 닫을 조건

- 기준 SHA 대비 dependency, Prisma schema, 신규 업무 필드, 삭제 정책 변경이 0인지 diff로 확인한다.
- 시간과 timezone을 고정하거나 일정 쿼리 월을 명시해 재현 가능하게 한다.
- 허용 seam을 session 공급자, UI leaf, holiday fetch, 비-coach repository, collaboration helper로 제한하고 실제 auth guard/page/context/factory/MongoCoachRepository는 유지한다.
- `DATABASE_URL` 읽기와 Prisma repository 생성을 별도 ledger로 기록한다. Prisma client/query는 실제 PG adapter의 공통 진입점인 `getPrismaClient` tripwire로 차단하고, adapter 생성0과 함께 도달 불가능성을 입증한다.
- 기능 수락과 원격 push·총괄 통합 증거를 분리한다.
- Google Drive·OneDrive는 후보일 뿐이다. 실제 계정·용량·보존·암호화·독립 삭제 권한과 각각의 격리 복원 증거가 없으면 운영 백업은 미검증으로 판정한다.

Validation v2와 최종 실행 manifest가 위 조건을 입증하면 계획상 필수 gap은 없다.
