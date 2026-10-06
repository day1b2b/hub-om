# 과정명 복원 Mongo 경계 계획 v1

기준95cdb6fb71e49b7e3f230571d867bca357a114fe, feature/20260929-mongodb-course-name-restore, 격리clone clean. 기존보정단위완료확인, 원격fetch/총괄SHA일치·origin/dev읽기확인.

## 범위·대안

courseNameRestore 서비스와 admin/course-name-restore GET/POST 경계. 원본PG 알고리즘은 PG adapter로 이동하고 types/conflict를 별도contract로분리, 기존serviceexport/명시db주입호환 유지. 기본PG/명시courseNameRestore context만Mongo. 기존readPlan 알고리즘 공유와 독립Mongo구현을비교해 PG변경최소화를위한독립Mongo선택, 독립PGoracle로대조. UI/권한/요청크기/상태/업무규칙/PGschema/의존성/운영selector변경없음.

Core1 main: contract plan/apply(rawCourseId,operationIds,snapshot,actorEmail); factory/PG adapter/context/facade. 명시db주입은 context없는기존호출에서만허용, 명시scope는PG우회금지. API 그대로(403/400/413/409/500/200·32KiB·1~100·정확ID·고정에러). 실제guard/withActivity/nativehandler 검증.

Core2 Mongo: Company/Course/OperationSession/OperationSourceRecord/ActivityChange와 기존Course.processSeq counter 재사용. prepare/open분리·readiness실패자동수리없음. plan은 같은snapshot에서 normalized courseId일치과정, 활성회차 및각회차최신2source(createdAtdesc/iddesc)를복호화해읽는다. DTO정렬/blockedReason우선순위/기업구분/0회차과정/메타데이터비교기존유지. SQLNULL/JSONnull/배열/빈mappedFields 처리, decimal의값동등성 주의. snapshot은64hex불투명동시수정지문이며권한토큰아님. PG원본snapshot바이트와직접db주입을유지; Mongo는결정적논리값지문(암호문/HMAC/내부guard불포함), backend사이snapshot문자열동일성은요구하지않고각backend내재검증동일성/변경탐지검증.

apply는입력1~100unique검사→새snapshot으로plan재계산/지문비교→선택전체유효성→기존target재사용 또는 company+name별newcourse1개→selected session의courseRecordId/updatedBy/HMAC/updatedAt만부분갱신. Course 새값은원본metadata+새id/processSeq/time, 기존course/미선택/삭제row/source/관계/raw불변. 모든쓰기·counter·감사같은transaction. 재실행stale409, 선택일부성공없음, 실패원복.

동시성: 단순Mongo snapshot만으로disjoint선택동시restore가둘다성공할수있으므로복원끼리predicate읽기전에실제nonce를쓰는최소내부CourseNameRestoreGuard를기존CoachCatalogGuard패턴으로검토한다. 업무schema필드/PGmigration/35모델snapshot변경은없음. processSeq를잠금목적으로소비하거나업무updatedAt을더미갱신하는대안은부작용으로제외. 기존counter는실제newcourse에만할당. guard+duplicatefirstupsert재시도 및모든재시도총30s·scan15s/20k/32MiB한도. 일반update/delete/coursebulk/restore/backfill과selectedrow writeconflict에서재평가→stale409. 모든미전환writer의serializable을보장한다고표현하지않음. 공유guard에참여하지않는미래source/importwriter는별도전환시검증.

Core3 PG원본oracle/newPG/Mongo독립fixture: DTO(opaquehash제외)/blockedreasons/새과정metadata/targetreuse/zeroWidth-normalization/기업분리/JSONnull/decimal/null/replay·선택오류/관계/감사/암호화/원복 비교. 원본PG의실동시별도선택충돌과Mongo동일/별도선택충돌검증. source/course/deleted/unselected/새target변경으로stale, 기존writer경합·counter일의성. 101읽기/100선택·BSONshort/한도/누적deadline 및후행실제쓰기/감사실패raw/counter/guard전체원복.

## 역할·완료

main Core1/handlers/runtime/docs; Schrodinger Mongo/내부guard; Kepler native; Gauss PGoracle; Anscombe critic; Gibbs meta/final. 쓰기파일분리, 실DB main실행. 새PG56649/course_name_restore_parity·Mongo27749 replica courserestore20260929, 새dbpath·합성·임시키/env-i. 기존테스트위치읽기실패는 .integration.test.ts로확인해해소(검사실패아님).

일반/test/type/lint/build·broadMongo·독립리뷰·문서/coverage/macro갱신·자원정리·featurecommit/push/SHA→총괄통합. 원본workspace/운영/원천/키/권한/배포/main/dev변경없음. 실제데이터이전/복구리허설/생산전환미완료.
