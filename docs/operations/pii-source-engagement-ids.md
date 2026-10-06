# 투입·슬롯 원천 식별자 암호화

## 왜 바꾸는가

`CoachEngagement.sourceEngagementId`와 `CoachEngagementSchedule.sourceEngagementScheduleId`는 계약 시트·삼성 일정 동기화에서 `원천 종류:행 번호:코치 이름:날짜` 형태로 만들어진다. 이름이 들어가므로 기존 inventory의 `operational` 분류는 암호화 제외 승인이 아니었다. 두 필드를 암호화 대상으로 바꿨고, 개인정보 대상은 26개 테이블/127개 필드가 되었다.

## 저장·조회 계약

- 원래 값은 바꾸지 않는다. 앱과 동기화 로직은 기존처럼 평문 식별자를 만들고 비교한다. 저장 계층에서만 AES-GCM 암호문과 `sourceEngagementIdPiiIndex`/`sourceEngagementScheduleIdPiiIndex` HMAC을 쓴다.
- 암호문은 매번 달라지므로 암호문 컬럼의 기존 unique는 원문 중복을 막지 못한다. 원문 중복 방지는 HMAC 컬럼의 unique(PostgreSQL)와 `runtime_unique_*PiiIndex` 인덱스(Mongo)가 담당한다.
- PostgreSQL: `fields.json`의 index 선언으로 Prisma wrapper가 문자열 equality/`in`/`findUnique`/`upsert` 조건을 HMAC 조건으로 바꾼다. 시트 저장소의 `findMatchingEngagement` OR 조건도 그대로 동작한다.
- Mongo: 원문 필드를 직접 조회하던 `findMatchingEngagement`를 HMAC 조회로 바꾸고, 복호화한 값이 입력 source ID와 같거나 기존 겹침 조건을 만족하는지 다시 확인한다. 둘 다 아니면 `PRIVATE_EQUALITY_MISMATCH`로 실패한다.
- 권한 있는 투입 API 응답의 `sourceEngagementId`는 기존 계약대로 복호화된 값을 돌려준다. 저장 문서·companion·감사 diff·오류에는 원문이 없다. 활동 감사는 PostgreSQL trigger와 Mongo 감사 모두 `{ redacted: true }`만 남긴다.

## 적용 전후 상태

| 상태 | 앱 동작 | 도구 동작 |
| --- | --- | --- |
| migration 전, 평문 | 새 코드의 Prisma 조회는 없는 HMAC 컬럼을 읽으려다 실패할 것으로 본다(코드 추론, 별도 실행 검증 없음) | `privacy:migrate --apply`는 companion 컬럼 오류로 해당 batch를 롤백 |
| migration 후, backfill 전 | source ID를 복호화하는 조회만 `Unencrypted personal data`로 실패. 시트 동기화의 매칭 조회는 id만 읽으므로 막히지 않고, HMAC이 NULL이라 기존 투입을 못 찾아 새 암호문 투입을 만들 수 있음 | dry-run이 평문 건수를 보고. 이 사이 새 쓰기는 원문 중복을 DB가 막지 못함 |
| backfill 중단 | 커밋된 200행 batch만 암호화 | 같은 키로 재실행하면 암호화된 행은 검증 후 건너뜀 |
| backfill 완료 | 조회·중복 차단 정상 | 재실행 시 평문 0, 불일치 0, 암호문 불변 |
| enforce 후 | 동일 | 직접 SQL의 평문·HMAC 누락 쓰기를 CHECK 제약이 거부 |

## 배포 전 적용 순서 (운영 미실행)

**서비스 중지와 백업 확인이 필요하다.** `db-write-safety.md`에 따라 백업 여부와 실행 범위를 확인받은 뒤 진행한다.

1. 백업·복원 가능 여부를 확인하고 앱, 계약/삼성/Notion/all 동기화 스케줄러, 수기 투입 쓰기를 멈춘다.
2. 격리 DB에서 migration 전체 순서와 `20260923090000_pii_source_engagement_ids`를 먼저 검증한다.
3. 새 코드를 배포하되 트래픽은 계속 막고 `prisma migrate deploy`로 migration을 적용한다.
4. `npm run privacy:migrate`로 읽기 전용 점검을 한다. `coach_engagements`, `coach_engagement_schedules`의 평문 건수를 확인한다.
5. `npm run privacy:migrate -- --apply --backup-confirmed --maintenance-confirmed`를 실행한다. 원문 중복으로 unique 오류가 나면 해당 batch만 롤백되고 중단된다. 두 행을 원문 출력 없이 담당자가 검토한다. 삭제·병합 정책을 도구가 임의로 정하지 않는다.
6. 모든 테이블의 plaintext/invalidIndexes가 0이 될 때까지 재실행한 뒤 `--enforce`로 제약을 설치한다.
7. 트래픽을 재개하고 계약 시트 dry-run과 재동기화에서 created가 늘지 않는지 확인한다.

3~6 사이에 동기화가 돌면 migration 뒤 새 암호문 행과 기존 평문 행이 같은 원문을 가질 수 있다. 이 경우 5단계가 충돌로 멈춘다. 이 충돌은 격리 PostgreSQL 테스트로 재현했다.

## 복구 계획

- backfill 중단: 같은 키로 5단계를 다시 실행한다. 잘못된 암호화 키는 dry-run부터 실패하고, 잘못된 HMAC 키는 invalidIndexes로 드러나 enforce를 거부한다. 둘 다 쓰기 전에 멈춘다.
- 원문 중복 충돌: 서비스를 멈춘 채 담당자가 두 행을 검토한 뒤 재실행한다.
- 코드 되돌리기: backfill 후 이전 코드는 암호문을 source ID로 읽는다. enforce 전이면 재동기화가 기존 투입을 찾지 못해 중복 투입을 만들 수 있고, enforce 후에는 이전 코드의 평문 쓰기가 CHECK 제약으로 실패한다. 따라서 코드만 되돌리지 않는다. 서비스를 멈추고 암호화 호환 코드를 고치거나, 승인된 변경 전 백업과 해당 코드 버전을 함께 복원한다. 복호화 되돌림 도구는 만들지 않았다.
- migration만 되돌리기: HMAC 컬럼 삭제는 원문 고유성 보호를 없앤다. backfill 이후에는 사용하지 않는다.

## Mongo shadow namespace 처리

- 기존 shadow에는 이전 정책의 평문 source ID와 HMAC 필드 없는 문서가 남을 수 있다. 새 codec은 이런 문서를 필드 누락으로 거부한다.
- `prepareMongoReadStore`/`prepareMongoOperationStore`는 이제 기존 컬렉션에 validator를 덮어쓰기 전과 후에 새 validator 위반 문서를 찾는다. 위반 문서가 있으면 `EXISTING_DOCUMENTS_POLICY_MISMATCH`로 실패하고 문서와 기존 validator를 바꾸지 않는다. 검사와 `collMod` 사이의 쓰기로 위반이 생기면 이전 validator로 되돌린 뒤 실패한다.
- 기존 문서 검사는 모델별 전체 컬렉션 스캔(`maxTimeMS` 60초)이다. 큰 컬렉션은 시간 초과로 준비가 실패할 수 있으며(fail closed) 실제 규모 소요 시간은 미검증이다.
- 처리 방법은 새 namespace 재복사다. PostgreSQL backfill·enforce 뒤 encrypted source mode로 다시 export하고 새 `runId`로 import한다. 기존 namespace는 자동 삭제·수리하지 않는다. 보존·삭제는 별도 승인 대상이다.
- 이전 정책으로 만든 spool 파일은 새 codec의 필드 검증에서 import가 실패한다. 새 정책으로 다시 export한다.
- PostgreSQL의 기존 평문 unique index(`*_source_engagement_id_key` 등)는 암호문 컬럼에 남아 있지만 더 이상 보호 역할을 하지 않는다. 스키마 변경을 최소화하려고 삭제하지 않았다.
- `seed-my-page-sample-data.ts`의 `startsWith` 조건은 암호화 후 최대 20,000행 복호화 스캔으로 동작한다(개발용 seed).

## 검증과 한계

- 격리 PostgreSQL 17: 전체 migration 재생, 스키마 전 backfill 거부, migration 후 dry-run, 유지보수 위반 중복 재현, 200행 batch 부분 커밋과 재시도, 재실행 불변, 암호화/HMAC 키 불일치, enforce 뒤 평문 SQL 거부를 확인했다. 실제 `PrismaCoachSheetSyncRepository`와 계약 workflow로 HMAC 매칭 재동기화(course 변경 시에도 created 0)와 원문 비노출을 확인했다.
- 로컬 MongoDB 8.0.30 replica set: 실제 계약 sync handler로 암호화 저장, HMAC 재동기화, 동일 원문 11000, 저장·감사·로그 원문 비노출, 이전 정책 namespace 거부와 경합 롤백, 실제 shadow importer(`NativeMongoShadowTarget.insertOnly`)로 채운 새 namespace가 prepare·open·HMAC 매칭을 통과하는 것을 확인했다. PG export부터 spool·import 전체 CLI 경로의 실제 규모 재복사는 미실행이다.
- 운영 DB·Atlas·실제 원천·키·배포 설정은 건드리지 않았다. 실제 운영 규모의 backfill 시간과 잠금 영향, 실제 shadow 재복사·복원 리허설은 미검증이다.
- `import-coach-db.ts` 등 직접 SQL CLI는 기존 `assertLegacyStorage`가 암호화 스키마에서 실행을 거부한다.
- 이 작업은 두 필드의 저장 암호화 보완이다. 전체 앱 전환, 브라우저 초안 암호화, 운영 데이터 암호화·이전 완료를 뜻하지 않는다.
