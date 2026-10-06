# Plan v2 — Drive history read → page

이번 조정자 사전계획 위임만 수행 / 구현·실행 NOT_RUN. 사람 사용자의 구현 지속 승인은 유지된다. 입력: [clarify-result](clarify-result.md). 요구사항 ID R1–R7을 사용한다.

상태: READY_FOR_COORDINATOR_REVIEW — Sagan meta-review M1–M6 및 조정자가 전달한 Parfit critic(P1/P2)을 반영했다. 조정자 검토 전 구현 착수하지 않는다. 계획 최종 수락·실행 PASS 아님. v1 보존, 실행 NOT_RUN.

## 첫 번째 행위: 핵심 난이도 식별

어려운 부분은 findFirst 교체가 아니라, PG가 오류까지 null로 돌려주는 공개 동작과 명시 Mongo의 fail-closed 경계를 분리하면서 같은 저장 이력·순서를 반환하는 것이다. PG의 동률과 DB collation, 암호화된 JSON, 필수 run과 nullable session, 페이지의 전역 최신 조회를 섞으면 통과하는 테스트로도 잘못된 이력을 보여줄 수 있다.
Core의 입력은 backend/scope/auth/DB 상태와 원본 저장 행이고 출력은 전체 DTO 또는 정해진 실패다. 아래 C1–C9 규칙으로 출력/허용집합을 정한다. 인턴이 새 팀 필터·최신 성공 run·동률 ID순을 발명할 필요가 없게 한다.

## 원본 계약과 조건부 규칙

### C1 — backend·scope·오류 (R1,R2,R4)

- scope 없음 → 기존 export가 PG adapter로 위임. DATABASE_URL falsy이면 client 생성 없이 null. 조회·privacy decode·DTO 변환 예외는 기존 try/catch 안에서 null. 이 PG 한계를 의도적으로 유지한다.
- scope 있음 → `getDataRepositoryOverride("driveImportHistory")`를 env 검사와 PG catch 바깥에서 먼저 해석한다. 없음이면 기존 `DATA_REPOSITORY_NOT_CONFIGURED: driveImportHistory` 실패. 명시 repo 오류를 PG catch로 삼키거나 default PG로 재시도하지 않는다.
- Mongo 정상 empty는 null. namespace/policy/codec/부모/자원 제한/driver 실패는 고정 내부 오류 `DRIVE_IMPORT_HISTORY_READ_FAILED`로 변환한다(계획상 신규 내부 코드). raw message/cause/stack/URI/문서값을 화면·로그에 전달하지 않는다. repository scope의 기존 고정 오류는 유지. 새로운 HTTP API/응답 code 계약은 만들지 않는다.
- 저장된 `result.error`, issues, candidate evidence는 기존 DTO 데이터이므로 인증된 페이지에서 기존대로 표시한다. 새 runtime 예외의 raw message를 이 필드에 넣는 것은 금지한다. 저장된 과거 오류의 내용 정화는 별도 정책 과제다.

### C2 — 선택과 순서 (R1,R3)

- 단건: operationId 문자열 exact 비교(임의 trim/case/UUID 정규화 없음). 후보는 해당 operationId의 Result. run.startedAt 내림차순, 다음 createdAt 내림차순으로 하나. run.status/finishedAt/operation 삭제 상태와 무관하다.
- run: 모든 Run 중 startedAt 최대 하나. 실패/진행 중 최신 run을 건너뛰지 않는다. 결과가 0개인 최신 run도 그 run의 DTO+results=[]다. 과거 결과로 채우지 않는다.
- 결과: 선택한 runId의 Result를 candidateCount 내림차순 → companyName 오름차순 → courseName 오름차순으로 정렬하고 `take=resultLimit`, 생략이면 250. 카운터는 Run 저장값 그대로이고 페이지에 표시된 결과 수로 재계산하지 않는다.
- 동률: PG orderBy에 없는 id/createdAt/삽입순을 업무 조건으로 추가하지 않는다. 동률 run이면 최대 startedAt 집합 중 한 run과 그 run의 일관된 전체 DTO만 허용한다. 단건 동률이면 최대 (run.startedAt,createdAt) 집합 중 한 완전한 DTO만 허용한다. 각 필드를 서로 다른 후보에서 섞으면 실패한다.
- 250 경계: 비동률 상위 행은 모두 포함하고, 경계 동률 집합에서 필요한 수만 중복 없이 선택한다. 동률 안 순열은 허용하되 비동률 역전은 실패한다. 테스트는 fixture의 고유 표시값으로 행 정체성을 확인한다(id가 DTO에 없기 때문).
- 문자열 정렬은 실제 baseline PG collation을 기록해 재현한다. JS localeCompare를 무근거로 동등 처리하지 않는다. ASCII/대소문자/한글/악센트/동일 접두부 fixture로 실제 PG 순서와 effective collation을 읽기 확인하고 그 baseline을 재현할 근거를 확보한다. PG collation 설정을 시험에 맞춰 변경하지 않는다. 환경별 collation 확대 지원은 주장하지 않는다. 증거가 없으면 V3 미통과다.
- 기본값 외 0,1,249,250,251 및 음수(-1,-250), 소수/NaN/Infinity/큰 수는 원본 Prisma의 실제 take 결과 또는 catch→null을 먼저 기록한다. 기존 인자를 새 1..250 규칙으로 clamp/reject하지 않는다. 원본에서 유효한 음수 take는 원본과 같은 전체 DTO/순서를 구현한다. scope 선택은 언제나 먼저 수행한다. 올바른 scope에서 원본이 거부해 null인 잘못된 인자는 DB/metadata 읽기 전 null로 처리한다. 따라서 잘못된 인자+손상 저장소는 null, 잘못된 인자+누락 scope는 scope 실패다. 유효 인자는 손상/예산 실패를 null로 숨기지 않는다. 기술적 oracle 확정 전 수락하지 않는다.

### C3 — 전체 DTO·JSON (R1,R3)

원본 네 interface와 return literal 전체를 독립 oracle 명세로 동결한다. 단건의 candidateCount/createdAt/fileCount/folderCandidates/folderTitle/folderUrl/inputKind/inputValue/issues/keyCandidates/resultKind/runId/runStartedAt/runStatus; run의 id/mode/status/start/finish와 모든 11개 count 필드 및 results 전체를 누락 없이 비교한다. 정확한 필드 이름/개수는 원본 interface 자체가 기준이며 요약 숫자로 대체하지 않는다.
createdAt/startedAt는 toISOString, startDate/endDate는 ISO 앞 10자 또는 null이면 빈 문자열, finishedAt null은 빈 문자열이다. nullable folder/input/error 텍스트는 기존 `?? ""`를 보존한다.
JSON 배열이 아니면 후보/이슈 목록은 []; 후보 배열은 truthy object만 보존하므로 배열 원소인 배열과 빈 객체도 현재 필터상 통과한다. 이슈는 string만 보존(빈 문자열 포함). 요소 필드 추가 정제/정렬/PII 제거를 발명하지 않는다. 순서와 중첩 값은 deep equality, object property insertion order는 비교 대상 아님. DB null/JSON null은 codec sentinel을 원래 Prisma 의미로 복원한 뒤 변환한다.

### C4 — 관계·일관성 (R4)

Result.runId의 Run은 필수다. Mongo 조회가 고려하는 후보(Result)는 같은 읽기 snapshot에서 run 존재/참조 일치를 확인한다. 단건은 exact operationId 후보 전부를 take 이전에 확인한다. run 조회는 선택된 run의 결과 전부를 take 이전에 확인한다(250 밖 포함). 단건 후보 중 orphan이 있으면 오래된 정상 행으로 대체하거나 empty 처리하지 않고 실패한다. run 조회에서는 선택된 run의 결과만 대상으로 하며 무관한 다른 run의 전수 무결성 감사로 확대하지 않는다. Run이 아예 없으면 run 조회는 null이며 이것으로 DB 전체 orphan 부재를 주장하지 않는다.
operationSessionId=null은 합법적이고 이력 자체로 표시한다. non-null 참조는 같은 namespace/snapshot의 정확 session ID 존재만 확인하고 깨졌으면 실패한다. session.operationId와 이력 operationId의 일치, Company/Course 현재 이름/존재는 새 불변식으로 강제하지 않는다. 다른 namespace에만 같은 ID 부모가 있으면 없는 부모다. session이 존재하되 soft-deleted인 경우는 원본대로 이력을 반환한다. Company/Course의 현재 이름으로 snapshot 이름을 덮어쓰지 않고 관계를 불필요하게 따라가지 않는다. 필요 모델은 Run,Result,OperationSession(참조 존재 확인용)이며 session null에서 부모를 강제하지 않는다.
Mongo read-only snapshot transaction에서 후보·run·필요 session의 identity projection을 읽어 섞인 상태를 막는다. 이 선택을 원본 PG 모든 동시 interleaving과 exact 동등이라고 과장하지 않는다. 원본이 허용하는 완전한 snapshot 결과를 비교한다. 조회에서 복구/부모 생성/감사 INSERT/인덱스 자동생성은 하지 않는다.

### C5 — PII·자원·안전 (R4,R6)

기존 mongoRuntimeCodec/registry/read-store metadata를 사용한다. HMAC 검색이 필요한 필드가 추가되면 기존 인증/원문 대조 규칙을 따르지만 public operationId/runId를 새 private schema로 바꾸지 않는다. Run summary/notes, Result의 등록된 protected 필드는 기존 정책으로 인증·복호화하며 raw 문서/키/HMAC companion은 DTO에 포함하지 않는다.
회사·과정 snapshot 이름이 현재 registry 보호 대상이 아니라는 사실을 명시한다. 이번 계획은 schema/registry 확장을 승인하지 않는다. synthetic만 쓰고 전체 PII 이전 완료는 주장하지 않는다. 이 부분은 상위 전환의 잔여 보안 검토 대상이다.
공통 store/budget framework는 변경하지 않는다. 이 reader 안의 작은 로컬 budget/읽기 helper만 사용하며 기존 scan별 20,000행/32MiB·15초 한계를 유지한다. limit250은 출력 한계이며 scan 한계와 다르다. 명시 Mongo public read 호출 하나에만 60초 처리 deadline과 누적 20,000행/32MiB 읽기 budget을 적용한다. 이는 원본 PG에 없는 의도적 제한이며 PG 동등성 주장 대상이 아니다. PG/auth/teamMembers에는 새 제한을 적용하지 않는다. 초과하면 고정 실패, 조용한 앞부분 반환 금지. 행/byte 정확 경계는 포함, +1행/+1byte는 실패. 시간은 monotonic 진입시각 기준 elapsed>=60,000ms이면 만료(정확60초도 실패)다. 시간 경과·세션 종료는 finally로 보장하고 드라이버 실패 재시도 때문에 예산을 초기화하지 않는다.
준비 함수는 별도 명시 합성 setup에서만 metadata/index를 준비하고, open/read는 기존 준비 상태 확인만 한다. 운영 URI/default env fallback 없음. 정적 fixture는 setup 후 읽기 전후 업무 컬렉션과 ActivityChange의 정렬 canonical 전체 문서 digest를 비교한다(count/bytes만 비교 금지). 경쟁 fixture는 별도 controller의 정확 쓰기 목록과 reader의 쓰기0을 구분한다.

### C6 — 페이지 auth·preflight·표시 (R2,R5)

requireWorkspaceSession을 먼저 실행한다. 인증 실패면 이력/명단 데이터 읽기 0. 기존 이메일·redirect·개발 bypass 정책은 변경하지 않는다.
인증 후 stored teamMembers와 driveImportHistory 두 의존성을 모두 해석한 다음 listResourceOwners/readLatestDriveImportRun을 시작한다. 하나라도 명시 scope에 없으면 양쪽 데이터 읽기 0. repo object 생성/선택과 실제 DB 읽기를 분리한다. 부분 scope에서 한쪽 조회가 먼저 시작되는 Promise.all 배치를 피한다.
기본 PG/local 명단 선택, searchParams/resolveTeamScope/sidebar/operation 링크 team query는 그대로. 페이지 본문 이력은 전역 최신 run이다. 새 admin 권한/팀 이력 필터를 추가하지 않는다.
기존 empty 문구, 6개 요약 지표, results.length와 run shortId/시각, 행 순서/날짜/링크, keyCandidates 우선 6개 아니면 folderCandidates 4개, issues 3개/error 우선, 사내→사내강사 표시를 유지한다. 실제 page component와 하위 표현 함수를 사용한다. 링크는 렌더만 하고 실제 URL 접근은 하지 않는다.

### C7 — Calendar composition (R2,R7)

신규 scope 키 추가만으로 Calendar 등록 composition을 해체/재등록하지 않는다. 별도 비등록 read-only 합성 scope `{driveImportHistory,teamMembers}`를 테스트한다. 기존 등록 Calendar runtime object를 일부만 재사용해 만든 scope는 현재 검사를 그대로 실패해야 한다. 기존 complete Calendar bundle은 기존 경로대로 동작해야 한다.
등록 bundle의 새 Drive/페이지 서비스 포함 및 전체 앱 selector/요청 감사/예약작업 조립은 후속 integration이다. 이 Task의 두 scope만으로 Calendar 통합을 완료했다고 기록하지 않는다. dataRepositoryContext 공통 타입 변경 영향은 실제 소비 테스트로 재검증한다.

### C8 — 원본 oracle 독립성과 증거 (R6)

Calendar 수락/통합 후 해당 commit+작업트리 상태를 baseline으로 확인한다. 현재 계획 근거 HEAD를 미래 테스트 최종 baseline으로 대체하지 않는다. 기존 전체 snapshot은 후보 자료일 뿐, Drive 관련 bytes가 일치하는지 확인한 것만 재사용한다.
roots: driveImportResults.ts, drive-import-runs/page.tsx. runtime closure: prisma/privacy fields+crypto+database/activity context+database/dataRepositoryContext, page의 auth/teamScope/stored factory와 재귀 local imports. package-lock/package/schema/필요 migration/sql/실행 scripts/ts-loader 포함. type-only·runtime·fixture/mocked platform 구분, 각 parent→import→resolved frozen path·SHA256과 패키지 버전을 manifest에 기록한다. 임의 파일 개수 목표 없음.
원본 PG와 current PG/Mongo는 별도 process/module cache·client로 실행. frozen local import가 current 제품으로 빠지면 실패. 원본 source/manifest는 oracle 실패 해결을 위해 바꾸지 않는다. 제품 구현 전 원본 PG take/collation actual oracle를 먼저 실행해 관찰표를 확정한다. 불일치가 있으면 구현 이전에 해당 기술 계약을 재계획한다. runner가 실제 사용하는 loader도 manifest 해시 비교한다.
기대값은 synthetic fixture의 독립 literal full DTO와 PG 실제 관찰을 함께 사용한다. 제품 presenter/parser를 expected 생성기로 공유하지 않는다. 고정 시간/UUID fixture와 가능한 동률 집합을 사용하며 실행 간 임의 ID/시간 삭제로 의미 있는 차이를 숨기지 않는다.

### C9 — 실행·인계 제한 (R7)

이번 하위 위임에서는 아래 단계의 설계만 한다. 상위 흐름의 구현 지속 승인을 취소하거나 재승인 대기로 바꾸지 않는다. 추후 실행자는 별도 소유 로컬 PG/replica Mongo의 정확 host/port/db/user/hello 검증·새 namespace·endpoint allowlist와 cleanup 책임을 기록한다. Calendar 실행 중 자원을 재사용/정리하지 않는다. 원천 fetch/OAuth/Google/Notion/Drive/Slack 호출은 tripwire로 0건 강제한다.
immutable runner·실행 전후 소스 SHA·exit와 TAP를 함께 보존한다. timeout은 TERM/KILL 후 observed exit를 기다리고 후속 worker를 중단한다. timeout을 cleanup 성공으로 표시하지 않고 소유 자원 감사 필요를 남긴다. cleanup은 별도 실제 증거로만 수락한다.

## 단계별 계획

| Step | 태그 | 작업·산출물 | 수락 기준 |
| --- | --- | --- | --- |
| 1 | [Core] | C1–C7 결정표와 원본 case 목록을 확정. collation/특수 take/관계/빈 결과를 별개 분류 | 원본 의미로부터 입력→DTO/허용집합/실패를 결정. 임의 최신 성공 필터·팀 권한·tie 규칙 0 |
| 2 | [Shell] | 수락된 Calendar baseline의 frozen closure/manifest, synthetic fixture·소유 환경 runner 준비 | runtime imports 누락/current 탈출 0, 실제 loader hash 포함, 실제 원천 호출 경로 차단 |
| 3 | [Core] | 원본 PG full DTO oracle 및 같은 fixture PG/native 대조 설계·작성 | non-tie exact tuple, tie 완전 후보/경계집합 판정. 원본 PG catch와 명시 손상 실패를 분리 |
| 4 | [Core] | 두 메서드 contract/PG adapter/기존 export facade/Mongo reader 구현 | C1–C5 규칙, read-only snapshot, 기본 PG 불변·명시 scope 누락 실패·raw 오류 차단 |
| 5 | [Core] | 페이지 의존성 preflight 연결과 실제 page/auth 시나리오 | C6–C7, 누락/미인증 조회 0, 전체 DTO와 사용자 표시 그대로, Calendar 조립 별도 |
| 6 | [Check] | validation-v2 수락 기준 기반 실제 PG/native/page + typecheck/lint/build/관련 회귀 | 필수 기준 전부 실행 PASS, 실패/skip의 숨김 0; 공통 context 영향 확인 후 필요 회귀 확장 |
| 7 | [Shell] | immutable 로그·source digests·file별 결과·소유 정리·execution manifest/review 기록 | 실제 exit/정리 증거 연결, 중복 합산/단일 SHA 전체런 과대주장 0 |
| 8 | [Check] | 독립 실행검토 및 alignment/handoff, 이후 통합 상태 대조 | 잔여 gap 0 또는 명시 deferred 범위, Calendar/원천/writer/전체전환 미완료 분리. 단계6 이전 PASS 선언 금지 |

Core 4개(Step1,3,4,5); Shell 2개; Check 2개. 의미 규칙과 단순 evidence 포장을 분리한다.

## 예상 변경 파일과 인터페이스 (아직 생성하지 않음)

- 신규 `src/lib/data/driveImportHistoryRepository.ts`: `readLatestDriveImportResult(operationId:string): Promise<StoredDriveImportResult|null>`, `readLatestDriveImportRun(resultLimit?:number): Promise<StoredDriveImportRunView|null>`. 기존 DTO export/import 경로 유지, 타입은 type-only로 연결하여 순환 runtime import 금지.
- 신규 `prismaDriveImportHistoryRepository.ts`, `mongoDriveImportHistoryRepository.ts`: 기존 패턴의 explicit client/databaseName/namespace open/read-ready, synthetic prepare 별도. writer 메서드 없음. 구현 시 명시적 synthetic shadow prepare/index/metadata 및 test seed·소유 정리는 허용되며 제품 read 경로와 분리한다.
- 수정 `src/lib/driveImports/driveImportResults.ts`(facade), `src/lib/data/dataRepositoryContext.ts`(driveImportHistory 타입), `src/app/drive-import-runs/page.tsx`(두 의존성 preflight만). factory 추가는 위 세 역할 중 단일 위치로 한정, 중복 선택 로직 금지.
- 테스트 후보 `src/lib/data/driveImportHistory.postgres.integration.test.ts`, `mongoDriveImportHistory.integration.test.ts`, `driveImportHistoryPage.test.tsx`, 필요 frozen fixtures/manifest. 기존 다른 테스트 수정은 실제 의존 추가로 필수인 최소 범위만.
- product schema/registry/auth/Calendar runtime/writer scanner/CLI/다른 route/새 UI 기능은 제외. 제품 파일명은 구현 전 확인 가능하지만 계약·검증을 줄이는 근거로 쓰지 않는다.

## 범위 밖과 인계

Drive CLI는 `drive:import:dry-run`으로 등록되어 있고 PG 이력을 저장한다. 실제 사용/예약 여부 조사, 암호화 writer 이관, 부분 실패/재실행/감사 정책은 별도 필수 후속이다. guard 제거로 연결하지 않는다. 조회 테스트용 seed는 제품 writer 수락 증거가 아니다.
Sheets/Notion 실제 import/source scope·token/error, Drive candidates/apply 원천 흐름, activity 수동 prune CLI, backup/health, 등록 Calendar 포함 전체 app/job composition, 운영 데이터 복사·A/B복원·최종 selector는 미완료 유지.
기술 원본 동작과 충돌하면 증거를 남겨 Core/Validation을 수정한다. 실패가 범위 밖 정책 변경을 요구하거나 동일 실패 수정 2회가 실패하면 상위 범위 재검토. 이미 승인된 계획 작성에 재승인 요청은 하지 않는다.

## 재개 계약

Rigor Level3; lifecycle candidate; artifacts planning; execution/validation NOT_RUN; independent review pending. 이 v2는 meta-review를 반영한 초안이다. Parfit critic 반영을 마쳤으며 조정자의 읽기검토를 기다린다. 준비 상태는 검토 가능이라는 의미로만 사용한다. 실행은 상위 조정자가 기존 승인으로 계속한다.
읽기 순서 clarify→plan→validation. Alignment 제안 update_next_task, repo macro/coverage 수정 deferred. Calendar 수락 전 Drive 구현 착수/branch 생성 금지. 이후 전체 Level3 완료에는 plan-v2/validation-v2, manifest, execution-review, 필요 gap-plan, alignment-review, cleanup와 handoff가 필요하다.


## v2 구체화 — M1–M6 적용 계약

### M1: 독립 literal과 own-key 표 (원본 4 interface/return literal 근거)

| 값 | 정확 own-key 계약 | 값/타입 |
| --- | --- | --- |
| 단건 DTO | candidateCount,createdAt,fileCount,folderCandidates,folderTitle,folderUrl,inputKind,inputValue,issues,keyCandidates,resultKind,runId,runStartedAt,runStatus | count 두 개 number; 후보/이슈 array; 나머지 string, 날짜 ISO |
| Run DTO | avgSatisfactionCandidateCount,errorCount,finishedAt,folderSearchCount,folderSearchWithCandidatesCount,id,instructorCandidateCount,instructorSatisfactionCandidateCount,mode,operationCount,results,scanFoundFolderCount,scanIssueCount,scannedRefCount,startedAt,status,suspiciousCandidateCount | count11개 number; results array; 나머지 string |
| Run 결과 row | candidateCount,companyName,courseName,createdAt,endDate,error,fileCount,folderCandidates,folderTitle,folderUrl,inputKind,inputValue,issues,keyCandidates,operationId,resultKind,startDate | count2개 number; 후보/이슈 array; 나머지 string |
| candidate | 고정 whitelist 없음: fixture 입력의 truthy object own-keys/값 그대로. confidence,evidence,field,label,reasons,score,sourceTitle,title,url,value는 TS 선택적 필드일 뿐 runtime key 제한 아님 | fixture별 literal로 exact own-keys/중첩 값/타입을 지정. []도 원본대로 통과하며 배열 index/길이 보존. 빈 객체 유지 |

original PG/current PG/native Mongo 각각 독립 literal 또는 허용집합에 판정한다. original=current 비교만으로 수락하지 않는다. seed 의미 fixture는 공유 가능하나 backend 저장 행은 독립 확인한다(복호화가 필요한 값은 frozen baseline와 literal로 확인). current presenter/selector로 expected를 생성하지 않는다.
행 identity는 합성 operationId/inputValue 등의 고유 marker로 연결하고 실제 같은 DTO 두 행은 multiplicity=2를 유지한다. set으로 중복 제거하지 않는다. comparator negative controls는 필드 삭제·추가, null↔빈 문자열, 비동률 배열 역전, count 변경, 후보 혼합을 각각 거부해야 한다. 공통 mutation framework를 만들지 않는다.

### M2: sort/take 관찰 gate

PG oracle 담당자가 제품 구현 전에 effective DB/column collation, provider/locale/version과 Prisma take 관찰표를 기록한다. collation 비교상 동등한 서로 다른 문자열은 동률집합에 넣는다. 몇 문자열 샘플 성공을 모든 Unicode 지원으로 과장하지 않는다. 지원 baseline의 비교를 재현할 근거 없으면 V3 PENDING으로 남긴다. 새 정렬 의존성을 자동 추가하지 않는다.
단건 2 sort key/run 1 key/결과 3 key마다 상위키 불리·하위키 유리 fixture로 우선순위를 독립 확인한다. 음수 take는 방향/반환순서/동률 절단을 따로 확인한다. NaN/Infinity/undefined는 IPC JSON 값 대신 태그로 보내 실제 함수 호출 직전에 복원하며 typeof/Object.is로 입력값을 확인한다. 잘못된 인자 우선순위는 C2를 따른다. limit251 clamp 금지.

### M3: 손상·키·namespace

확인 집합은 C4의 take 전 전체다. selected run의 251번째 broken session도 실패, 다른 run의 무관한 broken session은 차단하지 않음. 단건은 exact operationId 후보만 검사. session null/soft-delete 합법, 다른 namespace 부모는 실패.
동일 run/result/session ID를 두 namespace에 넣고 서로 다른 marker를 사용한다. 양쪽 read의 전체 DTO를 각각 literal과 대조하고 섞임0을 증명한다. session이나 run이 오직 다른 namespace에만 있는 별도 반례도 둔다.
_id/id 일치·ID 타입·필수 키는 기존 codec/metadata/validator가 보장하는 범위를 재사용한다. 각 손상은 '준비/validator에서 쓰기 거부'와 '검증 fixture의 명시 corruption 후 read 거부'로 구분한다. production validator를 완화하지 않는다. 허용 keyring+active-key 성공 / 필요한 key 누락 / 다른 키 / tag·cipher 손상 / policy·metadata 불일치를 개별 증명하며 새 rotation 정책은 만들지 않는다.

### M4: snapshot과 쓰기0

정적 fixture: setup/seed/metadata/index 완료 후 전체 canonical digest before=after와 reader business/audit command write0. 같은 개수/byte로 값을 바꿔도 digest 차이를 잡아야 한다.
경쟁 fixture: 실제 reader가 첫 snapshot 읽기를 끝낸 barrier에서 controller가 별도 session으로 명시 run/result 변경을 commit하고 reader를 재개한다. 기대는 고정 snapshot의 변경 전 complete DTO 하나다. 이후 새 호출은 변경 후 DTO. 전/후 둘 다 무조건 허용하는 oracle 금지. controller 변경만 정확 allowlist로 식별하고 reader write0를 command 관찰로 확인한다. driver 내부 transaction bookkeeping은 업무 쓰기가 아니다.

### M5: page 증거 소유

page 담당자는 동일 의미 fixture로 frozen original PG page, current default PG page, current explicit native page를 각각 최소1회 실제 reader에 연결한다. auth 플랫폼/Next 경계 대체 목록을 기록하고 실제 workspace guard/페이지/presenter는 실행한다. 전체 DTO 증거와 전체 렌더 행 순서·셀·href/query·요약 증거를 분리한다.
key7→6/folder5→4/issues4→3의 마지막 포함·첫 제외, key/folder 동시 존재 우선, error/issues 우선, 250행 전체 identity를 확인한다. 보호 필드 중 DTO에 원래 있는 값만 복원/표시 대조한다. summary/notes/folderId 같은 DTO 밖 보호 필드는 암호화 저장·출력 비노출을 확인한다.

### M6: 이 reader 전용 계측 (공통 기반 확장 금지)

소유자=public Mongo read 호출 한 번. 유효 인자 처리 후 데이터 접근을 하더라도 deadline 시작은 함수 진입이다. 모든 cursor/session/재조회/retry가 같은 clock과 누적 카운터를 공유한다. 명시 retry가 없으면 budget reset 경로도 없어야 하며 driver 자동 retry의 재수신 문서도 계상한다.
rows=실제 받은 raw BSON 문서 수의 합. bytes=각 raw 문서의 BSON.calculateObjectSize 합(프로젝트 driver 옵션으로 Buffer 등 BSON형을 보존한 상태). DTO/문자열 길이/서버 index entries는 제외. Run/Result/Session과 호출 중 읽은 metadata, 반복 수신/retry, 초과 탐지용 한 행도 포함. 0행 쿼리는 rows0/bytes0이나 시간은 소비한다. open의 사전 readiness 검사 자료를 호출에서 재사용하면 해당 호출에 실제 수신이 없으므로 추가 계상 없음; 이를 가정한 fixture와 read 중 metadata fixture는 분리한다.
예: result19,999+run1=20,000, 추가 session1이면20,001로 실패. 출력250/원본PG 허용과는 별도 제한이다. 부모 unique ID는 bounded batch로 조회하며 N+1 scan을 만들지 않는다. 같은 snapshot에서 재사용한 부모는 재수신이 없으므로 중복 계상하지 않는다.
각 driver 대기는 min(남은 전체시간,해당 scan 남은15초)로 제한하며 decode/관계/sort 후 및 반환 직전에 deadline 확인. 실패 때 cursor/session 작업의 실제 종료를 기다린다. Promise.race 단독으로 먼저 반환하고 작업을 남겨두는 구현 금지. 처리60초와 cleanup elapsed를 별도 기록한다. cancellation/cleanup의 유한 종료 방식은 기존 driver API로 작은 native spike에서 증명하며 무한 대기를 숨기는 PASS 금지. 이를 로컬 구현으로 증명 못하면 대체 bounded-query 계획을 상위에 제시하고 해당 gate는 PENDING; 공통 framework로 확장하지 않는다.
시험 비용: 정확행/+1행, 정확byte/+1byte, scan별 통과/누적초과, 부모포함초과를 같은 소형 BSON fixture군으로 검증한다. 단일 문서16MiB 한계 실패를 누적32MiB 테스트로 세지 않는다. clock 주입으로 59,999/60,000/60,001ms와 retry 잔여시간을 확인하며 실제60초 wallclock 증거라 부르지 않는다. 실제 native pending read 취소/세션 종료 최소1경로를 별도로 기록한다.

## v2 Changelog와 책임

M1 own-key/literal/multiplicity/negative comparator → PG oracle 담당 + native 대조 담당.
M2 각 sort 우선순위·take·collation actual 선행 gate → PG oracle 담당, 제품 담당은 gate 확인 뒤 구현.
M3 take 전 후보·관계키·crossnamespace·keyring → native 담당.
M4 정적 digest와 controller 경합/reader write0 분리 → native 담당.
M5 original/currentPG/native 실제 page 각각 연결 → page 담당.
M6 reader 로컬 budget/의도적 차이/정확 계상 → 제품+native 담당; 공통 store/Calendar 변경 금지.
이 역할은 계획 책임 구분이며 새 작업 위임이나 agent 실행을 수행한 것이 아니다. Parfit critic은 별도 파일 없이 조정자 메시지로 전달되었으며 아래 P1/P2 결정과 validation-v2에 반영했다. 독립 검토자의 v2 재수락을 대신 주장하지 않는다. v1 수정 없음.


## Parfit P1/P2 — 최종 실행 순서·검사 범위 (C1–C6의 명시적 세분화)

아래는 기존 규칙의 선택 분기를 고정한다. backend에 없는 업무 정책을 추가하지 않으며, 명시 Mongo의 더 엄격한 무결성 검사·budget은 의도적 차이로 공개한다.

1. 함수 진입 clock 시작 → scope 해석. 누락 scope는 인자/환경/DB보다 먼저 실패한다. 기본 PG는 기존 코드의 env→Prisma→catch/null 순서 그대로.
2. 명시 Mongo의 인자는 원본 PG actual 관찰표로 판정. 원본 거부 인자이면 읽기 전에 null. 올바른 scope+잘못된 인자+손상 DB도 null이다. 이 표 확정은 제품 구현 전 gate이며 collation 설정을 시험에 맞춰 변경하지 않는다. actual 관찰에서 take0이 유효함을 확인한 뒤 아래 유효 인자 흐름을 적용한다.
3. 유효 인자 → 준비 상태 확인·snapshot 시작. 단건은 exact operationId Result 전부; run은 모든 Run의 public identity/startedAt projection으로 최신 후보를 정하고 그 중 한 run을 선택한다. 이 선택의 동률은 C2 허용집합을 따른다. 미선택 run의 보호 payload는 decode하지 않으므로 무관한 notes/cipher 손상은 이 read를 막지 않는다. selection에 쓰는 id/startedAt의 타입/키 손상은 고정 실패다.
4. 단건 고려 Result 전부와 그 run 부모를 full codec decode/인증한다. run 조회는 선택 run 자체를 full decode한 다음 그 run Result 전부를 full decode/인증한다. 결과0 run은 정상 DTO이며 run0이면 null. 각 Result의 non-null operationSessionId는 동일 namespace/snapshot의 `_id/id` identity projection으로 존재만 확인한다. 타입/키 일치의 기존 metadata/validator 불변식을 확인한다. session private payload는 가져오거나 복호화하지 않는다. session 보호 필드만 손상되어도 정확 ID가 존재하면 이력 조회는 성공해야 한다. projection 필드를 full session codec에 넣어 필수 필드 누락 오류를 만들지 않는다.
5. 모든 고려 Result의 필수 run/nullable session 검사를 마친 후 Result sort → take → DTO 변환. take0도 유효 인자이므로 해당 run 후보 전체 무결성 검사를 생략하지 않는다. 양수250 밖 손상, 음수 take가 선택하지 않는 후보 손상도 동일 실패한다. 이것은 원본 PG가 해당 행을 반환하지 않을 때 성공할 수 있는 것과 의도적으로 다르다. valid 비손상 fixture의 non-tie full DTO 동등성은 줄이지 않는다.
6. DTO 반환 직전 deadline 검사. 실제 페이지는 기존대로 렌더한다. candidate는 object 필터만 있으므로 candidate.value/title 등 자리에 임의 object가 있으면 React 렌더가 실패할 수 있다. 그 값의 reader full DTO 보존과 original/current page의 같은 실패를 별도 negative fixture로 검증한다. 정화/문자열화/누락으로 성공시키지 않으며 모든 candidate가 렌더된다고 주장하지 않는다.

| 경계 | 명시 Mongo 판정 | PG 동등 주장 범위 |
| --- | --- | --- |
| 유효 take0+후보 부모 손상 | take 전 검사에서 실패 | 의도적 차이, PG actual 결과 따로 기록 |
| 유효 take250+251번째 관계/codec 손상 | 실패 | 의도적 차이 |
| 유효 음수 take+미선택 후보 손상 | 실패 | 의도적 차이 |
| 다른 run/다른 operationId 결과 payload 손상 | 무관 후보는 조회하지 않으므로 영향 없음 | 기존 조회 범위 보존 |
| non-null session 존재, session.operationId 불일치 | 성공 | 과거 snapshot 문자열 보존, equality 강제 없음 |
| non-null session identity 정상, private payload만 손상 | 성공 | existence-only projection, 무관 PII decode 없음 |
| selected run summary/notes 또는 considered result.folderId 손상 | full decode 실패 | 비반환 protected 필드 인증은 명시 무결성 gate |
| 유효 정상 fixture | non-tie exact own-key/value/순서 및 ties 허용집합 | full DTO 동등성 필수 |

M6의 정확 경계 fixture는 'result20,000+추가 부모'를 성공 사례로 쓰지 않는다. 실제 수신량 합계(모든 Run selection projection, selected fullRun 재조회, Result, unique session projection, metadata, retry 재수신 포함)로20,000을 맞추고 추가 raw 문서 하나가20,001이 되게 만든다. 같은 문서의 projection과 full fetch가 두 번 오면 rows2 및 두 BSON bytes를 계상한다. 바이트 역시 실제 수신 형태를 모두 더한다. 계측 담당은 raw 수신 ledger를 독립 fixture 예상 합계와 비교하며 budget counter 자체로 expected를 생성하지 않는다.
음수 take의 selected identity/multiplicity/order는 frozen PG actual을 literal 표에 기록한다. native sort helper를 oracle comparator로 공유하지 않는다. collation은 DB default/각 정렬 column override의 provider·locale·version까지 읽어 기록하고 실제 baseline을 변경하지 않는다.
보호값 검증은 returnedFields(단건/RunResult의 inputValue/folderTitle/folderUrl/candidates/issues/error 등 실제 존재 키)와 authenticatedNotReturned(Run summary/notes,Result folderId)로 나눈다. 전자는 원본 DTO 복원, 후자는 암호화 저장·정상 key 성공·잘못된 key/손상 실패·DTO 키 부재를 검증한다. session payload는 existence projection 범위 밖으로 별도 구분한다.
