# 활동 조회 실행계획 v2

핵심 난이도: 개인정보 부분 검색과 원문 HMAC 사용자 집계, 서로 다른 기간/모니터링/legacy/label 조건을 기존 PG와 동일하게 연결하면서 손상된 저장값과 과도한 검색을 부분 성공 없이 거부한다.

1. [Core] 원본 세 GET·query/feed/usage/legacy/presentation을39c70e2 독립 oracle로 동결한다. 파서는 원위치 유지, 기존 parsed필터를 받는 ActivityReadRepository의 adminList/legacyList/feed/usage 경계로 분리한다. Date/ISO·undefined생략·nullable·동률UUID순서·50/51페이지를 고정한다. 일반공백email필터없음/legacycontains빈값,private literal substring와 공개route SQLLIKE(%/_/escape)를 구분하고 실제PG로 확정한다. 수락: 원본/newPG/Mongo 동일syntheticfixture의 논리응답일치, nondeterministic fetchedAt만 요청시각검사후정규화.
2. [Core] Mongo 공개필터의 안전 필요조건으로후보축소→전체codec인증→정확private조건검사→정렬/51개선택. privacy contains insensitive는 JS lowerCase/includes,legacyprefix/OR/NOT는전체식평가. requestId/rowid/cursorUUID만 canonical조회,일반targetId변형금지. invalidUUID는기존repository오류503단계유지. users는인증된ActivityRequest HMAC의non-null distinct,case/space/empty유지. 공개routecontains는PGLIKE의문자별조건으로구현하며정규식입력그대로전달금지. 수락: 51이후일치·중복시각·삭제cursor·특수문자·UUID오류·집계교차fixture대조.
3. [Core] admin현재label서비스를DB읽기와순수formatter로분리한다. PG lookup/select는동일하게유지. Mongo는선택50행의최상위대상만조회하고fullcodec후관계payload를만든다. 없는최상위대상은기록당시fallback,남아있는대상의필수관계누락/손상은실패. 현재label우선·redacted fallback제외·삭제코치링크없음·Calendar operation_id조회·uppercase targetId의기존JS exact비교를보존한다. legacy는kind/createdAt/author/content/coach와기존표시를유지. 수락: 모든대상종류/소프트삭제/소멸/빈이름/기록fallback/관계손상대조.
4. [Core] Mongo readmethod전체를snapshottransaction으로실행하고8초총기한을callback retry밖에서고정한다. 후보scan은기존32MiB/20k/15초상한과총기한중빠른것,codec/정렬/집계/formatter후기한재확인. BSON-short는마지막실제_id keyset으로끝까지읽고getMore금지. 큰집계도fullauth후집계,상한초과503이며이추가안전제약은PG공개count보다엄격함을문서화한다. missing/wrongkey/HMAC/JSON손상은safe고정오류/noPGfallback/no writes. open은shadow/replica/validator/index readiness만검사하고무수리. 수락:실snapshot경쟁·BSONshort/다중batch·계측한도·가상총기한/재시도·raw불변·DDL무수리증거.
5. [Shell] 좁은type/PGadapter/factory/context를추가하고3route저장호출만치환한다. getPrismaClient는PGmethod안에서호출하여명시scope직접PG차단. 기존권한·파서·응답/status/headers·UI·쓰기/retention·schema/deps유지. PG응답은privacywrapper처럼storagecompanion을절대반환하지않는다. 수락:실제3handler auth/admin/Bearer/invalidparams/missingscope/503및성공DTO;외부호출0/PGfallback0.
6. [Check] 소유loopback합성PG45migration 및Mongoreplica에서독립oracle/newPG/native대조·실handler·암호화raw/인가된응답·저장불변/스냅숏검증. 일반전체·Mongo전체·typecheck/lint/build 후독립검토 V기준대조→gap보완→정리→문서/featurepushSHA/총괄통합코드동일성확인. 미검증실브라우저/OAuth/운영부하/실데이터복사복원전환을명시한다. 자동화상태는읽기확인ACTIVE를문서에반영하되설정변경/운영자동실행은하지않는다.

실행역할: main타입/PG/factory/route/presenter분리와문서/실행총괄,workerMongo/native/PGoracle/실handler,독립critic/architect. schema/의존성/생산설정없음. 모든실DB실행main만. 신규업무결정없음.

## v2 결정 보완

Core1–2/Check: route공개LIKE는 %/_/역슬래시조합·슬래시·개행·비BMP를실PG로검증하고같은privateliteral대조군을둔다. SQL글자와UTF16차이/escape오류도실PG기준. feedfetchedAt은transactioncallback내부,usagefetchedAt은transaction완료후route에서생성하며제어된시계·경계증거로위치를검증한다.
Core4: transaction종료와session정리후최종반환직전에도deadline확인한다. 한scan/집계/label분기의실패는전체실패이며entries/summary부분반환금지. 32MiB20k15초는scan별추가안전한도이며전체메모리한도로표현하지않는다. 전체8초는모든scan/retry가공유한다. 동일Mongotransaction의명령은순차await.
Shell: repository/scope/label실패는원본고정503이며새500정책금지. validation-v2 V1–V8로실행결과를검증한다.
