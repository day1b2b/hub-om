# 관리자 DB 실행계획 v1

핵심 난이도: 8표의표시계약과4표허용편집을PG와동일하게유지하면서Mongo암호화·unique·부분쓰기·원자감사를보장한다.

1. [Core] 조회는원본16query(count+sample8개)·정렬·take100·관계join·JSONsummary·decimal/date/rawValue를기준으로분리한다. 공통순수presenter에검증된논리row와count를주고기존DTO를생성한다. PG쿼리는이동만, Mongo는snapshottransaction에서정확count·정렬sample100과선택행관계만읽고codec복호화한다. 동일sort값의PG원본순서는미정이므로Mongo만_id tie-break로결정적순서를허용하되고유sortfixture로parity검증한다. 삭제회차도기존대로포함,전체행scan후slice금지. sampleBSONshort는실keyset또는boundedcursor로100행정확히수집하고15s/32MiB등안전한도초과는부분응답없이실패한다.
2. [Core] 셀은기존route파서/allowlist·400/403/404/409/500/200을보존하고adminDatabase repository updateCell로위임한다. Company/Member name은trim whitespace-collapse lower normalizedName을함께변경한다. PII는기존codec로암호화/HMAC; raw equality나랜덤암호문unique에의존하지않는다. OperationSession만updatedBy를추가,나머지는기존updatedAt행동보존. Mongo는row읽기→허용field만$set(연관normalized/HMAC/updatedAt포함)→감사동일transaction. 미존재P2025·uniqueP2002를고정safe오류로route기존매핑,임의에러메시지노출금지. readonlyfield/알수없는table은repository에서도거부한다. 타입/nullable/Int32/Decimalscale범위는실PGoracle로확인하고명시Mongo검증한다. null courseId 등원본DB가거부하는요청을Mongo도성공시키지않는다.
3. [Core] snapshotread와transactionwrite는30s전체retry예산,실writeconflict는최신row에서부분갱신재시도·다른field보존. 기존operation/course/Member writer경합은실DBbarrier로검증한다. 감사정책은operationAuditRow와PGtrigger allowlist일치확인,Member정책이없으면기존trigger부터확인해필수범위만보완. 별도dummycounter/새businessfield불필요. prepare명시/shadowgate/replicaset·validatorindexreadiness,open무수리.
4. [Shell] contract/factory/context·PGadapter·공통presenter·routefacade연결. 페이지는기존서비스호출유지,내부teamMembercontext도기존대로. 스키마/의존성/권한/UI변경없음.
5. [Check] 실제PG원본oracle/newPG/Mongo의8표DTO와4표수정·감사·nullable/decimal/date/unique·raw불변대조. 합성PII키/HMAC손상failclosed·unique중복·재실행·actualhandler와page권한/context/noPGfallback,기존writer충돌·감사실패rollback·sample101/정렬·BSONshort·한도검증. 전체unit/typecheck/lint/build와기존Mongo묶음. 독립V기준리뷰후실패보완,완료증거·한계·정리·commit/push/SHA·총괄통합기록.

대안: backend별화면formatter복제는표시drift위험으로제외. 공통presenter+좁은repository선택. 전체scan정렬은단순하지만sample100화면에불필요한암호화행노출/한도퇴행이있어제외한다. 원본snapshot동시성은16독립query이므로Mongo단일snapshot은강화이며PG동시상태100%동등주장안함.

역할: main contract/PG/presenter/facade/route/doc; Schrodinger Mongo구현; Kepler nativeMongo검사; Gauss actualPGoracle+handler/page검사; Anscombe critic; Gibbs meta/finalreview. 실제DB기동/검사는main만. 각worker서로파일수정금지.
