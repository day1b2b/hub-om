# 코치 시트 동기화 저장 경계

계약·일정 시트의 서비스는 단일 업무 workflow와 저장소 interface를 사용한다. 생산 기본은 PostgreSQL이며 Mongo는 내부 명시 context에서만 선택한다. 환경변수/요청 헤더로 운영 backend를 바꾸지 않는다. 원천 reader도 context에 명시하며 테스트는 합성 행만 주입한다.

## 기존 정책과 의도된 보완

- 계약: 취소/취소선·신규 코치 연도 제한·사번 정리·중복 행·source ID·날짜 파서를 유지한다. source ID 또는 같은 코치/과정/겹치는 기간으로 기존 투입을 찾고 수기 평가·feedback·재고용·경고·고용자 ID는 보존한다. 여러 후보의 우선순위는 기존 findFirst에도 명시되지 않았다.
- 개인 프로필은 비어 있는 필드만 보충한다. 트랜잭션 안에서 최신 값을 다시 읽으므로 동시 수기 변경을 오래된 값으로 덮어쓰지 않는다. 코치 public/private 보충을 하나의 트랜잭션으로 묶은 것은 의도된 원자성 강화다.
- 일정 시트 교체는 기존 두 과정명의 모든 투입을 삭제한다. MANUAL도 포함하며 유효 입력이 0건이어도 기존 삭제가 실행된다. 새로운 삭제 정책이 아니다. 슬롯은 Cascade, confirmedEngagementId 예약 참조는 SetNull 의미를 구현하며 다른 코치의 참조도 포함한다. 과거 취소 이력은 보존하고 재실행 때 새 투입에 자동 재연결하지 않는다.
- 단계별 commit은 유지한다. 코치 보충 뒤 계약 투입 각각을 commit하고, 일정 시트 교체는 한 transaction이다. 뒤 단계 실패는 앞 단계 성공을 되돌리지 않는다. 같은 단계의 업무와 ActivityChange는 함께 rollback한다.
- dryRun은 읽기·분석만 수행하고 업무·guard·변경감사·sync log를 쓰지 않는다. HTTP 요청감사는 별도다.

## 동시성 계약

각 namespace의 CoachCatalogGuard singleton nonce를 먼저 갱신하고, 대상을 읽은 뒤 coach ID를 중복 제거·정렬하여 CoachSchedulingGuard를 갱신한다. 모든 잠금은 업무쓰기 전에 획득한다. 삭제할 투입의 기존 코치, 새 코치, confirmed 예약 참조의 코치를 모두 포함한다. Mongo 충돌과 최초 upsert duplicate는 callback 전체를 재시도하며 원천 읽기와 result count 증가는 재시도 밖에 있다. 최초 목록은 프로필을 일괄 조회하고, 행별 코치 보충은 이름 HMAC equality와 복호화 후 원문 일치 확인으로 대상 조회를 제한한다. 트랜잭션 밖 조회의 driver 오류도 고정 코드로 변환한다.

시트, 수기 투입 create/update, 코치 관리 create/update/status/delete가 catalog에 참여한다. 월 입력·예약·취소·review는 coach guard만 사용한다. PostgreSQL도 같은 순서의 advisory transaction lock을 사용한다. catalog는 identity/삭제 predicate phantom을 막지만 모든 시트 transaction을 직렬화하므로 높은 빈도의 대규모 동기화는 별도 성능 검증이 필요하다. guard는 TTL/일상 삭제 대상이 아니다. 명시 shadow 준비 단계가 strict validator/index를 확인하며 운영에서 자동 보수하지 않는다.

## 로그·보안·제외 범위

CoachSyncLog는 start→업무→finish라는 별도 lifecycle이다. start 실패는 작업을 시작하지 않으며 finish 실패로 이미 commit한 업무가 취소되지 않는다. 실패 로그에는 고정 코드만 저장한다. 기존 개인정보 codec으로 private profile, 감사값, log의 지정 필드를 보호한다. 이름이 포함된 sourceEngagementId/sourceEngagementScheduleId는 기존 privacy 정책상 평문이며 이번 분리에서 새 암호화 정책을 도입하지 않았다.

Notion은 아직 PG 직접 writer다. 명시 repository scope에서 서비스 진입 즉시 외부 읽기 전에 차단하며 `/sync/all`도 Notion 단계에서 중단한다. 기본 PG의 Notion은 기존대로이며 catalog 참여를 보장하지 않는다. 따라서 전체 동기화의 생산 Mongo 전환 완료를 뜻하지 않는다.

기존 날짜 파서는 시간 문자열의 하이픈을 날짜로 오인할 수 있다. 이번 경계 분리는 파서를 수정하지 않는다. 실제 Google/Notion 원천, PG 실제 경합, OAuth/UI, 운영 데이터 복사·복원·배포는 검증 대상에서 제외했다. 다음 gate는 Notion 저장 경계와 남은 직접 PG 기능이며 운영 전환은 별도 승인·검증 단계다.

실행 결과는 [검증 기록](../../.claude/plans/mongodb-coach-sheet-sync/execution-review.md)에 기록한다.
