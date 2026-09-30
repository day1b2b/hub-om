**activity prune 이후 최소 구현 범위는 ‘코치 공개 조회 factory의 명시 scope 연결 → 실제 페이지 검증’입니다.** 기존 Mongo 조회 구현은 재사용하고, snapshot 개인정보 분류 검토는 병행하는 순서를 권합니다.

최신 [coverage](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/mongodb-runtime-coverage.md:258)·[macro](/Users/ga/workspace/hub-om-mongodb-coach-content/.claude/plans/mongodb-read-repositories/macro-plan.md:178)의 완료 기록은 관리자 백업까지입니다. activity prune 이후 순서는 아직 기록되지 않았습니다.

| 후보 | 실제 남은 근거·최소 범위 | 계약 함정·승인 |
|---|---|---|
| **1. 코치 공개 조회 조립 — 우선 권고** | [factory](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/coachRepositoryFactory.ts:4)는 Prisma 고정이고 context에도 공개 코치 포트가 없습니다. [코치 목록 페이지](/Users/ga/workspace/hub-om-mongodb-coach-content/src/app/coaches/page.tsx:15), 상세·일정·강사 위키·운영 상세가 실제 호출합니다. 기존 [MongoCoachRepository](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoCoachRepository.ts:11)를 scope/factory에 연결하고 해당 페이지 흐름을 검증하는 범위가 작고 구체적입니다. | 기본 PG·기존 권한·DTO 유지. 명시 scope의 포트 누락은 PG fallback 금지. 페이지가 오류를 잡아 `loadFailed`로 바꾸므로 화면 결과만 보지 말고 금지 PG 호출도 관찰해야 합니다. **격리 구현·합성 검증에는 운영 승인 불필요**, 생산 backend 변경은 별도입니다. |
| **2. Drive snapshot 개인정보 분류 — 필수 보안 검토** | [inventory](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/privacy/inventory.json:98)의 `companyName/courseName`은 operational이고 보호 registry에 없습니다. [writer](/Users/ga/workspace/hub-om-mongodb-coach-content/src/lib/data/mongoDriveImportWriterRepository.ts:151)가 저장하고 [이력 페이지](/Users/ga/workspace/hub-om-mongodb-coach-content/src/app/drive-import-runs/page.tsx:18)가 읽습니다. 두 필드의 원천→저장→조회→export 경로와 분류 근거를 확정하는 것이 최소 선행 범위입니다. | [remaining 문서](/Users/ga/workspace/hub-om-mongodb-coach-content/docs/operations/mongodb-cutover-remaining.md:45)가 명시한 차단 항목입니다. 현행 operational을 암호화 제외 승인으로 간주하면 안 됩니다. 보호 필요 시 기존 codec·PG wrapper·이관 호환성을 함께 다뤄야 합니다. 분류 조사에는 운영 접근 불필요하나 **정책 확정은 책임자 검토**, 실제 backfill은 별도 승인 대상입니다. |
| **3. 예약 알림 한 경로의 실행 조립 — 후순위** | [알림 POST](/Users/ga/workspace/hub-om-mongodb-coach-content/src/app/api/reminders/lecture-followup/route.ts:9)에 Coolify 호출 용도가 명시되어 있습니다. 실제 흐름은 operations·teamUsers 조회, 요청 감사, 로컬 발송 이력, Slack 발송입니다. 이 경로 하나의 저장소 묶음과 합성 발송 경계를 연결할 수 있습니다. | 실제 설치된 스케줄은 확인하지 않았습니다. 날짜·발송 상한·중복 방지 이력을 보존해야 하므로 1번보다 큽니다. Calendar repository를 다시 만들 범위는 아닙니다. 격리 검증은 가능하지만 **실제 발송·스케줄 등록/변경은 별도 승인**이 필요합니다. |

**전체 앱·CLI·배포는 다음처럼 구분해야 합니다.**

- 전체 앱에는 아직 생산 요청을 감싸는 공통 저장소 조립 진입점이 없습니다. 1번은 그 선행 연결 작업이며 전체 앱 전환 완료를 뜻하지 않습니다.
- Drive writer·토큰 보완·activity prune은 완료 또는 현재 작업 경계입니다. 다른 npm backfill/import 항목은 **등록만으로 활성 사용을 입증하지 못하므로**, 다음 구현 후보로 승격하거나 영구 제외하지 않았습니다.
- [Docker 진입점](/Users/ga/workspace/hub-om-mongodb-coach-content/scripts/docker-entrypoint.sh:4)의 조건부 Prisma migration은 실제 배포 의존입니다. backend 구성과 migration 실행 조건을 함께 설계해야 하며, 독립적으로 제거할 대상은 아닙니다. 격리 기동 검증과 실제 배포 승인을 분리해야 합니다.

파일·환경값 변경, 외부 접근, DB·런타임 실행 없이 조사했습니다.
