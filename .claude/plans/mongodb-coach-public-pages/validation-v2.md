# Validation v2: mongodb-coach-public-pages

## v1 → v2 변경점

- 일정 페이지의 factory 동기 throw, dashboard Promise reject, holiday reject를 각각 판정한다.
- factory의 override-first 순서와 PG/env ledger를 고정한다.
- 위키 목록은 trim 이름 Map의 마지막 일치, 상세는 첫 일치라는 기존 차이를 추가했다.
- actual Mongo 7페이지에서 다른 필수 port는 합성 seam임을 명시해 전체 앱 native 조립 과장을 막는다.

## 구조 기준

- S-1: 모든 Step에 Core/Shell/Check 태그가 있어야 한다.
- S-2: Core Step이 1개 이상이어야 한다.
- S-3: scope 상태와 페이지 오류 위치를 입력하면 결과·ledger가 하나로 결정돼야 한다.
- 하나라도 FAIL이면 결과 기준을 평가하지 않는다.

## V1 Factory 선택과 격리

- scope 없음+URL 있음: Prisma adapter, query 0.
- scope 없음+URL 없음: 기존 DATABASE_URL 오류.
- coach scope: 동일 객체, 기본 PG/env selector 0.
- 빈 scope: `DATA_REPOSITORY_NOT_CONFIGURED: coach`, PG 0.
- 중첩 빈 scope는 외부 상속 금지, 종료 후 외부 복원.
- 동시 A/B는 객체·method ledger 혼합 0.
- Mongo 관련 env만으로 기본 backend 전환 0.

테스트셋: 기본/누락/명시/빈/중첩/동시와 swallowed PG tripwire 음성대조. 기대: 7개 분기 모두 일치, 금지 ledger 0, 음성대조만 의도적 fail.

## V2 7페이지 권한·제어 흐름·DTO

- `/coaches`: admin 선행, 정상/빈, factory throw와 조회 reject 모두 `loadFailed=true`.
- `/coaches/[id]`: admin 선행, null notFound와 후속 0, 정상 4개 method와 기존 props/range.
- `/coaches/schedule`: admin 선행, factory 동기 throw 전파, dashboard reject만 기본 dashboard/loadFailed, holiday reject는 빈 map.
- `/coaches/[id]/engagements`: null notFound/후속 0, 정상 name/id/list/빈 feedback.
- `/instructor-wiki`: admin 선행, coach 실패는 보강만 생략. 동일 trim 이름은 마지막 coach summary가 적용된다.
- `/instructor-wiki/[id]`: NO notFound·이름 redirect·Notion-only 상세 보존. coach 보강은 첫 이름 일치의 detail만 사용한다.
- `/operations/[operationId]`: workspace 선행, 옵션 trim/빈 값 제거/중복 제거/`localeCompare("ko")`, coach 실패는 빈 옵션만.

공통 임계값: 7/7, 권한 거부 전 repository 0, 실제 redirect/notFound 목적지/상태 불일치 0, PG/실외부 접근 0, 전체 props/호출 인자 불일치 0. UI leaf만 대체하고 페이지/factory/업무 helper는 실제 코드를 사용한다.

## V3 Actual Mongo 조립과 저장 상태

- 새 loopback replica set·합성 데이터·임시 키로 actual `MongoCoachRepository`를 factory→7페이지 경로에 주입한다.
- 페이지별 정상 coach 경로 1개 이상, scoped method/인자와 독립 literal 결과를 확인한다.
- 별도 namespace의 다른 합성 coach로 동시 scope 혼합 0을 확인한다.
- read 동안 Mongo write command 0, 저장 문서에서 fixture 개인정보 평문 0, 기본 PG 0.
- 다른 필수 repository와 holiday/collaboration/UI는 합성 seam이며 전체 앱 native 조립으로 표현하지 않는다.

임계값: actual Mongo 페이지 7/7, 필수 opt-in skip 0, 금지 접근/혼합/평문 0.

재현 조건: 일정 쿼리 월을 명시하고 `TZ=Asia/Seoul`을 고정한다. 허용 seam은 session 공급자, UI leaf, holiday fetch, 비-coach repository, collaboration helper뿐이다. 실제 auth guard, page module, context, factory, `MongoCoachRepository`는 대체하지 않는다. `DATABASE_URL` 읽기와 Prisma repository 생성을 원문 계측으로 분리하고, 실제 `PrismaCoachRepository`의 모든 query가 거치는 `getPrismaClient` 진입을 별도 tripwire로 기록한다. scoped adapter 생성 0과 getter 진입 0이면 client 생성·query도 도달 불가능하므로 이를 지배 증거로 사용한다.

## V4 백업 결정 문서 정확성

- Google Drive=A 후보, OneDrive=B 후보.
- 로컬은 암호화 임시 생성·격리 복원 공간이며 영구 A/B가 아니다.
- 같은 클러스터·계정의 `hub-om-shadow-validation`과 `hub-om`은 독립 백업 2개가 아니다.
- 계정·용량·retention·전송/저장 암호화·독립 삭제/복구 권한은 실백업 전 미확인 gate다.
- 실제 업로드·checksum/개수·각 격리 복원·최종 동기화 전 운영 전환 금지.

임계값: 위 5항목 누락 0, 후보 지정을 실백업 완료로 표현한 문장 0.

## V5 회귀·독립 검토·정리·통합

- focused factory/page, 기존 coach parity/native 관련 검사, 일반 test/typecheck/lint/build를 실행한다.
- 필수 검사 fail 0. lint error 0·신규 warning 0.
- 제품·fixture·근거 hash, 실패와 보완, 미검증을 기록한다.
- 소유 Mongo DB/operation/프로세스/포트/dbpath를 정리한다.
- 독립 reviewer가 V1~V5를 판정하고 필수 gap 0이어야 한다.
- 작업→총괄 fast-forward, 두 원격 feature SHA 일치, clean. main/dev는 불변.
- 기준 SHA 대비 package/lockfile, Prisma schema, 신규 업무 필드, 삭제 정책 변경 0을 diff로 확인한다.
- 기능 수락 증거와 commit/push/총괄 통합 증거를 별도 항목으로 기록한다.

## 검증 범위

실제 실행: factory/page tests, loopback Mongo, 일반 검사, Git/자원 확인. 논리 검토: 백업 후보와 운영 gate 문구. 운영 DB·실원천·실클라우드 백업·배포는 실행하지 않으며 PASS로 세지 않는다.
