# 관리자 DB 실행계획 v2

핵심 난이도: 8표의표시계약과4표허용편집을PG와동일하게유지하면서Mongo암호화·unique·부분쓰기·원자감사를보장한다.

1. [Core] 조회는원본16query(count+sample8개)·정렬·take100·관계join·JSONsummary·decimal/date/rawValue를기준으로분리한다. 공통순수presenter에검증된논리row와count를주고기존DTO를생성한다. PG쿼리는이동만, Mongo는snapshottransaction에서정확count·정렬sample100과선택행관계만읽고codec복호화한다. 동일sort값의PG원본순서는미정이므로Mongo만_id tie-break로결정적순서를허용하되고유sortfixture로parity검증한다. 삭제회차도기존대로포함,전체행scan후slice금지. sampleBSONshort는실keyset또는boundedcursor로100행정확히수집하고15s/32MiB등안전한도초과는부분응답없이실패한다.
2. [Core] 셀은기존route파서/allowlist·400/403/404/409/500/200을보존하고adminDatabase repository updateCell로위임한다. Company/Member name은trim whitespace-collapse lower normalizedName을함께변경한다. PII는기존codec로암호화/HMAC; raw equality나랜덤암호문unique에의존하지않는다. OperationSession만updatedBy를추가,나머지는기존updatedAt행동보존. Mongo는row읽기→허용field만$set(연관normalized/HMAC/updatedAt포함)→감사동일transaction. 미존재P2025·uniqueP2002를고정safe오류로route기존매핑,임의에러메시지노출금지. readonlyfield/알수없는table은repository에서도거부한다. 타입/nullable/Int32/Decimalscale범위는실PGoracle로확인하고명시Mongo검증한다. null courseId 등원본DB가거부하는요청을Mongo도성공시키지않는다.
3. [Core] snapshotread와transactionwrite는30s전체retry예산,실writeconflict는최신row에서부분갱신재시도·다른field보존. 기존operation/course/Member writer경합은실DBbarrier로검증한다. 감사정책은operationAuditRow와PGtrigger allowlist일치확인,Member정책이없으면기존trigger부터확인해필수범위만보완. 별도dummycounter/새businessfield불필요. prepare명시/shadowgate/replicaset·validatorindexreadiness,open무수리.
4. [Shell] contract/factory/context·PGadapter·공통presenter·routefacade연결. 페이지는기존서비스호출유지,내부teamMembercontext도기존대로. 스키마/의존성/권한/UI변경없음.
5. [Check] 실제PG원본oracle/newPG/Mongo의8표DTO와4표수정·감사·nullable/decimal/date/unique·raw불변대조. 합성PII키/HMAC손상failclosed·unique중복·재실행·actualhandler와page권한/context/noPGfallback,기존writer충돌·감사실패rollback·sample101/정렬·BSONshort·한도검증. 전체unit/typecheck/lint/build와기존Mongo묶음. 독립V기준리뷰후실패보완,완료증거·한계·정리·commit/push/SHA·총괄통합기록.

대안: backend별화면formatter복제는표시drift위험으로제외. 공통presenter+좁은repository선택. 전체scan정렬은단순하지만sample100화면에불필요한암호화행노출/한도퇴행이있어제외한다. 원본snapshot동시성은16독립query이므로Mongo단일snapshot은강화이며PG동시상태100%동등주장안함.

역할: main contract/PG/presenter/facade/route/doc; Schrodinger Mongo구현; Kepler nativeMongo검사; Gauss actualPGoracle+handler/page검사; Anscombe critic; Gibbs meta/finalreview. 실제DB기동/검사는main만. 각worker서로파일수정금지.

## v2 변경점과 구체 계약

- Member정렬 displayOrder asc는NULLS LAST이다. 서버측합성nullsortkey 또는nonnull/null두구간조회로sample경계보존. 동률_idtie허용과별개.
- DataRepositories.teamMembers + getStoredTeamMemberRepository scope우선선택. 일반getTeamMemberRepository는기존Notion정책그대로별도미전환,이작업에서변경안함. actualpage에서adminDatabase와teamMembers동시주입/누락failclosed검증.
- Member PGtrigger공개필드는role/sourceTeam뿐이므로mongoOperationAudit.allowed.Member에그둘만추가. 나머지필드는기존redaction유지.
- 4표rowId는exact문자열이아닌PG UUID입력계약이다. 기존mongoCourseAdminRepository canonicalCourseId패턴(대소문자/braces/매4hex하이픈옵션)을참고하고실PGoracle로허용/무효표기대조한다. 무효UUID는없는행404와구분해기존오류응답보존.
- 원본dashboard query+formatter/DTO전체를byte동일fixture로동결한다. 새presenter를oracle에공유하지않는다. 고정8표독립기대값도추가한다. 원본route파서/명시allowlist/JSONnull예외/권한redirect는유지.
- 인터페이스는interface-notes.md에고정한다. 모든executor는validation-v2를수락기준으로사용하고main이실DB검사를실행한다.
- 최종[Check]에서V1–V10실제증거/미실행/실패를판정하고gap수정후검증·독립리뷰·alignment/handoff·정리·push/총괄통합한다.
