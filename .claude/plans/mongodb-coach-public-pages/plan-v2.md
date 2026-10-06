# Plan v2: mongodb-coach-public-pages

## Changelog

- 일정 페이지 오류 위치를 factory 동기 throw·dashboard reject·holiday reject로 분리했다.
- factory를 scope override 우선, 기본 경로에서만 DATABASE_URL guard 순서로 확정했다.
- 위키 목록 마지막 일치와 상세 첫 일치, actual Mongo와 합성 인접 port 구분을 추가했다.
- 백업 후보 결정과 남은 실증 gate를 분리했다.

## Step 1 [Core] 결정표로 조립 계약 고정

입력은 scope 상태, 페이지, auth 결과, coach method 결과다. scope가 존재하면 `getDataRepositoryOverride("coach")`를 먼저 평가한다. 객체면 반환하고, 누락이면 고정 오류다. scope가 없을 때만 DATABASE_URL을 확인해 PG adapter를 만든다.

페이지 출력은 기존 catch 위치가 결정한다. 목록은 factory/Promise 오류를 잡는다. 일정은 factory 동기 오류를 전파하고 dashboard Promise 오류만 loadFailed로 바꾼다. 상세/투입은 null notFound 후 후속 0, 정상 후속 오류는 전파한다. 위키/운영 상세는 coach 오류만 best-effort로 생략한다. 위키 목록은 trim 이름 Map의 마지막 summary, 상세는 첫 summary의 detail을 사용한다.

수락: Validation V1/V2의 각 입력이 결과와 ledger 하나로 결정된다.

## Step 2 [Shell] factory/context 최소 변경

`DataRepositories`에 `coach: CoachRepository`를 추가한다. factory는 override가 있으면 즉시 반환하고 기본 경로에만 기존 guard와 `PrismaCoachRepository` 생성을 적용한다. 페이지와 Mongo repository는 수정하지 않는다.

수락: 제품 변경 2파일, 새 env selector/의존성/schema 없음.

## Step 3 [Shell] 백업 A/B 결정 문서화

backup-cutover plan과 operational decision에 Google Drive A·OneDrive B 후보, 로컬 임시 암호화 공간, 동일 클러스터/계정 Mongo DB 비독립, 남은 계정·용량·retention·암호화·복구권한/실복원 gate를 기록한다.

수락: Validation V4 5항목, 운영 승인/완료 표현 0.

## Step 4 [Check] factory 및 7페이지 actual boundary test

실제 auth guard·factory·page/helper를 유지하고 UI leaf와 다른 필수 port만 합성한다. factory 7분기, 페이지 7/7의 권한/정상/빈/실패/notFound/redirect/props를 catch 밖 ledger와 검증한다. actual Mongo는 새 replica set에서 기존 codec/readiness/fixture를 사용해 7페이지 정상 경로를 실행하고 다른 namespace 동시 격리를 확인한다.

수락: Validation V1~V3, 필수 opt-in skip 0, PG/외부/write/plaintext ledger 0.

## Step 5 [Check] 회귀·독립 결과 검토

focused와 영향받은 기존 coach tests, 일반 test/typecheck/lint/build를 실행한다. 실행 manifest를 작성하고 독립 critic이 V1~V5를 판정한다. gap은 최소 수정·관련 재검증으로 닫는다.

수락: fail 0, lint error/new warning 0, 필수 gap 0.

## Step 6 [Check] 정리·alignment·handoff·통합

소유 Mongo 자원을 audit 후 종료·삭제한다. macro/coverage, execution review, alignment review, handoff를 갱신한다. 작업 브랜치를 commit/push하고 총괄로 fast-forward하여 두 원격 feature SHA와 clean/source hash를 확인한다.

수락: 자원 잔존 0, 원격 SHA 동일. main/dev·운영/실백업은 불변.
