# Validation v1 — Google Sheets import boundary

상태: 작성자 자체 구조검토 및 검증 설계. 독립 critic/architect 판정은 아직 없다. 실행 결과는 전부 PENDING이며 구조 PASS를 제품 PASS로 전용하지 않는다.

## 구조 선행 기준

| 기준 | 자체 판정 | 근거 |
| --- | --- | --- |
| S-1 모든 실행 Step Core/Shell/Check 태그 | PASS | S1 Shell, S2/S3 Core, S4 Shell, S5/S6 Check |
| S-2 Core 1개 이상 | PASS | S2 선택·순서, S3 입력/출력/실패 규칙 |
| S-3 블랙박스 없는 조건부 규칙 | PASS | scope 밖/안, auth/token/인자/원천/저장/감사 실패의 분기 및 exact 응답 명세. 독립 oracle와 의도적 차이를 구별 |

구조 종합 자체 PASS. **독립 구조 기준이 FAIL이면 아래 결과 기준은 평가하지 않고 Plan부터 보완한다.**

## 암묵적 가정과 반례

- 현재 UI가 Sheets를 사용한다는 가정은 기각한다. TSX 호출 검색은 upload/promote만, auth의 제거 기록 있음. 외부 호출 여부는 미확인이다(V1).
- scope source가 있으면 안전한 source라는 가정은 금지. 합성 source 객체와 실제 transport 차단을 각각 확인한다(V3/V4).
- 예외면 저장0이라는 가정은 금지. source/confirmed abort/unknowncommit/audit 실패의 결과가 다르다(V7).
- PG와 Mongo의 모든 시각이 같거나 startedAt<=finishedAt라는 가정은 금지. 필드 존재·ISO값·관계·관찰 범위를 검증한다(V5).
- headerRowNumber가 정수/양수라는 가정, Google cells가 늘 string이라는 가정, tabs index 정렬이라는 가정은 금지. frozen 동작을 관찰하고 새 정상화를 넣지 않는다(V2/V5).
- 테스트 expected와 제품 parser/DTO builder/정렬기를 공유하면 동시 오구현이 통과한다. 독립 literal과 negative control을 요구한다(V5).
- 새 staging global unique나 serializable 중복제거가 있다는 가정은 금지. 기존 두 중복 schedule을 보존한다(V7).

## 결과 기준 및 실제 검증 명세

각 V는 해당 실행을 관찰하고 로그/최종 source hash가 연결됐을 때만 PASS. 필수 검사 실패 또는 근거 부재는 수락 불가; 미실행 PENDING. 아래 숫자는 필수 반례의 최소 범주이며 case 개수 자체가 성공 기준은 아니다.

### V1 범위·원본 closure — R1/R2/R3/R10 → S1/S4/S6

- 입력: 최종수락 Drive SHA, frozen roots/runtime edges/loader/package/schema/migration manifest, diff, 실제 UI 사용 검색.
- PASS: 동결은 확정SHA에서만 시작, 실제 source hash 전부 일치; undeclared current import/원본byte/실제loader 변조 3종을 각각 거부. 원본 query/DTO/parse 코드가 current로 몰래 resolve되지 않음.
- 두 POST와 최소 source/context wiring 외 제품변경0. UI/OAuth/만족도/Notion/OperationSourceReader/Drive 파일 변경0. 추가정책이 필요하면 계획 변경 없이 PASS 불가.
- UI 증거는 admin/imports→ImportAdminDashboard→ImportUploadPanel→upload 및 auth scope 코드와 TSX 호출 검색을 기록. 현재 Sheets UI/실원천 사용 입증으로 과대해석하면 FAIL.
- 검증 방법: 정적 diff/hash/closure negative control. fixture용 disposable 사본만 훼손, frozen 원본은 변경0.

### V2 raw HTTP와 export 보존 — R3/R6/R8 → S2/S3/S5

- 원본/current의 실제 googleSheetsImport exports에 synthetic transport를 연결하여 결과와 request URL/options 전체를 독립 literal에 대조한다.
- tabs: 정상 여러 탭(응답순서와 index순서를 일부러 반대로), invalid properties 제거, sheetId0, 빈 title, sheets 누락. gid query/hash 충돌·없는gid·0·음수/비정수·비유한값; URL trim/잘못된URL 및 regex-match 비표준 host는 원본관찰로 고정한다.
- rows: 공백/작은따옴표/Unicode/slash를 포함한 tabTitle의 literal encoded range, A1:ZZ2000/majorDimension=ROWS/Bearer exact. values 누락/null/빈배열, raw scalar cell·malformed row가 성공/실패하는 지점과 순서 비교.
- HTTP401/403/429/500, response.json throw, transport reject. 401/403 동일 고정문구, 기타non-ok 고정문구. 새 retry/cache/POST/Google write 요청0.
- PASS: 정상 output·raw request 전체 일치, 모든 외부 fetch는 tripwire로0. 기존 satisfaction 세 caller가 참조하는 exports/signatures 보존. fake source 성공만으로 이 V를 통과할 수 없음.

### V3 실제 handler 인증·preflight — R3/R4/R6 → S2/S5

- 실제 export POST와 실제 withActivity 사용. 허용된 seam은 auth 결과/합성transport이며 handler 내부 core를 대체하지 않는다.
- 무session/허용되지 않은workspace: 기존 redirect/control-flow와 감사status 확인. 유효session/token 없음: exact401 `{ok:false,error:'Google 스프레드시트 읽기 권한이 필요합니다.',reauthRequired:true}`. source0/store0.
- requestActivity 누락: wrapper 진입 시 throw, auth/source/store0. 나머지 정상 명시scope에서 source/ imports/teamMembers/instructorNote를 하나씩 제거한 유효 import요청: catch400 해당 fallback, 원천0/roster0/staging0/defaultPG0. tabs는 source/requestActivity만 있으면 성공해야 함.
- 잘못된 JSON, 빈tab, 잘못된URL을 missing-port와 함께 주어 계획의 auth→인자→preflight 순서가 바뀌지 않는지 확인. token이 없으면 source resolver 오류로401을 가리지 않는다.
- 정상 trace: source read→parser→roster reads→store transaction→response→audit. preflight는 port 해석만 하며 새로운 DB/원천 IO0.
- PASS: 응답 및 예외 종류·전체순서·각 부수호출 카운트 모두 기대와 같음. 누락 scope의 requestActivity 실패기록은 허용하되 업무 저장과 분리한다.

### V4 기본PG·명시 조립·격리 — R4/R9 → S2/S4/S6

- 기본 무scope actual handler+합성 raw HTTP+실PG를 OPERATION_DATA_SOURCE local/notion 각각에서 실행. 저장/roster는 실제PG임을 증명하고 local파일/Notion fetch tripwire0. 실제 env파일은 읽지 않고 isolated child의 합성 env만 사용.
- 명시 Mongo 조립은 real imports/teamMembers/instructorNote/requestActivity+synthetic source. defaultPG tripwire0. namespaceA/B와 tokenA/B 두 요청을 barrier로 겹치고 실제결과·원천호출 인자·raw 저장namespace·감사 actor가 교차0임을 확인.
- 한 요청 실패 뒤 새 scoped/default 요청이 원래 경로로 성공. header/cookie/query에 Mongo 비슷한 값을 넣어도 backend 선택 변화0.
- 등록 Calendar scope 규칙의 기존 회귀 보존. 새 전체앱/Calendar runtime 조립 수락으로 확장하지 않음.
- PASS: 의도한 DB/원천만 호출. A/B별 전체 결과와 같은 namespace 부모연결 exact, 이탈0.

### V5 독립 frozen PG/current PG/native whole 결과 — R2/R5/R8 → S1/S3/S5

동일 합성 raw rows와 독립 명단 fixture를 사용하여 세 backend actual handler를 실행한다. 원본·current는 별도 worker. expected는 handwritten literal이며 제품 parser/validation/presenter를 호출해 생성하지 않는다.

필수 fixture:
- 정상행: mapped/unmapped/raw cell, nullable/빈값, 명시년도와 누락년도, metadata/sourceName fallback과 trim, team별 alias 및 UNKNOWN, importedBy/fileName미지정.
- 헤더 앞 안내행/비어있는행/헤더추론, 물리행 번호 유지. headerRowNumber omitted/0/음수/분수/범위밖·잘못된타입의 실제원본 결과. importYear1999/2000/2100/2101/분수/문자열/누락.
- 오류행: 필수값·날짜/OM/LD/강사 검증의 기존 문구와 순서. 알려진강사/빈강사/미등록강사를 분리. 빈parse400(저장0), 모든저장행오류라도 staging보존.
- 같은요청 중복, 두번째요청 전부중복(새run 생성/rows0), 일부중복, sourceName/팀/sourceType이 다른 음성대조.

검증 대상:
1. tabs/import HTTP status와 JSON key/value 전체. X-Request-Id는 실제 audit 참조와 일치, 임의 삭제하지 않음.
2. persisted DataImportRun/OperationSourceRecord의 모든 semantic field와 JSON 중첩값·배열순서·중복수. run/sourceRecord ID는 backend별 bijection을 지정하여 FK와 response ID를 함께 확인. 무차별key제거나 selected subset만 대조 금지.
3. 기존 imports summary/detail whole DTO와 record count/preview 한계. 실제 read를 통해 검토 가능한 형태인지 확인한다. 이번 page 코드변경/가짜 UI 추가 없음.
4. 시작/종료/created 시각은 null/non-null과 ISO/실제 읽힌값 및 호출 범위를 확인. PG DB default와 app clock 차이를 먼저관찰; 시작≤종료는 강요하지 않음. 동적값 예외 목록과 근거만 허용.
5. requestActivity route/method/status/actorType/actorEmail/actorName 및 requestId 연결. duration은 관찰 가능한 비음수정수. DataImportRun/OperationSourceRecord mutation audit0. token/rawbody는 감사0.

PASS: 승인된 동적값 정규화 외 모든 tuple/key/cardinality/order 일치, parser의 rowCount와 저장의 count 규칙 exact. literal negative control은 필드누락/추가/잘못된값/배열순서/중복수/NULL↔빈값 교체를 각각 reject해야 한다. 정상 JSON object key 삽입순서 차이는 허용한다.

### V6 exact error allowlist와 PII — R6/R8 → S3/S5

- Plan S3의 경로별4/3개 exact 허용문구를 Error와 MongoServerError로 각각 주입; exact만 원문 허용. 접두/접미/줄바꿈/canary첨부/대소문자변경은 fallback. plain object의 message가 같아도 instanceof Error가 아니면 fallback. non-Error/string/null도 fallback.
- JSON parse/driver/crypto/roster/source/timeout canary Error와 cause/stack에 합성token/email/id/rawrow를 넣어 actual handler response·콘솔·감사에서 검색한다. 고정 문구가 같다는 이유로 driver가 안전하다고 일반화하지 않는다.
- 실제 HTTP403/500과 실제native 저장오류, 주입류를 로그에서 분리. 실제 외부driver 실패 증거라고 canary injection을 포장하지 않음.
- rawMongo에서 승인 PII필드 암호화/companion 정책 검사, 토큰은 전collection0. tabs의 spreadsheetId/title 등 승인된 DTO와 staging 원문보존은 허용하며 오류·로그로 새어나온 것과 구별.
- PASS: exact 공개문구 외 rawerror 노출0, token 저장/노출0, 승인 DTO필드 불필요 삭제0. 원본error.message보다 안전한 의도차이는 명시되고 양backend에 동일 적용.

### V7 저장 원자성·중복schedule·기존 한계 — R5/R7/R8 → S3/S6

- source 실패와 parser 실패: run/rows0. roster읽기 실패: source읽기는 있을 수 있으나 staging0.
- native transaction rows삽입 도중 confirmed abort: 해당namespace raw run/rows 전후변경0. 원천재호출을 원래없는 재시도로 추가하지 않음.
- unknowncommit: 결과 불확정으로 기록하고 실제상태는 전체반영 또는전체미반영만 허용. HTTP실패만으로 rollback 주장 금지. 주입 여부/실driver 여부를 구별한다.
- requestActivity.recordRequest 실패: 기존성공응답·commit 보존, 고정로그, PGfallback0. 감사 실패를 사업transaction abort로 처리하면 FAIL.
- 중복 두schedule은 barrier로 실제 조회/commit 순서 증명: 양쪽조회선행은 각각저장 허용; 첫commit후둘째조회는 duplicate run/row0. frozenPG 허용결과와 전tuple대조. 자동전역직렬화/추가unique가 들어가면 실패.
- sourceType 후보 인증/HMAC key 불일치/companion 누락, ciphertext 손상/부모run손상, 기존 write scan 한계/timeout의 검증은 불변 의존 hash와 기존증거에 연결하거나 영향 재실행한다. 새handler 연결을 기존repository test 통과로 대체하지 않는다.
- PASS: schema/unique/guard/업무정책 변화0, 부분staging0, 예외분류에 맞는 실제상태, 모든필수 evidence 연결. scan-limit을 입력행수 제한으로 잘못 바꾸지 않음.

### V8 최종실행·정리·정합 — R1/R9/R10 → S6

- 부모 지정 새 synthetic endpoint/소유 DB만 사용. 실제 Google/Notion/Drive/운영env/network0. migration/prepare는 확인한 소유환경에서만. 이번 사전계획에는 어떤 실행PASS도 없음.
- actual suites 필수skip0, typecheck/build exit0, lint error0(기존warning 분리). source finalhash·불변 runner·각 log exit/TAP/실행버전 연결. 일반 unit의 기존skip은 내역과 함께 별도집계.
- 영향회귀는 context/public helper 변화에 따른 consumers를 산출하여 실행. 변경후 stale 결과를 최종코드 증거로 사용하지 않음. 파일별union이면 단일불변SHA fullrun이라고 부르지 않음.
- timeout child observed exit 전 cleanup/다음worker 금지. 잔존이면 cleanup-required로 실패기록, 소유자 외 DB 삭제0. 정리 후 owned DB/collection/port/temp path 증거와 durablehash 보존.
- PASS: 독립review/evidence/alignment/handoff의 열린gap0(명시 후속은 제외). 기본PG/생산미전환/UI·OAuth미복원/Notion별도/Drive writer별도/Calendar전체조립별도 표시. 원격통합은 별도후속 상태.

## 요구사항 추적

| 요구사항 | 검증 |
| --- | --- |
| R1 | V1,V8 |
| R2 | V1,V5 |
| R3 | V1,V2,V3 |
| R4 | V3,V4 |
| R5 | V5,V7 |
| R6 | V2,V3,V6 |
| R7 | V7 |
| R8 | V2,V5,V6,V7 |
| R9 | V4,V8 |
| R10 | V1,V8 |

고아 V/미커버 R 없음. 실행 정확성은 V1~V8의 관찰자료로 판단하고, 사용자 의미는 '합성 Sheets 행을 기존과 같은 검토가능 staging으로 저장하면서 scope누락·원천실패가 오접속/유출/부분업무저장으로 이어지지 않음'을 V3~V7 전체tuple로 판단한다. 점수평균으로 필수실패를 상쇄하지 않는다. 독립 메타검토는 이 3문서만 먼저 읽고 요구사항추적·실패변별·객관성 및 scope 과대를 판정하면 된다.
