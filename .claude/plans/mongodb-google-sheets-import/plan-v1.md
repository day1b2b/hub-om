# Plan v1 — Google Sheets tabs → import → staging

## 핵심 난이도와 분석 규칙

핵심은 이미 존재하는 staging을 다시 만드는 일이 아니라, HTTP 원천을 읽기 전에 올바른 저장소 조합을 확정하면서 원본 parser/PG 의미·인증·감사를 보존하는 것이다. 전체 입력을 `requestActivity scope 확인 → 인증 → 요청 인자 → source/저장 ports preflight → 원천 응답 → 파싱 → 저장 → 응답/감사` 순서로 판정한다. scope는 인증을 부여하지 않는다. 어떤 실패가 나도 해당 단계 이후의 업무 side effect가 실행되지 않아야 한다. 감사는 독립 best-effort 경계다.

인턴에게 필요한 판단 규칙은 아래 S2/S3에 명시한다. Core 로직과 파일 추출 작업을 분리한다. 원본에 없는 신규 입력 제한·업무 정상화·pagination·retry·UI를 암묵적으로 추가하지 않는다.

## S1 [Shell] 원본 동결과 실행 준비 — R1/R2/R10

입력: Drive 최종 수락 기록과 확정 SHA. 현재 값은 미정이다.
산출물: 향후 작업 original snapshot, closure manifest, 별도 literal fixture, 소유 합성 실행 계획. 지금 만들지 않는다.

- roots: 두 Sheets route, googleSheetsImport, importUploadParser, importStagingWriter. local runtime imports를 재귀 동결한다. auth/withActivity/privacy/audit/Prisma/roster/instructor 의존을 누락하지 않는다.
- package/lock/schema/migrations/실제 scripts/ts-loader.mjs와 fixture loader hash 포함. type-only/external/dynamic import edge를 구분한다. 실제 frozen 실행이 current 로컬 코드를 fallback하지 못하게 한다.
- auth와 HTTP transport만 합성 seam으로 대체 가능하며 명시한다. parser/validation/persistence/DTO/audit 구현을 mock하지 않는 원본 PG 경로를 준비한다.
- final SHA가 미확정이거나 Drive가 미수락이면 동결·다음 구현을 시작하지 않는다. 새 소유 PG/Mongo endpoint는 부모가 결정한다. Calendar/Drive 기존 DB 재사용 금지.
수락: 모든 runtime edge/hash가 식별되고 source byte mutation 및 미선언 current import가 거부되는 설계. 원본 SQL trigger/시간/UUID 계약을 먼저 관찰할 수 있음.

## S2 [Core] 선택·순서·인터페이스 결정 — R3/R4/R9

제안 최소 계약(파일명은 구현 시 확정, 의미는 고정): `GoogleSheetsImportSource`의 `listTabs(accessToken:string, spreadsheetId:string):Promise<GoogleSheetTab[]>`, `readRows(accessToken:string, spreadsheetId:string, tabTitle:string):Promise<string[][]>`; DataRepositories에 전용 `googleSheetsImportSource` 한 slot. 기존 googleSheetsImport 공개 exports는 그대로 둔다. 기본 source adapter는 기존 두 함수를 위임 호출한다. 만족도 caller는 기존 helper를 계속 사용한다. generic OperationSourceReader는 수정하지 않는다. 런타임 malformed payload는 현재 parser 실패를 보존하며 static 타입을 런타임 검증처럼 주장하지 않는다.

| 단계/입력 | 조건 → 출력·다음 단계 | 실패·side effect 규칙 |
| --- | --- | --- |
| wrapper | 현재 withActivity가 requestActivity scope 먼저 확인 | 명시 누락은 기존 throw, auth/source/business 호출 0. wrapper 밖 오류를 새 JSON으로 바꾸지 않음 |
| 인증 | requireWorkspaceSession의 기존 workspace guard 유지 | redirect 제어흐름 보존. 관리자 guard로 강화/완화하지 않음. token 없으면 기존401/reauthRequired, source 0 |
| JSON·인자 | 기존 request.json, tabs URL / import trim한 tabTitle 및 URL parser 순서 | 잘못된 JSON/타입은 catch400 고정 fallback. 빈 tab은 기존400. 네트워크 0 |
| 사전 scope 해석 | 유효 인자 후 source를 resolve. 명시 import는 imports/teamMembers/instructorNote 모두 resolve | resolve는 IO하지 않음. 어느 하나 누락하면 catch400 fallback; source/roster/business IO0, 기본 PG/local/Notion0. 정상 requestActivity가 있으면 실패 요청 감사는 허용 |
| 무scope | source는 기존HTTP. import는 원래 storeParsedImport | 무scope에 명단 factory를 사용하지 않음. 기본PG 직접 명단정책 유지, OPERATION_DATA_SOURCE local/notion이 이를 바꾸지 않음 |
| 명시scope | source+필수 저장 ports를 포착 후 해당 요청 내부에서 사용 | partial scope에 기본HTTP/PG fallback 금지. 테스트·shadow 조립은 명시된 객체만 사용 |
| 원천/parse/store | tabs는 listTabs 결과 응답. import는 readRows → 원본parse → 비어있지 않으면 기존store | tabs는 imports/명단 scope 불필요. import 실패는 이후 업무 호출0; 저장 완료 후 응답 shape 유지 |

source slot 존재만으로 HTTP port가 안전하다고 보장할 수는 없다. 합성 runtime은 합성 source를 명시 주입하고 fetch tripwire로 실제 외부 접속을 차단한다. 생산 기본 adapter는 기존 HTTP를 보존한다. header/cookie/query/env로 backend를 새 선택하지 않는다. global mutable singleton/전역 token cache를 두지 않는다.

사전확인은 port 존재 확인이다. Mongo open/prepare와 namespace/codec readiness는 합성 runtime 생성 단계에서 끝낸다. 매 요청 fetch 전에 DB ping/DDL을 추가하지 않는다. roster 내용 변경은 기존 store가 원래 시점에 읽는다. scoped roster read의 오류는 source read 후 일어날 수 있고, 이를 preflight 미달로 혼동하지 않는다.

수락: 정확한 위 순서가 trace oracle로 식별됨. concurrent A/B source/token/namespace와 default 경로가 섞이지 않음. Calendar registered scope 객체를 새 slot 때문에 조용히 다시 등록/확장하지 않음; 전체 조립은 후속.

## S3 [Core] 원본 HTTP·저장·오류 계약 — R3/R5/R6/R7

### 보존할 원천과 인자 규칙

- URL은 trim 후 `/spreadsheets/d/([a-zA-Z0-9-_]+)` 추출. hostname stricter validation을 추가하지 않는다. 실제 outbound는 고정 sheets.googleapis.com이다. gid는 query 우선/hash fallback, 유한값 아니면 null. 임의 양수·정수 제한을 추가하지 않는다.
- tabs GET: `/v4/spreadsheets/{id}?fields=sheets(properties(sheetId,title,index))`. 원래 fetch options의 Bearer header, 기본 GET 그대로. properties.sheetId:number/title:string인 항목만 골라 `{gid,title}`; index 기준 재정렬하지 않는다. sheets 누락은 [].
- rows GET: `/v4/spreadsheets/{id}/values/{encodedRange}?majorDimension=ROWS`. range는 작은따옴표를 두 번 겹친 tabTitle을 `'...'!A1:ZZ2000`으로 만든 뒤 encodeURIComponent. values 누락/null은 []. 임의 pagination/cache/retry/timeout/추가 행수 제한 없음.
- raw adapter의 401/403은 동일 고정 권한 문구, 다른 non-ok는 고정 읽기실패. JSON 파싱/transport throw 자체는 wrapper까지 전파하며 raw adapter를 정규화 저장소로 만들지 않는다.
- import: headerRowNumber||1; 원본 header 추론/문자열 trim/빈행 필터/물리행 번호 보존. importYear는 number·integer·2000..2100만 defaultYear로 전달. tab/sourceName trim 및 fallback, team_1/1팀→TEAM_1, team_2/2팀→TEAM_2, 나머지 UNKNOWN.
- StoreImportInput 전체: importedBy=session.user?.email??'', parsed, sourceName=trim또는tab, sourceSheet=tab, sourceTeam, sourceType='spreadsheet', sourceWorkbook=id. fileName 미지정. 원천에 쓰지 않는다.

### 응답·저장 의미

- tabs200 body exact `{ok:true,selectedGid,spreadsheetId,tabs}`.
- import200 body exact `{ok:true,duplicateCount,errorCount,headerRowNumber,importRunId,rowCount,storedCount}`. rowCount는 importRun.rowCount다. 새 key를 추가하거나 결과를 선택적으로 비교하지 않는다.
- 저장오류행은 버리지 않는다. rowSnapshot/mappedFields/unmappedFields/validationErrors/row number/fingerprint/팀/원천 메타를 보존. 기존 imports detail/summary whole DTO로 검토 가능한지 확인한다. 상세 preview200을 전체 저장행 수로 오인하지 않는다.
- 기존 중복 키 sourceTeam + sourceName/sourceType + fingerprint. 같은 요청 내 첫 지문 보존. 모든 행 중복이어도 run 생성. rowCount=storedCount+duplicateCount, errorCount=저장오류행수+duplicateCount, successCount=storedCount-저장오류행수.
- 같은 키 동시 요청이 둘 다 기존지문 조회를 commit 전 완료하면 각각 저장 가능. 첫 commit 후 둘째 조회면 둘째는 duplicate run. 기존 실제PG 허용결과와 두 barrier schedule을 대조한다. 전역 exactly-once/새 unique/guard 보장 금지.
- run+rows 기존 transaction. confirmed abort는 staging raw 변화0. unknowncommit은 완전반영 또는 미반영, 부분상태 금지; 자동 cleanup/retry로 성공을 추정하지 않는다. 요청감사 실패는 기존 commit을 되돌리지 않고 고정 로그만 남긴다. staging 두 모델 mutation audit0은 의도된 기존정책이다.
- 기존 60초 write deadline/scan20k·32MiB 등 Mongo staging 한계는 재정의하지 않는다. 기본PG와 무조건 동등한 무제한 처리를 주장하지 않는다. 준비는 allowShadowWrites가 있는 명시 synthetic 단계만 수행.

### 공개 오류의 정확한 경계

두 handler catch는 status400 유지. raw Error.message 전파 제거는 의도적 보안 차이이며 원본PG-error 문자열 동등성 대상에서 제외하되, 원본 실패와 변경 후 안전한 응답을 각각 기록한다.

허용 exact message 집합:
1. `Google 스프레드시트 URL을 확인해 주세요.` (두 경로)
2. `스프레드시트를 읽을 권한이 없습니다. Google로 다시 로그인해 권한을 허용해 주세요.` (두 경로)
3. `Google 스프레드시트를 읽지 못했습니다.` (두 경로)
4. `헤더로 사용할 행을 찾지 못했습니다. 시트에 제목 행과 데이터가 있는지 확인해 주세요.` (import만)

각 경로에서 `error instanceof Error && allowlist.has(error.message)`일 때만 그대로 공개. substring/prefix/status/code/constructor name 기반 허용 금지. 이 exact 문자열은 Error/MongoServerError 등 subclass라도 출력에 비밀이 없는 같은 상수이므로 허용한다. 원본 `cause`, stack, 원 객체는 직렬화하지 않는다.
그 외 tabs는 `탭 목록을 불러오지 못했습니다.`, import는 `스프레드시트를 가져오지 못했습니다.`. 직접 반환하는 빈tab `가져올 탭을 선택해 주세요.`, 빈parsed `저장할 행이 없습니다.`, token 없음401 `Google 스프레드시트 읽기 권한이 필요합니다.`+reauthRequired:true는 유지한다.

PII 판정: token은 저장/출력0. spreadsheetId/tab/sourceName/row값은 승인된 tabs DTO·암호화 staging/검토 DTO에 필요한 값이므로 전면삭제하지 않는다. 응답 오류·콘솔·request audit에 body/URL/token/rawexception을 붙이지 않는다. 요청감사의 기존 actor 및 route/status/requestId 의미를 보존한다.

수락: 정상 whole DTO/저장 tuple 동등, 실패 종류별 side effect와 안전문구가 구별됨. 기존정책 이외 쓰기0, 개인정보 canary 비승인 노출0.

## S4 [Shell] 최소 wiring — R1/R3/R4

S2/S3 결정을 코드로 옮길 대상은 두 route, 전용 source interface/default adapter 또는 최소 helper, DataRepositories slot이다. 기존 exported HTTP helper/PG writer/parser/Mongo writer의 업무본문을 바꾸지 않는다. import preflight를 작은 route 공통함수로 둘 수 있으나 범용 budget/원천 framework는 만들지 않는다. 새제품 결함이 발견되면 재계획/영향범위 기록 후 처리하고 기존 frozen source를 고치지 않는다.
산출물: 좁은 diff, 파일 소유 목록. 수락: diff가 이 경계에 한정되고 default helper의 만족도 3caller와 기존 Calendar scope 계약이 보존됨.

## S5 [Check] 선행 PG oracle + raw HTTP/actual handler/native — R2/R5/R6/R8

합성 HTTP JSON → actual 원본 export POST + 실제PG → current PG → explicit source+native Mongo export POST 순으로 검증한다. independent literal은 제품 presenter/parser 결과에서 생성하지 않는다. exact full body, store rows와 metadata, detail/summary DTO, request audit를 같이 대조한다. 원본 시간/UUID는 식별관계 bijection 및 실제 조회값/호출 전후 시각 범위만 정규화한다. 필드 삭제나 모든 날짜 null 치환 금지; startedAt<=finishedAt를 새 가정하지 않는다. frozen PG query 후 실제 복호화 결과와 SQL 저장 raw도 확인한다.

원천 transport spy는 raw URL/options/JSON/throw를 기록하고 승인 합성 응답만 반환한다. actual Google 접근은0. source fake만 성공하는 검사와 real adapter→synthetic transport 검사를 별도 표기한다. actual Mongo imports/teamMembers/instructorNote/requestActivity를 조립한 저장 증거가 필수다. 각 case/전체tuple와 기대값은 validation-v1에 따른다.
산출물: baseline/current/native ledger, 실패 counterexample, source hashes, mock/injection/native 구분. 수락: 필수 case skip0 및 whole DTO 반례 없음. 원본과 의도적 보안 차이는 별도 대조.

## S6 [Check] 원자성·격리·영향 회귀·인계 — R7/R9/R10

동시 A/B scope barrier, 중복 두 schedule, source 실패/roster 실패/저장 abort/감사 실패를 각각 실행한다. 기존 staging 증거를 인용할 때 baseline/의존 hash를 확인하고 새 조합 actual handler를 대체하지 않는다. unknowncommit은 실제 failpoint 또는 명시 주입으로 구별, 테스트가 미실행이면 pending.

실행 담당은 불변 runner/전후 source digest, actual PG+Mongo/handler, typecheck/lint/build와 기존 영향 테스트를 기록한다. 일반 회귀와 Mongo 회귀 범위는 변경된 context의 실제 consumers 기준으로 부모가 고정한다. 실패·코드변경이면 영향 집합 재실행, 파일별최종 집계와 단일SHA실행을 구분한다. 소유 endpoint·DB 검증 후 cleanup/잔존0/종료·port 확인, durable hash를 보존한다. timeout은 child exit 관찰 후 종료하고 후속worker를 멈춰 cleanup 겹침을 막는다.

수락: verification + 사용자 의미 validation + 독립검토 + evidence/alignment/handoff 완료. 코드수락/원격통합/생산이전은 별도 상태다. runtime/OAuth/UI/실원천/Notion/Drive writer/전체Calendar조립은 후속으로 남긴다.

## 현재 인계

현재: 외부 v1 작성, 전 실행 pending. 다음: 부모가 독립 critic/architect 검토 → v2 정리 → Drive 수락/최종SHA 확인 → 새Task 구현. 지금 Do Not: 저장소 수정, Drive 파일 변경, DB/네트워크/테스트 실행, scope 확장. alignment 후보는 update_next_task이며 상위 문서 반영은 부모 소유다.
