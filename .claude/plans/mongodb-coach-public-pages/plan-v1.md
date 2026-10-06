# Plan v1: mongodb-coach-public-pages

## 핵심 난이도

페이지가 오류를 잡아 빈 상태나 best-effort로 바꾸는 상황에서도 저장소 선택 오류를 검출해야 한다. 화면 결과와 storage ledger를 함께 판정하는 것이 Core다.

## Step 1 [Core] 저장소 선택·페이지 의미 판정 프레임워크

각 호출을 `scope 없음`, `scope에 coach 있음`, `scope 있으나 coach 없음`으로 분류한다.

- scope 없음이면 기존 `DATABASE_URL` guard 후 새 `PrismaCoachRepository`를 반환해야 한다.
- scope에 coach가 있으면 환경·PG client를 읽지 않고 동일 객체를 반환해야 한다.
- scope가 있으나 coach가 없으면 `getDataRepositoryOverride("coach")`가 고정 오류를 내야 하며 PG fallback 호출 수는 0이어야 한다.

각 페이지는 기존 제어 흐름대로 판정한다.

- 코치 목록/일정은 repository 실패를 `loadFailed`로 바꾸되 저장소 ledger가 scoped Mongo만 가리켜야 한다.
- 코치 상세/투입은 null이면 기존 notFound, 정상 값이면 기존 호출 순서와 DTO를 유지한다.
- 강사 위키/운영 상세의 coach 보강은 실패를 best-effort로 무시하되, 성공 시 기존 이름 매칭·옵션 정렬을 유지한다.
- 인증 실패면 repository 호출 전에 redirect/deny가 발생해야 한다.

산출물: 수정 범위와 테스트 oracle. 수락 기준: 세 분기와 7개 호출 페이지가 각각 기존 의미와 금지 fallback ledger로 판정 가능하다.

## Step 2 [Shell] factory/context 최소 연결

`DataRepositories`에 `coach: CoachRepository` 슬롯을 추가하고 factory가 `getDataRepositoryOverride("coach") ?? new PrismaCoachRepository()`를 사용하게 한다. 기존 scope 누락 fail-closed와 기본 `DATABASE_URL` guard 순서를 보존한다.

산출물: `dataRepositoryContext.ts`, `coachRepositoryFactory.ts`. 수락 기준: 새 runtime selector/env toggle 없이 타입 슬롯과 factory 선택만 변경된다.

## Step 3 [Shell] 백업 A/B 결정 기록

Google Drive=A, OneDrive=B 후보를 기록한다. 로컬은 암호화 임시 생성·격리 복원 공간이며 영구 A/B가 아니다. 같은 클러스터·계정의 `hub-om-shadow-validation`, `hub-om`은 백업 2개로 계산하지 않는다. 실제 서비스의 계정 독립성·용량·retention·암호화·복구 권한은 미확인으로 유지한다.

산출물: backup/cutover 결정 문서. 수락 기준: 후보 확정과 아직 필요한 실증을 구분하고 운영 실행 승인을 만들지 않는다.

## Step 4 [Check] factory와 실제 페이지 조립 검증

factory의 기본/명시/누락 scope, 중첩·동시 scope를 검사한다. 실제 페이지 모듈을 호출해 인증 선행, coach 목록·상세·일정·투입 및 강사 위키·운영 상세의 기존 정상/빈/오류 의미를 확인한다. 화면 결과만으로 판정하지 않고 PG/env/외부 접근 ledger 0과 scoped repository 호출을 함께 단언한다.

산출물: focused test와 실행 로그. 수락 기준: 모든 지정 페이지에서 scoped 객체 사용, 누락 scope fail-closed, 금지 fallback 0.

## Step 5 [Check] 실제 Mongo 및 전체 회귀

새 loopback replica set·합성 데이터·임시 키로 기존 `MongoCoachRepository`와 페이지 경계를 실행한다. 기존 parity/native 테스트를 필요한 범위에서 재사용하고, 일반 test/typecheck/lint/build를 실행한다. 실패는 보완 후 관련 검사만 재실행한다.

산출물: execution evidence. 수락 기준: 필수 검사 0 fail, lint는 오류 0이며 기존 경고만 허용, 운영/외부 접근 0, 소유 자원 정리 완료.

## Step 6 [Check] 독립 리뷰·통합·인계

Validation v2로 구현과 실행 증거를 독립 검토한다. macro/coverage/handoff/alignment를 갱신하고 작업 브랜치와 총괄 브랜치를 동일 SHA로 원격 push한다.

산출물: execution manifest/review, alignment review, handoff, integration record. 수락 기준: 미해결 필수 gap 0, 원격 SHA 일치, 작업트리 clean. main/dev와 운영 설정은 불변.
