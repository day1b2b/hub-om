# 운영 승격 Plan v2

기준: 75125c9644d6c8265fbdae59e5c9d450247170ef. 원본 service 동결 SHA256: 2d98a237b295c973ad0d9c8e12b726989341f390d513aad9ede055045ad73aa9. 이번 단위는 imports promote POST와 업무 반영·명시 Calendar 후처리 경계다. 이후 Calendar/Drive/전체앱 작업은 별도이며 이번 수락 조건에 구현 완료로 끼우지 않는다. validation-v2의 C1~C6을 따른다.

## 1. [Shell] 정확한 경계

- `ImportPromotionRepository.promoteReadyImportRows(importRunId): Promise<ImportPromotionResult>`를 새 scope `importPromotion`에 추가한다. facade의 기존 export와 buildOperationSessionValueData/stableOperationId export는 유지한다.
- 공통 core `promoteImportRows(tx, importRunId, roleRoster)`와 순수 후보·값 변환을 원본에서 추출한다. 원본fixture는 공유core를 쓰지 않는다.
- tx port는 getRun(id)→{sourceType}|null, listUnlinkedSources(runId)→원본source행 배열, findByFingerprint(value)→{id,deletedAt}|null, findByBusinessKey(companyName,courseName,startDate,endDate)→{id}|null, upsertCompany({name,normalizedName})→{id}, upsertCourse({companyId,courseId,name,operationType,revenue,revenueRaw})→{id}, createOperation({courseRecordId,operationId,sourceFingerprint,...원본값})→{id}, restoreOperation(id,원본값), linkSource(sourceId,operationSessionId)다. 이 값은 외부 SRC 식별자가 아니라 OperationSession UUID id다. tx 밖에서 같은 PG/Mongo writer를 중첩 호출하지 않는다.
- PG adapter는 원래 쿼리·upsert/create/update와 transaction 기본을 그대로 사용한다. scope 없는 명단은 기존 Prisma 고정이다. Mongo adapter는 명시 teamMembers로 roster를 읽는다.
- `importPromotionCalendar.backfillMissingCalendarEvents({dryRun:false})`는 totals의 insertedEvents/failedOperations를 반환한다. default adapter는 기존 함수를 호출하고 Mongo는 명시 port만 사용한다. 실제 Google 구현은 다음 Calendar 단위다.
- actual API는 기존 auth 후 try 안에서 importPromotion/teamMembers/importPromotionCalendar를 모두 resolve하고 그 뒤 업무를 시작한다. withActivity의 requestActivity 선검사도 유지한다. scope 밖에서 teamMembers 강제 factory를 선택하는 동작을 새로 만들지 않는다. 누락 port는 업무/Calendar/PG fallback0이다.

## 2. [Core] 원본 업무 알고리즘

run sourceType의 notion 포함 차단, 미연결 원천 전체의 복호화 sheet 한국어→row 순서, validationErrors→OM→LD→기업→과정→시작일→종료일→날짜역순 차단 순서를 보존한다. run없음/미연결없음은 sourceRows0 요약이며 임의404를 만들지 않는다. 201행도 모두 처리하며 UI200제한을 적용하지 않는다.

eligible마다 지문으로 기존운영(삭제포함) 조회→활성 업무키조회→기업/과정 upsert→새운영 create 순서다. 삭제표시 지문일치는 원본 값필드+deletedAt/By만 복원하고 operationId/과정/지문/기타수동필드를 보존한다. 활성일치는 source link만 변경한다. sourceFingerprint 앞12문자가 같아 operationId가 충돌하면 원본처럼 전체실패이며 재이름·자동삭제·새중복정책을 만들지 않는다. 지문없음만 원래 randomID다. 회계: blocked+eligible=sourceRows, created+linkedExisting+revived=eligible. blocked행은미연결로남으므로재요청에서도sourceRows/blocked에포함된다. 업무키findFirst는orderBy없고courseId/sourceTeam/roundNo조건도없다. 여러활성후보가있으면허용후보중하나로연결하고추가생성0이어야하며임의정렬정책을추가하지않는다.

## 3. [Core] Mongo transaction·참조·경쟁

Company/Course/OperationSession/DataImportRun/OperationSourceRecord/ActivityChange와 기존 __counter/restore guard를 사용한다. 업무모델·unique 정책 추가없음. 한 snapshot/majority transaction에 업무와 변경감사를 묶고 source link에는 기존 감사 제외를 유지한다. operation/course/company 필수 참조가 깨진 경우 부분반영 없이 거부한다. 미연결 source가 존재하면 같은 snapshot에서 필수 DataImportRun도 확인한다. 전부 blocked인 source도 부모가 없으면 거부하며, 없는 run과 source가 모두 없는 경우만 원본의 빈 요약을 유지한다. source nullable relation은 원본대로다.

promotion은 predicate 조회 전에 기존 courseNameRestore guard를 쓴다. 같은 guard 참여자는 promotion끼리, 과정명복원, OM확인배정이다. 일반 operation CRUD/관리자 삭제는 이 guard 참여자로 주장하지 않는다.

| 제어한 순서 | 기대 결과 |
| --- | --- |
| 동일run P1 commit→P2 조회 | 전부eligible이면 P2 sourceRows0. mixed/all-blocked면 미연결blocked행·이유를 재평가해 보존하며 추가업무/변경감사0. 성공POST별Calendar1회 |
| 동일run 두 promotion 겹침 | shared guard로 직렬화. 전부eligible이면 후행0, mixed/all-blocked면 blocked잔존·이유유지와추가업무/변경감사0. 성공POST별Calendar1회 |
| 다른run 같은지문 P1 commit→P2 | 한운영에두source연결; 두번째 linkedExisting1 |
| source-only link가활성대상조회→일반softdelete commit→link commit | link가삭제표시운영에연결된최종상태허용(원본PG가능). guard로삭제까지차단했다고주장하지않음 |
| softdelete commit→promotion지문조회 | revived1, 원본값복원; 업무키만일치하고지문없으면삭제건매칭안함 |
| 동일운영restore/수정쓰기겹침 | 같은문서write conflict로전체재조회; 한쪽의동시변경을stale전체replace로잃지않음 |
| 과정명복원과promotion link겹침 | guard선행자commit후후행predicate재조회. 복원된과정참조/새source근거가끊기지않음 |
| 일반create/과정명복원과새course채번경쟁 | 같은__counter와unique의원자적충돌/retry, 중복processSeq0 |

first guard upsert11000과 신규 Company/Course의 정확한 자연키 insert 경합만 최대5회(최초 포함)·남은 예산 내 전체 transaction을 재시도한다. 자연키 경합은 해당 insertOne 위치에서 code11000, 정확한 keyPattern, 삽입 문서와 일치하는 keyValue를 모두 확인한다. _id/operationId/sourceFingerprint/processSeq, 감사 insert, commit 오류는 이 분류에 포함하지 않는다. Course는 방어적 분류이며 실제 경합 도달과 오류 주입 검증을 구분한다. driver의 TransientTransactionError/UnknownCommit retry는 유지한다. 외부효과는 callback 안에서0회다.

### 구현 중 동시성 보완 — 실행 수락 대기

일반 create는 guard 비참여자다. 같은 기업/과정의 신규 insert 경합을 모두 abort하면 원본 PG upsert가 성공하는 서로 다른 날짜의 요청까지 실패할 수 있다. 정확한 자연키 경합에 한해 새 snapshot에서 기존 알고리즘을 재실행한다. 새 중복 정책이나 unique를 추가하지 않는다.

동일 업무키에서는 PG READ COMMITTED의 특정 경합 순서가 운영 두 건을 만들지만 Mongo 재조회는 기존 운영에 연결할 수 있다. 이 경우 생성/연결 건수·source 참조·값·감사 차이를 숨기지 않는다. 동일/다른 날짜와 양쪽 선행자를 제어해 실제 PG 원본의 허용 직렬 실행 결과와 비교한다. 이 시나리오의 겹친 요청에 대한 허용 결과일 뿐 전체 저장소의 직렬화 보장이나 항상 운영 한 건 보장은 아니다. 겹치지 않은 요청의 선후 관계는 유지한다. 실제 결과와 독립 검토로 최종 수락 전까지 이 차이를 미검증으로 표시한다.

## 4. [Core] 값·감사·sequence

원본 Number 변환 후 numeric(14,2)를 `numericMoney`로 표현한다: 1.005→1.01, -1.005→-1.01, 999999999999.994→999999999999.99, 반올림후13정수자리 overflow는전체실패. 유한하지않은입력은원본nullableNumber의null이며임의0변환하지않는다. 날짜/enum/Unicode/공백도원본변환유지.

nullable/list/timestamp/id 외 schema default는 원본에 맞게 명시한다. audit는 PG 원본의 target/action/필드집합/부재null/actor/request를 대조한다. INSERT의 부재→null을 보존하도록 promotion 생성에 complete row의 forceChangedFields를 지정한다. 실제 교차 writer oracle에서 발견한 누락을 보완해 ordinary Mongo writer의 신규 Company/Course/OperationSession에도 같은 처리를 한정 적용한다. UPDATE·동일 원문 재암호화 no-op·다른 writer·공통 helper의 기본 감사 정책은 유지한다. 검증 근거는 pg-race-first의 실패와 pg-race-fixed54다. source모델감사0, actor·변경내용은기존codec으로저장한다.

prepare는명시shadow/high-water와실제최대processSeq로기존counter를준비하고open은미준비counter/guard/index/validator를수리하지않는다. counter=Int32MAX는link-only허용,새course는원자적실패. 일반생성/복원과동일namespace/counter를공유한다. PGnextval은abort/upsert충돌에도번호소비가능, Mongo는txnrollback한다. 따라서 번호열동일성은의도된차이이고정규화는generatedprocessSeq에만제한한다. 유일성·기존최대보존·재시작/highwater·고갈·동시경합은반드시검증한다.

## 5. [Core] 기한·오류·외부 효과의 상태표

Mongo 전체60초는 roster IO 전 performance.now로 시작하고 callback/outer retry에서 재설정하지 않는다. scan은각15초/20k/32MiB, transaction driver timeout은남은예산이다. 명단조회후/각tx읽기쓰기전후/return전예산확인한다. 업무commit이확정된뒤의Calendar/revalidation에는 이DB예산을소급적용하지않는다. 기본PG의기존timeout을임의변경하지않는다. 60초는업무예산과명시시점검사이며roster강제취소나전체POST응답시간보장이아니다. authredirect/wrapper밖scope오류를HTTP400으로일괄변환하지않는다.

| 단계/실패 | 업무·변경감사 | 요청감사/HTTP | Calendar/revalidation |
| --- | --- | --- | --- |
| commit전확정실패 | raw변경0(별도내부counterrollback포함) | 기존best-effort 요청감사400, 고정오류400 | 0/0 |
| commit결과불명으로driver최종실패 | 전체없음또는전체있음;부분반영금지,자동rollback주장금지 | 400, generic; 저장판정과응답분리 | 0/0 |
| ACK확정 | 전체업무·감사commit | 200(ok/result) | 요청당1회/기존4경로각1회 |
| Calendar실패 | 이미commit유지 | 200, calendar필드생략, 고정로그 | 1회시도/기존4경로각1회 |
| revalidation n번째실패 | 이미commit유지 | 원본처럼400,generic. 400이미반영증거가아님을검증/문서화 | Calendar1회, revalidation앞n회시도 |
| 요청감사실패 | 기존업무상태유지 | 기존handler응답유지 | 추가효과0 |

빈요약도ACK후 Calendar를한번호출한다. callback재실행/commitACK재시도 중Calendar0이며확정return뒤한번이다. 새HTTP재요청은새실행이므로sourceRows0이어도Calendar를다시호출한다; 전역once-only아님. 옵션은정확히{dryRun:false}; notify/from/limit을추가하지않는다.

authredirect는기존위치유지. API400오류는정확한Notion차단문구만보존하고나머지는 `반영 요청을 처리하지 못했습니다.`로고정한다. Calendar로그도고정문구로본문/stack를출력하지않는다. 승인된summary.blockedReasons의원문표시는오류예외노출과구분한다.

## 6. [Check/Shell] 검증·완료

C1~C6의실제PG/nativeMongo/actualPOST oracle를완료하고일반/type/lint/build/전체Mongo, 독립실행검토/gap보완,소유합성정리,source/logdigest,macro/coverage/인계를남긴다. 최신dev/총괄fetch후featurecommitpush/총괄FF/원격SHA를확인한다. 이단위완료후다음Calendar등Task를계속하되그기능구현을이번완료로주장하지않는다. 실Google/운영/백업/복원/최종전환은실행하지않는다.

## Changelog

v1의모호한port/예산을고정하고실패상태표와guard비참여writer의허용결과를추가했다. 생성감사·금액·sequence의비교차이를좁게명시했다. Calendar한번의범위를요청단위로한정했고revalidation의원본400과실제commit을분리했다.
