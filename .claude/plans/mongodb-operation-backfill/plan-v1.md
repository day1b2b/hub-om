# 운영 보정 관리자 경계 계획 v1

기준 `118e2763678db0a210715e479c5ce3baa06f77d1`, branch `feature/20260929-mongodb-operation-backfill`, 격리 clone clean. 원격 fetch/총괄 SHA 및 origin/dev 읽기 확인. 완료된 삭제목록/복원은 반복하지 않는다.

## 범위·대안

onsite-required-backfill 및 om-assignment-status-backfill의 GET/POST만 전환한다. 일반 OperationRepository.updateOperation 사용과 별도 OperationBackfillRepository를 비교해 후자를 선택한다. 일반수정은 onsiteText/상태계산 등 관련 필드를 바꾸므로 원본 단일필드 보정과 다르다. 기본 PG 유지, 명시 operationBackfill context만 Mongo. /admin/database 호스트와 UI/권한/새스키마/의존성/보정정책/자동배치는 범위 밖이다.

## Core1 경계

interface 4메서드 `countOnsiteRequiredTargets`, `applyOnsiteRequiredBackfill`, `countOmAssignmentStatusTargets`, `applyOmAssignmentStatusBackfill`, 모두 Promise<number>. PG adapter는 원본 where/data를 그대로 유지한다. admin/withActivity·응답 GET{ok,targetCount}/POST{ok,updatedCount}·POSTbody미사용 유지. 두 콘솔로그의 by=email만 제거하고 고정 경로/건수는 유지, 암호화 감사 actor는 유지한다. context미설정·실패 시 PG fallback 없음.

## Core2 Mongo

OperationSession/ActivityChange 기존 계약·codec/readiness, 명시 prepare·replica only. 각 count/apply는 snapshot transaction. onsite: deletedAt:null & onsiteRequired != Y (N/PARTIAL/UNKNOWN, 완료·archived포함). OM: deletedAt:null & ASSIGNMENT_NEEDED & omName notnull/notIn ['', '★배정필요', '배정필요']. HMAC companion의 명시적 null 제외/notIn으로 검색, 후보 복호화·HMAC무결성·exact원문 판정. trim/normalize/deriveOperationStatus 사용 금지. 공백/패딩placeholder는 기존대로 대상이다. index로 제외된 손상행까지 탐지한다고 주장하지 않는다.

apply는 지정 business필드+updatedAt만 부분 갱신, 그 외 raw/ciphertext/onsiteText/updatedBy/관계 보존. business감사 같은transaction, 중간/후행 실패 전체원복. 대상0/replay0 timestamp/감사 없음. driver writeconflict 재시도는 새로운snapshot과 같은 전체30s deadline, 각 scan 15s/20k/32MiB/100keyset공통한도. 실제관련writer 경합에서 조건 재평가, 유실/중복감사방지. GETcount와 POST는 별도snapshot이며 대상예약 아님.

## Core3 검증

독립 원본 PGquery oracle→PGadapter→Mongo를 각 고정fixture로 재구성하여 count/state/raw/updatedAt/audit/암호화 비교. enums/삭제/완료/archive, null/empty/space/exactplaceholder/유사문자열/replay/대상0. 실제guard/withActivity/context 및 로그평문 비노출. 101행과 BSON짧은batch, 한도/timeout부분성공금지, 1쪽작성뒤2쪽/감사실패전체원복. 실제update/delete/coursebulk 및 두backfill경합·후보name/status조건변경 제외, 실제겹친writeconflict/retry증거. 미래대상포함·모든순서강제충돌·동일GET/POST건수는 보장하지 않는다.

## 역할·완료

main interface/PG/factory/context/routes/handlers/runtime/docs. Schrodinger Mongo본체. Kepler native테스트. Gauss 실제PG oracle. Anscombe critic, Gibbs meta·독립결과리뷰. 쓰기범위분리, 실DB실행은 main. 신규 PG56639/operation_backfill_parity·Mongo27739 replica operationbackfill20260929·새dbpath·합성/임시키/env-i.

일반test/type/lint/build 및 broadMongo, 독립review, 한계·실패·skip별도기록. 문서/macro/coverage·자원정리·featurecommit/push/SHA확인·총괄feature통합. 운영/원본 workspace/main/dev 변경없음. 실제 운영보정/실OAuth/브라우저E2E/부하/복구리허설/최종전환 미실행. count가codec검증scan이므로 PGcount보다한도/비용이큼을명시.
