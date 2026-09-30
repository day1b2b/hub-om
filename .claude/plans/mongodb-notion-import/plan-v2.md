# Notion 가져오기 계획 v2

상태: 독립 critic/architect 검토의 문구 보완5개를 반영한 계획. 구조 gate S1–S3 중 FAIL 또는 미확정이 있으면 후속 구현·검증 실행·수락을 중단한다. 계획 보완과 구조 재검토 PASS 후 재개한다. 결과 수락은 validation-v2의 V1–V6 필수 하위 항목을 모두 충족해야 하며, 미실행은 PENDING으로 기록한다. 제품 실행 PASS 아님.

변경: 구조 선행 gate, 서버 공유 credential, eager mapping/후기 fetch 교차실패, commit 상태별 결과, Calendar 증거 재사용 범위를 명확히 했다. v1은 보존한다.

## 핵심 난이도

기존 Notion reader는 HTTP뿐 아니라 property 매핑과 JSON parser까지 포함한다. source port를 둔다고 이 의미가 보존됐다고 판단하면 안 된다. 입력 선택/읽기/파싱/저장/감사의 평가 순서와 두 종류 rowCount를 분리하고, 실제 원본 reader와 frozen PG handler를 독립 literal에 대조한다. 같은 staging을 다시 구현하거나 현재 parser로 expected를 생성하는 접근은 거절한다.

대안 A: 기존 reader 전체를 전용 source port로 감싸 두 층(HTTP→parsed, actual POST→DB)을 각각 대조. 기존 public export·만족도/코치/팀의 다른 Notion 사용처 불변, 최소변경 장점. 대안 B: HTTP client/mapper/parser를 새 repository에 재배치. 추상화는 세분화되지만 호출 의미/실패순서·범위 확대 위험이 커 이번에는 A를 선택한다. 원본 loader가 current로 탈출하거나 synthetic source 성공만 검사하면 A도 실패다.

## S1 [Shell] 원본과 격리 환경 준비 — R1/R3/R6

기준093f585b444197c6b0442a3880469fd0d6a0502b의 actual Notion route, notionImport, parser/writer, query factory/Prisma repository/presenter, auth/activity/privacy/명단의 runtime closure를 동결한다. package/lock/schema/migrations/실제loader를 hash로 고정한다. 기존 Sheets 원본 파일을 수정하거나 현제품을 원본 oracle로 사용하지 않는다. scope없는원본 PG가 실행되도록 low-level auth()와 합성 fetch만 대체하고 실제 guard/withActivity를 보존한다.

새 소유 root `/private/tmp/hub-om-notion-import-20260930`, PG56752/database notion_import_test/user synthetic, Mongo27852/replica notionimport20260930을 사용한다. 기존 프로세스/경로가 없음을 먼저 확인하고 새 dbpath·임시키·합성값으로 기동한다. 외부 fetch는 tripwire로 차단한다. 원본 환경/DB를 읽지 않는다.

수락: 기준 commit의 전체 closure byte 일치, query factory/repository/presenter 각각의 변조·current import 탈출과 실제 loader 변조 거부. frozen PG에서 토큰/env 선택·빈원천·property/rowCount·시간의 관찰 gate를 먼저 실행한다. actual PG startedAt과 app finishedAt의 순서를 임의 강제하지 않는다.

## S2 [Core] 원천/저장 선택과 평가 순서 — R1/R2/R5

최소 신규 계약 `NotionImportSource.readDatabase(input:{databaseUrlOrId:string;token:string}):Promise<NotionImportReadResult>`와 `notionImportSource` context slot. default는 기존 readNotionDatabaseImport 함수 그 자체를 사용한다. source 선택은 인증/원천설정 획득을 대신하지 않는다. 새 backend env/header/query selector를 만들지 않는다.

실제 순서:
1. withActivity의 requestActivity scope 선택 → wrapper actor 분류 → 실제 requireWorkspaceSession.
2. `NOTION_TOKEN ?? NOTION_API_KEY` 읽기. 두 값 없음 또는 TOKEN 빈문자열이면 기존 설정필요400(빈 TOKEN은 API_KEY로 fallback하지 않음), JSON/source/저장0. 공백 TOKEN은 기존 truthy 의미 유지.
3. JSON → 팀 alias(team_1/1팀,team_2/2팀,기타UNKNOWN) → `databaseUrl?.trim() || notionUrl?.trim() || 팀설정 || ''`. 팀설정은 ID||URL, UNKNOWN은 IMPORT_ID||IMPORT_URL이다. 명시 URL이 있으면 후순위 속성/환경을 평가하지 않는다. body type을 새로 강제하지 않는다.
4. notionUrl falsy면 기존 URL/팀입력필요400. truthy 값이면 신규 source/imports/teamMembers/instructorNote port를 resolve한 뒤 source.readDatabase를 호출한다. scope누락은 원천/명단/PG IO0, 고정오류400. scope밖은 기존 HTTP/기본PG며 OPERATION_DATA_SOURCE local/notion으로 바뀌지 않는다. 새 IO readiness/ping을 preflight에 넣지 않는다.
5. reader 안의 ID추출 → 모든 HTTP page 읽기 → page mapping → JSON parser 완료. 그 뒤 parsed.rows.length0이면 기존 빈행400; 그렇지 않으면 sourceName?.trim() 또는 기본 'Notion 운영 데이터', storeParsedImport.
6. Response 생성 → wrapper status/X-Request-Id → finally 요청감사 await → POST settle. 요청감사 실패는 고정로그 후 기존응답, 업무commit취소아님.

교차실패: sourceName123+정상source는 fetch/parse후 fallback400/store0; 빈source면 빈행400 우선. invalidURL+missingport는 preflight가먼저라 고정fallback400/source0인 의도적변경이다(원본 ID검사와 완전동등이라 부르지 않음). invalidJSON/noURL/noToken은 port누락보다 우선하며 requestActivity누락만 최우선이다.

Authorization은 actorType token_request만 선택하고 workspace session을 인증하지 않는다. wrapper auth와 guard auth 횟수를 분리한다. DEV_AUTH_BYPASS 없이 actual guard redirect와 token없는설정오류를 검증한다. body의 token은 원천credential로 사용하지 않는다. credential 선택은 기존 route의 서버 공용 `NOTION_TOKEN ?? NOTION_API_KEY`로 유지한다. 같은 process의 A/B 동시 검사는 불변 합성 서버 token 하나를 사용하고 source/database/namespace만 분리한다. 환경 선택 행렬은 직렬 또는 별도 worker에서 실행하며 동시 env 변경을 하지 않는다. token의 정확한 전달과 오류응답·로그·감사 비노출을 검증하되 scope별 서로 다른 token 지원을 주장하지 않는다.

수락: 위 순서/값 선택·호출횟수·고정 응답·감사동작이 actual POST에서 일치. 기존 guard/권한/env/화면/다른Notioncaller 변화0.

## S3 [Core] 원본 reader 변환·오류·저장 의미 — R3/R4/R5

원본 readNotionDatabaseImport 공개 함수를 보존한다. compact32hex 추출이 dashedUUID보다 우선이고 입력 대소문자/host/공백 규칙을 강화하지 않는다. outgoing URL은 고정 api.notion.com/v1/databases/{id}/query, POST·Bearer·JSON·Notion-Version2022-06-28·cache no-store·page_size100 유지. 첫 body에 start_cursor키없음, 후속에는 이전 next_cursor값. has_more=false 또는 cursor없음/빈문자열에서 종료한다. 새 timeout/page cap/retry/cursor cycle정책을 추가하지 않는다. 반복cursor를 무한실행하지 않고 합성transport가 정해진 횟수후중단하는 방식으로 기존제한없음을 관찰한다.

모든 page 읽기 후 mapping하는 실패 우선순위와, 유효한 course alias가 있어도 수행되는 title 탐색의 실패를 V3의 교차실패 fixture로 고정한다. 전page를 읽은 뒤 mapper 실행이므로 뒤pageHTTP실패/JSON실패 또는 어떤page의 malformed property/id가 전체import를 실패시켜 저장0이 된다. 앞page만부분저장하면 실패. property alias는 코드에 정의된 첫 nonempty 우선, courseName없으면 첫 nonempty title. date는 alias순서 첫 start를 slice10, end null이면 start, end빈문자열은비어있음. title/rich_text/plain_text join trim, people/multi_select 이름join ', ', select/status/url, formula string/number(0)/boolean(false), unsupported property→빈값을 실제 raw payload로 검증한다. page.id의 dash삭제→NOTION-id 및 page.url→싱크업도 유지. malformed value의 현TypeError를 새로운정규화/무시로바꾸지않는다. JSON parser의 rowSnapshot/mapped/unmapped/fingerprint·물리row2부터·header1을 독립 literal에 비교한다.

reader.rowCount는 page수, parsed.rows는parser결과, run.rowCount는validated rows수, HTTP rowCount는reader.rowCount이다. 이 값을 서로 대체하지 않는다. 정상rawpage에서는 운영ID가있어서 빈propertypage도행이되며, parsed빈행400은 빈원천으로검증한다. 서로다른count의syntheticport반례는route계약전용이며실제Notion관찰로보고하지않는다.

오류수정: routecatch400 유지. exact URL/ID오류 및 exact권한오류만 공개하고 나머지는 `Notion 데이터를 가져오지 못했습니다.`. rawhelper의 동적 status/statusText문구는 그함수에그대로남지만 route에서는고정fallback으로대체한다. statusText/cause/stack/canary를allowlist prefix로허용하지않는다. Error와MongoServerError의exact/접두/접미/개행/대소문자 변형, nonError를대조한다. 기존 body/설정/빈행 고정응답은 그대로다.

저장은 sourceType notion, sourceSheet Notion, sourceWorkbook result.databaseId, importedBy session.user.email, fileName미지정. 같은요청/기존source지문 중복과오류행·all-duplicate run생성·review DTO 그대로. sourceName/sourceType/team에 따른 중복 분리는 실제 historicalseed로검증한다. 자동승격/Calendar0, Company/Course/OperationSession 전체raw불변, sourcerow operationSessionIdnull.

저장 전 실패와 confirmed abort는 run/source records 전체 raw 불변을 요구한다. 실제 commit 후 ACK 회복은 200·전체 저장 유지·callback 재실행0, 실제 commit 후 최종 오류는 generic400·전체 저장 유지·audit400으로 판정한다. 미확정 commit은 V5의 주입·관찰 기준에 따라 전체 반영 또는 미반영을 구분하며 부분 저장을 허용하지 않는다. 원천 reader·parser·각 명단 조회는 transaction callback 밖에서 한 번 수행하고, fetch 횟수는 정상 pagination page 수로 판정한다. 재시도로 원천 재조회나 추가 run을 만들지 않는다. 두동시요청이commit전중복읽으면각저장가능, 첫commit뒤둘째읽으면중복run/rows0. 새unique/전역exactlyonce 금지. 직접Notionfixture의두일정을원본PG/currentPG/native같은입력전체tuple로대조한다.

수락: 원본실PG·currentPG·native의응답/전체logical rows/run/감사/summary/detail이동적ID/시간만검증후정규화하여같음. raw암호문과비업무감사는각backend전후판정한다. 199/201 실제저장·preview200 및 음성대조(누락/추가/경계교체), 요약실제정렬/동점ID·전체bijection을검증한다. 제품parser/presenter/정렬기를oracle에재사용하지않는다.

## S4 [Shell] 최소 구현과 분리된 검증 작성 — R1/R2/R3/R4/R5

부모는 source/context/route 최소제품3파일과환경/실행/문서를소유한다. 원본closure/PGparity, HTTPreader, actualhandler/nativefault 테스트는파일소유를분리해위임할수있다. 작성자freeze뒤에만부모가DB검사를실행한다. schema/migration/dependencies/기존reader/parser/staging/Calendar제품변경0. 현재새UI호출이없으므로UI/OAuth복원은범위밖이다.

기존Sheets/staging의HMAC/codec/scan/readiness/tx하위계층검증은동일소스·로그해시및새호출연결증거가있을때만재사용한다. 신규Notion sourceType·pagination과실제handler연결/실패·인증증거는새로실행한다. 기존 증거 재사용 조건이 충족되고 Calendar runtime 의존성이 변경되지 않으면 Calendar는 기존 scope 일반 회귀 3개를 실행하며 전체 24개 반복을 요구하지 않는다. 재사용 기준 SHA·의존 파일/테스트/로그 hash·정확한 case와 한계를 기록한다. 공통 context 변경의 영향 또는 회귀 실패가 확인되면 해당 영향 범위 검사를 확대한다. Notion의 실제 raw HTTP/property/parser/full tuple/auth/env/error 연결은 새로 검증한다.

## S5 [Check] 실행과 독립 Gap 보완 — R1~R6

Node24.19 env-i, 실제PG17·Mongo8replica합성검사. 원본gate→독립wholeparity→HTTP/actualhandler/nativefault→일반전체/type/lint/build를실행한다. 서로독립한DB없는검사는병렬, PGworker는소유락하나로순차. 필수DB검사skip0, 일반opt-in skip별도. 하위기반해시가바뀌거나실패가나면영향검사확대, 새변경/위험없는동일검사반복금지. 주입ACK는실제네트워크손실재현으로주장하지않는다.

독립코드/증거리뷰지적은수정·재검증·재수락한다. 반복실패나범위변경이면gap-plan/replan. 로그/exit/최종소스해시/재사용근거/미검증을보존한다. 필수실패를성공건수로상쇄하지않는다.

## S6 [Check] 정리·문서·통합 — R6

소유PG데이터0/다른client0·Mongo소유DB/작업0을확인하고프로세스/포트/dbpath를정리한다. borrowedbinary/타인자원유지. durable증거hash, execution-manifest/review/alignment/handoff와coverage/macro갱신, 검증한feature를총괄에FF/atomicpush하고원격SHA일치확인. 운영기본PG·실백업증거0/실원천·전체앱·backup/health/CLI·privacy分類·collation·실A/B백업복원전환/dev→main미완료를명시한다.

다음범위후보는Drive CLI writer이며본작업의검증/통합완료전구현을겹치지않는다. 미사용CLI를임의제외하지않는다.

최종 S6 수락은 validation-v2의 V1–V6 결과·증거·독립 리뷰를 다시 대조한다. 필수 미실행/실패는 완료로 표시하지 않는다.
