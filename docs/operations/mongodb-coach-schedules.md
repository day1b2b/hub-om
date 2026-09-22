# 코치 월간 일정·예약 Mongo 경계

2026-09-22, 기준 `cc9eeb49`. 생산 선택은 PostgreSQL을 유지한다. 세 API를 `CoachScheduleRepository`로 분리하고 내부 `runWithDataRepositories({coachSchedule,coachToken,requestActivity}, ...)`에서만 Mongo shadow 저장소를 주입한다. HTTP/환경변수로 Mongo를 선택하지 않는다.

## 범위와 계약

- `/api/coach/schedule/[yearMonth]` GET/PUT: 기존 토큰 인증. self GET만 접근 시각을 갱신하며 PUT은 기존 accessedAt을 보존하고 lastEditedAt을 갱신한다. lastSavedAt은 접근 로그의 lastEditedAt, 없으면 해당 월 일정 updatedAt 최댓값이다.
- `/api/coaches/[id]/schedules` GET: workspace 인증, 삭제되지 않은 코치만 조회, 접근 로그는 변경하지 않는다.
- `/api/coaches/[id]/reservations` POST/DELETE: workspace 인증. POST는 삭제된 코치404, DELETE는 기존처럼 코치 존재와 무관하게 자기 active 예약만 취소한다. 응답은 날짜별 최종 예약 소유자/취소된 날짜 배열이다.
- self engagements는 기존처럼 모든 상태의 겹치는 기간을 반환한다. engagementSchedules만 취소되지 않은 슬롯이며 SCHEDULED/IN_PROGRESS/COMPLETED 관계로 제한한다.
- 실제로 존재하지 않는 날짜와 null 항목은400이다. 이는 기존 날짜 rollover/500 결함의 의도된 보완이다. 0000년은 거부하고 0001–0099년은 1900년대 보정 없이 처리한다. 중복 일정/날짜는 최초 순서로 제거하고 겹치는 시간대 자체를 새로 금지하지 않는다.

## 원자성·암호화·감사

Mongo는 전체 행 codec의 암호화/HMAC/무결성 검사를 사용한다. 예약자 이름·메일 및 활동 기록의 PII를 평문으로 저장하지 않는다. 변경감사의 허용 필드는 기존 `activity/field-policy.json`의 날짜/시간/코치/취소시각/확정 링크와 일치한다. `CoachScheduleAccessLog`는 기존 table-exclusions에 따라 공통 변경감사에서 제외한다.

월 교체는 기존 월 가용 일정을 교체하는 계약을 유지한다. 삭제·삽입·접근 로그와 변경감사는 한 transaction이다. 예약 이력은 물리 삭제하지 않고 cancelledAt을 갱신하며 confirmedEngagementId를 보존한다. Coach soft delete 시 자식 데이터를 새로 cascade 삭제하지 않는다.

동일 월 빈 일정에도 경쟁 PUT을 직렬화하기 위해 lastEditedAt은 max(현재 시각, 이전 값+1ms)다. 기존 log가 없어도 unique(coachId,yearMonth)가 충돌을 감지한다. 충돌 시 전체 transaction을 새 snapshot으로 재시도한다. 매우 짧은 간격의 PUT에서는 감사 시각이 실제 시각보다 수 ms 앞설 수 있다.

예약에는 shadow 전용 `runtime_active_reservation` unique(coachId,date), partial cancelledAt:null 인덱스를 준비·검사한다. 취소 이력 여러 건은 허용한다. 기존 active 중복은 준비 실패이며 자동 삭제하지 않는다. insert 중복 경쟁은 전체 transaction 재시도 후 실제 승자를 응답한다. 이 인덱스는 Prisma schema나 운영 DB에 적용되지 않는다.

명시 scope에서 저장소나 요청감사가 빠지면 실패하며 PG로 fallback하지 않는다. 직접 Mongo 월교체/예약/취소도 ActivityContext가 없으면 쓰기 전에 실패한다. 업무 변경감사의 실패는 rollback하며, 요청 ActivityRequest 기록의 런타임 실패는 기존처럼 best-effort로 업무 성공과 구분한다.

PG adapter는 기존 조회/응답/암호화/감사를 유지하고 세 변경 메서드에 코치별 parameterized advisory transaction lock을 추가한다. 동일 UUID의 대소문자도 동일 lock을 사용한다. 모의 adapter 테스트는 실PG 경합·rollback의 증거가 아니다.

## 검증·남은 전환 게이트

실행 명령·최종 카운트는 `.claude/plans/mongodb-coach-schedules/execution-manifest.md`, 독립검토는 execution-review.md에 기록한다. native 로컬 Mongo8 replica set, 임시키와 합성 fixture만 사용한다. 실제 OAuth/UI/운영Mongo/실PG query 대조는 수행하지 않는다.

**이 scope 완료가 생산 전환을 허용하지 않는다.** engagement 쓰기·`reservationAutoCancel.ts`·contractSheetSync·samsungScheduleSync는 아직 PG 경로다. 확정 writer가 예약을 취소하고 confirmedEngagementId를 연결하는 원자성, engagement 물리삭제의 SetNull과 Coach soft delete의 차이를 함께 이관·검증해야 한다. 현재 active unique는 POST 간 중복만 막으며 범위 밖 확정·삭제 writer와의 통합 직렬화를 보장하지 않는다. Coach 삭제와 신규 예약의 동시 commit 금지는 기존 수준을 넘는 별도 보장으로 추가하지 않았다.

실데이터 snapshot/차이 반영/최종 쓰기 중단/복구/OAuth UI/배포/생산 selector는 총괄 전환 계획의 후속 게이트로 남는다.
