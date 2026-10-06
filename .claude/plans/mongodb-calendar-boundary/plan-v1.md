# Calendar 저장·lease 경계 Plan v1 — 검토용 draft

작성일: 2026-09-30. 상태: 부모 / critic / meta 검토 전. 구현 승인이 완료된 계획이나 실행 결과가 아니다.

## 0. 목적·기준·현재 제한

- 이번 문서는 외부 소유 경로에만 작성한다. 현재 제품/저장소 문서/테스트 소스는 동결하며 코드·DB·테스트·Google/OAuth/Slack 실행은 없다.
- 조사 checkout: `/Users/ga/workspace/hub-om-mongodb-coach-content`, branch `feature/20260930-mongodb-import-promotion`, HEAD `75125c9644d6c8265fbdae59e5c9d450247170ef`. 승격 구현은 이 HEAD 이후 working tree에도 있으므로 HEAD만으로 원본을 특정하지 않는다. validation-v1 §2의 파일 digest를 함께 사용한다.
- 부모 전달 선행 결과: handler 18 pass / 0 skip / exit 0, static 922 pass / 71 skip, type/build pass, lint 7. 작성자가 재실행한 결과가 아니며 Calendar 수락 증거로 전용하지 않는다.
- 먼저 읽은 조사: `.claude/plans/mongodb-import-staging/next-scope.md`. 승격 plan-v2/validation-v2와 원본 PG 손실 보장에 대한 후속 정정 의견을 반영했다.
- 다음 별도 작업 branch에서 구현한다. main production의 기존 PG 선택, local 모드, 실제 예약 설정, 환경변수·자격증명·배포·운영 데이터는 바꾸지 않는다.

## 1. 추천: 단일 수직 단위, mapping에 한정한 소유권 보호

완료할 사용자 흐름은 **actual promote POST → 실제 기존 backfill 오케스트레이터 → 실제 Mongo 조회·lease → 합성 Google transport → 실제 Mongo CalendarEventLink와 ActivityChange 저장**이다. Calendar 효과 전체를 spy로 대체한 기존 승격 handler 검증을 보완한다. 호출 옵션은 기존 `{ dryRun: false }` 그대로다.

실제 양성 fixture는 **educationDates가 있는 삭제 운영을 같은 지문으로 승격 복원(revived)**하는 경우로 잡는다. 현재 `importPromotionCore.buildOperationSessionValueData`는 educationDays만 옮기고 educationDates는 쓰지 않는다. 신규 승격 운영은 기존 default의 빈 educationDates 때문에 backfill에서 제외되는 것이 원래 동작이다. mappedFields에 날짜 배열만 넣어 신규 이벤트가 생긴다고 가정하거나 이번 Task에서 승격의 필드 의미를 바꾸지 않는다. 별도 활성·미매핑·교육일 보유 운영도 준비해 backfill이 해당 run에만 한정되지 않는 원본 성질을 검증한다.

| 대안 | 장점·비용 | 반례·선택 |
| --- | --- | --- |
| A. 저장·lease·승격 backfill 연결을 하나의 수직 단위로 구현 | 한 번의 조립으로 실제 API부터 mapping 감사까지 확인. 내부 구현 순서는 lock→storage→API로 나누되 수락은 종단 흐름으로 한다 | 실패상태를 분리하지 않으면 부분반영을 놓친다. 본 계획의 상태표와 독립 oracle로 제어한다. **추천** |
| B. 잠금 포트·Mongo lease만 먼저 독립 Task | 잠금 경합 검증이 작고 리뷰가 쉽다 | 다시 조립·검증해야 하고 그 단계만으로 Calendar 사용 가능하다고 할 수 없다. critic이 핵심 lease 알고리즘의 미해결 결함을 찾는 경우 분리할 수 있으나 선행 의무는 아니다 |

비만료 Mongo document lock은 추천하지 않는다. PG session lock과 달리 프로세스 종료로 자동 해제되지 않아 사망 판정/잔존 lock 회수 절차가 새로 필요하다. lease는 장기 event-loop 정지까지 소유권 상실로 취급한다는 차이를 명시하고 기존 손실·부분실패 계약 안에서 구현한다.

필수로 만들지 않는 보장: Google exactly-once, 메일 exactly-once, 외부효과 전체 rollback, 모든 OperationSession writer의 fencing, Google 결과 불명 시 무기한 보류/관리자 승인. 모두 원본에 없는 요구다.

## 2. 원본 보장과 의도된 차이

원본 `calendarOperationLock.ts`는 별도 pg.Pool 연결의 session advisory lock을 callback 전체(업무 DB·Google·mapping 포함)에 걸친다. 같은 회차 재진입 전과 최외곽 callback 정상 반환 뒤에 abort를 확인한다. 최초 acquire 성공→callback 진입, Prisma 업무 쓰기, Google 성공→mapping 쓰기 사이에는 일괄 abort 확인이 없다. unlock 실패는 연결을 폐기하지만 그 실패만으로 callback 결과를 다시 거부하지 않는다.

Prisma는 별도 adapter/pool이다. 잠금 연결만 손실된 경우 진행 중인 업무 transaction·mapping·보상 쓰기가 완료될 수 있다. 서버가 이전 session lock을 해제하고 새 작업자를 허용한 뒤에도 이전 Google 요청은 성공할 수 있다. abort는 callback 강제 종료나 이미 끝난 작업의 rollback이 아니다.

| 항목 | 원본 PG | 명시 Mongo scope의 제안 |
| --- | --- | --- |
| 소유권 기준 | 서버 session 생존 및 advisory lock | 서버 시간 기반 leaseUntil와 owner/generation |
| event loop 장기 정지, DB session 정상 | PG lock 유지; 다른 작업자 진입 실패 | renewal 중단→lease 만료→새 작업자 획득 가능. 원본과 다른 장애 감지 조건 |
| 소유권 손실 인지 | client error 이벤트가 늦을 수 있음 | renewal 실패/서버 거부/로컬 보수적 기한으로 손실 확정. 늦은 timer만 의존하지 않음 |
| stale mapping writer | 일반 Prisma 쓰기가 이어질 수 있음 | 이 포트를 통한 mapping+감사는 동일 transaction의 owner/fence 확인으로 추가 보호 |
| stale operation writer | 별도 Prisma 쓰기 허용 가능 | 일반 MongoOperationRepository 등의 기존 쓰기는 이번에 전체 fencing하지 않음 |
| Google 요청 | signal 전달, 전송 후 성공 가능 | 동일 한계. 전송 전 소유권 확인 추가는 기회 감소이지 외부 fencing이 아님 |
| callback 재실행 | lock wrapper 자체는 하지 않음 | 획득/갱신/손실/commit 오류로 외부 callback을 재실행하지 않음 |

이 차이는 허용 범위가 명시된 구현 보완이다. PG 동등 비교에서 손실 시 전체무쓰기/전체실패를 공통 정답으로 만들지 않는다. Mongo가 추가로 차단한 mapping 쓰기는 별도 강화 결과로 기록한다.

## 3. 구체 port와 명시 조립

### 3.1 CalendarPersistence

기존 export 함수를 facade로 유지하고 scope key `calendarPersistence`로 backend를 선택한다. scope 없음은 원본 PG adapter, scope 내 누락은 fail closed이며 PG/local fallback을 하지 않는다.

| 메서드 | 반환·계약 |
| --- | --- |
| listCalendarEventLinks(operationId) | CalendarEventLink[]; eventDate 오름차순 |
| listAllCalendarEventLinks() | operationId→eventDate 오름차순 |
| saveCalendarEventLink(link) | void; operationId+eventDate upsert; 기존 id/createdAt 보존, calendarId/eventId 갱신 |
| deleteCalendarEventLink(operationId,eventDate) | void; 해당 키만 삭제; 원본 mapping 삭제 계약 유지 |
| deleteCalendarEventLinks(operationId) | void; 해당 회차 mapping만 삭제 |
| moveCalendarEventLinkDate(link,toDate) | void; 원본 네 필드 모두 일치·정확히 1건 변경, 아니면 실패; 목적지 unique 충돌도 실패 |
| findCalendarEventLinksByCalendar(calendarId) | Map<eventId,link>; 원본처럼 non-unique 역조회 결과. 새 unique/정렬 정책을 만들지 않음 |
| deleteMatchingCalendarEventLink(link) | void; operationId/eventDate/calendarId/eventId 모두 일치할 때만 삭제 |
| findOperationUpdatedAt(operationIds) | Map<string,Date>; 없는 ID는 없음, 빈 배열 빈 Map, 삭제표시 제외 조건을 새로 넣지 않음 |

모델은 기존 CalendarEventLink, OperationSession, ActivityChange를 사용한다. CalendarEventLink의 `(operationId,eventDate)` unique, date-only UTC 변환, nullable/default/createdAt/updatedAt 계약을 보존한다. `(calendarId,eventId)`는 unique가 아니다. OperationSession 표준 DTO에 updatedAt을 추가하지 않는다.

calendarId/eventId는 기존 privacy codec/HMAC 검색 계약을 적용한다. 무작위 암호문 equality로 조회하지 않는다. mapping 변경감사는 기존 PG trigger와 target/action/필드집합/actor/request를 대조한다. `operation_id,event_date`는 기존 공개값, calendar/event IDs는 change-only다. 현 `operationAuditRow`에 필요한 Calendar 전용 보완만 하며 다른 모델의 감사 정책은 바꾸지 않는다. PG trigger는 activity context가 없으면 감사 없이 반환한다(PII migration의 함수 재정의도 동일). actor 없는 직접 호출에 새 사용자 감사를 만들어내지 않으며 실제 PG oracle에서도 확인한다.

### 3.2 CalendarLockPort

scope key `calendarLock`. public 개념 계약:

```ts
interface CalendarLockHandle {
  readonly signal: AbortSignal;
  assertActive(): Promise<void>; // Mongo: deadline/소유권 확인. PG 경로는 기존 동작 유지
}
interface CalendarLockPort {
  withLock<T>(operationId: string,
    run: (handle: CalendarLockHandle) => Promise<T>): Promise<T>;
}
```

기존 `withCalendarOperationLock(id, () => ...)`, `calendarLockSignal`, `withoutCalendarReflection`, `isCalendarReflectionSuppressed` export는 유지한다. 내부 ALS가 handle·scope identity·operationId·suppressReflection을 보유한다. Mongo transaction용 owner/generation 값과 guard 쓰기 helper는 Mongo adapter 내부 계약이며 업무 DTO/HTTP로 노출하지 않는다.

PG branch는 원래 assertDefaultDatabaseAccess→disabled bypass→재진입/Pool 경로를 유지한다. Mongo branch에서 override를 선택한 뒤 PG guard를 호출해버리거나 guard를 제거해 fallback을 허용하지 않는다. 추가 async 소유권 preflight는 scoped Mongo handle에만 적용한다.

### 3.3 Scope 조립과 선검사

- `createMongoCalendarRuntime(options)` 같은 명시 builder가 동일 client/DB/namespace의 persistence·lock·importPromotionCalendar 효과를 함께 묶는다. global backend env 전환은 추가하지 않는다.
- 실제 backfill용 scope는 `operations`, `teamUsers`, `calendarPersistence`, `calendarLock`. 승격 POST에는 기존 `importPromotion`, `teamMembers`, `importPromotionCalendar`, `requestActivity`도 필요하다. teamMembers는 Calendar의 teamUsers를 대체하지 않는다.
- `operations`는 첫 승격/backfill 경로에서는 기존 MongoOperationRepository를 명시 공급한다. forward/reverse compatibility fixture에서는 `new CalendarReflectingOperationRepository(mongoOperations)`를 명시 공급한다. factory가 모든 override를 자동 wrapping하지 않는다.
- 구현 추천: ImportPromotionCalendar에 optional `assertReady(): void`를 추가하고 기존 getter가 override 반환 전에 있을 때 호출한다. 실제 Mongo Calendar effect만 이 hook으로 필요한 scope 및 backend identity를 동기 검증한다. 기존 synthetic 최소 effect/PG default는 그대로다. DB 준비/설정 파일 조회/외부 호출은 이 hook에서 하지 않는다.
- 직접 backfill 경로도 외부 조회 전에 같은 scope 선검사를 한다. 단순 Promise.all 안의 개별 getter에 맡기지 않는다. dependency 누락 시 승격 업무0, Calendar OAuth/fetch0, PG0이어야 한다. schema/index readiness는 미리 완료한 open의 책임이다.
- 위의 포트 누락→업무/외부0 보장은 이번 primary promote/backfill 진입의 필수 조건이다. 인접 forward/reverse/cleanup/refresh는 완전한 builder scope에서 compatibility를 확인한다. 특히 기존 reverse의 Google조회+mapping조회 Promise.all과 forward 생성후 반영은 불완전한 임의 scope에서 선행 효과를 막아주지 않는다. 이들 진입까지 배포 조립할 후속 Task에는 entrypoint 선검사를 명시하고, 현재 기본 PG를 바꾸지 않는다. 이를 이번에 모든 Calendar 진입의 원자적 preflight를 끝냈다고 보고하지 않는다.
- scope 없는 기존 Google 자격증명·파트 설정·token cache·Slack 규칙은 유지한다. 이번 최소안은 새 범용 credential/transport 프레임워크를 만들지 않는다. 테스트는 설정 모듈 또는 합성 env와 transport를 통제하며 실제 env 파일을 읽지 않는다. 명시 scope가 실제 자격증명 계정을 자동 격리한다는 주장은 하지 않는다.
- disabled에서도 명시 실제 runtime의 포트 존재는 검사한다. 완전한 disabled scope에서는 backfill의 기존 enabled:false/빈요약을 유지하고 lock acquire·mapping 변경·OAuth/Google/Slack은 0이다. 원래 disabled wrapper가 callback을 그냥 실행하는 성질도 유지한다. scope 없는 PG/local 동작을 새 실패로 바꾸지 않는다.

## 4. 새 내부 coordination 컬렉션: 하나만

제안 이름: `${namespace}_CalendarOperationLease`. 업무 모델 목록/Prisma schema/업무 삭제 정책에는 추가하지 않는다. private native collection으로 명시 준비/검증한다.

| 필드 | 의미 |
| --- | --- |
| `_id: string` | operationId. 컬렉션 namespace가 저장 범위를 분리 |
| `owner: string | null` | 획득 시 새 무작위 UUID, 해제 시 null. 한 callback 소유권을 다른 실행에 재사용하지 않음 |
| `generation: BSON Long` | 획득마다 증가하는 비음수 세대. JS number로 좁히지 않음; overflow면 callback 전 거부 |
| `leaseUntil: Date` | 서버 `$$NOW`로 설정/비교하는 유효기한 |
| `nonce: string` | mapping transaction이 소유권 문서를 실제 갱신하여 takeover/renew와 경합하도록 하는 임의 값 |

- unique `_id`, strict validator/error, simple collation, TTL 없음. lease expiry는 삭제 이벤트가 아니며 문서를 남겨 generation을 보존한다. 문서 삭제/TTL로 lock을 해제하지 않는다.
- generation은 `promoteLongs:false` 등으로 BSON Long을 그대로 취급하고 최대값에서 wrap/number 정밀도 손실 없이 거부한다. helper의 파라미터 타입과 반환형에서도 number로 변환하지 않는다.
- prepare는 `allowShadowWrites:true`와 허용 shadow DB/namespace에만 동작한다. 새 컬렉션/index/validator를 생성할 수 있으나 이미 있는 불일치 구조·TTL·capped·잘못된 index는 거부한다. 기존 문서/owner/generation을 reset하지 않는다. open과 일반 요청은 metadata 자동수리를 하지 않는다.
- 첫 operationId 등장 시 정상 coordination 데이터로 unowned 문서를 setOnInsert할 수 있다. 해당 `_id` 첫 insert 경합만 winner 문서를 다시 읽는다. 이 동작은 schema auto-repair가 아니다. callback 전 coordination 준비만 반복 가능하며 업무/Google callback은 실행하지 않는다.
- 획득은 단일 조건부 native update: owner가 null 또는 leaseUntil<=서버 $$NOW일 때 generation+1, owner=새 UUID, leaseUntil=$$NOW+leaseMs, nonce 갱신. active owner이면 즉시 busy, polling queue 없음. 알려진 실패와 ACK 불명은 구분한다.
- 갱신은 같은 owner+generation 및 leaseUntil>$$NOW 조건으로만 한다. 이미 만료된 자기 lease를 되살리지 않는다. 만료 후 다시 획득해 같은 callback을 계속 실행하지 않는다.
- 해제는 owner+generation 조건으로 owner=null/leaseUntil=서버시간 처리하고 generation을 남긴다. 새 owner를 지우지 않는다. 해제 ACK 불명은 lease 만료가 회복 경로이며 callback 재실행은 없다.

## 5. 시간·수명·재진입 계약 — draft 추천 상수

아래 수치는 다음 구현의 출발값이며 production SLA가 아니다. 부모/critic이 수치를 바꾸면 validation의 동일 파라미터 표도 함께 바꾼다. silent test-only 완화는 하지 않는다.

| 경계 | 추천값/판정 | 예산·한계 |
| --- | --- | --- |
| lease | 60초, 서버 $$NOW가 authoritative | client Date.now로 유효성 확정하지 않음 |
| renewal | 15초 간격, 동시에 최대 1개 | 응답 실패/불명/owner 불일치/만료면 손실을 확정하고 abort. 같은 callback 재획득 없음 |
| coordination IO | 각 5초 이내 client/server 예산 | 남은 lease/전체 deadline보다 작게 제한. 서버 선택·응답 지연 포함 |
| 로컬 보수적 유효시각 | 갱신/획득 요청 시작 monotonic 시각 +60초-1초 | RTT를 TTL에 더하지 않음. 늦은 ACK가 과거 deadline을 복구하지 않음 |
| callback 전체 | acquire 시도부터 180초, 최초 1회 설정 | 재진입/갱신/DB retry에서 초기화하지 않음. 전체 backfill/POST 강제 종료시간은 아님 |
| mapping+audit DB transaction | 최대10초와 남은 전체 예산 중 작은 값 | DB callback만 제한 retry 가능. Google callback은 retry 금지 |
| Google | 기존 각 fetch 30초 timeout + lock signal | 이미 전송된 요청 성공/메일은 취소 보장 없음. OAuth도 동일 signal 적용 |
| GET retry | 기존 800ms 후 최대1회 | 손실 signal이면 retry하지 않음. INSERT/PATCH/DELETE/OAuth에 일반 자동retry 추가 없음 |

`assertActive()`는 로컬 monotonic deadline을 먼저 확인하고 필요한 서버 owner/generation/유효기한 확인을 한다. 보호 대상 mapping transaction의 최초 guard와 외부 OAuth/Google 전송 직전, 최외곽 callback 반환 직전에서 호출한다. timer가 밀린 event loop 재개 시에도 이 관찰점에서 만료를 확인한다. 서버 확인과 외부 전송 사이의 원자성은 없으며 불가피한 잔여 경합으로 표시한다.

재진입 identity는 builder가 공유하는 backend/client target + databaseName + namespace 범위와 operationId를 함께 비교한다. 같은 runtime/same operation은 같은 handle/deadline/signal을 재사용하고 acquire0·generation 증가0. 다른 operation 또는 다른 namespace/runtime 중첩은 거부한다. 별도 client instance는 같은 DB라도 기존 ALS handle을 임의 재사용하지 않고, 독립 호출은 서버에서 경합시킨다. suppressReflection은 같은 handle을 보존한다.

finally에서 renewal scheduling을 멈추고 진행 중 renewal을 정리한 뒤 조건부 release한다. 늦은 갱신 응답이 종료/손실 상태를 ACTIVE로 되돌릴 수 없다. release 실패만으로 이미 성공한 callback을 다시 실행하지 않으며 PG 원본처럼 연결정리 실패와 업무 결과를 분리한다. callback 오류가 있으면 cleanup 오류로 원인을 덮지 않는다.

## 6. stale owner 쓰기 보호의 정확한 범위

모든 **Mongo CalendarPersistence의 mapping 변경**은 유효한 같은 scope·operation lease를 요구한다. 짧은 native transaction 안에서 owner/generation/leaseUntil>$$NOW 조건으로 coordination nonce를 실제 변경한 뒤 mapping과 해당 ActivityChange를 함께 쓴다. 소유권 확인을 transaction 밖에서만 하고 저장하는 방식은 사용하지 않는다. mapping unique/원본 일치 검사를 동일 transaction에서 유지한다.

보장: takeover가 먼저 commit하면 이전 세대 mapping 쓰기는 거부된다. 이전 mapping transaction이 coordination 문서에 먼저 쓰면 takeover/renew와 write conflict가 발생하며 실제 commit 순서로 결과를 판정한다. 재시도는 원래 owner/generation으로 소유권부터 재검사한다. lease가 transaction 도중 만료돼도 takeover보다 앞서 commit하는 결과를 무조건 금지한다고 주장하지 않는다.

비보장: 일반 OperationSession 생성/수정/삭제, promotion transaction, 역반영의 내부 운영 변경은 이번 전체 fencing 대상이 아니다. 기존 업무 transaction이 잠금 손실 뒤 commit할 수 있다. reverse의 이동→운영 변경 실패→매핑 복원에서 소유권을 잃으면 보상 매핑 쓰기도 거부될 수 있어 부분상태가 남는다. 기존보다 보상이 제한되는 이 결과를 명시적으로 검증한다. 임의 운영 rollback·source unlink·새 tombstone을 만들지 않는다.

외부 요청은 DB transaction 안에 넣지 않는다. Google 성공→mapping 실패의 재시도는 기존 결정적 event ID/409 표식확인으로 회복한다. fence를 Google ID에 섞어 매 획득마다 새 이벤트를 만드는 설계는 금지한다. patch/delete/메일 exactly-once는 주장하지 않는다.

## 7. 실패·응답 상태표

Calendar backfill은 개별 회차 오류를 outcomes/failedOperations에 담아 반환할 수 있다. **반환된 실패 집계와 함수 throw를 구분**한다. promote는 backfill.ok를 새로 검사하지 않고 기존 totals만 전달한다.

| 시점/결과 | 승격 업무 | mapping·감사/Google | 실제 promote 응답·후속 |
| --- | --- | --- | --- |
| auth 또는 필수 scope 누락 | 0 | 0, 외부0, PG0 | 기존 guard/wrapper 위치에 따른 redirect/직접거부/400. 일괄400으로 바꾸지 않음 |
| promotion transaction 재시도/최종실패 | 기존 승격 계약 | Calendar 호출0 | callback/ACK재시도 중0, 최종불명400에서 Calendar0 |
| commit확정, Calendar disabled | commit 유지 | mapping 변경0, 외부0, lease획득0 | 200, calendar totals 0/0 포함, revalidation4 |
| backfill 초기 조회/준비 오류로 throw | commit 유지 | 시작 전 실패라면 Google0 | 200, calendar 생략, 기존 고정로그, revalidation4 |
| 회차 lock busy/acquire불명/소유권손실 | commit 유지 | 해당 callback 미실행 또는 이미 일어난 일부 효과만 잔존 | backfill이 회차오류로 반환하면 200+calendar.failedOperations; throw 경로면 calendar생략 |
| Google 쓰기 오류/응답불명 | commit 유지 | 실제 Google 존재/메일 여부 미확정, 해당 mapping 미저장 가능 | 회차 failed; callback 전체 자동재실행0 |
| Google 성공, mapping transaction 확정실패 | commit 유지 | Google 남음, 해당 mapping+감사0; 이전 이벤트들의 commit은 유지 | 회차 failed; 다음 요청의 deterministic ID 복구 |
| mapping commit ACK 불명 | commit 유지 | 해당 mapping+감사 모두 있음 또는 모두 없음 | 안전 오류/회차 failed. Google 재실행으로 ACK 확인하지 않음 |
| 여러 이벤트 중 후반 실패 | commit 유지 | 앞선 mapping·감사·Google은 유지 | 원본 insertedEvents 증가위치/failedOperations 유지. 원자적 회차전체rollback 주장 금지 |
| callback 끝 abort 확인 실패 | commit 유지 | 이미 끝난 mapping/Google 남을 수 있음 | 회차 failed 가능. 실패=무반영으로 해석 금지 |
| release 실패만 발생 | commit 유지 | 조건부정리 시도, 잔존 lease는 expiry로 회복 | callback 성공 결과를 유지하는 원본 성질 보존; raw driver 로그 금지 |
| revalidation n번째 실패 | commit 유지 | Calendar 이미1회, mapping 유지 | 원본400/generic, revalidation 앞n회만 |
| requestActivity 실패 | 기존 상태 유지 | 추가 효과0 | 기존 handler 응답 그대로, best-effort 고정로그 |
| 새 HTTP 재요청 | sourceRows0도 가능 | 실제 backfill은 다시 호출; 이미 mapping 있으면 insert0 | 요청당 Calendar1, 전역once-only 아님 |

신규 Mongo 오류는 코드 기반 안전 메시지로 만들고 cause/원문 driver 오류를 HTTP·로그에 내보내지 않는다. 기존 Google/legacy 상세 오류 문구를 이 저장 경계 작업에서 포괄적 새 정책으로 바꾸지는 않는다. 원본 오류 노출과 새로운 adapter 오류 보호를 validation에서 구별한다.

## 8. 시간·경합의 관찰 시나리오

| 제어할 순서 | 기대/차이 |
| --- | --- |
| 같은 namespace·회차 A획득→B획득 | B busy, callback0; A callback1. B가 기다렸다 자동 실행되지 않음 |
| 다른 회차 또는 별도 namespace | 독립 top-level 실행 가능; ALS 중첩 규칙과 혼동하지 않음 |
| 동일 회차 재진입→반환 | lease1개·deadline1개·release1개, callback 호출 순서 유지 |
| renewal 정상→장시간 callback | generation 유지, leaseUntil만 연장, 외부 callback1 |
| event loop 정지→server lease만료→B획득→A재개 | A의 새 protected mapping0, 후속 전송 전 손실 확인. A의 이미 전송된 Google 성공은 허용 |
| A mapping guard쓰기→B takeover 경합 | native write conflict/실제 commit순서 관찰. A가 먼저 commit한 mapping은 허용 |
| B takeover commit→A stale mapping·release·renew | 세 작업 모두 새 owner를 변경하지 않음, 감사 추가0 |
| A Google성공→lease상실→mapping | Google만 남는 상태 허용; 새 요청이 같은 creation key로 복구 |
| acquire ACK유실 | 해당 실행 callback0, 임의 재획득0. 조건부 cleanup 또는 expiry 후 다른 요청 가능 |
| renewal ACK유실→늦은 성공응답 | 이전 실행 LOST 유지. 서버 lease가 잠시 더 길 수 있음; callback 재개0 |
| mapping callback/commit ACK retry | DB-only retry; Google 추가0. 새 lease를 얻어 같은callback 계속하지 않음 |
| ordinary create와promotion 겹침 | 선행 승격 테스트의 허용결과 유지. 새 Calendar lock이 업무writer 전체를 직렬화한다고 주장하지 않음 |

## 9. 호출 계약·후속 Task map

`예정`은 현재 backfill 코드에서 마지막 교육일/종료일 >= from이라는 날짜 기준이다. operationStatus 문자열의 추가 필터를 만들지 않는다. 이벤트는 기존 buildCalendarEventBodies의 연속 교육일 구간 계획 단위이며 무조건 교육일마다 한 건으로 바꾸지 않는다.

| 흐름 | 이번 Task에서 보존·확인 | 후속 경계/완료로 주장하지 않을 것 |
| --- | --- | --- |
| promote→backfill | 실제 종단 필수. options exact, 오늘KST/교육일필수/기본무메일/100상한을 회차 사이에서 검사; ACL reader/freeBusyReader 제외, null/조회오류는 시도; 계획후revision·mapping 재조회 | 전체앱 backend전환·실제Google계정연결 |
| 일반 forward create/update/delete | 공통 storage/lock facade 연결; 명시 wrapper compatibility. create는업무저장후, update/delete는잠금안업무저장. 생성·삭제기본메일/참석자변경patch만메일, calendar비관련수정은반영0, creationReplayed반영0 | 모든 CRUD/관리/원천writer에wrapper·fence강제 적용은 별도 inventory Task |
| missinglink/event 복구 | mapping없음+createdAt>=2026-08-21 수정만생성; 이전/모름skip. mapping유지된Google삭제는reverse/backfill무조치, 일반저장missingpatch에서previousEventId포함복구 | cleanup후재생성정책을주석만근거로강화하지않음 |
| reverse `/api/sync/calendar-events` GET/POST | secret 또는admin+withActivity, updatedAt fallback·표식·revision/ETag, 날짜mapping선이동/실패보상, withoutCalendarReflection, 원복attendees제외. native포트 compatibility 최소1회 | 실제예약주기/활성job/Coolify설정 확인·전환 별도 |
| cleanup backfill route GET mode=cleanup / DELETE | 서명token/expiry/operationRevision/source=backfill/creationKey/ETag 확인; 무메일; 삭제성공후mapping실패 재정리; 재시도에서새mapping보존 | 업무운영softdelete정책 변경없음. mapping삭제는원래제어흐름만 |
| refresh `/api/admin/calendar/refresh-events` GET/POST | secret 또는admin, dryRun, revision+mapping再조회/If-Match, 기본무메일; missing은재생성없이결과표시 | 일괄설명정책/내용변경은범위밖 |
| credentials·OAuth·Slack | 기존설정/token/skip通知규칙보존. 테스트는합성Google+OAuth+Slack만 | multi-account credential scope/공유tokencache분리·실제계정권한검증은별도 |
| 전체조립 | 명시테스트runtime만Mongo. 기본factory/productionPG/local유지 | startup/health/backup/예약CLI/실원천/전환runbook는상위후속Task |

후속을 누락하지 않기 위해 공유 facade 영향의 최소 compatibility 검증은 이번 validation에 포함한다. 위 후속 production 전환이나 전체 writer fencing을 이번 완료 조건에 끼워 넣지 않는다.

## 10. 최소 파일 범위 제안·구현 순서

다음 branch에서만 적용할 예상 범위이며 현재 수정 허가가 아니다.

- 기존 수정: `src/lib/googleCalendar/calendarEventLinkRepository.ts`, `operationSessionTimestamps.ts`, `calendarOperationLock.ts`, `calendarWriteClient.ts`(scoped 전송전 확인만), `backfillCalendarEvents.ts`(scope 선검사); `src/lib/data/dataRepositoryContext.ts`, `importPromotionEffects.ts`, `mongoOperationAudit.ts`(Calendar 감사분기만).
- 신규 제안: Calendar port type 파일 1개, 원본 PG persistence adapter 1개, 원본 PG lock adapter 1개, Mongo Calendar persistence 1개, Mongo lease/준비 1개, 명시 runtime 조립 1개. 실제 이름은 구현자가 기존 규칙에 맞추되 범위를 숨기지 않는다.
- `calendarReflectingOperationRepository`와 factory·실제 promote route는 기존 구조 재사용을 우선한다. generic factory 자동 wrapping, MongoOperationRepository 전체 fencing, 기존업무schema/삭제정책/외부SDK 추가는 계획에 없다.
- 신규 검증: frozen-original PG oracle, native lease, native persistence, actual handler+synthetic transport 통합. 기존 Calendar 단위/route/wrapper 회귀를 함께 실행한다. 원본 fixture는 구현 시작 전 별도 보존한다.
- 순서: 원본동결·검증기준→PG facade 추출 회귀→lease native→mapping/감사 native→실제 promote/backfill 조립→인접흐름 compatibility→전체정적/독립실행검토. 중간층 완료만으로 종단완료를 선언하지 않는다.

## 11. 열린 결정과 수락 조건

- 사용자 승인 질문이 필요한 업무정책 변경은 현재 제안에 없다. 상위 목표가 허용한 명시 Mongo 경계 안에서 lease와 좁은 mapping 보호를 추천한다.
- 기술검토 미확정: 서버 $$NOW 조건부 획득/update pipeline와 BSON Long overflow, transaction guard와renewal의실제경합, 추천60/15/5/180초예산, mapping 감사의 실제 PG 필드집합 대조. 부모/critic/meta 검토와 독립 테스트로 확정하며 미검증을 PASS로 표시하지 않는다.
- 기술반례가 나오면 필요한 최소 파일/실패표를 수정한다. 전역fencing·outbox·관리자승인·무기한lock으로범위를자동확장하지않는다. lease만으로현재수직단위조립이불가능하다는실증이있을때대안B로분리한다.
- 완료는 validation-v1의필수행이실행증거로충족되고누락scope/PGfallback/실외부접근0이확인된상태다. production전환은별도이며,이문서와선행handler18PASS는Calendar구현완료를의미하지않는다.
