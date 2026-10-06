# OM 전체 배정 Validation v2
R1/R2/R3은독립critic validation-v1의결과기준. architect meta-evaluation과Plan2의공유guard전략반영. 구조gate:모든steptag/Core조건/재시도및실패조건결정후만실행수락. 이 표는 수락 기준이며 실제 실행 결과는 execution-review.md를 따른다.

|ID|요구/원본근거|실행사례와필수기대값|
|--|--|--|
|V01|R1 원본PG기본|fixtureSHA검사,기본PGSerializable옵션·기존helpertest/암호화wrapper회귀. scope없음만PG선택|
|V02|R1 정상대상|실PGoriginal/newPG/Mongo 동일ID/시각seed의preview count/order/omUserId/nextOm/token동일,같은course다른batch회차제외|
|V03|R1 metadata폐쇄|요청creation0/2,혼합requestbatch,중복/추가/누락operation,잘못된route/method/action/UUID,대표미포함·삭제,일정수0/불일치/date없음 각각409및업무raw/audit불변|
|V04|R1 서명|동일snapshot고정clocktoken동일,secret우선/fallback/missing,형식/만료/과미래/digest/actor/nextOm/revertedupdatedAt변경reject. metadata변경은연결재검증이며batchID서명으로거짓표기금지|
|V05|R1 배정·취소|이름·계정전체교체clear,needed↔planned,DONE/기타유지,changedoperationIds만정렬. 원본DTO기존spread/nullundefined정확대조|
|V06|R1 noop|requestOM같아도회차다르면회차만update. 완전noop유효token반복success,업무raw/timestamp/ActivityChange/외부불변,내부guardnonce만변경허용|
|V07|R1/R2 저장비노출|실PG SQLraw/Mongo문서(업무·감사·guard)민감합성name/email/account/notes/token평문0. 응답승인복호화값긍정대조,독립HMAC검사. audit의redacted/allowlist/귀속동등|
|V08|R2 원자성|둘째회차/요청/ActivityChange실validator또는DB제약실패→전체업무raw+기존audit+guard원복,후속0. codec/key/HMACcorrupt도failclosed|
|V09|R2 같은배정cycle|reqX/S1Y/S2X에서독립두session A→X/B→Y realbarrier. 기존guard에서 native112 증거,전체callback재읽기/패자staletoken409,최종값승자직렬상태/감사중복0. 양방향승자|
|V10|R2 restorecycle|S1noop/S2변경assignment와S1기존목적과정restore,둘다전체S1S2서명읽기,동일guard경합. 양방향으로승자commit후패자서명409,부분혼합0. 실제PG원본 함수에서도직렬화또는재확인거부확인|
|V11|R2 일반writer경쟁|실OmRequestpatch/delete,Operationupdate/delete,DeletedOperationrestore,AdminDatabasecell,Backfill,Coursedelete. 실제관련행쓰기후A재개또는Acommit후writer 실행;중첩은112재읽기,단방향은유효한 직렬 순서 허용. 일부noop회차경쟁포함.미실행writer는명시미검증|
|V12|R2 phantom/retention|동일batch생성 감사 추가/두 번째 요청/중복 요청 생성 감사 및 삭제를snapshot 전후에제어. before불일치409,after는A→writer가능결과허용+다음preview는연결조건실제불일치시409/유효하면성공. 무관한course회차추가preview성공/대상불변. HTTPretention후기존metadata보존정책변경없음|
|V13|R2 guard/runtime|shadow/allowWrite/privacy/replica/validator/index/guard누락·mismatch거부,자동repair0. 최초guardupsert경쟁,deadline30초전체공유·최대5조건,unknowncommit은drivercommitretry이며불명시safe500/외부0/rollback확정주장금지|
|V14|R3 권한|실route+realguard/withActivity/scopedTeamUser. 401/403/400/404/409/200/500,no-store. 유일명단/중복/누락/failure/override/표시이름위조,preview후PATCH다시평가. 자유입력OM기존허용|
|V15|R3 포트|omAssignment/omRequests/teamUsers/operations/calendar/notifier/requestActivity 필요한누락각각업무쓰기전실패·PG/fetch/filefallback0. 독립·중첩scope격리. legacy2helper계속거부|
|V16|R3 후속/오류|commit전calendarSlack0,retry중0,commit후changedround각1;Slack prev!=next&&next있음만1. 일부후속실패다른후속계속/업무유지/응답로그민감exception0. HTTPrequestlog실패업무유지|
|V17|R3 UI|실AssignForm기존test로돌아가기/중복/409폐기/네트워크재시도. 서버응답계약과컴포넌트입력보존. browserE2E별도미검증표기|
|V18|전달/회귀|일반/fullMongo/배정PG/type/lint/build·baseline전체diff공백검사. logexit/skip/mock겹침구분. 독립수락/소유cleanup/commits/remotesHA/coverage/macroscope인계. 전체운영완료주장금지|

## 비교 규칙
생성auditUUID/시각은관계보존해사전정규화하되business/null/undefined/부재/arrayorder/status/auditfield삭제금지. 동일 seed/clock의 token은 정확히 비교한다. 무작위 암호문은 복호화와 독립 index 검증을 함께 하고, no-op/rollback은 raw 값을 비교한다.실제 PostgreSQL 감사 트리거와 새 Mongo codec을 mock으로 대체하지 않는다.

## 메타수정
서명 request 필드는 8개다. no-op은 내부 guard의 nonce 외에 차이가 없어야 한다. preview는 업무/신규 ActivityChange/외부 쓰기 0이며 HTTP ActivityRequest와 기존 retention 삭제는 별도 계약이다. 단방향 경쟁까지 409를 강제하지 않는다. 격리 shadow/새 키/loopback만 사용하며 미검증은 PASS로 처리하지 않는다.

최종critic 보완: V13 최초guard문서upsert경쟁은기존guard112와별도실행. 실제11000이발생하는경로는독립증거로확인하며미관찰을발생으로주장하지않음. collection/readiness누락은거부하되준비collection의최초문서는허용. 30초는guard대기/전체재시도/commit확인을포함하고5회는최초포함. V10패자409는승자가패자서명상태를바꾼fixture임을직접증명. 필수writer/실PG/native미실행·skip은최종수락보류.
