**결론: 기존 codec·감사 helper·트랜잭션 패턴은 재사용할 수 있지만, Course writer 전체를 보호하는 공통 잠금은 없습니다.** 매출 전환에서는 **트랜잭션 안에서 대상과 변경값을 다시 계산**하고, 과정 생성·복원까지 일관성을 보장할지 별도로 결정해야 합니다. 금액 변환은 일반 운영 writer보다 **관리자 편집의 PostgreSQL 호환 반올림 방식**이 원본 동작 보존에 적합합니다.

신뢰도 **높음: 코드 구조 확인**, **중간: 실제 경쟁 실행 결과는 미검증**. 파일 수정·DB 실행·환경 조회·네트워크 접근 없이 조사했습니다. 원천 및 handler 상세 분석은 제외했습니다.

**1. 기존 매출 동기화의 조회·쓰기 계약**

- `courseId != ""`인 Course를 조회한 뒤 애플리케이션에서 ID를 정규화하여 매칭합니다. 활성 회차 존재 여부나 삭제된 회차는 조회 조건에 없습니다. 같은 정규화 ID의 Course 여러 건을 모두 대상으로 삼습니다. [salesRevenueSync.ts:106](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/salesRevenueSync.ts:106)
- 기존 매출을 `Number()`로 바꾸어 비교하고, 다른 행만 쓰기 목록에 넣습니다. **조회·비교는 트랜잭션 밖**, 쓰기는 `id`만 조건으로 `revenue`와 `revenueRaw`를 갱신합니다. 이전 값 조건, 명시적 잠금, 명시적 isolation 설정은 없습니다. 모든 쓰기는 한 트랜잭션이며 timeout 120초/maxWait 10초입니다. [비교:190](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/salesRevenueSync.ts:190), [쓰기:220](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/salesRevenueSync.ts:220)
- 따라서 조회 이후 수동 매출 변경을 덮어쓰거나, 조회 때 `same`이었던 행의 후속 변경을 놓칠 수 있습니다. Mongo에서 **미리 만든 `pendingUpdates`만 재시도해도 이 문제는 남습니다.**
- `partial`은 실제 쓰기를 막습니다. `SalesRevenueSyncLog`는 업무 트랜잭션 뒤에서 별도로 저장하며 실패를 무시합니다. 업무 예외로 먼저 탈출하면 이 후행 로그까지 도달하지 않습니다. [salesRevenueSync.ts:215](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/salesRevenueSync.ts:215), [로그:260](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/salesRevenueSync.ts:260)

**2. 실제 경쟁 writer**

| 경로 | 확인된 쓰기·보호 방식 | 매출 동기화와의 관계 |
|---|---|---|
| `MongoOperationRepository` | 생성 시 기존 Course에도 `revenue/revenueRaw`를 씁니다. 일반 수정에서는 분류·도구 변경 시 Course 전체 교체, 새 과정으로 이동하면 기존 메타데이터 복사. snapshot transaction과 재조회 재시도, 같은 transaction의 감사 사용. 공통 guard 없음. | 같은 Course 쓰기는 충돌·재시도로 조정 가능. 새 Course로 매출을 복사하는 경로는 원본 Course를 읽기만 할 수 있어 별도 위험. |
| `MongoAdminDatabaseRepository` | Course 매출·이름·코스ID 셀 편집 가능. transaction 안에서 최신 행을 읽고 수정 필드와 `updatedAt`만 `$set`; 감사도 함께 저장. 공통 guard 없음. | 직접 매출 경쟁 및 매칭 대상 변경 writer. 매출 편집은 `revenueRaw`를 함께 바꾸지 않으므로 두 값의 상시 일치는 기존 계약이 아님. |
| `MongoCourseAdminRepository` | Course는 조회만 하고 해당 활성 `OperationSession`을 soft-delete. 회차별 조건부 갱신·감사·transaction 사용. | **직접 Course 매출 writer가 아님.** 동기화에 활성 회차 조건을 새로 넣지 않는 한 이 경로 때문에 매출 잠금을 확대할 필요 없음. |
| `MongoCourseNameRestoreRepository` | 전용 singleton guard를 먼저 쓰고 계획 재조회·snapshot 비교. 새 Course에 매출·raw 복사, 회차 이동, counter·감사를 원자적으로 저장. 기존 대상 Course 메타데이터는 유지. | guard는 복원끼리만 공유. 매출 동기화나 일반 Course writer를 현재 보호하지 않음. |

근거:

- 운영 writer: [transaction·전체 교체:34](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoOperationRepository.ts:34), [생성 매출 쓰기:185](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoOperationRepository.ts:185), [과정 복사·수정:202](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoOperationRepository.ts:202)
- 관리자 편집: [transaction:71](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoAdminDatabaseRepository.ts:71), [부분 갱신·감사:203](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoAdminDatabaseRepository.ts:203)
- 과정 삭제: [mongoCourseAdminRepository.ts:94](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoCourseAdminRepository.ts:94)
- 과정명 복원: [guard 선행:80](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoCourseNameRestoreRepository.ts:80), [생성·이동:233](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoCourseNameRestoreRepository.ts:233), [guard 구현:31](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoCourseNameRestoreGuard.ts:31)

**3. 조건별 동시성 위험과 설계 선택**

**같은 Course를 서로 수정하는 경우:** 동기화가 transaction 안에서 읽고, 변경을 다시 계산하고, 같은 session으로 쓰면 기존 writer의 충돌 재시도 패턴을 활용할 수 있습니다. 다만 이는 수동 입력 우선권을 보장하지 않습니다. 충돌 후 동기화가 최신 수동 값을 다시 덮어쓰는 것이 허용되는지는 업무 정책입니다.

**복원·일반 편집이 새 Course를 생성하는 경우:** 다음 경쟁은 같은 문서 쓰기 충돌만으로 막히지 않습니다.

1. 복원/과정 이동이 원본 Course의 이전 매출을 읽음.
2. 동기화가 원본 Course의 매출을 변경함.
3. 복원/과정 이동이 별도 Course에 이전 매출을 복사하여 생성함.

복원의 snapshot 검증도 **그 transaction이 읽은 상태**를 검증하므로 이후 원본 Course 변경까지 잠그지 않습니다. 복원 지문에는 Course 데이터가 포함되어, 적용 전에 이미 보이는 매출 변경은 감지할 수 있습니다. [지문:188](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoCourseNameRestoreRepository.ts:188)

두 현실적인 대안은 다음과 같습니다.

| 대안 | 장점·비용 | 남는 위험 |
|---|---|---|
| **최소 전환: snapshot 재조회 + 부분 갱신 + 원자적 감사** | 기존 경쟁 writer 수정이 적음. 같은 문서 충돌과 오래된 쓰기 목록 문제 해결 | 동시에 추가되거나 매칭 범위로 이동한 Course 누락, 이전 매출 복사 가능. 다음 동기화 보정 또는 해당 작업 중단 조건 필요 |
| **관련 writer가 공통 guard 참여** | 매칭 범위 변경·복사까지 직렬화 가능 | 일반 과정 생성/복사, 관리자 코스ID 변경, 복원 등 참여 범위 확대. singleton은 무관한 과정까지 대기시킴 |

**권장:** 현재 요청의 최소 전환에는 첫 번째 설계를 사용하되, “동시 생성까지 즉시 일관”을 완료 조건으로 삼는다면 두 번째가 필요합니다. 동기화만 새 lock을 갖거나 복원 guard만 재사용해서는 일반 운영 writer까지 해결되지 않습니다. `Course.processSeq` counter를 잠금용으로 소비하는 방식도 피해야 합니다.

**4. 감사 helper 재사용**

`SalesRevenueSyncLog`만 옮기면 감사가 빠집니다. 기존 Prisma client에는 activity wrapper가 있고, transaction에 context를 설치하며 Course trigger가 변경 감사를 남깁니다. [prisma.ts:25](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/prisma.ts:25), [activity/database.ts:29](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/activity/database.ts:29), [Course trigger:73](/Users/ga/workspace/hub-om-mongodb-coach-content/prisma/migrations/20260907090000_activity_logs/migration.sql:73)

Mongo에서는 다음을 재사용하면 됩니다.

- `operationAuditRow("Course", before, after)` → codec 인코딩 → **Course 변경과 같은 session에서** `ActivityChange` 삽입.
- context가 없으면 helper는 `null`을 반환합니다. `actorEmail` 인자만 전달해도 감사가 생기는 구조가 아닙니다.
- `revenue`는 before/after 값 기록 대상이고, `revenueRaw`는 변경 시 가림 처리됩니다. `updatedAt`만 바뀐 경우 감사에서 제외됩니다.
- 후행 동기화 요약 로그의 실패 허용과 업무 변경 감사의 실패 시 rollback은 구분해야 합니다.

근거: [mongoOperationAudit.ts:7](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoOperationAudit.ts:7), [context·변경 비교:44](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoOperationAudit.ts:44)

**5. decimal 도우미와 최소 구현 권장**

| 기존 도우미 | 동작 | 재사용 판단 |
|---|---|---|
| 운영 repository의 `money()` | 유한 number, 정수 12자리·소수 2자리까지만 허용. 초과 소수 거절 | 원본 PG 반올림 보존 목적에는 부적합 |
| 관리자 repository의 `numericMoney()` | number의 문자열 표현을 BigInt 기반으로 소수 2자리 반올림. 지수 표기·음수 half tie·반올림 후 overflow 처리 | **공통 helper로 추출하여 재사용 권장** |
| codec 내부 `decimal()` | 정확한 문자열만 허용·2자리 정규화, BSON Decimal128 변환 | 저장 검증용. number 반올림을 대신하지 않음 |

세 함수 모두 현재 파일 내부 함수입니다. 바로 import할 수 있는 공통 money 변환 helper는 확인되지 않았습니다. [money:15](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoOperationRepository.ts:15), [numericMoney:32](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoAdminDatabaseRepository.ts:32), [codec:39](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoRuntimeCodec.ts:39)

최소 구현은 다음 순서가 적합합니다.

1. 재시도 callback 안에서 Course 대상 조회·비교·변경 목록·결과 카운트를 다시 계산합니다.
2. 전체 논리 행으로 codec 검증 후 **`revenue`, `revenueRaw`, `updatedAt`만 부분 저장**합니다. `revenueRaw = String(입력값)`이라는 기존 의미를 유지합니다.
3. 변경 감사는 같은 transaction, 실행 요약 로그는 기존처럼 별도 실패 허용 경계로 둡니다.
4. 원본의 **반올림 전 number 비교**를 canonical decimal 비교로 바꾸면 반복 적용의 `changed/unchanged` 의미가 달라지므로 별도 변경으로 취급합니다.
5. ID 정규화 매칭을 단순 `$in`으로 바꾸지 않습니다. 복원 repository의 bounded ID projection scan을 참고하고, 필요한 Course/Company 전체 행만 codec으로 읽습니다. [기존 스캔 패턴:111](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoCourseNameRestoreRepository.ts:111)
6. 재시도 전체 deadline을 둡니다. 기존 `MongoOperationRepository`는 외부 11000 재시도마다 30초 설정을 새로 적용하므로 전체 30초 예산으로 그대로 인용하면 안 됩니다. 복원 repository의 외부 deadline 패턴이 더 적합합니다.

후속 검증 우선순위는 **실제 운영 writer·관리자 매출 편집과의 경합, 복원의 새 Course 생성 경쟁, 감사 실패 시 전체 rollback, ±1.005·overflow·null/0 금액 계약**입니다. 이번 감사에서는 테스트를 실행하지 않았습니다.
