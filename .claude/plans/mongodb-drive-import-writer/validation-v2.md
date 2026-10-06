**validation-v1 제안 전문입니다.** 계획의 Shell/Core/Check 구성은 적합합니다. 다만 `confidence` 기본값, 1 미만 concurrency, try 바깥 입력 선택, commit 후 오류의 결과를 아래 기준대로 명확히 한 뒤 구조 gate를 닫아야 합니다. 새 사용자 결정은 필요하지 않습니다.

# Validation v2 — Drive CLI 이력 writer

상태: 독립 critic의 정적 검토·검증 설계안. 제품 구현, DB, 테스트 실행은 **NOT_RUN**이다. 파일을 저장하지 않았으며 부모가 본문을 저장한다.

기준은 `3c72e6997e057b7811e128e12ca6b354065de66a`, 대상 branch는 `feature/20260930-mongodb-drive-import-writer`다.

## 1. 구조 gate

| 기준 | 판정 | 근거·선행 보완 |
|---|---|---|
| S1 — 단계 태그 | PASS | 계획 S1 Shell, S2/S3 Core, S4/S5 Check |
| S2 — Core 존재 | PASS | 대상 선택·worker·집계·부분쓰기와 저장/원천 경계가 명시됨 |
| S3 — 조건부 규칙 | 보완 후 재판정 | 아래 원본 의미 및 실패 상태를 계획에 명확히 반영 |

필수 보완:

1. `keyCandidate`는 **evidence만 `?? ""`** 처리한다. confidence는 그대로 복사한다. “confidence/evidence 기본 빈문자열”로 구현하면 원본과 달라진다.
2. `0 < concurrency < 1`은 floor 후 **0**이다. 원본은 worker0·source0·result0인 채 전체 operationCount를 가진 run을 완료한다. 이를 최소1 또는 기본3으로 바꾸지 않는다.
3. `pickScanInput`은 개별 try/finally **밖**이다. 여기서 실패하면 error result·errors 증가·해당 항목 progress가 없다. source/후속 mapping/INSERT 실패와 구분한다.
4. INSERT 성공 후 오류 전달은 저장 전 실패와 다르다. 첫 result가 이미 저장됐으면 catch의 error result까지 남을 수 있다. 결과 수를 operationCount 이하로 제한하지 않는다.
5. 병렬 worker 하나가 실패해도 `Promise.all`이 다른 worker를 취소하지 않는다. 서비스 함수의 reject와 CLI `process.exit(1)`의 관찰 시점을 구분한다.

구조 FAIL 또는 미확정이면 후속 구현·검증 실행·수락을 중단한다. 보완 후 구조 PASS로 재개한다. 역사 PG의 실행 가능성은 별도 기술 gate이며, 추정으로 통과 처리하지 않는다.

## 2. 원본과 의도적 차이

세 증거를 분리한다.

| 증거 | 목적 |
|---|---|
| frozen 원본 CLI + 정당한 역사 migration prefix PG | 기존 workflow·집계·부분쓰기의 functional oracle |
| frozen 원본 CLI + 현재 encrypted schema PG | 실제 legacy guard 차단·source0·write0 |
| 새 writer + 현재 encrypted PG / 명시 native | 안전한 저장 경계와 기존 workflow 보존 |

기존 CLI를 현재 schema에서 실행 가능하게 만들기 위해 guard를 mock하거나 UUID DB default를 복원하지 않는다.

역사 PG는 **baseline CLI를 역사 schema에 실행하는 제한된 의미 검증 환경**이다. 당시 전체 애플리케이션을 복원했다고 주장하지 않는다.

의도적 차이는 별도 기록한다.

- 현재 encrypted PG에서는 원본 raw CLI가 차단되지만 새 안전한 writer는 실행된다.
- 새 경계는 민감 오류를 외부에 고정 code로 내보낸다.
- 명시 scope 누락 및 native scan 안전상한 초과는 fail-closed다.
- 이 차이를 원본과 동일한 오류로 정규화하여 숨기지 않는다.

## V1 — 역사 oracle·현재 차단·독립성

**R1/R6 → 계획 S1/S4**

### 역사 schema gate

migration 파일을 근거로 다음을 고정한다.

- 선택한 연속 migration prefix와 전체 hash.
- 원본 SELECT가 요구하는 컬럼·join·soft-delete 컬럼 존재.
- Drive run/result ID의 실제 DB default 존재.
- legacy guard가 검사하는 encrypted 표식 부재.
- 실제 FK·nullable·date·JSON·기본값.

확인된 migration 근거:

- `20260614190000_add_drive_import_runs`: 두 ID에 `gen_random_uuid()` default 생성.
- `20260629023708_add_coach_domain`: default 제거.
- `20260629043000_restore_uuid_defaults_for_import_tables`: 복원.
- `20260723062051_add_coach_day_reservation`: 다시 제거.
- `20260909150000_pii_encryption`: 암호화 schema 도입.

예컨대 두 번째 제거 전의 적합한 연속 prefix를 후보로 삼을 수 있지만, **실제 적용·카탈로그 확인·원본 실행 후에만** functional oracle로 수락한다. 현재 schema 일부를 임의 수정한 환경은 역사 oracle이 아니다.

### 현재 schema 차단 gate

실제 `assertLegacyStorage`를 유지한 frozen CLI를 별도 현재 PG에서 실행한다.

- DB 연결·표식 조회는 허용한다.
- 원본 차단 오류와 CLI 비정상 종료를 확인한다.
- source 호출0, 운영대상 조회0, run/result 쓰기0.
- 대상 raw 상태 전후 불변.
- guard를 통과시켜 UUID default 문제를 관찰하지 않는다. default 부재는 별도 schema 증거로 기록한다.

### closure·독립 기대값

CLI, guard, scanner, runtime 의존 모듈, loader, package/lock, migration prefix를 동결한다. origin→target, runtime/type-only/external, hash를 manifest로 남긴다.

역사 original/current PG/native는 process/module cache를 분리한다. 원본의 현재 제품 모듈 탈출을 금지한다.

정상 seam은 합성 환경·HTTP 및 필요한 원천 계약 fixture다. source fixture 사용과 실제 scanner 연결 증거를 구분한다. DB 함수 관찰은 실제 위임 결과를 바꾸지 않는다.

음성대조는 disposable 사본에서 수행한다.

- frozen CLI·guard·scanner bytes 변조 거부.
- 미등록 current import 탈출 거부.
- 실제 loader 및 migration 입력 변조 거부.

기대 run/result/summary는 제품 orchestration·mapper·reader를 호출하여 생성하지 않는다. 고정 입력의 독립 literal을 사용한다.

## V2 — 대상 선택·인자·scope·실행 순서

**R1/R2 → 계획 S2/S3**

### 운영대상

같은 합성 업무 fixture를 역사 PG/current PG/native에 준비한다.

- Session→Course→Company inner join.
- Session `deletedAt != null`만 제외.
- 삭제된 parent에 새 필터를 추가하지 않음.
- 누락 parent는 native에서 inner join처럼 제외. 정상 PG FK로 생성 불가능한 고아 상태를 PG 정상 데이터처럼 주장하지 않음.
- startDate ASC, null last, operationId ASC로 정렬한 뒤 limit.
- 입력 snapshot의 nullable 문자열은 원본처럼 `""`, 날짜는 원본 `dateOnly` 의미.
- 복호화된 링크·OM/LD가 source에 전달되는지 canary로 확인.
- 기본 fixture는 정렬키를 구별 가능하게 만든다. 완전 동점에 새 ID tie-break를 요구하지 않는다.
- 합성 PG collation/locale을 기록하고, 제한된 문자열 순서 관찰을 운영 collation 전체 동등성으로 확대하지 않는다.

limit0은 무제한 선택 의미다. native의 기존 scan 안전상한 초과는 명시 실패이며, 잘린 목록을 정상 완료하면 FAIL이다. 중간 limit 때문에 검사 대상 밖 데이터의 오류가 무시되는지 등은 기존 scan 계약과 대조한다.

### 인자·환경

`parseArgs` 원본 literal 표를 고정한다.

- 기본 concurrency3, limit0, mode `dry_run`.
- 유한 양수는 floor, 나머지는 각각 기본3/0.
- concurrency `0.5`→0, limit `0.5`→0.
- 0/음수/NaN/Infinity/정수/소수/누락 인자.
- 반복 flag, 다음 flag가 값 위치에 오는 입력을 원본과 대조.
- mode 임의 문자열은 기록만 바꾸며 scan/search 실행을 끄지 않는다.
- 합성 `.env` 다음 `.env.local`이 환경을 덮어쓰는 원본 순서 유지.

환경 행렬은 직렬 또는 별도 worker에서 검사한다. 실제 env 파일을 읽지 않는다.

### 경계 선택

- scope 밖 기본 writer는 encrypted PG, source는 기존 scanner 함수.
- 각 신규 writer/source port를 하나씩 제거하면 env/source/DB IO 전에 거부.
- 명시 native에서 기본 PG fallback0.
- module import만으로 env 읽기·DB 연결·source·process.exit0.
- 실제 CLI entry에서만 기존 환경 순서를 수행.
- 키/설정 오류가 있으면 source0. DB readiness 조회와 외부 source 호출을 구분한다.
- 원본의 실제 PG 접근 제한 장치를 mock으로 우회하지 않는다.

### link 선택

driveLink trim→lectureManagementLink trim→search를 고정한다.

- 두 링크가 모두 있으면 drive 우선.
- drive 공백이면 lecture, 모두 공백이면 search.
- 선택 후 후순위 링크를 불필요하게 평가하지 않음.
- search에 전달하는 운영 snapshot 전체 비교.
- nonstring 링크 실패는 source fixture/명시 런타임 주입으로 표시하며 정상 DB 관찰로 주장하지 않는다.

## V3 — scanner·후보 투영·집계

**R1/R3 → 계획 S2/S3/S4**

### 실제 scanner 새 연결

실제 scanner에 합성 OAuth/Drive/문서 HTTP를 연결하고 writer까지 실행한다. scanner 반환값을 mock한 검사만으로 이 기준을 충족하지 않는다.

최소 경로:

- 직접 폴더 링크 scan 성공.
- 폴더 참조 검색 및 링크 없는 operation search.
- 본문/후보를 가진 성공 응답.
- 설정 누락으로 HTTP0·issues 반환.
- OAuth 또는 Drive 실패가 throw 대신 issues 반환으로 바뀌는 경로.

동일 합성 HTTP fixture를 frozen scanner/current scanner에 공급한다. outgoing 요청·반환 후보/파일/issues·writer 저장값을 독립 기대값과 대조한다.

서버 공용 Google 설정과 token cache를 기존대로 유지한다. 동시 A/B에서 env를 변경하거나 tenant별 credential 지원을 주장하지 않는다. 새 연결 증거에는 cache cold/warm 차이를 구분하며 기존 cache 정책을 확장하지 않는다.

### 후보 계약 fixture

실제 scanner가 필터링하여 만들지 않는 극단값은 **writer source-port 계약 fixture**로 검사한다.

scan:

- candidateCount는 전체 후보 수.
- 저장 후보는 지정된 6 field만 포함.
- 허용 field 모두와 제외 field를 함께 넣는다.
- 저장 객체는 confidence/evidence/field/label/sourceTitle/value만 보존.
- evidence null/누락→`""`; confidence는 그대로 전달.
- id/action/sourceFileId/sourceUrl/applyable 등을 추가 저장하지 않음.
- 중복·입력 순서 유지.
- fileCount는 전체 files 수.
- folderId truthiness로 found/no-folder 결정.

search:

- candidateCount는 전체 수.
- 저장 후보는 입력 순서의 첫10개.
- confidence/reasons/score/title/url만 복사.
- 0/10/11개로 경계를 구별.
- 재정렬·dedup·누락 속성의 임의 기본값 추가 금지.

### 집계

독립 literal로 모든 summary 필드를 확인한다.

- scannedRefs/folderSearches는 source 호출 전에 증가.
- scanIssues는 issues 개수가 아니라 issues 있는 scan 건수.
- issues-only 결과는 errors를 증가시키지 않음.
- satisfaction/instructors 후보 집계는 저장 필터·INSERT 성공 여부와 별개.
- suspicious는 정확한 `"0.00"`, `"시계"`, `"등에서도"`를 구별하며 유사값을 포함하지 않음.
- INSERT 실패 전에 증가한 집계를 되돌리지 않음.
- completed/errors0이면서 issues가 존재하는 결과를 실패로 오판하지 않음.

## V4 — 부분쓰기·실패·동시성

**R3/R4/R5 → 계획 S2/S3/S4**

전체 실행 transaction, 보상 삭제, 전역 exactly-once, 새 source retry를 요구하거나 추가하지 않는다.

| 실패 지점 | 필수 관찰 |
|---|---|
| 대상 읽기/변환 실패 | run0/result0/source0 |
| createRun 저장 전 실패 | result0/source0 |
| createRun 실제 저장 후 오류 | pending run 보존, result0/source0 |
| try 밖 link 선택 실패 | 해당 error result0·errors 증가0·해당 finally progress0 |
| source throw / try 안 mapping 실패 | errors 증가 후 error result 쓰기 |
| 첫 result INSERT 저장 전 실패 | 이미 증가한 집계 유지, catch의 error result 쓰기 |
| 첫 result 실제 commit 후 오류 | 기존 result 유지, catch error result도 저장 가능 |
| catch의 error result 저장 실패 | run pending·기존 부분 result 유지, 정상 finish 없음 |
| finish 저장 전 실패 | result 유지, pending run의 persisted 집계/default/finishedAt 유지 |
| finish 실제 commit 후 오류 | 완료된 run/result 유지, 호출 실패와 DB 성공을 구분 |

추가 기준:

- Error와 non-Error source throw의 저장 문자열을 원본과 비교한다.
- driver 오류는 새 repository의 고정 code로 바뀌는 의도적 차이를 표시한다.
- run이 pending이면 메모리 summary를 DB에 기록된 summary처럼 기대하지 않는다.
- commit 후 오류 주입은 실제 위임 완료 후 주입했음을 관찰한다.
- unknown commit을 confirmed abort나 confirmed success로 임의 분류하지 않는다. 고정 barrier로 확정 가능한 사례를 우선하고, 불명확한 경우 전체 operation 단위 반영 여부와 한계를 별도 기록한다.
- native callback/commit retry가 필요하면 해당 짧은 저장 작업 안에 한정한다. source 재호출0·whole-run 재실행0을 확인한다.

### worker schedule

- concurrency1과 2 이상에서 index stride·최대 동시 source 수를 barrier로 확인한다.
- 0건은 completed run1/source0/result0.
- 양수 operationCount + concurrency0도 원본 의미대로 완료.
- 25배수 및 마지막 처리의 숫자 progress를 확인한다.
- 한 worker의 catch 재기록 실패 후 다른 worker는 자동 취소되지 않는다.
- 서비스 검사는 다른 worker를 결정적으로 settle시킨 뒤 남은 상태를 비교한다.
- CLI 검사는 실제 child 종료 시점의 상태를 별도 관찰한다. reject 직후 snapshot을 최종 상태라고 부르지 않는다.
- 동시 실행 및 재실행은 별도 run을 만든다. 전역 중복 금지 정책을 추가하지 않는다.

A/B는 불변 합성 서버 credential 아래 writer/source/DB/namespace를 분리하고 source overlap·한쪽 실패·양쪽 recovery를 확인한다.

## V5 — 전체 저장값·암호화·기존 reader 연결

**R2/R3/R4/R5 → 계획 S3/S4**

### whole tuple

역사 PG/current encrypted PG/native에서 다음을 비교한다.

- 전체 run: mode/status/operationCount/각 count/summary/notes/startedAt/finishedAt.
- 전체 result: ID/FK/업무 snapshot/date/input/resultKind/folder/fileCount/candidateCount/후보/issues/error/createdAt.
- NULL, `""`, JSON null, 빈 배열, 누락 JSON 속성을 구별.
- 먼저 ID 유일성·FK·동적 시간 타입/구간을 검사하고 이후 ID·시간만 정규화.
- DB UUID default와 Prisma/native UUID 생성의 차이를 허용하되 실제 유효 ID를 검사.
- 병렬 완료 순서를 임의로 동등하다고 가정하지 않는다. fixture operation 및 result 시도별 대응을 만들고 multiplicity를 보존한다.
- 실패 경로에서 result 수가 operationCount보다 많거나 적을 수 있음을 유지.

### 전집합 완전성

마지막 recovery와 worker settle 후 실제 전체 run/result ID 집합을, 검증한 반환값·저장 행에서 누적한 기대 집합과 비교한다.

- 추가/누락/중복 ID 없음.
- result→run 및 operationSession 연결 확인.
- 기대 집합을 마지막 DB 전체 조회로 생성하지 않음.
- A/B는 DB별 비교.
- pending/실패 상태도 예상되는 부분 결과를 명시적으로 등록.

동일 비교기에 메모리 음성대조를 적용한다.

- 추가 run/result.
- 고아 result.
- 누락·동일 개수 ID 교체·중복 ID.
- 잘못된 부모 연결.
- tuple 필드 누락/추가/NULL 변경.
- 후보 10번째 누락·11번째 추가/교체.
- 집계 값 변경.

정상 fixture는 통과하고 변형은 거부해야 한다.

### 암호화와 비대상 상태

현재 privacy policy에 지정된 필드만 기준으로 다음을 확인한다.

- 실제 PG/native raw 저장은 암호문이고 복호화하면 기대값과 일치.
- index 대상 필드는 companion HMAC 검증.
- key/HMAC/암호문 실패 시 fallback·부분 평문쓰기 없음.
- malformed key 설정과 유효 형식의 잘못된 key에 의한 read 실패를 구분.
- source 오류 원문은 승인된 encrypted error 저장에서 보존하되 console/외부 오류에는 고정 code.
- driver message·cause·stack·합성 token/key canary 비노출.
- 최종 console summary는 승인된 runId/status/집계 값으로 제한.

Company/Course/OperationSession 등 읽기 대상 업무 raw 상태는 nonempty sentinel을 포함해 불변이어야 한다. 기존 미분류 snapshot 필드를 이번에 임의 암호화·재분류하지 않는다.

실제 기존 Drive history reader로 완료·부분 실패 이력을 조회하여 독립 DTO와 비교한다. reader 반환값을 expected builder로 사용하지 않는다. 기존 페이지/auth 전체 행렬을 이번 작업에서 다시 만들 필요는 없다.

## V6 — 재사용·실행·정리·통합

**R6 → 계획 S4/S5**

### 재사용 조건

기존 scanner unit, Drive history, codec/HMAC/readiness/scan/transaction 증거는 다음이 있을 때 재사용한다.

- 정확한 기준 SHA, 의존 제품 파일·테스트·로그 hash.
- 재사용 case와 관찰 범위.
- 이번 변경의 영향 분석.
- 새 writer→해당 기반의 실제 연결 증거.

다음은 재사용으로 대체할 수 없다.

- 역사 schema functional oracle와 현재 guard gate.
- 새 CLI/main/import 경계.
- writer 부분쓰기·집계·catch 재기록.
- 실제 scanner 합성 HTTP→writer 저장.
- 신규 scope 및 A/B 격리.
- 신규 native writer의 FK·쓰기·오류 연결.

기반 hash 변경이나 연결 실패가 있으면 영향 검사만 확대한다. 전체 Mongo·Calendar·기존 UI 행렬을 근거 없이 반복하지 않는다.

### 실행·인계

- PG56753/Mongo27853 예정 환경의 실제 소유권·DB·data directory·replica·버전을 확인한다.
- 역사 PG와 현재 PG는 별도 DB이며 migration 상태를 각각 기록한다.
- 실제 env/원천/운영키를 사용하지 않는다.
- DB 검사는 부모가 실행하고 필수 검사는 skip0.
- 일반 test/typecheck/build/lint 결과와 기존 warning을 기록한다.
- 최종 source/runner/manifest hash, 명령, exit, 로그, 재사용 근거를 연결한다.
- timeout은 TERM/KILL 뒤 observed exit를 기다리고 후속 실행을 중단한다. 강제종료 후 cleanup 성공을 추정하지 않는다.
- 독립 지적은 수정→영향 재검증→재수락으로 닫는다.
- 데이터 정리, 연결/작업 종료, process/port/dbpath 철거, 원격 통합을 별도 상태로 기록한다.
- 실 Google·운영 collation·실 backup/restore·전체 앱 전환·미확인 예약 실행은 미검증으로 남긴다.

## 3. 추적표와 현재 판정

| 요구사항 | 주요 검증 |
|---|---|
| R1 원본 계약·다중 모듈 호환 | V1/V2/V3 |
| R2 scope·fallback·저장 경계 | V2/V4/V5 |
| R3 분기·변환·집계 | V2/V3/V4/V5 |
| R4 부분쓰기·동시성·완전성 | V4/V5 |
| R5 외부 실패·민감정보 보호 | V3/V4/V5 |
| R6 독립 증거·정리·인계 | V1/V6 |

**현재 상태:** 구조 S1/S2 PASS, S3는 위 명확화 반영 후 재판정. 역사 schema 기술 gate 및 V1–V6 실행은 모두 **NOT_RUN/PENDING**이다. 실행 가능성이 입증되지 않은 원본을 functional oracle로 인정하거나, 기존 부분쓰기 의미를 더 강한 새 정책으로 바꾸지 않는다.

## 메타 검토 반영 — v2 규범적 보완

v1의정적상태표는원검토이력이며아래보완과plan-v2가최종재판정대상이다. meta-evaluation.md의5개P2를모두수락한다.

M1: 역사prefix17/ID불능prefix18/current45의세별도DBgate. 원문연속migrationhash/실카탈로그/default/FK/실guard위임을증명하고, prefix18은createRun에서23502/source0/run-result0, current는운영조회/DML/source0. 하나라도미확정이면구현대기.
M2: UTC/AsiaSeoul별도worker에서DATE원값→driver타입/값→dateOnly→source→저장날짜를관찰/같은TZ비교. 업무날짜차이정규화금지. NOTNULL업무날짜와nullable결과날짜분리. rawstatus보존/확인된enum만명시logical대응.
M3: 5모델기존metadata와정상metadata아래historicalinvalid문서를먼저검증. 누락+잘못된기존이공존하면DDL0/raw불변/prepare거부. crypto/HMAC실패별도.
M4: load단일snapshot·run없음/session없음/softdeleted존재구분. load후softdelete경합에도snapshot불변. native물리삭제동시CASCADE/SETNULL동등성은수락범위외/전역후속gate. CLI activitycontext없는감사쓰기0.
M5: 실제첫appendcommit확인후fault1회/catchappend성공은정확히성공+오류2행/source1/errors1. create/finish commit후fault도독립조회/도달횟수필수. transport/DB관찰assert가catch에삼켜져도별도위반누적/외부단언/음성대조로거부.

추가명확화: Google설정누락issues와저장소암호화키오류분리, 공유cachecredential격리신규정책없음, 기존scannerunit미발견은재사용증거0. source throw String변환실패는원본대로관찰. plan-v2의immutablegit-object 원본resolver는기존실명코드의새공개복제금지를위한저장방식이며closure/hash/negative-control 기준은동일하다.
