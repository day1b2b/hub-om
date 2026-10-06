# Calendar 저장·lease 경계 Plan v2 — Meta R1~R6 / Critic 보완 draft

작성일: 2026-09-30. 상태: v1에 대한 부모 / critic / meta 지적 반영, v2 재검토 대기. 구현·실행 결과가 아니다. v1은 원문 보존한다.

## 0. 목적·기준·현재 제한

- 이번 문서는 외부 소유 경로에만 작성한다. 현재 제품/저장소 문서/테스트 소스는 동결하며 코드·DB·테스트·Google/OAuth/Slack 실행은 없다.
- 구현 기준 checkout: `/Users/ga/workspace/hub-om-mongodb-coach-content`, branch `feature/20260930-mongodb-calendar-boundary`, HEAD `8238647961bebe3545128fc95f017881ace7d404`. 과거 조사 HEAD75125는 이력이며 최종 기준이 아니다.
- 선행 promotion 제품504782b9f69a921df7b6ec1422dcf103514494e7 및 통합기록8238647961bebe3545128fc95f017881ace7d404를 작업·총괄에 atomic push하고 두 원격 SHA/clean을 부모가 확인했다. 독립 코드·검증·문서·정리 수락 완료. 증거는 선행 계획과 `/Users/ga/.cache/hub-om-verification/20260930-import-promotion/final-remote.txt`다.
- 선행 최종 결과: 일반922/71skip, 실제PG54, native60/API22(파일별최종Mongo833에 포함), type/build 통과, lint0error/기존7warning. Calendar 실행 증거와 합산하지 않는다.
- 먼저 읽은 조사: `.claude/plans/mongodb-import-staging/next-scope.md`. 승격 plan-v2/validation-v2와 원본 PG 손실 보장에 대한 후속 정정 의견을 반영했다.
- §13 G0에서 확정한 promotion 통합 SHA를 출발점으로 다음 별도 작업 branch에서 구현한다. main production의 기존 PG 선택, local 모드, 실제 예약 설정, 환경변수·자격증명·배포·운영 데이터는 바꾸지 않는다.

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
| findCalendarEventLinksByCalendar(calendarId) | Map<eventId,link>; 원본처럼 non-unique 역조회 결과. 새 unique/정렬 정책을 만들지 않음. 동일 eventId 중 어느 후보가 Map의 최종 값이 될지는 허용 후보집합으로 판정(§17) |
| deleteMatchingCalendarEventLink(link) | void; operationId/eventDate/calendarId/eventId 모두 일치할 때만 삭제 |
| findOperationUpdatedAt(operationIds) | Map<string,Date>; 없는 ID는 없음, 빈 배열 빈 Map, 삭제표시 제외 조건을 새로 넣지 않음 |

모델은 기존 CalendarEventLink, OperationSession, ActivityChange를 사용한다. CalendarEventLink의 `(operationId,eventDate)` unique, date-only UTC 변환, nullable/default/createdAt/updatedAt 계약을 보존한다. `(calendarId,eventId)`는 unique가 아니다. OperationSession 표준 DTO에 updatedAt을 추가하지 않는다. 기존 Mongo scan의 20,000행 / BSON 32MiB / 호출당 15초 한계를 재사용하고 초과 시 부분 목록으로 성공하지 않는다. 초기 목록 실패는 Google/lease 시작 전 throw, 잠금 안 재조회 실패는 해당 회차 failed로 고정한다. HMAC 오답 키의 정상 miss와 복호화 오류는 별도다(validation K1~K4).

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

- 명시 builder는 동일 options로 실제 Mongo dependencies를 열어 persistence·lock·importPromotionCalendar와 함께 고정된 object-reference 집합으로 묶는다. backend/client 객체/databaseName/namespace/runtimeToken의 불변 binding을 만들고 등록된 runtime의 runWithDataRepositories 진입 전 및 primary preflight에서 scope 참조를 그 집합과 대조한다(§14). 임의로 받은 repo에 caller 제공 namespace 문자열만 붙여 안전하다고 판단하지 않는다. global backend env 전환은 추가하지 않는다.
- 실제 backfill용 scope는 `operations`, `teamUsers`, `calendarPersistence`, `calendarLock`. 승격 POST에는 기존 `importPromotion`, `teamMembers`, `importPromotionCalendar`, `requestActivity`도 필요하다. teamMembers는 Calendar의 teamUsers를 대체하지 않는다.
- `operations`는 첫 승격/backfill 경로에서는 기존 MongoOperationRepository를 명시 공급한다. forward/reverse compatibility fixture에서는 `new CalendarReflectingOperationRepository(mongoOperations)`를 명시 공급한다. factory가 모든 override를 자동 wrapping하지 않는다.
- 구현 추천: ImportPromotionCalendar에 optional `assertReady(): void`를 추가하고 기존 getter가 override 반환 전에 있을 때 호출한다. 실제 Mongo Calendar effect만 이 hook으로 필요한 scope 및 backend identity를 동기 검증한다. 기존 synthetic 최소 effect/PG default는 그대로다. DB 준비/설정 파일 조회/외부 호출은 이 hook에서 하지 않는다.
- 직접 backfill 경로도 외부 조회 전에 같은 scope 선검사를 한다. 단순 Promise.all 안의 개별 getter에 맡기지 않는다. dependency 누락 시 승격 업무0, Calendar OAuth/fetch0, PG0이어야 한다. schema/index readiness는 미리 완료한 open의 책임이다.
- 위의 포트 누락→업무/외부0 보장은 이번 primary promote/backfill 진입의 필수 조건이다. 인접 forward/reverse/cleanup/refresh는 완전한 builder scope에서 compatibility를 확인한다. 특히 기존 reverse의 Google조회+mapping조회 Promise.all과 forward 생성후 반영은 불완전한 임의 scope에서 선행 효과를 막아주지 않는다. 이들 진입까지 배포 조립할 후속 Task에는 entrypoint 선검사를 명시하고, 현재 기본 PG를 바꾸지 않는다. 이를 이번에 모든 Calendar 진입의 원자적 preflight를 끝냈다고 보고하지 않는다. callsite별 현재 조립/이번 검증/후속 활성화 gate는 §17을 따른다.
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
| renewal | 15초 간격, 동시에 최대 1개 | 무장애 실행은 반드시 갱신·callback 성공. 실제 실패/불명/owner 불일치/만료면 LOST. 같은 callback 재획득 없음 |
| coordination IO | 각 5초 이내 client/server 예산 | 남은 lease/전체 deadline보다 작게 제한. 서버 선택·응답 지연 포함 |
| 로컬 보수적 유효시각 | 갱신/획득 요청 시작 monotonic 시각 +60초-1초 | RTT를 TTL에 더하지 않음. 늦은 ACK가 과거 deadline을 복구하지 않음 |
| callback 전체 | acquire 시도부터 180초, 최초 1회 설정 | 재진입/갱신/DB retry에서 초기화하지 않음. 전체 backfill/POST 강제 종료시간은 아님 |
| mapping+audit DB transaction | 최대10초와 남은 전체 예산 중 작은 값 | DB callback만 제한 retry 가능. Google callback은 retry 금지 |
| Google | 기존 각 fetch 30초 timeout + lock signal | 이미 전송된 요청 성공/메일은 취소 보장 없음. OAuth도 동일 signal 적용 |
| GET retry | 기존 800ms 후 최대1회 | 손실 signal이면 retry하지 않음. INSERT/PATCH/DELETE/OAuth에 일반 자동retry 추가 없음 |

`assertActive()`는 로컬 monotonic deadline을 먼저 확인하고 필요한 서버 owner/generation/유효기한 확인을 한다. 보호 대상 mapping DB callback의 최초 guard와 최외곽 완료 판정에서 검사한다. 외부 전송은 OAuth fetch 직전, await getAccessToken 이후 Calendar fetch 직전(캐시 hit 포함), GET 800ms 대기 후 다음 fetch 직전에 다시 검사한다. 이미 commit된 transaction의 commit ACK 재확인에는 새 ACTIVE/guard 조건을 붙이지 않는다(§6). lease 없이 수행되는 backfill 초기 ACL GET은 기존대로 허용한다. timer가 밀린 event loop 재개 시에도 이 관찰점에서 만료를 확인한다. 서버 확인과 외부 전송 사이의 원자성은 없으며 불가피한 잔여 경합으로 표시한다.

재진입 identity는 builder가 공유하는 backend/client target + databaseName + namespace 범위와 operationId를 함께 비교한다. 같은 runtime/same operation은 같은 handle/deadline/signal을 재사용하고 acquire0·generation 증가0. 다른 operation 또는 다른 namespace/runtime 중첩은 거부한다. 별도 client instance는 같은 DB라도 기존 ALS handle을 임의 재사용하지 않고, 독립 호출은 서버에서 경합시킨다. suppressReflection은 같은 handle을 보존한다.

상태 전이는 §14의 ACQUIRING/ACTIVE/LOST/FINISHING/CLOSED 표를 따른다. finally에서 renewal scheduling을 멈추고 진행 중 renewal을 정리한 뒤 조건부 release한다. 늦은 갱신 응답이 종료/손실 상태를 ACTIVE로 되돌릴 수 없다. callback이 끝났다는 이유만으로 아직 판정 중인 renewal 실패를 성공으로 숨기지도 않는다. release 실패만으로 이미 성공한 callback을 다시 실행하지 않으며 PG 원본처럼 연결정리 실패와 업무 결과를 분리한다. callback 오류가 있으면 cleanup 오류로 원인을 덮지 않는다.

## 6. stale owner 쓰기 보호의 정확한 범위

모든 **Mongo CalendarPersistence의 mapping 변경**은 유효한 같은 scope·operation lease를 요구한다. 짧은 native transaction 안에서 owner/generation/leaseUntil>$$NOW 조건으로 coordination nonce를 실제 변경한 뒤 mapping과 해당 ActivityChange를 함께 쓴다. 소유권 확인을 transaction 밖에서만 하고 저장하는 방식은 사용하지 않는다. mapping unique/원본 일치 검사를 동일 transaction에서 유지한다.

보장: takeover가 먼저 commit하면 이전 세대의 **새 mapping DB callback** 쓰기는 거부된다. 이전 mapping transaction이 coordination nonce를 실제로 변경하고 그 서버 응답까지 받은 뒤 commit을 보류하면 takeover와 순서 경합이 생긴다. B가 기다리거나 조건 재평가/충돌로 끝날 수 있으므로 반드시 112가 나와야 한다고 요구하지 않는다. 정확한 barrier와 원격 DB 결과로 판정한다(validation L6a/L6b).

재시도는 두 종류로 나눈다.
- DB callback 재실행: 기존 transaction이 abort되고 새 snapshot에서 실행하는 것이므로 동일 owner/generation의 guard를 재검사한다. takeover 뒤 새 쓰기/감사0, Google callback 재실행0.
- commit ACK 재확인: A의 mapping+감사 commit 성공→ACK 유실→lease 만료/B takeover→A가 같은 session/txn의 commit 결과를 재확인하는 경우다. 새 guard 쓰기나 callback 재실행을 하지 않는다. 기존 A mapping+감사는 유지하며 B 소유권도 유지한다. ACK 확정은 해당 DB 저장의 완료로 반환하고 backfill의 기존 insertedEvents 증가를 허용한다. 다음 외부 전송 또는 최외곽 Calendar callback의 완료 검사에서 LOST를 실패로 반영한다. commit된 mapping을 지우거나 실패 transaction으로 재분류하지 않는다. L11b는 예산 내 강제 owner 변경·ACK 재확정 fault와 실제 자연 만료를 분리한다. 전자는 저장 반환 후 insertedEvents1/failedOperations1, 후자는10초 예산 종료로 저장이 최종 불명이면 committed mapping이 있어도 insertedEvents0/failedOperations1이다. 정상 제품 예산에서 자연 만료 후 ACK 성공을 필수 정답으로 만들지 않는다.

lease가 mapping transaction 도중 만료돼도 takeover보다 앞서 commit하는 결과를 무조건 금지하지 않는다. fence가 막는 것은 후행 stale 쓰기이지 확정 commit의 과거 취소가 아니다.

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
| 회차 lock busy/acquire불명/소유권손실 | commit 유지 | 해당 callback 미실행 또는 이미 일어난 일부 효과만 잔존 | 해당 item try 내부 실패로200+calendar.failedOperations; 초기 전체 조회 throw만 별도 calendar생략 |
| Google 쓰기 오류/응답불명 | commit 유지 | 실제 Google 존재/메일 여부 미확정, 해당 mapping 미저장 가능 | 회차 failed; callback 전체 자동재실행0 |
| Google 성공, mapping transaction 확정실패 | commit 유지 | Google 남음, 해당 mapping+감사0; 이전 이벤트들의 commit은 유지 | 회차 failed; 다음 요청의 deterministic ID 복구 |
| mapping commit ACK 최종 불명(예산 내 재확정 성공 제외) | commit 유지 | 해당 mapping+감사 모두 있음 또는 모두 없음 | 안전 오류/회차 failed. Google 재실행으로 ACK 확인하지 않음 |
| 여러 이벤트 중 후반 실패 | commit 유지 | 앞선 mapping·감사·Google은 유지 | 원본 insertedEvents 증가위치/failedOperations 유지. 원자적 회차전체rollback 주장 금지 |
| callback 끝 abort 확인 실패 | commit 유지 | 이미 끝난 mapping/Google 남을 수 있음 | 회차 failed 가능. 실패=무반영으로 해석 금지 |
| release 실패만 발생 | commit 유지 | 조건부정리 시도, 잔존 lease는 expiry로 회복 | callback 성공 결과를 유지하는 원본 성질 보존; raw driver 로그 금지 |
| revalidation n번째 실패 | commit 유지 | Calendar 이미1회, mapping 유지 | 원본400/generic, revalidation 앞n회만 |
| requestActivity 실패 | 기존 상태 유지 | 추가 효과0 | 기존 handler 응답 그대로, best-effort 고정로그 |
| 새 HTTP 재요청 | sourceRows0도 가능 | 실제 backfill은 다시 호출; 이미 mapping 있으면 insert0 | 요청당 Calendar1, 전역once-only 아님 |

신규 Mongo 오류뿐 아니라 이번에 통과·검증하는 Calendar 흐름의 원문 Google/OAuth/Slack/driver 오류와 PII 로그도 §16의 안전 코드/고정 메시지로 정리한다. 승인된 정상 DTO·사용자 검토용 업무 이유·알림 payload와 저장/로그를 구분한다. 원본의 상세 오류를 일괄 보존해 암호화 목표에서 누락하지 않는다. 이는 의도된 노출 축소이며 HTTP/status/집계/메일/저장 의미는 유지한다.

## 8. 시간·경합의 관찰 시나리오

| 제어할 순서 | 기대/차이 |
| --- | --- |
| 같은 namespace·회차 A획득→B획득 | B busy, callback0; A callback1. B가 기다렸다 자동 실행되지 않음 |
| 다른 회차 또는 별도 namespace | 독립 top-level 실행 가능; ALS 중첩 규칙과 혼동하지 않음 |
| 동일 회차 재진입→반환 | lease1개·deadline1개·release1개, callback 호출 순서 유지 |
| renewal 정상→장시간 callback | generation 유지, leaseUntil만 연장, 외부 callback1 |
| event loop 정지→server lease만료→B획득→A재개 | A의 새 protected mapping0, 후속 전송 전 손실 확인. A의 이미 전송된 Google 성공은 허용 |
| A guard nonce 실제쓰기 성공 ACK→commit 보류→B takeover | B native 요청 도달을 관찰한 뒤 A commit을 풀어 직렬 결과 확인. 반드시112 요구하지 않음. takeover 선commit 역순은 별도 L6b |
| B takeover commit→A stale mapping·release·renew | 세 작업 모두 새 owner를 변경하지 않음, 감사 추가0 |
| A Google성공→lease상실→mapping | Google만 남는 상태 허용; 새 요청이 같은 creation key로 복구 |
| acquire ACK유실 | 해당 실행 callback0, 임의 재획득0. 조건부 cleanup 또는 expiry 후 다른 요청 가능 |
| renewal ACK유실→늦은 성공응답 | 이전 실행 LOST 유지. 서버 lease가 잠시 더 길 수 있음; callback 재개0 |
| mapping callback retry / commit ACK 재확인 | 전자는 guard 재검사, 후자는 기존 commit 유지·새 guard0. 둘 다 Google callback 재실행0. 자세한 순서는 L11a/L11b |
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

다음 branch에서만 적용할 예상 범위이며 계획 수락 후 기존 개발 승인 범위에서 구현한다.

- 기존 수정: `src/lib/googleCalendar/calendarEventLinkRepository.ts`, `operationSessionTimestamps.ts`, `calendarOperationLock.ts`, `calendarWriteClient.ts`(scoped 전송전 확인 및 오류/로그 노출 축소), `backfillCalendarEvents.ts`(scope 선검사); `src/lib/data/dataRepositoryContext.ts`, `importPromotionEffects.ts`, `mongoOperationAudit.ts`(Calendar 감사분기만).
- PII 보완에 필요한 좁은 추가 수정: `reflectOperationToCalendar.ts`, `calendarReverseSync.ts`, `applyCalendarReverseSync.ts`, `refreshCalendarEventTexts.ts`, `cleanupBackfilledCalendarEvents.ts`, `notifyCalendarReflectSkip.ts`와 관련 Calendar API catch, 실제 DM 경로가 사용하는 `src/lib/slack/notifySlack.ts`의 botPost/openDirectMessageChannel 오류 로그만. 신규 공통 안전 코드/표현 helper를 작게 두되 기존 Mongo 안전 오류와 고정 로그 패턴을 재사용한다. 선택적 원문 message/stack 출력이나 전체앱 로그 리팩터링은 하지 않는다.
- 신규 제안: Calendar port type 파일 1개, 원본 PG persistence adapter 1개, 원본 PG lock은 현재 파일에 유지하고 scoped branch만 추가(별도 adapter 불필요), Mongo Calendar persistence 1개, Mongo lease/준비 1개, 명시 runtime 조립 1개. 실제 이름은 구현자가 기존 규칙에 맞추되 범위를 숨기지 않는다.
- `calendarReflectingOperationRepository`와 factory·실제 promote route는 기존 구조 재사용을 우선한다. generic factory 자동 wrapping, MongoOperationRepository 전체 fencing, 기존업무schema/삭제정책/외부SDK 추가는 계획에 없다.
- 신규 검증: frozen-original PG oracle, native lease, native persistence, actual handler+synthetic transport 통합. 기존 Calendar 단위/route/wrapper 회귀를 함께 실행한다. 원본 fixture는 구현 시작 전 별도 보존한다.
- 순서: 원본동결·검증기준→PG facade 추출 회귀→lease native→mapping/감사 native→실제 promote/backfill 조립→인접흐름 compatibility→전체정적/독립실행검토. 중간층 완료만으로 종단완료를 선언하지 않는다.

## 11. 열린 결정과 수락 조건

- 사용자 승인 질문이 필요한 업무정책 변경은 현재 제안에 없다. 상위 목표가 허용한 명시 Mongo 경계 안에서 lease와 좁은 mapping 보호를 추천한다.
- 기술검토 미확정: 서버 $$NOW 조건부 획득/update pipeline와 BSON Long overflow, transaction guard와renewal의실제경합, 추천60/15/5/180초예산, mapping 감사의 실제 PG 필드집합 대조. 부모/critic/meta 검토와 독립 테스트로 확정하며 미검증을 PASS로 표시하지 않는다.
- 기술반례가 나오면 필요한 최소 파일/실패표를 수정한다. 전역fencing·outbox·관리자승인·무기한lock으로범위를자동확장하지않는다. lease만으로현재수직단위조립이불가능하다는실증이있을때대안B로분리한다.
- 완료는 validation-v2의필수행이실행증거로충족되고누락scope/PGfallback/실외부접근0이확인된상태다. production전환은별도이며,이문서와선행handler22PASS는Calendar구현완료를의미하지않는다.


## 12. Meta R1~R6 / Critic trace

아래 R 번호는 이번 사용자 전달 Meta 필수6을 순서대로 식별한 것이다. 별도 미확인 review 문서를 읽었다는 뜻이 아니다.

| 요구 | 계획 위치 | 검증/증거 |
| --- | --- | --- |
| R1 최종수락·통합SHA gate | §0, §13 | G0~G2, promotion 수락/정리 증거 + accepted/integrated/remote SHA |
| R2 상태전이·혼합포트 검출 | §3, §14 | L2/L4/L7/L10, H2a~H2c; business/lease/Google/OAuth/Slack0 |
| R3 frozen import 의존 폐쇄·독립 기대값/fake | validation §11 | O1~O4 manifest, resolver allowlist, 원격 event registry |
| R4 단계별 HTTP/집계/원격상태 | §7, §15 | F0~F13; 같은 오류라도 발생 단계로 기대값 확정 |
| R5 무장애 갱신 성공·native/clock 구분 | §5, §14 | L3-healthy/L8-native/L12-healthy, 주입/서버/실정지 증거 분리 |
| R6 callsite map·비유일Map·scan fail | §3, §17 | X1~X6, P2b, M12, K1~K4 |
| Critic P1 callback retry/commit ACK | §6 | L11a/L11b: takeover 뒤 확정된 A mapping 유지 |
| Critic P1 두 barrier | §8 | L6a/L6b: guard 실제쓰기 ACK 뒤 commit 보류, 역순은 B commit 증거 뒤 A쓰기 |
| Critic P1 Google 객체 공유 | §17 | H10a/H10b: DB namespace와 calendarId 분리를 따로 검증 |
| Critic P1 OAuth/cache/GET 대기 | §5 | E1~E4: 손실 후 다음 fetch0, lease 전 ACL 허용 |
| Critic P1 고정 H3 | validation §12 | sourceRows2/created1/revived1, 2+1=3 events, failed0, replay insert0 |
| Critic P2 Map/키 오류 분리 | §3, §17 | P2b/K1~K4 |
| 부모 PII 표면 | §16 | S1~S5: 정상 승인 응답·암호화 저장·로그 별도 oracle |

## 13. 선행 promotion 통합 gate

G0은 새 승인 질문이 아니라 이미 수락된 제품을 재현 가능한 출발점으로 고정하는 기술 gate다.

| gate | 현재 상태 | 다음 단계에 필요한 객관 증거 |
| --- | --- | --- |
| G0-a 제품/독립 수락·합성 정리 | 부모 전달 완료 | handler22/0skip, static922/71skip, type/build, lint7의 로그·독립수락·소유 자원 정리 위치를 인계표에 연결 |
| G0-b 문서·통합·remote | 완료 | 제품504782b9f69a921df7b6ec1422dcf103514494e7, 통합/원격8238647961bebe3545128fc95f017881ace7d404, 선행 final-remote.txt |
| G0-c 출발점·frozen snapshot | 완료/테스트 resolver 폐쇄는O1~O4 | 새 branch 기준8238647, external original919파일과 SHA manifest 확보 |
| G1 Calendar 구현 진입 | G0 충족 후 | 계획 v2/후속 수락본과 검증 ID 확정. 전체 promotion을 재승인 받거나 재구현하지 않음 |
| G2 Calendar 구현 수락 | 미래 | 아래 필수 실행 증거·독립 검토·정리·기본PG 유지. production 전환은 별도 |

G0의 원격/동결 근거는 부모가 직접 실행해 제공했다. 제품 구현 전 최종 계획 리뷰를 마치고 테스트 resolver의 frozen 의존 폐쇄를 별도 검증한다.

## 14. 상태 machine·binding·무장애 갱신

### 14.1 상태와 완료 판정

| 현재→다음 | 원인 | 허용/금지 |
| --- | --- | --- |
| NEW→ACQUIRING | complete binding preflight 성공 | coordination IO만 허용. 아직 callback0 |
| ACQUIRING→ACTIVE | 서버 획득 ACK + 로컬 보수기한/전체deadline 유효 | callback 정확히1회 진입 |
| ACQUIRING→LOST | 응답불명/늦은ACK/기한종료 | callback0; 같은실행재획득0; own-owner 조건부정리 가능 |
| ACTIVE→ACTIVE | 정상 renewal ACK | owner/gen 유지; 유효기한 갱신. callback 재실행0 |
| ACTIVE→LOST | renewal실패/서버거부/기한종료/명시손실 | lostReason latch+abort. 새외부요청/새DBcallback0. 진행중효과 자동rollback 없음 |
| ACTIVE→FINISHING | callback resolve/reject | 새작업·재진입·새renew 예약 금지, 진행중renew 정리와 최종판정만 허용 |
| LOST→FINISHING | callback 정리/탈출 | LOST latch 유지. 실패원인을 cleanup오류로 덮지 않음 |
| FINISHING 유지 | 이미 전송된renew 완료 | 성공ACK로ACTIVE복귀/기한연장 사용 금지. verdict 확정 전 실패는 lostReason에 반영 |
| FINISHING→CLOSED | 진행중IO 정리·완료판정·조건부release | 완료판정 성공 뒤 release오류만으로 callback 재실행/결과변경 안 함 |
| LOST/FINISHING/CLOSED→ACTIVE | 어떤 늦은ACK/재진입 | 금지 |

FINISHING 진입 시 새 public assertActive 작업은 거부한다. 내부 completion check는 별도로 lostReason, 최초deadline, 서버소유권을 확인한 뒤 verdict를 한 번 확정한다. 진행중renew가 있다면 그 결과를 기한 내 정리하고 판정한다. 이후 release 실패는 정리 실패로만 기록한다. callback이 이미 던진 오류를 후속 release 오류로 덮지 않는다.

commit ACK 재확인은 새 업무가 아니므로 LOST/FINISHING을 이유로 이미 commit된 transaction의 재확인을 새 guard로 막지 않는다. 최종 서비스 결과에 LOST를 반영하는 것과 과거 commit을 유지하는 것을 분리한다.

### 14.2 혼합 포트 검출

builder는 `reflectOperations` 옵션으로 raw 또는 CalendarReflectingOperationRepository를 **등록 전에** 선택한다. 등록 이후 wrapper 치환은 거부한다. nested scope는 기존과 병합하지 않는 완전한 새 scope다. builder가 같은 options로 생성한 importPromotion/teamMembers/operations/teamUsers/calendarPersistence/calendarLock/requestActivity 객체와 actual importPromotionCalendar의 참조를 immutable registry에 저장한다. backend 종류, MongoClient **객체 identity**, databaseName, namespace, runtimeToken을 비교한다. URL 문자열에 자격증명을 넣거나 단순 namespace 이름만 비교하지 않는다.

- primary effect의 assertReady는 모든 필수 객체가 registry의 기대 참조와 일치하는지 동기 검사한다. 다른 namespace/client/backend에서 온 객체를 하나라도 끼우면 `CALENDAR_SCOPE_MISMATCH` 안전 오류로 거부한다. 동일 DB라도 별도 builder/client 객체를 섞는 경우 보수적으로 거부한다.
- 외부에서 제공한 opaque port를 caller 선언만으로 같은 backend라고 신뢰하지 않는다. 레거시 synthetic effect는 기존 최소계약 유지하되 이 실제 runtime provenance 보장을 주장하지 않는다.
- 등록된 complete runtime의 혼합/누락은 **withActivity보다 앞**에서 잡는다. builder가 생성한 객체를 내부 WeakMap registry에 등록하고 `runWithDataRepositories`가 등록 포트가 포함된 candidate scope를 ALS 진입/작업 실행 전에 검증한다. requestActivity만 다른 객체로 교체해 실패요청 감사가 엉뚱한 DB에 남는 틈을 막는다. 검증은 참조/불변 binding 대조뿐이며 IO를 하지 않는다.
- 실제 Calendar runtime을 구성하는 registered port가 하나라도 있으면 기대 complete 집합을 검증한다. 서로 다른 runtime의 registered port를 섞거나 PG/opaque port로 한 항목을 치환해도 거부한다. 업무0·mapping/감사0·요청감사0·lease acquire0·Google/OAuth/Slack0·PG fallback0이다. direct 호출은 scope 진입의 직접 거부이며 새 HTTP400으로 포장하지 않는다.
- 기존 unregistered synthetic scopes와 scope없는 PG 경로는 이 새 조립 검증 대상이 아니므로 종전 withActivity/누락포트 동작을 유지한다. 실제 runtime의 effect assertReady도 실행 시점에 다시 검사한다. registry를 테스트에서만 실행되는 helper로 만들거나 기존 guard/auth를 mock해서 통과시키지 않는다.
- nested scopeB가 자체로 완전해도 A lease를 재사용하지 않는다. scope/operation mismatch는 B의 새 business/effect 시작 전에 거부한다.

### 14.3 자기 renewal과 mapping transaction의 충돌 방지

무장애 native 실행에서 callback을 최초 lease보다 길게 유지하고 최소2회 갱신시켜 **반드시 성공**해야 한다. `성공 또는 LOST`는 정상 갱신 테스트의 수락값이 아니다.

같은 handle의 coordination critical section을 직렬화해 renewal이 자기 mapping transaction의 nonce write 뒤에서 5초 timeout으로 실패하지 않도록 한다. mapping DB callback/commit 확인의 CSOT10초 구간과 renewal을 겹쳐 발행하지 않는다. 설치된 driver의 실패 abortTransaction 정리는 별도 timeout을 사용할 수 있으므로 실패 정리까지 mutex 점유가 항상10초 이내라고 주장하지 않는다. 정상 갱신 성공과 실패 정리 시간을 별도로 검증한다. mapping 진입 전에 남은 보수적 lease가 DB10초+coord5초+margin1초(16초) 이하라면 먼저 renewal을 완료한다. renewal 대기는 처음 정한 전체deadline을 늘리지 않는다. 외부 Google 호출 전체를 이 mutex에 넣어 renewal을 막지 않는다. mutex 대기 이후 상태·보수적 lease·최초 전체 deadline을 다시 검사한다. 내부 renewal/guard 함수는 동일 mutex를 재획득하지 않는다. DB10초 deadline은 transaction callback retry마다 초기화하지 않는다. coordination acquire/renew/release는 primary, writeConcern majority+j이며 IO5초를 적용한다. mapping transaction은 snapshot/majority+j/primary다.

다른 client takeover와의 native 경합은 별도 L6이다. 실제故障/기한상실에서 LOST는 허용되지만, 무장애 scheduler·자기 경합 결함을 LOST로 통과시키지 않는다.

## 15. 실패 주입 단계의 고정 규칙

validation §13 F표를 규범으로 사용한다. 같은 Error를 여러 위치에 던진 뒤 'throw면생략/아니면집계'로 적당히 판정하지 않는다. fixture의 오류 위치와 observer가 어떤 함수 경계를 통과했는지를 고정한다.

- 초기 operations/links/teamUsers 전체조회 실패는 backfill 전체 throw: promotion commit 유지, HTTP200/calendar 생략, Google mutation0.
- 각 item의 try 안에 있는 lock acquire·revision·Google·mapping 오류는 item failed: HTTP200/calendar 유지, failedOperations에1. ACL 조회 오류는 기존 catch에서 canWrite 불명으로 계속 시도하며 자체 failedOperations를 올리지 않는다.
- 손실 후 remote effect와 mapping commit의 잔존 여부는 F표의 barrier로 결정한다. 오류만 보고 remote registry를 초기화하거나 mapping을 되돌리지 않는다.
- 새 mapping DB callback은 guard를 검사하지만 commit ACK 확인은 같은 txn의 결과 확인이다. L11b에서는 A mapping이 이미 있으므로 삭제/재생성0이 정답이다.
- response의 error/accessError/detail과 로그는 §16에 따라 안전 표현으로 치환하되 상태코드·숫자·성공필드 유무·메일옵션은 바꾸지 않는다.

## 16. PII 표면: 정상 응답과 저장·로그를 분리

정적 확인된 기존 표면:

| 위치 | 현재 노출 | 이번 추천 보완 |
| --- | --- | --- |
| reflectOperationToCalendar.logSkip / unresolvedNames | 미해결 사람 이름을 join해 warn | `CALENDAR_ATTENDEES_UNRESOLVED` + 인원수 등 비민감 집계. 이름/동적reason 출력0 |
| reflectOperationToCalendar의 복구/실패 로그 | eventId, 원문 Error 객체/stack | 요청 식별과 고정코드/집계만; event/calendar IDs·원문오류0 |
| calendarReverseSync cancelled 경고 | calendarId/eventId | 삭제감지 고정코드/집계, 승인된 skipped DTO는 그대로 |
| applyCalendarReverseSync / refresh / backfill | 원문 error.message, eventId, 동적detail | 안전코드/고정 메시지; 상태/집계/원래 허용된 결과 필드는 유지 |
| notifyCalendarReflectSkip 및 실제 sendSlackDirectMessage 하위 botPost/openDirectMessageChannel | 수신자email·raw오류와 하위catch의 원문 err | 해당 catch까지 고정로그, 기존 조건의 Slack payload/대상선택/재시도·fallback 순서는 유지. 송신함수 전체 mock으로 하위 노출을 숨기지 않음 |
| calendarWriteClient/OAuth 및 API catch | response.text(), error.message, token응답error가 상위로 전달 | 알려진 안전 domain code만 명시 mapping; 나머지 고정 `캘린더 작업을 처리하지 못했습니다.`. 원문body/cause/stack0 |

원칙은 다음 네 채널을 따로 검사하는 것이다.
1. 권한을 통과한 정상 DTO의 company/course/attendee/unresolvedNames/calendarId/eventId 등 기존 업무표시는 승인된 계약이다. promotion blockedReasons도 기존 승인된 결과로 유지한다. 이를 로그에 복사하지 않는다.
2. 저장은 기존 privacy field만 암호화/HMAC하고 감사의 민감 값은 redacted다. 정상 DTO에 보인다고 raw DB 평문을 허용하지 않는다.
3. 로그는 고정 문자열/안전 code/requestId/비민감 count만 사용한다. free-form name/email/eventId/calendarId/Google body/token/stack을 넣지 않는다. operationId도 원천을 내포할 수 있으므로 최소안은 requestId만 사용한다.
4. 실패 응답의 동적 error/accessError/detail은 일반적인 사용자 진단과 원문 전파를 구분한다. 기존에 명시된 안전 오류형/code는 고정 메시지로 변환하고 임의 한국어/허용문구+민감suffix는 generic이다. 다국어 여부나 startsWith로 allowlist를 만들지 않는다. Slack의 승인된 목적상 알림 본문은 합성 transport에서 검증하고 해당 본문을 로그로 남기지 않는다.

원본 oracle의 기존 노출 로그는 별도 캡처해 차이 근거로만 사용한다. 새 실행에서 '원본과 같아야 한다'며 원문 노출을 유지하지 않는다. PG/default 경로에도 touched Calendar 실패표현·로그의 안전화는 적용하며, backend 선택·disabled·메일·HTTP 의미는 유지한다. 이 명시 차이를 baseline 대조의 허용 변경 목록에 기록한다.

## 17. callsite 조립표·Map/scan 계약

| callsite | 현재 조립 | 이번 실행 검증 | 후속 활성화 gate |
| --- | --- | --- | --- |
| promote POST | 기본 PG promotion/effect; explicit Mongo effect는 기존에는 합성 spy | 새 complete runtime으로 실제 backfill→mapping/감사; primary preflight | G0 후 shadow 구현; production backend전환별도 |
| backfill 관리 GET/POST | operations factory + PG link/lock + teamUsers facade | complete scope의 dryRun/apply/ACL/options, scope 선검사 | 실제 admin/예약 env 조립은 별도 |
| forward wrapper | scope override는 그대로 반환; scope없는DB모드는 PG wrapper | builder가 명시 wrapper를 만든 fixture의 create/update/delete/missing/메일; PII로그 | 모든 API/CLI writer 연결·부분scope preflight inventory 완료 전 전역 wrapping 금지 |
| reverse GET/POST | API가 actual planner/apply 직접 호출; PG link/updatedAt/lock | complete scope + native ports + 합성Google + 실제권한; 날짜이동/보상 | direct entrypoint incomplete-scope 선검사 및 예약 inventory 필요 |
| cleanup GET/DELETE | 기존 admin/secret, 서명 claim + PG mapping/lock | complete scope + 실제token/revision/ETag/deleteMatching; 무메일 | 임의scoped 노출전 preflight gate, 실제cleanup 실행은 별도 |
| refresh GET/POST | 기존 admin/secret + PG mapping/lock | complete scope + actualpatch/missing/무메일 | 임의scoped 노출전 preflight gate |
| 원천/관리CLI/전체앱 | 이번에는 변경안함 | rawPG3경계의 직접사용처 inventory와 fallbacktripwire | 운영자격증명/작업예약/백업/health/전환 별도 |

Map 후보: `(calendarId,eventId)`가 non-unique인 여러 link를 반환하는 PG findMany에 orderBy가 없다. 같은 key의 Map 값은 해당 후보 중 하나이며 backend마다 달라도 된다. 테스트는 그룹별 cardinality1, 실제 선택 row가 허용집합 소속, 이후 처리의 operation/date/ref가 그 row와 일관됨을 확인한다. 특정 UUID/정렬을 공통 정답으로 강제하거나 후보밖 행을 허용하지 않는다.

scan: 20,000행/32MiB/15초를 넘으면 fail. 20,001번째나 바이트초과 이후 앞부분만 반환/Map 구성/Google 진행은 금지한다. listAll/findByCalendar/updatedAt 및 조립된 operation 목록 각각의 실제 사용 scan 경로를 검증한다. timestamp ID배치도 숨은 무제한조회로 우회하지 않는다. PG 무제한조회와의 안전한계 차이는 의도된 차이로 기록한다.

H10에서는 같은 fake Google registry를 공유한다. 서로 다른 DB namespace라도 calendarId+operationId+eventDate+previousEventId가 같으면 기존 creation key/409가 공유된다. namespace/lease owner/fence를 event ID seed에 추가하지 않는다. 실제 remote 객체 분리는 calendarId가 다른 경우에만 기대한다.
