# Plan v1 — Drive history read → page

이번 조정자 사전계획 위임만 수행 / 구현·실행 NOT_RUN. 사람 사용자의 구현 지속 승인은 유지된다. 입력: [clarify-result](clarify-result.md). 요구사항 ID R1–R7을 사용한다.

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
- 문자열 정렬은 실제 baseline PG collation을 기록해 재현한다. JS localeCompare를 무근거로 동등 처리하지 않는다. ASCII/대소문자/한글/악센트/동일 접두부 fixture로 실제 PG 순서를 확인하고 그 collation을 구현 가능하게 고정한다. 환경별 collation 확대 지원은 주장하지 않는다. 증거가 없으면 V3 미통과다.
- 기본값 외 0,1,249,250,251 및 음수(-1,-250), 소수/NaN/Infinity/큰 수는 원본 Prisma의 실제 take 결과 또는 catch→null을 먼저 기록한다. 기존 인자를 새 1..250 규칙으로 clamp/reject하지 않는다. 원본에서 유효한 음수 take는 원본과 같은 전체 DTO/순서를 구현한다. 원본이 거부해 null인 잘못된 인자는 동일 null로 처리 가능하되 저장소 손상 오류와 혼동하지 않는다. 기술적 oracle 확정 전 수락하지 않는다.

### C3 — 전체 DTO·JSON (R1,R3)

원본 네 interface와 return literal 전체를 독립 oracle 명세로 동결한다. 단건의 candidateCount/createdAt/fileCount/folderCandidates/folderTitle/folderUrl/inputKind/inputValue/issues/keyCandidates/resultKind/runId/runStartedAt/runStatus; run의 id/mode/status/start/finish와 모든 11개 count 필드 및 results 전체를 누락 없이 비교한다. 정확한 필드 이름/개수는 원본 interface 자체가 기준이며 요약 숫자로 대체하지 않는다.
createdAt/startedAt는 toISOString, startDate/endDate는 ISO 앞 10자 또는 null이면 빈 문자열, finishedAt null은 빈 문자열이다. nullable folder/input/error 텍스트는 기존 `?? ""`를 보존한다.
JSON 배열이 아니면 후보/이슈 목록은 []; 후보 배열은 truthy object만 보존하므로 배열 원소인 배열과 빈 객체도 현재 필터상 통과한다. 이슈는 string만 보존(빈 문자열 포함). 요소 필드 추가 정제/정렬/PII 제거를 발명하지 않는다. 순서와 중첩 값은 deep equality, object property insertion order는 비교 대상 아님. DB null/JSON null은 codec sentinel을 원래 Prisma 의미로 복원한 뒤 변환한다.

### C4 — 관계·일관성 (R4)

Result.runId의 Run은 필수다. Mongo 조회가 고려하는 후보(Result)는 같은 읽기 snapshot에서 run 존재/참조 일치를 확인한다. 단건 후보 중 orphan이 있으면 오래된 정상 행으로 대체하거나 empty 처리하지 않고 실패한다. run 조회에서는 선택된 run의 결과만 대상으로 하며 무관한 다른 run의 전수 무결성 감사로 확대하지 않는다. Run이 아예 없으면 run 조회는 null이며 이것으로 DB 전체 orphan 부재를 주장하지 않는다.
operationSessionId=null은 합법적이고 이력 자체로 표시한다. non-null 참조가 깨진 고려 대상 Result는 실패한다. session이 존재하되 soft-deleted인 경우는 원본대로 이력을 반환한다. Company/Course의 현재 이름으로 snapshot 이름을 덮어쓰지 않고 관계를 불필요하게 따라가지 않는다. 필요 모델은 Run,Result,OperationSession(참조 존재 확인용)이며 session null에서 부모를 강제하지 않는다.
Mongo read-only snapshot transaction에서 후보·run·필요 session을 읽어 섞인 상태를 막는다. 이 선택을 원본 PG 모든 동시 interleaving과 exact 동등이라고 과장하지 않는다. 원본이 허용하는 완전한 snapshot 결과를 비교한다. 조회에서 복구/부모 생성/감사 INSERT/인덱스 자동생성은 하지 않는다.

### C5 — PII·자원·안전 (R4,R6)

기존 mongoRuntimeCodec/registry/read-store metadata를 사용한다. HMAC 검색이 필요한 필드가 추가되면 기존 인증/원문 대조 규칙을 따르지만 public operationId/runId를 새 private schema로 바꾸지 않는다. Run summary/notes, Result의 등록된 protected 필드는 기존 정책으로 인증·복호화하며 raw 문서/키/HMAC companion은 DTO에 포함하지 않는다.
회사·과정 snapshot 이름이 현재 registry 보호 대상이 아니라는 사실을 명시한다. 이번 계획은 schema/registry 확장을 승인하지 않는다. synthetic만 쓰고 전체 PII 이전 완료는 주장하지 않는다. 이 부분은 상위 전환의 잔여 보안 검토 대상이다.
기존 store의 scan별 20,000행/32MiB·15초 한계를 유지한다. limit250은 출력 한계이며 scan 한계와 다르다. 호출 전체에도 60초 deadline과 누적 20,000행/32MiB 읽기 budget을 적용하는 기술적 보호를 제안한다(기존 PG 무제한과 의도적 차이). 초과하면 고정 실패, 조용한 앞부분 반환 금지. 정확 경계는 포함, +1행/+1byte는 실패. 시간 경과·세션 종료는 finally로 보장하고 드라이버 실패 재시도 때문에 예산을 초기화하지 않는다.
준비 함수는 별도 명시 합성 setup에서만 metadata/index를 준비하고, open/read는 기존 준비 상태 확인만 한다. 운영 URI/default env fallback 없음. 읽기 전후 관련 raw 컬렉션·감사 수/bytes 동일을 검사한다.

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
원본 PG와 current PG/Mongo는 별도 process/module cache·client로 실행. frozen local import가 current 제품으로 빠지면 실패. 원본 source/manifest는 oracle 실패 해결을 위해 바꾸지 않는다. runner가 실제 사용하는 loader도 manifest 해시 비교한다.
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

Rigor Level3; lifecycle candidate; artifacts planning; execution/validation NOT_RUN; independent review pending. 다음은 이 plan과 validation-v1 독립 메타검토이며 v2/실행은 이번 사전계획 위임 산출물이 아니며 상위 조정자가 기존 승인으로 계속한다.
읽기 순서 clarify→plan→validation. Alignment 제안 update_next_task, repo macro/coverage 수정 deferred. Calendar 수락 전 Drive 구현 착수/branch 생성 금지. 이후 전체 Level3 완료에는 plan-v2/validation-v2, manifest, execution-review, 필요 gap-plan, alignment-review, cleanup와 handoff가 필요하다.
