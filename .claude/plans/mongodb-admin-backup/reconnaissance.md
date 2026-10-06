**최소 다음 범위는 기존 backup POST의 조회를 전용 repository로 분리하고, PG 기본값·명시 Mongo scope를 연결하는 것입니다.** `archiveSnapshots`를 위한 새 모델은 필요 없습니다. 코드만 확인했으며 파일 변경·DB·테스트 실행은 없었습니다. 현재 브랜치는 `feature/20260930-mongodb-admin-backup`입니다.

**보존해야 할 현재 계약**

- 인증은 정확한 `BACKUP_API_SECRET` Bearer 또는 `assertCoachPiiAccess()`입니다. 후자는 workspace 소속이면서 `ADMIN_EMAILS`에 포함된 실제 세션을 요구합니다. proxy에도 backup Bearer 허용이 있습니다. [route](/Users/ga/workspace/hub-om-mongodb-coach-content/src/app/api/admin/backup/route.ts:8), [proxy 인증](/Users/ga/workspace/hub-om-mongodb-coach-content/src/auth.ts:81)
- 코치 관련 **11개 모델 전체 행**과 archive snapshot **최근 20건·6개 필드**를 반환합니다. snapshot은 상태 필터 없이 `started_at DESC`이며 동률 보조 정렬은 없습니다. soft-delete 제외나 관계별 필터도 없습니다.
- 응답은 `exportedAt/counts/data`, JSON attachment와 기존 파일명입니다. `withActivity`의 요청 감사·`X-Request-Id`도 유지 대상이므로 명시 scope에는 `requestActivity`가 필요합니다. [조회·응답](/Users/ga/workspace/hub-om-mongodb-coach-content/src/app/api/admin/backup/route.ts:28), [감사 wrapper](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/activity/request.ts:45)
- 11개 Prisma 조회는 개인정보를 복호화하고 암호화 보조 필드를 제거합니다. Mongo decoder는 보조 필드를 남기므로 **decode 결과를 그대로 JSON 반환하면 계약 위반**입니다. [PG 제거](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/privacy/database.ts:99), [Mongo decode](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoRuntimeCodec.ts:177)

**이미 있는 기반과 재사용 한계**

| 기반 | 재사용 가능 | 그대로 대체하면 안 되는 부분 |
|---|---|---|
| Mongo 35모델 계약·codec | 필요한 12모델 모두 포함, 암호화/BSON/HMAC 기반 | 모델 지원이 backup 응답 동등성을 증명하지는 않음 |
| Coach archive reader | snapshot·archive row의 실제 읽기 패턴 | `completed`만 고르는 기존 reader는 backup의 모든 상태 최근20 계약과 다름 |
| Drive history reader | 누적 예산·singleBatch·pending timeout·유한 cleanup 패턴 | 제한값과 단일 snapshot 보장은 backup에 자동 승계할 계약이 아님 |
| 관리자 handler 검증 | 실제 권한·request audit·명시 scope·native 저장 패턴 | backup의 전체 DTO와 secret 경로는 새 검증 필요 |

근거: [snapshot 계약](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoRuntimeContracts.json:4081), [35모델 대조 테스트](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoRuntimeCodec.test.ts:31), [archive reader](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoCoachRepository.ts:58), [bounded reader](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoDriveImportHistoryRepository.ts:64), [handler 검증 패턴](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoAdminDatabaseHandlers.integration.test.ts:1).

**착수 전에 확정할 실제 차이**

1. **전체 내보내기와 scan 제한:** 현재 무조건 `findMany()`에는 전체 요청 20k/32MiB/60초 제한이 없습니다. 기존 Mongo scan을 단순 연결하면 큰 백업이 새로 실패합니다. 요청 누적/모델별 한도와 초과 시 전체 실패를 명시적으로 합의해야 하며, 조용한 잘라내기는 기존 계약과 맞지 않습니다.
2. **snapshot 메타데이터의 검증 범위:** PG raw SQL은 6개 필드만 읽고 `error_message`를 복호화하지 않습니다. Mongo에서 전체 문서를 decode하면 반환하지 않는 암호문의 손상까지 새 실패 원인이 됩니다. 선택한 6필드 검증으로 보존할지, 전체 인증 실패를 허용 차이로 둘지 결정이 필요합니다.
3. **일관성·오류 정책:** 현재 `Promise.all`은 단일 시점 보장이 없고 route 자체 catch도 없습니다. 단일 snapshot이나 고정 공개 오류를 도입한다면 명시적 변경으로 기록해야 합니다. 동일 시각 snapshot의 새 tie-breaker도 원본 계약인 것처럼 추가하면 안 됩니다.

**대안 비교와 권고**

- **전용 backup reader 추출:** 변경·검증 범위가 작고 기존 다운로드 계약을 직접 보존할 수 있습니다. 권고안입니다.
- **기존 35모델 shadow snapshot/export 사용:** 일관된 이전용 산출물에는 적합하지만 전체 모델·sequence·manifest·암호화 파일 형식까지 포함해 범위와 응답이 달라집니다. 이번 endpoint 대체에는 과합니다. [기존 export](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/migration/postgresShadowExport.ts:45)

새 검증은 frozen PG/current PG/native의 전체 응답 대조, 권한 분기, 숨김 필드·JSON/null/date 직렬화, 최근20·모든 상태, 감사 및 실패 시 부분 응답 없음에 집중하면 됩니다. 이 endpoint에는 archive 원문·전체 앱 데이터·복원 기능이 없으므로 **운영 전체 백업/복원 완료 증거로 확대하지 않는 것**이 정확합니다.
