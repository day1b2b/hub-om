# 다음 Calendar 단위 사전 조사 — 제품 변경 아님

Parfit 독립 정적 조사와 부모 코드 확인. 선행 `.claude/plans/mongodb-import-staging/next-scope.md`의 기존 근거에 추가한다. 현재 promotion 완료·독립 수락을 대신하지 않는다.

## 권고 분리

잠금 계약을 먼저 검토한 뒤 저장·실제 backfill을 연결한다. 한 번에 잠금/CRUD/Google 부작용을 모두 바꾸는 대안은 완성 흐름이 빠르지만 원자성·응답 불명·늦은 작업자 쓰기가 얽힌다. 분리 비용은 추가 계약 검토이나 잠금 안전성의 판정이 명확하다. 잠금만 완성했다고 Calendar를 사용 가능하다고 보고하지 않는다.

## 필요한 경계

- CalendarPersistence: 기존 mapping 8함수와 operation updatedAt Map 조회. 기존 export 유지, 명시 context 우선, 기본 PG.
- CalendarOperationLock: callback 전체 수명의 배타 실행, 취소 신호, 소유권 검증. 동일 회차 재진입/다른 회차 중첩 거부를 보존하고 다른 저장 namespace의 같은 ID는 재진입으로 취급하지 않는다.
- 현재 operation factory는 override를 그대로 반환하므로 명시 composition에서 CalendarReflectingOperationRepository(mongoOperations)를 주입한다. factory 전체를 임의 wrapping하지 않는다.
- 실제 Calendar는 teamUsers가 필요하며 promotion의 teamMembers만으로 충분하지 않다. 기존 requestActivity·operations와 저장/잠금 필수 포트를 외부 호출·업무 쓰기 전에 확인한다. reverse plan의 Promise.all은 Google 호출을 먼저 시작할 수 있다.

## 저장·감사·외부 효과 계약

mapping unique는 operationId/eventDate뿐이다. calendarId/eventId unique를 새로 만들지 않는다. 날짜 이동은 기존 네 필드 일치와 정확히 한 건 변경을 요구하고 조건부 삭제는 교체된 매핑을 보존한다. Calendar ID/event ID는 기존 암호화 정책이므로 raw equality로 검색하지 않는다.

PG mapping 감사와 Mongo 감사는 필드까지 대조한다. 기존 operationAuditRow는 Calendar 공개 필드 allowlist가 없으므로 operation_id/event_date까지 가려지는지 검토한다. 매핑/감사 원자성은 필수다.

정방향 생성/삭제 기본 메일, patch 기본 억제/참석자 변경 시 메일, backfill·cleanup 무메일 유지. GET 한 번 재시도와 쓰기 자동재시도 없음 유지. Google 성공/mapping 실패는 결정적 ID·409 표식 확인으로 복구하지만 patch/delete/메일 exactly-once를 보장하지 않는다. OAuth·Slack까지 합성 경계로 차단한다.

wrapper 수정/삭제는 업무 저장부터 잠금 안이고 생성은 저장 후 반영이다. 일반 운영/역반영 보상 쓰기의 소유권 상실 시점도 검증하되, 원본 PG가 모든 업무 쓰기를 fence한다고 가정하지 않는다. Mongo retry callback 안에 Google 요청을 넣지 않는다.

## 잠금 설계에서 아직 해결할 조건

현재 PG 세션 advisory lock에는 Mongo와 동일한 서버 기능이 없다. lease/fencing 대안은 만료 후 구 소유자의 늦은 쓰기와 Google 요청을 검토해야 한다. TTL 삭제만으로 소유권을 판정하지 않는다. 소유권 확인과 쓰기를 별도로 하면 엄격한 DB fencing 보장에는 충분하지 않으므로 보장 범위를 구분한다. DB fencing은 이미 보낸 Google 요청을 막지 못한다. 잠금 상실/응답 불명 시 callback 자동 재실행을 추가하지 않는다. 새 작업자의 승계는 원본 잠금 손실 계약과 lease의 만료 차이를 대조한다. 시간 만료만으로 takeover하지 않는 보수적 대안과 자동 회복 대안의 가용성/중복 효과 위험을 비교하고 기존 계약으로 해결되지 않는 실제 결정만 사용자에게 제시한다.

추가 원본 확인으로 위 판정선을 보완했다. PG 잠금 연결과 Prisma 업무 연결은 별개이며, 원본도 잠금 상실 후 업무/mapping 쓰기가 완료될 수 있다. abort 확인은 재진입 전과 최외곽 callback 반환 후에 있고 Google 성공→mapping 사이에는 없다. 이미 전송된 Google 요청의 exactly-once나 전체 rollback은 원본 보장이 아니다. 따라서 이를 새 필수조건으로 만들거나 운영 쓰기 전체 fencing을 무조건 요구하지 않는다.

실제 차이는 긴 event-loop 정지다. PG 세션이 살아 있으면 잠금이 유지되지만 lease는 만료될 수 있다. lease 만료를 잠금 손실로 취급하고 재개 시 만료 확인, 소유자 조건부 갱신/해제, callback 전체 자동재실행 금지로 기존 손실/부분실패 계약 안에서 설계할 수 있다. DB fencing은 보장하는 적용 범위를 구체적으로 검증할 추가 강화다. 비만료 lock은 프로세스 사망 후 잔존 잠금 해제 절차가 필요하다. 잠금 Task 분리는 검증 편의상 권고이며 필수 선행조건은 아니다. 구체적인 계획·독립 검토에서 재확인한다.

필수 합성 검증: 독립 client 경합·재진입·namespace 격리, 잠금 상실/응답 불명/해제 실패, 늦은 DB 쓰기 거부, Google 성공 직후 잠금 상실/mapping 실패, event 누락 복구, cleanup 후 일반 저장, actual promote→실제 backfill→native mapping/감사와 메일 옵션/호출 수. 실제 Google·운영 실행은 포함하지 않는다.

근거: src/lib/googleCalendar/calendarOperationLock.ts, calendarEventLinkRepository.ts, operationSessionTimestamps.ts, calendarWriteClient.ts, calendarReverseSync.ts, reflectOperationToCalendar.ts, applyCalendarReverseSync.ts, backfillCalendarEvents.ts, cleanupBackfilledCalendarEvents.ts, src/lib/data/calendarReflectingOperationRepository.ts 및 operationRepositoryFactory.ts.
