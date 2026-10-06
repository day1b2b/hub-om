# Plan v2 — Google Sheets tabs → import → staging

상태: Parfit 4지적 반영 초안. Sagan M1~M4 반영 완료, 부모 전체 검토 대기. 계획 수락·실행 PASS로 표시하지 않는다. v1 및 clarify 원문은 보존한다. 상위 계속 구현 승인은 유효하고 이번 위임은 외부 계획 작성만이다.

## v1 대비 변경

- P1 평가 순서를 fetch 전 tabTitle/URL, fetch 후 header/연도 parser, nonempty parsed 후 sourceName.trim으로 분리했다. 누락 port 조기차단은 명시적 의도차이다.
- P2 transaction callback retry와 실제 commit 성공 뒤 ACK fault를 별도 검증한다. handler 재시도는 추가하지 않는다.
- P3 실제 withActivity/guard는 유지하고 low-level auth만 합성한다. finally 감사 완료와 POST 반환을 분리했다.
- P4 sourceType 음성대조는 historical seed로 만들고 summary 정렬은 backend 실ID/시각 기준으로 검증한다.
- M1 조회 frozen closure/탈출 negative, M2 정상 seam·관찰·주입 구분, M3 실제199/201행과 preview 경계, M4 업무모델 전체 raw sentinel 불변을 반영했다. 확정SHA 갱신은 clarify-addendum.md를 따른다.

## 핵심 난이도와 분석 규칙

핵심은 이미 존재하는 staging을 다시 만드는 일이 아니라, HTTP 원천을 읽기 전에 올바른 저장소 조합을 확정하면서 원본 parser/PG 의미·인증·감사를 보존하는 것이다. 전체 입력을 `requestActivity scope 확인 → wrapper actor 해석 → 실제 guard/token → JSON/tabTitle/URL → source/저장 ports preflight → 원천 읽기 → header/연도 파싱 → 빈행 검사 → sourceName/팀/저장 인자 → 저장 → Response 객체 생성 → finally 감사 await → POST 반환` 순서로 판정한다. scope는 인증을 부여하지 않는다. 어떤 실패가 나도 해당 단계 이후의 업무 side effect가 실행되지 않아야 한다. 감사는 독립 best-effort 경계다.

인턴에게 필요한 판단 규칙은 아래 S2/S3에 명시한다. Core 로직과 파일 추출 작업을 분리한다. 원본에 없는 신규 입력 제한·업무 정상화·pagination·retry·UI를 암묵적으로 추가하지 않는다.

## S1 [Shell] 원본 동결과 실행 준비 — R1/R2/R10

입력: 부모가 확정한 Drive 최종 총괄 원격 SHA `8b4d954707933fdd5da8bfbef46a1779e04ceeb0`. 이번 역할은 원격 조회하지 않았으며 전달받은 통합 기준으로 사용한다. 구현 담당은 동결 시작 시 해당 commit 존재와 대상 closure bytes를 확인한다.
산출물: 향후 작업 original snapshot, closure manifest, 별도 literal fixture, 소유 합성 실행 계획. 지금 만들지 않는다.

- roots: 두 Sheets route, googleSheetsImport, importUploadParser, importStagingWriter, importRepositoryFactory, prismaImportRepository, importReviewPresenter. summary/detail을 제공하는 조회 runtime도 원본이다. local runtime imports를 재귀 동결한다. auth/withActivity/privacy/audit/Prisma/roster/instructor 의존을 누락하지 않는다.
- package/lock/schema/migrations/실제 scripts/ts-loader.mjs와 fixture loader hash 포함. type-only/external/dynamic import edge를 구분한다. 실제 frozen 실행이 current 로컬 코드를 fallback하지 못하게 한다.
- 정상 parity의 대체 seam은 low-level auth()의 session 결과와 HTTP transport뿐이다. requireWorkspaceSession/isAllowedWorkspaceEmail/redirect/withActivity는 실제 구현을 유지한다. 관찰 instrumentation은 원본 함수에 위임하여 결과를 변경하지 않고 카운트/trace/barrier만 추가할 수 있다. 테스트 전용 명시 실패주입은 별도 lane으로 허용한다: 일부 실제 insert 후 confirmed abort, 실제 commit 뒤 ACK 오류, driver callback retry를 유발하는 label/fault. 주입 위치·실제 위임 완료시점·callback/commit 호출횟수·finally 복원·raw 전후를 기록한다. 이 lane을 무주입 parity 또는 실제 외부장애라고 부르지 않는다. frozen bytes나 제품 업무 로직을 고쳐 주입하지 않고 disposable loader seam/위임 proxy를 사용한다. route/source 신규retry는 어느 lane에서도 금지한다. parser/validation/persistence/DTO/audit 구현을 mock하지 않는 원본 PG 경로를 준비한다.
- final SHA가 미확정이거나 Drive가 미수락이면 동결·다음 구현을 시작하지 않는다. 부모가 지정한 검증환경: PG port56751/database sheets_import_test, Mongo port27851/replica sheetsimport20260930, root /private/tmp/hub-om-google-sheets-import-20260930. 아직 미기동이며 DB gate/oracle는 후속위임 대상이다. Calendar/Drive 기존 DB 재사용 금지.
수락: 모든 runtime edge/hash가 식별되고 source byte mutation 및 미선언 current import가 거부되는 설계. 조회 factory/PG repository/presenter 각 frozen byte 변조와 조회 경로의 미선언 current import 탈출도 거부해야 한다. 원본 SQL trigger/시간/UUID 계약을 먼저 관찰할 수 있음.

## S2 [Core] 선택·순서·인터페이스 결정 — R3/R4/R9

제안 최소 계약(파일명은 구현 시 확정, 의미는 고정): `GoogleSheetsImportSource`의 `listTabs(accessToken:string, spreadsheetId:string):Promise<GoogleSheetTab[]>`, `readRows(accessToken:string, spreadsheetId:string, tabTitle:string):Promise<string[][]>`; DataRepositories에 전용 `googleSheetsImportSource` 한 slot. 기존 googleSheetsImport 공개 exports는 그대로 둔다. 기본 source adapter는 기존 두 함수를 위임 호출한다. 만족도 caller는 기존 helper를 계속 사용한다. generic OperationSourceReader는 수정하지 않는다. 런타임 malformed payload는 현재 parser 실패를 보존하며 static 타입을 런타임 검증처럼 주장하지 않는다.

| 단계/입력 | 조건 → 출력·다음 단계 | 실패·side effect 규칙 |
| --- | --- | --- |
| wrapper | 현재 withActivity가 requestActivity scope 먼저 확인 | 명시 누락은 기존 throw, auth/source/business 호출 0. wrapper 밖 오류를 새 JSON으로 바꾸지 않음 |
| 인증 | requireWorkspaceSession의 기존 workspace guard 유지 | redirect 제어흐름 보존. 관리자 guard로 강화/완화하지 않음. token 없으면 기존401/reauthRequired, source 0 |
| JSON·선행인자 | 기존 request.json → import tabTitle?.trim/빈tab 검사 → URL parser. tabs는 JSON→URL | 이 단계의 JSON/tabTitle/URL 오류만 fetch0. headerRowNumber/importYear/sourceName을 선검증하지 않음 |
| 사전 scope 해석 | 위 선행인자 통과 후 source를 resolve. 명시 import는 imports/teamMembers/instructorNote 모두 resolve | resolve는 IO하지 않음. 어느 하나 누락하면 catch400 fallback; source/roster/business IO0, 기본 PG/local/Notion0. 정상 requestActivity가 있으면 실패 요청 감사는 허용 |
| 무scope | source는 기존HTTP. import는 원래 storeParsedImport | 무scope에 명단 factory를 사용하지 않음. 기본PG 직접 명단정책 유지, OPERATION_DATA_SOURCE local/notion이 이를 바꾸지 않음 |
| 명시scope | source+필수 저장 ports를 포착 후 해당 요청 내부에서 사용 | partial scope에 기본HTTP/PG fallback 금지. 테스트·shadow 조립은 명시된 객체만 사용 |
| 원천/parse/store | tabs는 listTabs 결과. import는 readRows → headerRowNumber/importYear 평가 및 parseImportTable → 빈parsed 검사 → sourceName.trim/팀 등 저장인자 평가 → 기존store | tabs는 imports/명단 scope 불필요. sourceName 평가오류도 이미 source1회이며 store0. 응답 객체 생성 뒤 finally감사 완료까지 POST 미반환 |

### 평가 순서와 의도차이의 고정 반례

- `sourceName:123` + 정상 비어있지 않은 parsed rows: source1회 → parse 성공 → sourceName.trim TypeError → store0. 원본은 raw message400, current는 고정 fallback400이다. 검증에서 원본과 보안수정 응답을 구별한다.
- 같은 sourceName + 유효한 header만 있는 table(즉 parse 성공, parsed.rows=[]): source1회 → 빈행400 `저장할 행이 없습니다.`; sourceName을 평가하지 않는다. `values:[]`는 header 오류가 될 수 있으므로 이 fixture와 구별한다.
- sourceName123 + malformed header/parser 입력: source1회 후 parser 실패가 먼저다. fetch 실패와 교차하면 parser/sourceName은 모두 미평가다.
- 명시 missing port는 tabTitle/URL 뒤, fetch 전에 거부한다. 원본은 이 경우 fetch 뒤 저장 시점까지 갈 수 있으므로 이는 의도적 조기차단이다. missing port+sourceName123 또는 잘못된header 모두 source0이며 해당 고정400. 이를 원본 오류우선순위와 완전동등이라 주장하지 않는다.
- auth/token, JSON/tabTitle/URL 선행 실패는 missing source/import port보다 앞서며 기존 결과를 보존한다. 단 requestActivity 누락은 wrapper 시작에서 가장 먼저 거부한다.

### 인증과 요청감사의 정확한 구분

합성 env는 DEV_AUTH_BYPASS를 꺼서 실제 guard가 low-level auth()를 호출하게 한다. wrapper와 guard의 auth 호출은 별도 trace로 센다. Authorization 존재는 actorType만 token_request로 만들며 session 인증을 대신하지 않는다.

| fixture | wrapper actor/auth | 실제 guard 및 결과 |
| --- | --- | --- |
| Authorization 없음, 허용 email+Google token | wrapper auth1회, user/lowercase email/name 최대200자 | guard auth1회, 정상200; 합계2회 |
| Authorization 있음, 허용 session+Google token | wrapper auth0회, token_request/email null/name null | guard auth1회, 정상200; Authorization token을 Google token으로 쓰지 않음 |
| Authorization 없음, 미허용 email 또는 null session | wrapper auth1회, anonymous/null/null | guard auth1회, 실제 /sign-in redirect; source/store0 |
| Authorization 있음, 미허용 email 또는 null session | wrapper auth0회, token_request/null/null | guard auth1회, 같은 redirect; source/store0 |
| Authorization 없음, 허용 email+Google token 없음 | wrapper user | guard 통과 뒤401/reauthRequired; source/store0 |
| Authorization 있음, 허용 email+Google token 없음 | wrapper token_request | guard 통과 뒤 같은401; source/store0 |

guard의 redirect digest/status는 실제 frozen 구현으로 확인하며 임의 JSON401로 바꾸지 않는다. requestActivity 누락이면 이 모든 auth 호출은0이다.

trace의 response는 HTTP 전송/POST resolve가 아니라 `Response 객체 생성`이다. 실제 순서는 handler Response 생성 → wrapper status/X-Request-Id 설정 → finally recordRequest await → POST resolve이며, redirect는 finally 후 reject다. 감사 promise를 barrier로 보류해 POST가 아직 settle되지 않았음을 검증한다. 감사 실패는 best-effort 고정로그 후 settle이며 wrapper audit 시도는 요청당1회다.

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

### transaction 재시도와 commit ACK 오류

source read, parseImportTable, 저장인자 평가, roster 2종 읽기/validateImportRows는 withTransaction callback 밖이다. 기존 Mongo runId도 callback 밖에서 생성된다. callback retry는 저장 snapshot과 run/rows 삽입만 다시 실행하고 handler 전체를 다시 호출하지 않는다. 새 retry helper를 만들지 않는다.

1. callback transient retry: 첫 attempt를 확정 abort시키는 명시 fault로 기존 driver의 callback 재실행을 관찰한다. source=1/parser=1/각 roster=1/storeParsedImport=1/wrapper audit=1, callback>=2. 최종200이며 run1개+전체예정 rows만, 실패 attempt의 부분rows0. 실제 driver label 처리와 테스트 주입을 구분 기록한다.
2. 실제 commit 성공 뒤 ACK fault: 실제 commit을 완료시킨 다음 ACK 경계에서만 오류를 주입한다. 이후 독립 조회로 run1개+전체rows를 확인한다. (a) driver가 commit 재확인으로 회복하면200, (b) 확정 commit 뒤 최종 오류를 호출자에게 전달하도록 주입하면 handler 고정400. 두 injection schedule의 HTTP 기대값을 별도로 고정한다. commit 재확인은 callback 재실행과 다르며 관찰횟수를 기록한다. 정상 callback1회인 결정적 ACK fixture에서 handler/source/parser/roster/audit는 각1회다.
3. 실제 성공 증거 없는 unresolved unknowncommit은 별도다. 전체반영/미반영만 허용하지만 위 '성공후 ACK fault'의 실제반영을 미반영도 허용하는 oracle로 약화하지 않는다.

각 경우 HTTP body/status, commit 결과, raw run+rows 전체, single wrapper audit의 status와 finally 완료를 함께 대조한다. 내부 retry 때문에 audit2개, source2회, duplicate run이 생기면 FAIL. 실제 사용자 재요청은 별도 요청이며 원래 duplicate run 정책을 따른다.

### summary 순서와 sourceType 음성대조

route의 sourceType은 항상 spreadsheet다. 다른 sourceType 중복 음성대조는 이전 run/rows를 명시 historical seed로 준비한다. 같은 sourceName/team/fingerprint에 sourceType만 notion인 기록이 있어도 새 spreadsheet 요청이 저장되어야 한다. 비교용 spreadsheet seed는 중복을 발생시켜야 한다. 요청 body sourceType을 바꿔 통과했다고 주장하지 않는다.

listImportRuns는 startedAt DESC → 실제 UUID id DESC. 각 backend에서 실제 raw id/startedAt에 따른 반환 순서를 먼저 검사하고, 이후 각 row의 complete DTO를 fixture identity bijection으로 대조한다. 결과 배열을 공통 fixture 순서로 다시 정렬하지 않는다. 동적 UUID가 서로 달라 tie의 backend별 fixture 순서가 달라질 수 있으며 이를 DTO 불일치로 처리하지 않는다. non-tie 순서, 같은 startedAt의 명시 UUID high/low historical fixture, 실제 생성ID tie를 분리한다. expected comparator는 제품코드를 공유하지 않고 고정 UUID fixture의 literal rank와 실제 raw값 근거를 사용한다.

### preview 경계와 비대상 업무모델 보호

201개 고유 fingerprint의 실제 import POST로 run.rowCount=storedCount=201, source rows201을 만든다. 한 tab 내 고유 물리행 번호로 expected 순서를 독립 literal로 고정한다. detail.records는 원본 sourceSheet 정렬→sourceRowNumber ASC의 앞200이며 201번째 fixture identity는 제외한다. count는 preview길이200과 달리201이어야 한다. 199행 case도 별도로 실제 POST를 거쳐 records199/stored199를 확인한다. 201행 oracle의 negative control은 actual DTO사본에 201번째를200번째 대신 끼우거나 200번째를 제거/201개로 늘려 반드시 실패해야 한다. 테스트 expected를 actual 정렬결과에서 생성하지 않는다.

Company/Course/OperationSession에 참조가 맞는 합성 sentinel을 미리 저장한다. 이 세 collection/table의 전체 raw row/document count와 canonical state를 요청 전후 비교하고 정확히 불변이어야 한다. 새 OperationSourceRecord는 모두 operationSessionId=null, promotion/Calendar 호출0이어야 한다. 신규 추가를 못 잡는 sentinel 일부필드 비교로 대체하지 않는다. requestActivity 및 기존 PG audit retention은 별도 효과다. 따라서 DB전체 무변경을 요구하지 않으며 audit/retention 변화가 sentinel 변경을 정당화하지도 않는다. retention 실행조건은 별도 소유fixture로 통제·관찰하고 제품 정책을 바꾸지 않는다.

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

원천 transport spy는 raw URL/options/JSON/throw를 기록하고 승인 합성 응답만 반환한다. actual Google 접근은0. source fake만 성공하는 검사와 real adapter→synthetic transport 검사를 별도 표기한다. actual Mongo imports/teamMembers/instructorNote/requestActivity를 조립한 저장 증거가 필수다. 각 case/전체tuple와 기대값은 validation-v2에 따른다.
산출물: baseline/current/native ledger, 실패 counterexample, source hashes, mock/injection/native 구분. 수락: 필수 case skip0 및 whole DTO 반례 없음. 원본과 의도적 보안 차이는 별도 대조.

## S6 [Check] 원자성·격리·영향 회귀·인계 — R7/R9/R10

동시 A/B scope barrier, 중복 두 schedule, source 실패/roster 실패/저장 abort/감사 실패를 각각 실행한다. 기존 staging 증거를 인용할 때 baseline/의존 hash를 확인하고 새 조합 actual handler를 대체하지 않는다. unknowncommit은 실제 failpoint 또는 명시 주입으로 구별, 테스트가 미실행이면 pending.

실행 담당은 불변 runner/전후 source digest, actual PG+Mongo/handler, typecheck/lint/build와 기존 영향 테스트를 기록한다. 일반 회귀와 Mongo 회귀 범위는 변경된 context의 실제 consumers 기준으로 부모가 고정한다. 실패·코드변경이면 영향 집합 재실행, 파일별최종 집계와 단일SHA실행을 구분한다. 소유 endpoint·DB 검증 후 cleanup/잔존0/종료·port 확인, durable hash를 보존한다. timeout은 child exit 관찰 후 종료하고 후속worker를 멈춰 cleanup 겹침을 막는다.

수락: verification + 사용자 의미 validation + 독립검토 + evidence/alignment/handoff 완료. 코드수락/원격통합/생산이전은 별도 상태다. runtime/OAuth/UI/실원천/Notion/Drive writer/전체Calendar조립은 후속으로 남긴다.

## 현재 인계

현재: Parfit 4항목/Sagan M1~M4 반영 외부 v2, 확정SHA 전달받음. 전 실행 pending. 다음: 부모 전체검토 → 확정SHA 원본closure 동결 → 새Task 구현. 지금 Do Not: 저장소 수정, Drive 파일 변경, DB/네트워크/테스트 실행, scope 확장. alignment 후보는 update_next_task이며 상위 문서 반영은 부모 소유다.
