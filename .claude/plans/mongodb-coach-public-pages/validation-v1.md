# Validation v1: mongodb-coach-public-pages

## 구조 기준 — Plan 완전성

- S-1 태깅: PASS. 6개 Step 모두 태그가 있다.
- S-2 Core Step >= 1: PASS. Step 1이 저장소 선택과 페이지 의미 판정 규칙을 정의한다.
- S-3 Core 분석 프레임워크: FAIL. 일정 페이지의 factory 동기 throw와 repository Promise reject를 같은 `loadFailed` 결과로 묶었다.
- 구조 기준 종합: FAIL. 아래 결과 기준은 수정 계획의 검증 명세이며 실행 PASS 판정이 아니다.

필수 교정: 일정 페이지는 factory가 `Promise.allSettled` 인자 생성 중 동기 throw하면 페이지가 reject되고 holiday도 시작되지 않는다. repository Promise reject만 기본 dashboard와 `loadFailed=true`가 된다. 목록 페이지는 factory까지 try 안이라 두 오류를 잡는다. 누락 scope의 factory 실패 계약과 페이지 표현을 분리해야 한다.

## 식별된 암묵적 가정

- public은 익명 접근이 아니다. 코치·위키는 admin, 운영 상세는 workspace guard다. — 기준 2
- 누락 scope는 목록/best-effort 페이지에서 잡힐 수 있으므로 빈 화면만으로 fail-closed를 증명할 수 없다. — 기준 1·2
- override를 먼저 확인하고 scope 밖에서만 기존 `DATABASE_URL` guard를 실행해야 한다. — 기준 1
- 위키·운영 상세는 coach 외 추가 의존성이 필요하다. 다른 누락으로 조기 실패하면 coach 검증으로 세지 않는다. — 기준 2·3
- 기존 repository parity는 신규 factory/page 조립을 보증하지 않는다. — 기준 3
- 이름 trim·첫 일치·중복 제거·한국어 정렬을 개선 명목으로 바꾸면 회귀다. — 기준 2
- Google Drive/OneDrive 후보 지정은 독립성·복원 완료 증거가 아니다. — 기준 3

## 결과 기준

### 기준 1: factory 세 분기와 숨은 PG fallback 차단

다음 모든 분기가 필수다.

| 입력 | 필수 결과 |
| --- | --- |
| scope 없음, DATABASE_URL 있음 | `PrismaCoachRepository` 반환, query 0 |
| scope 없음, DATABASE_URL 없음 | 기존 `DATABASE_URL is required to access the coach repository.` |
| scope에 coach 있음 | 주입 객체와 동일, env guard·기본 PG 생성/조회 0 |
| scope 있으나 coach 없음 | `DATA_REPOSITORY_NOT_CONFIGURED: coach`, 환경 fallback·PG 0 |
| 외부 coach scope 안 빈 scope | 외부 상속 없이 누락 오류, 종료 후 외부 복원 |
| 동시 A/B | 저장소·호출·결과 혼합 0 |

Mongo 환경값만으로 기본 backend를 전환하지 않는다. 기본 PG 진입 시도와 client/query를 별도 ledger로 기록하고 제품 catch 밖에서 단언한다. 오류를 삼킨 금지 fallback 음성대조가 반드시 실패해야 한다.

임계값: 사례 누락 0, 명시/누락 scope의 PG 진입·client/query 각 0, 객체/오류 불일치 0, 음성대조 탐지 100%.

### 기준 2: 실제 7페이지 권한·DTO·제어 흐름 보존

| 페이지 | 필수 의미 |
| --- | --- |
| `/coaches` | admin 선행, factory throw와 조회 reject 모두 빈 목록·loadFailed true |
| `/coaches/[id]` | admin 선행, null이면 notFound·후속 3조회 0, 정상 props 유지 |
| `/coaches/schedule` | admin 선행, factory 동기 throw는 페이지 reject, dashboard reject만 기본 dashboard/loadFailed, holiday 실패는 빈 map |
| `/coaches/[id]/engagements` | admin 선행, null이면 notFound·목록 조회 0, 정상 이름/ID/목록/빈 feedback 유지 |
| `/instructor-wiki` | admin 선행, coach 오류는 operation loadFailed/provenance를 바꾸지 않고 보강만 생략 |
| `/instructor-wiki/[id]` | admin 선행, 기존 NO notFound·이름 redirect·Notion-only 상세, coach 실패는 보강만 생략 |
| `/operations/[operationId]` | workspace 선행, coach 옵션 trim·빈 값 제거·중복 제거·한국어 정렬, coach 오류는 옵션만 빈 배열 |

실제 페이지와 factory를 사용한다. 인증 거부의 모든 repository 호출은 0이다. factory 선택 객체와 method/인자, tab/month/range, yearMonth/date/email을 단언한다. 위키 공백 이름과 운영 옵션 중복·한국어 정렬 fixture를 둔다. UI leaf만 props 관찰용으로 대체한다. redirect/notFound는 실제 제어 흐름을 검사한다. 잡힌 오류가 있어도 fallback ledger에 금지 접근이 있으면 FAIL이다.

임계값: 페이지 7/7, 인증·정상·빈/실패·누락 의미 불일치 0, DTO/순서/매칭/redirect/notFound 불일치 0, 실외부·기본 PG 접근 0.

### 기준 3: actual Mongo 증거와 백업 A/B 상태 정확성

- 새 loopback replica set·합성 행·임시 키에서 기존 `MongoCoachRepository`를 명시 scope로 주입한다.
- 7페이지 각각 coach 경로 정상 사례를 actual Mongo로 실행한다. 다른 필수 port가 합성이면 구분한다.
- 실제 Mongo 결과를 독립 literal props/결과와 대조하고 기본 PG 0을 기록한다.
- 별도 namespace/DB의 다른 합성 데이터로 scope 혼합 0을 확인하되 백업 A/B 증거로 부르지 않는다.
- 기존 parity/native의 hash·재사용 범위와 이번 신규 실행을 구분한다.
- 일반 test/typecheck/lint/build, 독립 리뷰, 실패 로그, 자원 정리, hash, 원격 SHA/clean을 기록한다.

백업 문서 허용 상태:

| 항목 | 허용 상태 |
| --- | --- |
| Google Drive | A 후보 |
| OneDrive | B 후보 |
| 로컬 | 암호화 임시 생성·격리 복원 공간, A/B 아님 |
| 같은 클러스터·계정의 두 Mongo DB | 독립 백업 2개가 아님 |
| 계정·용량·retention·암호화·독립 삭제/복구 권한 | 미확인, 실백업 전 gate |
| 업로드·무결성·각 격리 복원·최종 동기화 | 실제 증거 전 미완료 |
| 운영 backend 전환 | 실행·승인하지 않음 |

임계값: actual Mongo 페이지 7/7, 혼합·PG fallback·운영/외부 접근 0, 필수 검사 0 fail/0 미해결 gap, lint 0 error·신규 warning 0, hash 불일치 0, 백업 상태 누락/과장 0, 원격 두 feature SHA 일치와 clean.

## 판정 및 최소 수정

현재 S-3 FAIL이다. Plan v2에서 일정 페이지 오류 위치를 분리하고, factory 선택 순서, 7페이지별 제어 흐름·ledger, actual Mongo와 백업 후보/미확인을 명시한다.
