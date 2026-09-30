# Validation v1 — Notion import 명시 경계

상태: 독립 critic의 검증 설계안. plan-v1 및 실제 route/reader/staging 코드의 정적 검토를 근거로 작성했다. 제품 구현·DB·테스트 실행은 NOT_RUN이며 실행 수락을 뜻하지 않는다.

기준 commit은 `093f585b444197c6b0442a3880469fd0d6a0502b`다. 실행 담당이 동결 시 실제 commit과 bytes를 확인한다. 상위 계속 구현 승인은 유지하며 기술적 관찰을 새로운 사용자 정책 결정으로 바꾸지 않는다.

## 1. 구조 선행 gate

| Gate | 판정 | 근거 |
| --- | --- | --- |
| S1 — 모든 단계 태그 | PASS, 정적 설계 | S1/S4는 Shell, S2/S3는 Core, S5/S6는 Check로 표시됐다. |
| S2 — Core 존재 | PASS, 정적 설계 | S2의 선택·평가 순서와 S3의 reader·저장·오류 계약이 독립 Core다. |
| S3 — 조건부 판단 규칙 | PASS, 정적 설계 | scope/auth/token/URL/원천/빈행/저장/감사 분기 및 원본과 의도적으로 다른 오류를 구분한다. 아래 기준으로 관찰 가능한 조건을 고정한다. |

구조 PASS는 실행 PASS가 아니다. 구현 중 위 조건을 변경하거나 필수 분기를 미정 상태로 두면 해당 gate를 다시 검토한다. 결과 기준은 필수 하위 항목 모두 충족해야 하며 미실행은 PENDING, 불일치는 FAIL이다.

## 2. 숨은 가정과 확정 경계

1. **Notion token은 요청 session token이 아니라 서버 공용 env credential이다.** 기존 route의 token/env 선택을 유지한다. source/config를 모두 주입하는 tenant 설정은 이번 범위에 추가하지 않는다.
2. 같은 process의 동시 A/B 검사는 불변 합성 서버 token 하나와 서로 다른 source/database/namespace를 사용한다. 서로 다른 env 선택은 직렬 검사 또는 별도 worker로 검증한다. 진행 중 전역 env를 바꾸거나 scope별 token 두 개를 지원한다고 주장하지 않는다.
3. **source port 결과는 이미 parsed다.** source stub 성공은 실제 pagination·mapper·JSON parser 보존 증거가 아니다. raw HTTP→실제 reader와 actual POST→저장을 각각 연결한다.
4. **mapper는 필요한 값만 지연 평가하지 않는다.** `getDateRange`, `page.id.replaceAll`, `getTitle`이 course alias 선택보다 먼저 실행된다. 유효한 과정 alias가 있어도 malformed property 때문에 앞 단계에서 실패할 수 있다.
5. **원본은 모든 page 수집 후 mapping한다.** 첫 page에 malformed property가 있어도 뒤 page HTTP 실패가 먼저 드러날 수 있다. streaming mapping 또는 page별 저장으로 바꾸지 않는다.
6. **unknown Notion property가 그대로 unmappedFields에 보존되지는 않는다.** reader가 고정 한국어 키로 만든 행이 parser 입력이다. reader가 버린 원본 property까지 staging에 저장한다고 주장하지 않는다.
7. 정상 page는 운영ID를 생성하므로 빈 properties도 행이 된다. `reader.rowCount != parsed.rows.length` 반례는 별도 synthetic-port 계약 검사로 표시한다.
8. undefined·NaN·Infinity·함수·getter처럼 HTTP JSON에서 표현할 수 없는 값은 실제 Notion JSON 관찰과 구분한다. 필요하면 명시된 런타임 주입으로 검증한다.
9. 기존 cursor cycle 방지·페이지 상한·timeout 부재는 기존 한계다. 검증 harness가 유한 횟수 후 합성 실패로 종료하되 제품에 새 제한을 추가하지 않는다.

## V1 — 원본 독립성·실행 기반

R1/R3/R6 → Plan S1/S4/S5

### 필수 증거

- 기준 commit에서 route, notionImport, parser/writer, query factory/Prisma repository/presenter와 auth/activity/privacy/명단의 runtime closure를 동결한다.
- 각 origin→resolved target, frozen path, SHA, runtime/type-only/external 구분을 manifest에 기록한다. package/lock/schema/migrations 및 실제 실행 loader도 포함한다.
- frozen original, current PG, explicit Mongo는 별도 process/module cache로 실행한다.
- 정상 대체 seam은 low-level `auth()` 입력과 합성 HTTP transport다. 실제 workspace guard, withActivity, reader/parser, 저장 및 조회 구현은 유지한다.
- 관찰 proxy는 실제 함수에 위임한 결과를 바꾸지 않는다. 실패주입은 위치·실제 위임 완료 여부·복원 여부를 별도 기록한다.

### 실패 변별

- route/reader의 frozen byte 변조, 조회 factory/repository/presenter 각각의 byte 변조, 미등록 current import 탈출, 실제 loader 변조를 disposable 사본에서 거부해야 한다.
- original이 current parser/presenter로 resolve되거나 current expected builder를 사용하면 FAIL이다.
- raw source fixture는 공유할 수 있으나 expected parsed/저장/DTO 값은 제품 mapper/parser 결과로 생성하지 않는다.

### 환경 및 gate

부모 지정 PG56752/notion_import_test와 Mongo27852/notionimport20260930의 실제 host·database·user·data directory·replica 및 소유권을 확인한 뒤 실행한다. 실제 env 파일이나 운영 credential은 읽지 않는다.

선행 frozen PG gate에서 env 선택, 원천 빈 결과, property 변환, count 및 동적 시각을 관찰한다. gate의 관찰 수집 성공을 전체 parity 성공으로 부르지 않는다.

## V2 — token/env·인증·평가 순서·preflight

R1/R2/R5 → Plan S2

### token과 URL 선택

직렬 검사 또는 isolated worker의 합성 env에서 다음을 actual POST로 확인한다.

- TOKEN 설정 시 API_KEY보다 우선.
- TOKEN 미설정 시 API_KEY 사용.
- TOKEN `""`이면 API_KEY가 있어도 설정필요400.
- TOKEN 공백 문자열은 truthy로 유지하며 임의 trim하지 않음.
- body token, Authorization 값, session의 Google token은 Notion 서버 token을 대체하지 않음.
- 팀 alias `team_1/1팀`, `team_2/2팀`, 기타 UNKNOWN.
- `databaseUrl.trim()` → `notionUrl.trim()` → 해당 팀 ID `||` URL → 빈값 순서.
- 명시 databaseUrl이 truthy 문자열이면 잘못된 타입 notionUrl은 평가하지 않음.
- 명시 URL이 공백이면 다음 후보를 사용함.
- 팀별 ID가 빈문자열이면 URL로 fallback하지만 공백 ID는 truthy로 선택되어 reader에서 ID 오류가 될 수 있음.
- UNKNOWN은 IMPORT_ID/IMPORT_URL을 사용하고 임의 팀 기본값을 추가하지 않음.

후순위 환경 getter 호출 자체를 증명하기 위해 env를 변조할 필요는 없다. 서로 다른 후보값과 실패하는 후순위 입력으로 실제 선택 결과를 구별한다.

### 정확한 응답과 순서

| 입력 | 기대 |
| --- | --- |
| requestActivity 누락 | wrapper 진입에서 reject; auth/source/business 0 |
| 인증 불허 | 실제 guard redirect; source/store 0, 원본 감사 status |
| token 없음 또는 빈 TOKEN | 400, `서버에 NOTION_TOKEN 설정이 필요합니다.`; JSON/source/store 0 |
| malformed JSON | catch400; current 고정 fallback, source/store 0 |
| 선택된 URL 없음 | 400, `Notion 데이터베이스 URL을 입력하거나 담당 팀을 선택해 주세요.` |
| truthy invalid ID + complete scope | source reader 진입 후 ID 오류; fetch/store 0 |
| truthy invalid ID + 필수 port 누락 | preflight 고정 fallback400; source/fetch/roster/store 0 |
| 정상 source + sourceName123 | source/parse 완료 후 catch400, store 0 |
| 빈 source + sourceName123 | `저장할 Notion 행이 없습니다.` 400 우선; sourceName 미평가 |
| source 오류 + sourceName123 | source 오류 우선; sourceName/store 미평가 |

현재 route의 raw TypeError 공개 제거와 invalid ID보다 missing-port가 먼저인 변경은 의도적 차이로 별도 비교한다. 원본과 모든 실패 문자열이 같아야 한다고 요구하지 않는다.

필수 port는 notionImportSource/imports/teamMembers/instructorNote다. 하나씩 제거한 actual POST에서 외부 호출·명단 읽기·업무 저장·default PG/local/다른 Notion fallback 0을 확인한다. requestActivity 정상일 때 실패 요청 감사는 허용한다. preflight에 DB ping/DDL을 추가하지 않는다.

### 실제 인증과 감사

DEV_AUTH_BYPASS를 끄고 low-level auth만 공급한다.

- Authorization 없음: wrapper와 guard가 각각 auth를 호출한다.
- Authorization 있음: wrapper는 token_request/null actor로 분류하지만 실제 guard는 session을 확인한다.
- 허용 session, null session, 미허용 email을 Authorization 유무와 교차한다.
- actorEmail lowercase/name 최대200자와 importedBy의 session 원문을 구분한다.
- 감사 promise를 보류하면 POST가 아직 settle되지 않아야 한다. redirect도 finally 후 reject한다.
- 감사 실패는 고정 로그 뒤 원래 응답을 유지하며 요청당 감사 시도는 한 번이다.

## V3 — 실제 Notion HTTP·pagination·mapper

R1/R3/R5 → Plan S3

실제 `readNotionDatabaseImport`에 raw 합성 fetch를 연결한다. 원본/current 결과와 outgoing URL/options/body 전체를 독립 literal에 대조한다.

### ID 및 HTTP

- compact32hex, dashed UUID, 대소문자, URL 내 ID, 공백·비표준 host 입력.
- dashed ID가 먼저 등장해도 뒤 compact ID가 있으면 compact 검색 우선인 반례.
- 잘못된 ID는 fetch0.
- 고정 api.notion.com URL, POST, Bearer, Content-Type, Notion-Version `2022-06-28`, cache `no-store`, page_size100.
- 첫 JSON body에 start_cursor 키가 없어야 하며 후속 요청에는 이전 cursor가 정확히 들어간다.

### 페이지네이션

- 두 page 이상과 빈 중간 page, 응답 순서 보존.
- `has_more=false`인데 cursor가 있어도 종료.
- `has_more=true`라도 cursor null/누락/빈문자열이면 종료.
- results 누락/null은 기존 빈 배열 의미.
- 반복 cursor는 합성 transport가 정해진 횟수 후 실패시켜 요청 반복을 관찰한다. worker를 무기한 방치하지 않는다.
- 두 번째 이후 HTTP401/403/429/500, JSON decode 실패, transport reject에서 부분 staging0.
- 첫 page의 malformed property와 뒤 page HTTP 실패를 교차하여 전체 fetch가 mapping보다 먼저임을 확인한다.

### mapper와 parser

고정 alias 목록 전체를 검증 표에 옮기고, 각 목록에 서로 다른 nonempty 값 두 개 및 빈 우선 alias를 배치해 우선순위를 구별한다.

- course alias가 없으면 properties 열거 순서상 첫 nonempty title.
- title/rich_text는 plain_text를 구분자 없이 join 후 trim. 비배열·null 원소 처리도 원본대로.
- people/multi_select는 이름 trim·빈값 제거·`, ` join.
- select/status/url, date, formula string/number0/booleanfalse.
- unsupported property는 빈값. unknown 원천 property를 staging unmapped로 자동 보존하지 않음.
- date alias 첫 truthy start, slice10, end null/누락이면 start, end 빈문자열이면 빈값.
- page.id dash 제거와 `NOTION-` 접두, page.url→싱크업.
- 빈 properties지만 정상 id인 page는 운영ID 행으로 남음.
- missing/nonstring id, null property, nonstring date start/end, nonstring page.url 등의 JSON 가능한 malformed 값은 원본 실패 위치를 보존함.
- 유효한 course alias와 malformed 다른 property를 같이 두어 eager getTitle 평가를 무시하는 구현을 잡음.

reader 전체 반환 `{databaseId, parsed, rowCount}`를 비교한다. parsed의 headerRowNumber1, rowNumber2부터, rowSnapshot/mappedFields/unmappedFields/validationErrors/fingerprint 및 순서를 포함한다.

빈 source와 서로 다른 count의 synthetic-port 반례는 구분한다. 후자는 route의 HTTP rowCount가 source.rowCount임을 검증할 뿐 실제 Notion 응답에서 발생했다고 주장하지 않는다.

## V4 — actual POST의 PG/Mongo whole tuple

R1/R2/R3/R4 → Plan S3/S4/S5

### 연결

동일 raw Notion pages와 명단 fixture를 사용하여 다음 세 경로를 실행한다.

1. frozen actual POST→실제 reader→실제 PG 저장·frozen 조회
2. current default POST→실제 reader→실제 PG 저장·조회
3. explicit source→실제 reader+합성 transport→real Mongo imports/명단/요청감사→실제 조회

기본 경로는 OPERATION_DATA_SOURCE local/notion에서도 기존 PG 명단·writer를 사용해야 한다.

### whole 결과

- HTTP status와 exact body: `ok, duplicateCount, errorCount, importRunId, rowCount, storedCount`. Sheets의 headerRowNumber를 추가하지 않는다.
- HTTP rowCount는 reader.page 수, run.rowCount는 validated rows 수이며 서로 대체하지 않는다.
- run/source record의 모든 logical field와 중첩 JSON·배열 순서·중복수.
- sourceType notion, sourceSheet Notion, workbook databaseId, fileName null 의미, sourceName 기본/trim, team, importedBy.
- summary/detail 전체 DTO와 response ID→run→source records의 bijection.
- ID·시각은 실제 저장값/FK/호출 구간을 확인한 뒤에만 정규화한다. startedAt≤finishedAt를 새 계약으로 강제하지 않는다.
- summary는 실제 startedAt DESC/id DESC 순서를 먼저 검증한다. backend별 UUID tie 차이를 숨기려고 반환 배열을 재정렬하지 않는다.
- requestId/header/audit 연결, actor/status/route/method 및 비음수 정수 duration.

### 필수 데이터

- 정상 명단 행, 필수값·날짜·OM/LD 오류, 알려진/빈/미등록 강사.
- 팀 alias, UNKNOWN, sourceName 기본·공백·비어 있지 않은 trim.
- 같은 요청의 동일 page 중복, 전부 중복 재요청, 일부 중복 재요청.
- 같은 mapped 값이라도 page.id가 다른 경우의 실제 fingerprint/중복 의미.
- sourceName/team 차이 및 historical spreadsheet sourceType 반례. 요청 body sourceType으로 대체하지 않음.
- 199/201개 고유 page를 실제 pagination과 POST로 저장. raw199/201, detail199/200, 201번째 제외와 전체 count201을 확인한다.

정상 201행 detail과 독립 expected를 비교한 동일 oracle에 200번째 제거·201번째 추가·경계 교체를 넣어 모두 거부한다. 필드 누락/추가/잘못된 값/NULL↔빈값/배열순서/중복수 negative control도 필요하다.

### 비대상 상태와 격리

Company/Course/OperationSession 전체 raw 상태·count를 요청 전후 비교한다. 새 source record의 operationSessionId는 null, 승격/Calendar 호출0이다. 실패 요청은 run뿐 아니라 source records 전체 raw 불변을 확인한다. 요청감사와 기존 PG retention은 별도 효과다.

동시 scope A/B는 같은 process의 불변 서버 token 하나 아래 서로 다른 source/database/namespace로 겹친다. token의 정확한 전달과 응답·로그·감사 비노출을 확인하되, scope별 서로 다른 token 지원을 요구하거나 주장하지 않는다.

서로 다른 token/env 선택은 직렬 또는 별도 worker로 검증한다. 요청 진행 중 전역 env를 바꾸어 격리를 주장하지 않는다. 실패 후 새 scoped/default 요청 복구도 확인한다.

## V5 — 오류 공개·원자성·재사용 한계

R2/R4/R5 → Plan S2/S3/S4

### 정확 오류

route catch에서 공개 가능한 exact Error.message는 다음 두 개다.

1. `Notion 데이터베이스 URL 또는 ID를 확인해 주세요.`
2. `Notion 통합 토큰 권한이 없습니다. 해당 데이터베이스에 Notion 통합을 초대했는지 확인해 주세요.`

나머지는 `Notion 데이터를 가져오지 못했습니다.`로 고정한다.

Error/MongoServerError의 exact, prefix/suffix/newline/canary 변형과 non-Error를 actual POST catch에 주입한다. raw helper의 non-ok 동적 status/statusText 오류는 helper에서 보존하되 route에서는 generic400이어야 한다. helper/route의 의도적 차이를 분리한다.

token/cause/stack/원문 canary가 응답 오류·콘솔·감사에 나오지 않아야 한다. 승인된 검토 DTO와 암호화 staging의 원문 보존은 누출로 오판하지 않는다.

### Notion 연결에서 새로 필요한 증거

| 상황 | 판정 |
| --- | --- |
| 후속 page/source/parser 실패 | run/source rows 변화0 |
| roster 실패 | pagination은 완료될 수 있으나 staging0 |
| 실제 일부 insert 후 confirmed abort | 해당 run/rows 전후 raw 불변 |
| transient callback retry | source.readDatabase1, fetch는 정상 페이지 수, parser1, 각 roster1, store1, audit1; 최종 완전한 run1 |
| 실제 commit 후 ACK 회복 | commit 재확인 뒤200, callback 재실행0, 전체 저장 유지 |
| 실제 commit 후 최종 오류 전달 | generic400이지만 전체 저장 유지, audit400 |
| 미확정 unknowncommit | 전체 반영 또는 미반영만 허용; 실제성공 후 ACK fixture와 구분 |
| 요청감사 실패 | 성공 응답·commit 유지, 고정 로그, PG fallback0 |

여기서 source1은 **reader 호출 한 번**이다. 여러 page의 fetch를 한 번으로 요구하면 안 된다. retry가 원천 pagination을 다시 시작하거나 추가 run을 만들면 FAIL이다.

두 중복 schedule은 같은 raw Notion fixture로 original/current PG/native에서 직접 비교한다. 양쪽 duplicate read가 commit 전 완료된 schedule과 첫 commit을 관찰한 뒤 두 번째 요청을 시작하는 schedule을 구분한다. 전체 응답/run/rows/audit tuple을 비교하고 backend 제외 필터를 두지 않는다.

### 최소 재사용

기존 staging의 codec/HMAC/companion/readiness/scan 한계 전체 matrix를 무조건 복제하지 않는다. 다음을 모두 기록한 항목만 재사용한다.

- 제품 의존 파일·테스트·실행 로그의 hash와 기준 SHA
- 재사용할 정확한 case와 한계
- 이번 변경으로 해당 기반이 바뀌지 않았다는 정적 근거
- actual Notion handler→해당 기반 연결의 새 실행 증거

새 notion sourceType candidate 인증, pagination 실패, Notion env/auth/preflight, route catch, 요청간 격리는 기존 Sheets 통과로 대체할 수 없다. 공통 기반이 변경되면 영향 검사 재실행 또는 재계획한다. 주입을 실제 네트워크 장애나 실 Notion 장애로 표현하지 않는다.

## V6 — 최종 증거·정리·통합

R6 → Plan S5/S6

- 필수 PG/native/handler 검사는 skip0. 일반 opt-in skip은 별도 목록으로 기록한다.
- 전체 일반 검사, typecheck/build exit0, lint error0와 기존 warning 대조를 남긴다.
- final source hash, immutable runner, 실행 명령·버전·exit·로그·재사용 근거를 연결한다. 파일별 최종 결과 union을 단일 SHA 전체 실행으로 부르지 않는다.
- timeout이면 TERM/KILL 뒤 child observed exit를 기다리고 후속 worker를 중단한다. cleanup 성공을 추정하지 않는다.
- 소유 PG 데이터/연결, Mongo DB/작업의 잔존을 확인한 뒤 소유 프로세스·port·dbpath를 정리한다. 타인 자원·borrowed binary는 유지한다.
- 독립 코드·증거 지적은 수정→영향 재검증→재수락으로 닫는다.
- 코드 수락, 소유 데이터 cleanup, 서버 철거, 원격 통합은 각각 별도 상태다.
- 총괄 FF/atomic push·원격 SHA 일치는 실제 증거가 있을 때만 수락한다.
- 운영 기본 PG, 실제 Notion/UI 미검증, 백업 증거0, 개인정보 분류·운영 collation·전체 앱 조립·운영 전환·dev→main 미완료를 유지한다.

## 요구사항 추적과 현재 상태

| 요구사항 | 주요 검증 |
| --- | --- |
| R1 기본 호환성·인증·env·평가 순서 | V1, V2, V3, V4 |
| R2 scope/fallback/격리 | V2, V4, V5 |
| R3 reader·count·PG/Mongo 결과 | V1, V3, V4 |
| R4 오류행·중복·원자성·감사 | V4, V5 |
| R5 민감 오류 비노출 | V2, V3, V5 |
| R6 최종 검사·정리·독립 검토·통합 | V1, V6 |

구조 gate는 정적 검토 PASS다. V1~V6 실행 결과는 모두 NOT_RUN/PENDING이다. 이 문서는 검증 제안이며 제품 최종 수락이나 실행 성공 기록이 아니다.
