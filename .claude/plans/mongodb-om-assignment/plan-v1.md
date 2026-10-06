# OM 전체 배정 Plan v1

핵심 난이도: 확인한 생성배치/요청/회차가 저장 시점에도 같은지 검증하며, Mongo snapshot만으로 막지 못하는 no-op/phantom 경쟁과 일반 writer를 함께 직렬화하는 것. 기존 preview는 업무쓰기0, 저장은 전체원자성, 후속 캘린더/Slack는 커밋후 best-effort다.

1. [Core] 원본 계약 고정: 원본PG함수 fixture checksum과 실제helper/AssignForm/권한/API 읽기. 생성감사 metadata만 연결; 요청생성정확히1, 같은batch요청정확히1, 회차수/UUID/대표포함/삭제0 조건 모두 아니면409. 같은과정확대금지. 원본서명canonical/TTL/actor/nextOm/state/status/updatedAt 보존.
2. [Core] 저장동시성 설계: CAS/기존행 touch와 내부 공유guard 비교. 요청/회차쓰기 충돌뿐 아니라 생성감사 phantom, no-op, 회차삭제/복구와 일반writer를 판독. 모든 관련정상writer가 같은순서의보호지점을 거치거나 안전한409로 닫힘을 증명. preview 읽기0쓰기. 구조적 새업무schema가 필요하면 중단하고 미결정으로 기록.
3. [Shell] 순수 계약과 PG adapter 분리; facade명 유지. 명시 omAssignment repository+calendar/notifier port 추가. 기본PG/기본부수작업유지, 누락scope는전쓰기단계에서닫힘. 옛 확인없는 assignment/samecourse helper는계속차단.
4. [Core] Mongo adapter 구현: 현정책codec/HMAC/검증된저장읽기. 매재시도 최신snapshot읽고서명재검증. 요청+필요회차+감사 동일tx. 상태전이는기존needed↔planned만;DONE그대로, omUserId항상clear. 안전오류/전체deadline/실112재시도/unknowncommit경계명시. 새준비없음/readiness실패는자동수리금지.
5. [Check] 합성PG원본/새PG/Mongo 정확대조, 서명expiry/tamper/actor/nextOm/secret/변경후재확인/동일재저장/noop, 감사metadata와비노출. 실제replica 경쟁write112, 요청수정삭제, 일반회차변경/삭제/phantom 생성감사,중간실패rollback. 테스트는완화정규화금지.
6. [Check] 실제API 401/403/400/404/409/200+no-store, 관리자명단failclosed, body서명, followupcommit후만/실패무롤백/중복notify방지. 기본경계와UI동작유지. 브라우저미검증은분리표기.
7. [Check] 영향회귀·일반/type/lint/build·전체Mongo/PG·독립최종수락. 소유합성cleanup, baseline부터전체diff --check(신규파일포함),문서/인계,featurecommit/push/총괄FF/실원격SHA확인. 전체운영/devmain완료표기금지.

선택대안: 개별행CAS는참여하지않는phantom작성자와no-op를놓칠수있음. 공유내부guard는writer연결과범위확장비용이있지만배정의기존Serializable계약에가까움. 독립architect가실writer목록과부작용을확인한뒤Planv2에서결정.
