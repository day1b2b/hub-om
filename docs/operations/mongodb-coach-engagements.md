# 코치 투입·평가 Mongo 저장 경계

2026-09-22, 기준 `7ebb24f`. 생산 기본은 PostgreSQL이다. `CoachEngagementRepository`를 세 API에 연결하고 명시적인 내부 repository scope에서만 Mongo shadow를 사용한다. 이 작업은 운영 데이터·권한·환경키·배포·Prisma schema를 변경하지 않는다.

## 범위와 기존 계약

- `api/coaches/[id]/engagements`: workspace 인증 후 live 코치의 목록/생성. GET은 status/source 소문자와 날짜만, POST는 기존 대문자 enum 및 ISO 시각 응답이다. POST는 평점이 없으면 명시적으로 null을 보내야 한다(생략400 유지).
- `api/engagements/[id]` PUT: 투입 이력 수정. 잠금 이후 최신 행을 읽어 빈 과정명·잘못된 날짜 fallback을 계산한다. 날짜·시간 필드가 전달될 때만 평일 슬롯을 교체한다. status만 수정하면 슬롯과 예약을 바꾸지 않는다.
- `/review` PATCH: toggleFlag 우선, deleteReview, 일반 수정 순서. toggle/delete는 전체 DTO, 일반 수정은 id/coachId/rating/feedback/rehire만 반환한다. rehire만 바꾸면 수정 이력을 만들지 않는다. deleteReview는 평점·피드백만 비우고 경고/rehire는 보존한다. 없는 review의 기존 오류 경로는 유지한다.
- auth는 기존 workspace 세션, 요청 활동 기록은 `MongoRequestAuditRepository`, 토큰 관련 인접 일정 경로는 `MongoCoachTokenRepository`를 명시 주입한다. scope 안의 누락 저장소는 실패하고 PG로 fallback하지 않는다.

평일 슬롯은 최대 366개 달력 날짜를 순회하며 주말을 제외한다. 시간이 비면 09:00–18:00, source ID는 기존 `hub:<engagementId>:<date>`다. 기존 기간 역전·366일 초과 처리와 상태 fallback을 새 정책으로 변경하지 않는다. 실제 달력에 없는 날짜는 기존 공통 날짜 검증으로 보완했다(POST400, PUT은 기존 fallback). null/배열 본문도400으로 처리한다.

## 예약과 취소 상태의 의미

이는 현재 제품 동작을 보존한 것이며 새 권장 업무 정책이 아니다. 화면은 확정 시간을 뺀 가용 시간이 남으면 같은 날짜에 예약 버튼을 제공한다. 따라서 확정일 전체 재예약 금지를 추가하지 않는다.

1. 예약이 먼저 commit되고 일정 재생성이 나중이면 active 예약을 cancelledAt으로 취소하고 confirmedEngagementId를 연결한다.
2. 재생성이 먼저 끝나고 예약이 나중이면 새 active 예약을 허용한다.
3. CANCELLED 상태로 생성하거나 날짜·시간을 수정해도 현행처럼 평일 슬롯 재생성 및 예약 자동취소가 실행된다.
4. status-only 수정은 재생성·자동취소·기취소 예약의 복구를 하지 않는다.

과거 취소 예약과 확정 링크는 보존한다. 슬롯 교체는 기존 replacement 계약이며 투입 이력 자체의 새 물리삭제 API나 Coach 자식 cascade를 추가하지 않는다.

## 공통 잠금과 원자성

Mongo의 `<namespace>_CoachSchedulingGuard`는 내부 조정 컬렉션이다. 업무 schema 필드를 추가하지 않는다. `_id`는 코치 UUID, `nonce`는 매번 새 UUID이며 strict/error validator, simple collation, _id 유일성, TTL 부재를 준비·열기 단계에 검사한다. 기존 잘못된 구성을 자동 수리하지 않는다. 평소 guard 삭제·TTL 정리는 금지하며 합성 테스트 DB 전체 정리에서만 제거한다.

같은 session에서 nonce를 실제 갱신한 후 업무 조건을 읽는다. 예약 조건이 빈 경우에도 두 writer가 같은 문서에 쓰므로 snapshot write skew를 피한다. write conflict와 최초 upsert 중복은 전체 transaction을 재시도한다. engagement ID로 coachId를 알아내기 위한 초기 조회 이후 guard가 충돌하면 그 초기 조회도 다시 실행하고 최신 행을 읽는다.

참여 목록은 양 backend의 schedule getCoachMonth/replaceCoachMonth/reserveDates/cancelDates 및 engagement createForCoach/update/updateReview다. manager/list 조회는 readonly다. PG는 기존 `coach-schedule:<lowercase UUID>` advisory transaction key를 공통 모듈로 추출하고 잠금 후 행을 재조회한다. 실제 PG 경합은 이번 로컬 Mongo 검증으로 증명하지 않는다.

투입 행·슬롯 삭제/삽입·예약 취소/링크·ActivityChange는 한 transaction이다. 리뷰 수정과 CoachContentEntry EDIT_HISTORY도 같은 transaction이다. 업무 감사의 늦은 실패는 앞선 쓰기를 되돌린다. EDIT_HISTORY의 공통 변경감사 제외, 허용값/PII redaction 정책은 기존 정의를 따른다. 피드백·섭외자·작성자·활동 이력은 기존 codec 암호화/HMAC를 사용하며 응답에는 companion 저장 필드를 넣지 않는다. 직접 Mongo 변경에 ActivityContext가 없으면 쓰기 전에 실패한다. 요청 ActivityRequest 자체는 기존 best-effort 정책과 구분한다.

## 검증과 다음 게이트

실행 명령·카운트는 `.claude/plans/mongodb-coach-engagements/execution-manifest.md`, 독립검토는 execution-review.md에 기록한다. 로컬 Mongo8.0.30 replica set·임시 키·합성 데이터만 사용한다. 기존 일정/예약 통합 검사를 함께 실행한다.

**외부 contractSheetSync와 samsungScheduleSync는 별도 필수 후속이다.** 이들은 아직 PG이며 같은 잠금에 참여하지 않는다. 호환용 `reservationAutoCancel.ts`에 뒤늦게 잠금만 추가하면 lock 순서가 뒤집힐 수 있어 그러한 변경은 하지 않았다. 원천 읽기·코치/개인정보 보충·섭외 병합·슬롯 교체까지 실제 저장 경계로 이관하고 전체 transaction 시작에서 같은 guard를 획득해야 한다.

특히 Samsung writer는 engagement 물리삭제 후 재생성하며 기존 FK는 슬롯 Cascade, 예약 confirmedEngagementId SetNull이다. Coach soft delete는 자식 보존이다. 이 차이를 새 삭제 정책으로 추측하지 않고 후속 이관에서 보존·검증해야 한다. 실제 외부 API 호출·OAuth/UI·실PG 경합·실데이터 전환/최종 동기화/복원/생산 selector/배포는 미실행이며 생산 전환 gate로 남는다.
