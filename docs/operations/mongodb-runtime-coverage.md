# MongoDB 전환 범위와 남은 PostgreSQL 의존성

최초 전체 경로 조사: `7ebb24f` 이후 코치 투입·평가 경계, 2026-09-22. 이후 시트·Notion 작업의 변경 경계를 표와 후속 기록에 누적 반영했다. `src`의 테스트 외 소스에서 실제 연결 생성·Prisma delegate 호출·raw SQL·repository factory와 간접 호출을 읽어 구분했다. 이 문서는 코드 경로 조사이며 운영 DB 접속이나 운영 데이터 검증 결과가 아니다. 아래 진행 상태는 이 기준 시점의 기록이다.

**35개 모델의 복사/codec 지원은 앱 전체 전환 완료를 의미하지 않는다. 생산 factory와 직접 API는 여전히 PostgreSQL을 사용한다.** 기존 Mongo 구현은 별도 shadow DB/namespace에서 직접 여는 병렬 검증용이다. 환경변수 이름만 바꾸거나 기존 factory 몇 개를 바꾸는 것으로 아래 직접·간접 경로가 함께 전환되지 않는다.

## 이미 구현한 병렬 경로와 이번 작업

| 기능 | Mongo 구현 상태 | 생산 연결 상태 |
| --- | --- | --- |
| 운영 목록·상세·생성·수정·soft-delete·과정 검색·요약 | `MongoOperationRepository` 구현·합성 검증. Company/Course/CourseIdLabel/OperationSession/OperationSourceRecord/TeamUser/ActivityChange 사용 | `operationRepositoryFactory.ts`는 명시 operations context 우선, 밖에서는 `CalendarReflectingOperationRepository(new PrismaOperationRepository())` 유지. Mongo 감사 쓰기가 전역 활동 기록을 대체하지 않음 |
| 코치 공개 조회 6개·개인정보 조회 2개 | `MongoCoachRepository`, `MongoCoachPrivateRepository` 구현·합성 검증. 분야/커리큘럼/일정/예약/archive 관계 포함 | 공개 coach factory도 명시 `coach` context를 우선하고 기본은 Prisma다. 코치·위키·운영 상세 7개 실제 page의 권한·오류·DTO를 native Mongo로 검증했다. private/token 경계와 생산 기본 PG는 유지 |
| Member/TeamUser 기반 명단 조회 | `MongoTeamMemberRepository` 구현·합성 검증 | stored factory는 명시 teamMembers context 우선, 밖에서는 local/Prisma 유지. 일반 factory의 Notion 정책은 별도 |
| InstructorNote 조회·쓰기 | shadow 구현과 Mongo8.0.30 실제 save handler 검증 완료 | factory는 명시 context 우선, 기본 local/Prisma 유지. Notion sync는 별도 명시 원천/저장 경계로 연결 |
| Coach CRUD | shadow 구현과 Mongo8.0.30 관리 API 경계 검증 완료. 업무/ActivityChange 실패 rollback 확인 | 두 관리 API는 repository 호출로 변경. 명시 context 외 기본 PG 유지. 일정/섭외/마스터·토큰·복원은 별도 |
| TeamUser 생성·팀/역할 수정 | shadow 구현과 Mongo8.0.30 합성 검증 완료. guard 중복 경쟁·감사 실패 rollback 확인. 물리삭제는 정책 충돌로 차단 | 기존 export 함수는 context 우선 facade. 기본 legacy PG/local 유지. 모든 writer의 guard 참여 필요 |
| 코치 월간 일정·예약 | `MongoCoachScheduleRepository` 및 실제handler 합성검증 경계. 월 교체/접근 로그/예약 선점·자기취소, active unique·transaction·암호화·감사 | 지정 3개 API는 context 우선/기본 Prisma. 투입·시트·Notion writer와 coach guard 공유 |
| 코치 투입·평가 | `MongoCoachEngagementRepository`, 슬롯 교체·예약 자동취소·평가 이력 원자화와 공통 scheduling guard | 3개 API context 경계/기본 PG. contract/Samsung/Notion도 catalog→coach guard 참여, 생산 전환은 별도 |
| 과정명 복원 미리보기·선택 적용 | `MongoCourseNameRestoreRepository`, 원천 근거·계획 재검증·부분 이동·원자적 감사, 내부 복원 guard | 기존 service/API는 명시 courseNameRestore context·기본PG 유지. [경계·검증 상태](mongodb-course-name-restore.md) |
| 관리자 현장 투입·OM 상태 보정 | `MongoOperationBackfillRepository`, 기존 count/apply 조건·HMAC 후보 확인·부분 갱신·원자적 감사 | 두 admin backfill API는 명시 operationBackfill context/기본PG 경계. [경계·검증 상태](mongodb-operation-backfill.md). 실제 운영 보정·legacy CLI·호스트 페이지는 별도 |
| 삭제된 운영 건 목록·복원 | `MongoDeletedOperationRepository`, 기존 목록 DTO·exact 운영ID·반복복원 시각·감사 계약 및 일반writer 경합 검증 | admin/deleted-operations GET/PUT는 명시 deletedOperations context/기본PG 유지. [경계·한계](mongodb-deleted-operations.md) |
| 관리자 과정 조회·일괄 소프트 삭제 | `MongoCourseAdminRepository`, 기존 과정 조회·활성 운영 건 삭제 및 원자적 감사·경합 검증 | 두 admin/courses API는 명시 courseAdmin context/기본PG 유지. Course와 관계 문서는 삭제하지 않음. [경계·한계](mongodb-course-admin.md) |
| 담당자 내 페이지 | `MongoCoachManagerMyPageRepository`, 기존 활성 예약·확정 과정 조건과 메서드별 snapshot 검증 | `coachMyPage.ts` facade의 명시 `coachManagerMyPage` context만 Mongo. 기본 PG·기존 admin guard 유지. [경계·한계](mongodb-manager-my-page.md) |
| 코치 접근 토큰 보완 | `MongoCoachTokenBackfillRepository`, 최신 non-null archive token·paging·dry-run·apply/rollback·재실행 경계 | CLI 기본 PG, 명시 `coachTokenBackfill` context만 Mongo. 운영 적용은 별도 maintenance/백업 확인 필요. [경계·한계](mongodb-coach-token-backfill.md) |
| 관리자 DB 조회·허용 셀 편집 | `MongoAdminDatabaseRepository`, snapshot 8표/100행·4표 부분 갱신·원자적 감사·PG 의미 대조 | 기존 dashboard/API는 명시 adminDatabase, 페이지 명단은 stored teamMembers context. 기본 PG 유지. [경계·검증 상태](mongodb-admin-database.md) |
| 공지·첨부 | `MongoAnnouncementRepository`, 분리 암호화 bytes·부분쓰기·원자적 감사·최대 5×5MiB·PG 대조 | 6개 API handler/3개 조회 page는 명시 announcements context, 기본 PG 유지. [경계·검증 상태](mongodb-announcements.md) |
| 활동 관리 조회·피드·사용 통계 | `MongoActivityReadRepository`, 원본 PG 대조·검색/집계·legacy/이름 표시·snapshot·손상 차단 | 세 GET는 명시 activityReads context/기본 PG. [경계·한계](mongodb-activity-reads.md). 감사 쓰기/보존 정책과 전체 앱 연결은 별도 |
| 강사 Notion 동기화 | 기존 `MongoInstructorNoteRepository`의 행 재매칭·암호화·원자적 감사, 원본 PG 대조·실 manual 경합 검증 | 실제 GET/POST는 명시 instructorNotionSync/instructorNotionSource/requestActivity 경계, 기본 PG·기존 권한 유지. [경계·한계](mongodb-instructor-notion-sync.md) |
| 매출 동기화 | `MongoSalesRevenueSyncRepository`, 원본 PG 금액·다중 딜·partial·재실행 대조, 일괄 업무/변경 감사 및 실제 writer 경합 검증 | 실제 GET/POST는 salesRevenueSync/source/notifier/requestActivity 명시 경계, 기본PG 유지. [경계·한계](mongodb-sales-revenue-sync.md). 최종 검증·통합은 해당 실행 기록 |
| OM 요청 접수·조회·수정·삭제 | `MongoOmRequestRepository`, 기존 부분 성공 접수·회차 연결, 입력 부분 갱신·원자적 감사·명시 합성 부수 작업 | 기본PG/local 유지. 확인 후 전체 배정은 별도 명시 omAssignment 경계에서 구현·합성 검증했다. [경계·검증 상태](mongodb-om-requests.md) |
| OM 전체 회차 배정·변경·취소 | `MongoOmAssignmentRepository`, 기존 확인 토큰·생성 집합·원자적 감사와 과정명 복원 guard 공유 | 명시 omAssignment/operations/teamUsers/calendar/notifier 경계 구현·합성 검증·독립 검토. 원격 통합 상태는 해당 integration-review 기준. 기본 PG 유지. [경계·검증 상태](mongodb-om-assignment.md) |
| 파일 업로드·임시 저장·검토 | `MongoImportRepository`, 원본 PG 대조·복호화 정렬·중복/오류 보존·동시 요청·암호화·원자성 검증 | upload API와 목록/상세 page는 명시 imports context, 기본 PG 유지. 최종 회귀·수락·통합은 해당 실행 기록 기준. 승격·실원천·Drive는 별도. [경계·한계](mongodb-import-staging.md) |
| 가져오기 운영 반영 | `MongoImportPromotionRepository` 구현·원본 PG54/native 저장60/API22 검증·독립 코드 수락 | 명시 importPromotion/teamMembers/importPromotionCalendar/requestActivity, 기본 PG. 일반922/71skip, Mongo파일별최종833. 원격 통합은 실행 기록 기준. [경계·한계](mongodb-import-promotion.md) |
| Google Sheets 탭 조회·가져오기 | 전용 합성 원천 port와 기존 MongoImportRepository, 원본PG/현재PG/native 전체결과 및 경합 대조 | 두 POST는 명시 googleSheetsImportSource/imports/명단/requestActivity, 기본PG·기존HTTP 유지. 실제Google/OAuth/UI활성화는 별도. [경계·한계](mongodb-google-sheets-import.md) |
| Notion 가져오기 API | 전용 명시 source와 기존 MongoImportRepository, 실제HTTP·원본PG/현재PG/native whole 결과·경합 대조 | POST는 명시 notionImportSource/imports/명단/requestActivity, 기본PG·서버공유token·기존reader 유지. 실Notion/OAuth/UI활성화는 별도. [경계·한계](mongodb-notion-import.md) |
| Drive CLI 이력 쓰기 | `MongoDriveImportWriterRepository`와 기존 scanner/워크플로우 명시 경계, 원본 PG/current PG/native·실제 합성 HTTP·장애·재시도·A/B 검증 | 기본은 encrypted PG, 명시 driveImportWriter/driveImportSource context만 Mongo 사용. 실제 원천/운영 실행은 별도. [경계·한계](mongodb-drive-import-writer.md) |
| 전체 모델 암호화 snapshot export/import | 35개 모델 codec·일관된 PG 읽기 snapshot·사본 대조·참조 검증 지원 | 운영 서비스 선택·실시간 변경 동기화·최종 freeze/cutover·복구 승인은 별도 |

## 남은 기능군별 실제 경로

경로는 저장소 상대 경로다. 모델에는 직접 delegate 및 관계/보조 저장소를 통한 의존성을 함께 적었다.

| 기능군 | 실제 PostgreSQL 진입점·연결 경로 | 모델·PG 기능 | 남은 전환 범위 |
| --- | --- | --- | --- |
| 공통 연결·암호화 | `src/lib/data/prisma.ts` → `PrismaPg` → `withPrivacyDatabase` → `withActivityDatabase` | 전 모델; SQL transaction·Prisma 확장 | 생산 선택과 오류·암복호화·transaction 계약 전환. 타입 이름 제거 작업과 구분 |
| 운영·과정의 별도 관리자 기능 | `api/admin/courses/lookup`, `api/admin/courses/[courseId]`, `api/admin/deleted-operations`, `api/admin/onsite-required-backfill`, `api/admin/om-assignment-status-backfill`, `lib/data/courseNameRestore.ts` | Company, Course, OperationSession, OperationSourceRecord, 활동 감사 | admin/courses 두 API는 2026-09-29 명시 context/기본PG adapter로 연결. 삭제 운영 목록/복원도 명시 deletedOperations context/기본PG 경계에 연결. onsite·배정 보정 두 API도 명시 operationBackfill context/기본PG 경계에 연결. 과정명 복원도 명시 courseNameRestore context/기본PG 경계로 분리. DB dashboard/cell도 명시 adminDatabase context에 연결. 관리자 백업/health 등 나머지 경계는 미전환 |
| OM 접수·배정·권한 | `lib/data/omRequest/omRequestLocalRepository.ts`, `omRequestAssignment.ts`, `lib/auth/omRequestAssignmentAccess.ts` → `listTeamUsers()` | OmRequest, OperationSession, TeamUser, ActivityChange | 접수·조회·수정·삭제는 명시 omRequests/operations/customTools/notifier 경계 구현·검증·독립수락·총괄 통합 완료(제품908175b, 인계 기록 기준). 기본PG/local 유지. 배정 토큰·전체 회차 원자성은 별도 명시 omAssignment로 구현하고 실제 PG/Mongo 대조·동시 writer 검증을 완료했다. 최종 수락·통합 여부는 mongodb-om-assignment 실행 기록을 따른다. 확인 없는 legacy helper 둘은 계속 차단 |
| 팀 사용자 관리 | `lib/data/teamUsers/teamUserRepository.ts` → 기본 `legacyTeamUserRepository.ts` → TeamUser delegate | TeamUser; local JSON은 개발 분기 | 명단/권한 호출부는 facade를 유지하며 context 주입 검증. 생산 선택과 전체 writer 일치 필요. Member 조회는 별도 |
| 코치 CRUD·태그 마스터 | `api/coaches`, `api/coaches/[id]`, `api/coaches/[id]/regenerate-token`, `api/master/fields`, `api/master/curriculums`, `api/admin/deleted-coaches` | Coach, CoachPrivateProfile, CoachField/Curriculum, 두 Master | 두 CRUD API는 context/기본 Prisma adapter로 연결. 토큰 재발급도 context 경계 연결. 태그 마스터·삭제 코치 목록/복원/영구삭제도 2026-09-23 context/기본 Prisma adapter로 연결([경계](mongodb-coach-admin.md)) |
| 코치 인증·본인 페이지·개인정보 열람 | `lib/coaches/coachTokenAuth.ts`, `lib/data/coachMyPage.ts`, `coachPrivateAccess.ts`, `coachTokenBackfillCommand.ts`, `api/coach/me`, `api/coaches/export` | Coach, CoachPrivateProfile, CoachPrivateAccessLog, CoachdbArchiveRow/Snapshot, 예약·섭외·TeamUser | 토큰 lookup/본인 API/export·manager coachMyPage는 명시context 연결 및 합성검증. 2026-09-29 token backfill도 기능 브랜치에서 명시context/기본PG로 연결·실DB 검증. 운영 토큰 보완 실행과 생산 backend 선택은 미완료 |
| 가용 일정·예약·섭외 | `api/coaches/[id]/schedules`, `/reservations`, `/engagements`, `api/coach/schedule/[yearMonth]`, `api/engagements/[id]`, `/review`; `lib/coaches/engagementApi.ts`, `reservationAutoCancel.ts` | CoachSchedule, CoachScheduleAccessLog, CoachDayReservation, CoachEngagement, CoachEngagementSchedule, Coach | 월일정 GET/PUT·예약 POST/DELETE·매니저일정 GET은 context 경계. 수동 섭외확정/자동취소/평가는 context 경계 및 일정·예약 공통 guard. contract/Samsung 동기화·삭제 관계 transaction은 별도 시트 경계에서 구현. Notion도 별도 동기화 경계 구현 |
| 코치 메모·콘텐츠·관리 조회 | `lib/coaches/contentEntries.ts`, `api/coaches/[id]/notes`, `api/admin/content-entries`, `api/admin/schedule-registration/[yearMonth]`, `api/schedules/[yearMonth]/status`, `app/coaches/admin/page.tsx` | CoachContentEntry, CoachEngagement, CoachScheduleAccessLog, Coach | 2026-09-29 coachContent/coachAdmin 명시 context 연결·검증 및 총괄 통합. 기본 PG 유지. 프로필 legacy helper는 PG 관리 adapter 전용이며 Mongo 프로필 이력은 이미 구현했다. logReviewEdit는 호출처 없는 export이고 Mongo 평가는 자체 이력 기록을 사용한다(2026-09-29 사용처 확인). [경계·한계](mongodb-coach-content.md) |
| 코치 외부 동기화 | `lib/coaches/notionCoachSync.ts`, `samsungScheduleSync.ts`, `contractSheetSync.ts`, `syncLog.ts` | Coach, PrivateProfile, Field/Curriculum/Master, Engagement/Schedule, CoachSyncLog | contract/Samsung/Notion 및 로그는 명시 Mongo context, 합성 source로 실제 handler 검증. Notion/all은 전체 scope 선행 검사 후 실행하며 기본 PG 유지 |
| 강사 위키·노션 동기화 | `lib/data/prismaInstructorNoteRepository.ts`, `lib/instructors/notionInstructorSync.ts` | InstructorNote | 실제 save route와 Notion GET/POST의 명시 context 검증. sync는 별도 원천/저장 port와 PG adapter를 사용하며 기본 PG 유지 |
| 가져오기·staging·승격·Drive 기록 | `lib/data/prismaImportRepository.ts`, `importStagingWriter.ts`, `prismaImportPromotionRepository.ts`, `lib/driveImports/driveImportResults.ts`; `api/admin/imports/{upload,google-sheets/import,notion/import}`; `app/admin/imports/**` | DataImportRun, OperationSourceRecord, Company, Course, OperationSession, DriveImportRun, DriveImportResult | 업로드→staging→목록/상세는 명시 imports 경계 구현·영향 검증. 최종 수락은 mongodb-import-staging 실행 기록 기준. 승격은 명시 경계 구현·합성 검증·독립 코드 수락을 마쳤으며 통합은 해당 기록을 따른다. Drive 저장 이력 두 조회와 기존 페이지는 명시 경계 검증 완료(통합은 해당 기록). Sheets 두 POST의 명시 원천→staging 연결은 합성 검증했다. Notion 가져오기 명시 원천→staging도 합성 검증했다. Drive CLI writer의 명시 source/저장 경계도 합성 검증했다. 실제 Sheets/Notion/Drive 연결·적재와 전체 앱 조립은 후속. 외부 소스 읽기와 저장을 구분 |
| 매출 동기화의 생산 연결 | `lib/data/prismaSalesRevenueSyncRepository.ts`와 기본 Salesmap/알림 adapter | Course, SalesRevenueSyncLog | 명시 Mongo 경계는 구현. 전체 생산 구성·실제 원천/운영 금액 반영은 별도 |
| Google Calendar | `MongoCalendarPersistence`/`MongoCalendarOperationLock`/명시8port runtime → 기존 Calendar 모듈 | 기본 PG/별도 `pg.Pool` 유지. 구현·원본PG/native/합성 Google 검증·독립 리뷰 수락 | 실제 promotion→backfill→합성 Google→mapping/감사 및 인접 forward/reverse/cleanup을 검증했다. 전체 앱 선택·실Google·예약 작업 연결은 미완료. 원격 통합은 [기록](../../.claude/plans/mongodb-calendar-boundary/integration-review.md), [현재 범위](mongodb-calendar-boundary.md) |
| 활동 요청·변경 이력·활동 피드 | `lib/activity/request.ts`, `database.ts`, `retention.ts`, `presentation.ts`; `api/activity-feed`, `api/admin/activity`, `/usage` | ActivityRequest, ActivityChange 및 이름 해석에 쓰이는 업무 모델; `set_config`, PG trigger, SQL DELETE | 조회 세 GET는 명시 activityReads context/기본PG 경계로 연결했다. 전역 요청 연결·트리거 귀속·보존 작업의 실제 운영 연결은 별도다. MongoOperation의 ActivityChange 기록은 이 전체를 대체하지 않음 |
| 관리자 DB·백업·건강 확인 | `lib/admin/databaseDashboard.ts`, `api/admin/database/cell`, `api/admin/backup`, `api/health` | 여러 업무 모델 및 archive snapshot raw SQL; `SELECT 1` | 8표 조회/4표 셀 수정·담당자 명단·기존 코치 JSON 백업·health 연결 확인은 기본 PG/명시 Mongo 경계를 검증했다. 전체 앱 backend 구성과 실제 DB 백업/복구는 미완료이며 health는 readiness를 보증하지 않는다 |

## 간접 의존성과 오탐 제외

- `withActivity`는 명시 context에서 Mongo 요청 로그·retention을 사용하고, context가 없을 때 기존 PG 경로를 유지한다. Mongo 기록 실패 시 PG로 재시도하지 않는다. 최초 조사 시점 `src/app`의 테스트 외 `withActivity` 사용 파일은 72개였다. 이는 전환 완료율이나 독립 DB 연결 수가 아니다.
- OM 배정 권한은 `omRequestAssignmentAccess.ts` → `teamUserRepository.ts` → 기본PG 또는 명시 teamUsers를 읽는다. 인증 화면만 정상이라고 실제 배정 권한까지 Mongo로 바뀐 것은 아니다.
- `auth.ts`는 Google/NextAuth 설정이며 Prisma auth adapter를 사용하지 않는다. `requireAdminSession.ts`의 관리자/PII viewer 판정도 환경 설정·세션 기반이다. 이 파일들을 직접 PG 연결로 세지 않았다. 코치 링크 인증은 별도로 `coachTokenAuth.ts`가 PG를 읽는다.
- `@prisma/client`의 **type-only import**, enum 상수·Decimal/JsonNull 표현 사용만으로 DB 연결이라고 세지 않았다. `privacy/fields.ts`·DTO mapping 등의 값 변환은 실제 연결 생성과 구분한다. `activity/query.ts`, `usage.ts`, `legacy.ts`의 query/표현 helper도 호출자가 실행하는 PG 경로에 속할 뿐 독립 연결이 아니다.
- `features/coaches/CoachList.tsx`, dashboard·operation UI의 `.coach`/`.course` 속성 접근은 Prisma delegate 오탐에서 제외했다. `NOTION_IMPORT_DATABASE_URL`은 외부 원천 설정이지 PostgreSQL 연결 문자열이 아니다.
- `lib/migration/postgresShadowSource.ts` 및 `shadowJobCommand.ts`는 명시적 export 도구 경로다. 정상 앱 요청의 미전환 기능으로 세지 않는다. 전환 후에도 PG 원천 읽기 도구로 남길 수 있다.
- 현재 문서는 `src` runtime 범위다. `scripts`, 배포 entrypoint, Prisma migration 실행, 예약 작업·백업·실제 데이터 변환 스크립트는 별도 릴리스 점검이 필요하다. 브라우저 암호화 초안/복구 UI를 PG 테이블 이전과 혼동하지 않는다.

## 전체 앱 전환 완료를 판단할 조건

1. 위 기능군의 정상·권한·오류·transaction 계약에 대한 Mongo 구현과 실제 호출 연결을 검증한다. 신규 모듈 존재만으로 완료 처리하지 않는다.
2. 직접 API·페이지·공유 활동 기록·Calendar 잠금·권한 조회를 포함해 생산 요청에서 남은 PG 호출을 확인한다. 외부 부작용과 개발 local fallback은 별도로 검증한다.
3. 같은 snapshot 대조, 이후 변경·삭제 반영, 최종 쓰기 중단/sequence 재확인, 암호화 키 보존·복구, rollback을 완료한다. 현재 shadow 검증은 이 승인을 대신하지 않는다.
4. 생산 factory·health·배포/작업 설정을 일관되게 전환하고 실제 데이터/배포에 필요한 확인을 마친다. 운영 PostgreSQL은 그 전까지 유지한다.

## 직접 getPrismaClient 호출 파일 증거 목록

이 목록은 실제 호출식 검색 후 테스트·Mongo 구현·중앙 연결 정의를 제외한 보조 증거다. factory 선택, 주입된 Prisma transaction, raw pg.Pool 및 간접 호출은 위 기능군 표에 별도 포함했다. 메서드 본문에 직접 드러난 모델 목록이므로 관계 포함 모델 전체를 뜻하지 않는다.

| 경로 | 직접 delegate 모델 |
| --- | --- |
| `src/app/api/admin/backup/route.ts` | Coach, CoachPrivateProfile, CoachFieldMaster, CoachCurriculumMaster, CoachField, CoachCurriculum, CoachSchedule, CoachScheduleAccessLog, CoachEngagement, CoachEngagementSchedule, CoachImportRun |
| `src/lib/data/prismaCoachContentRepository.ts` | Coach, CoachContentEntry, CoachEngagement, CoachScheduleAccessLog; 이전 콘텐츠/월현황 API의 PG 기본 adapter |
| `src/lib/data/prismaCourseAdminRepository.ts` | Company, Course, OperationSession; admin/courses 두 API의 PG 기본 adapter |
| `src/lib/data/prismaAdminDatabaseRepository.ts` | Company, Course, OperationSession, Member; 셀 API의 기본 PG adapter |
| `src/lib/data/prismaDeletedOperationRepository.ts` | Company, Course, OperationSession; 삭제 운영 목록/복원 API의 PG 기본 adapter |
| `src/lib/data/prismaOperationBackfillRepository.ts` | OperationSession; 현장 투입·OM 상태 보정 API의 PG 기본 adapter |
| `src/app/api/health/route.ts` | 기본 PG/명시 Mongo databaseHealth 연결 경계 검증. 전체 readiness 아님 |
| `src/lib/activity/request.ts` | ActivityRequest |
| `src/lib/data/activityReads/prismaActivityReadRepository.ts` | ActivityRequest, ActivityChange, CoachContentEntry 및 기존 presentation 관계 조회; 활동 조회 facade 기본 PG |
| `src/lib/data/announcements/prismaAnnouncementRepository.ts` | Announcement, AnnouncementAttachment; 공지 facade의 기본 PG 조회/쓰기 |
| `src/lib/data/prismaAdminDatabaseRows.ts` | Company, Course, OperationSession, DriveImportRun, DriveImportResult, Member, DataImportRun, OperationSourceRecord; dashboard facade의 기본 PG 조회 |
| `src/lib/coaches/contentEntries.ts` | CoachContentEntry; logProfileEdit/logReviewEdit legacy helper만 직접 PG. 메모 helper는 repository facade |
| `src/lib/data/prismaCoachSheetSyncRepository.ts` | Coach, CoachPrivateProfile, CoachEngagement, CoachEngagementSchedule, CoachDayReservation; catalog→coach locks |
| `src/lib/data/prismaCoachNotionSyncRepository.ts` | Coach, CoachPrivateProfile, CoachFieldMaster, CoachCurriculumMaster, CoachField, CoachCurriculum; catalog→coach locks |
| `src/lib/data/coachSyncLogRepositoryFactory.ts` | CoachSyncLog PG default adapter |
| `src/lib/data/prismaCoachTokenBackfillRepository.ts` | Coach, CoachdbArchiveRow/Snapshot; 기존 coachAccessTokenBackfill 직접주입 알고리즘을 호출하는 PG 기본 CLI adapter |
| `src/lib/data/prismaCoachManagerMyPageRepository.ts` | Coach, CoachDayReservation, CoachEngagement, CoachEngagementSchedule; 명단 TeamUser는 기존 resolveOmNameByEmail 간접 호출. coachMyPage.ts는 facade |
| `src/lib/data/coachPrivateAccess.ts` | CoachPrivateAccessLog |
| `src/lib/data/prismaCourseNameRestoreRepository.ts` | Company, Course, OperationSession, OperationSourceRecord; 과정명 복원 service의 기본 PG adapter |
| `src/lib/data/prismaImportPromotionRepository.ts` | Company, Course, OperationSession, DataImportRun, OperationSourceRecord; 승격 facade의 기본 PG adapter |
| `src/lib/data/importStagingWriter.ts` | DataImportRun, OperationSourceRecord |
| `src/lib/data/omRequest/omRequestAssignment.ts` | OperationSession, OmRequest, ActivityChange |
| `src/lib/data/omRequest/omRequestLocalRepository.ts` | OmRequest |
| `src/lib/data/prismaCoachTokenRepository.ts` | Coach, CoachdbArchiveRow |
| `src/lib/data/prismaCoachTokenRotationRepository.ts` | Coach |
| `src/lib/data/prismaCoachExportRepository.ts` | Coach, CoachPrivateAccessLog |
| `src/lib/data/prismaCoachAdminRepository.ts` | CoachFieldMaster, CoachCurriculumMaster, Coach(Cascade/SetNull 자식 포함) |
| `src/lib/data/prismaCoachManagementRepository.ts` | Coach, CoachPrivateProfile, CoachFieldMaster, CoachCurriculumMaster, CoachField, CoachCurriculum |
| `src/lib/data/prismaCoachPrivateRepository.ts` | CoachPrivateProfile, CoachEngagement |
| `src/lib/data/prismaCoachEngagementRepository.ts` | Coach, CoachEngagement, CoachEngagementSchedule, CoachDayReservation, CoachContentEntry; 공통 coach advisory lock |
| `src/lib/data/prismaCoachScheduleRepository.ts` | CoachSchedule, CoachScheduleAccessLog, CoachDayReservation, CoachEngagement, CoachEngagementSchedule, Coach; 예약/일정 advisory transaction lock |
| `src/lib/data/prismaCoachRepository.ts` | Coach, CoachSchedule, CoachDayReservation, CoachEngagement, CoachEngagementSchedule, CoachdbArchiveRow |
| `src/lib/data/prismaImportRepository.ts` | Company, Course, DataImportRun |
| `src/lib/data/prismaInstructorNoteRepository.ts` | InstructorNote |
| `src/lib/data/prismaOperationRepository.ts` | Company, Course, CourseIdLabel, OperationSession |
| `src/lib/data/prismaTeamMemberRepository.ts` | Member, TeamUser |
| `src/lib/data/prismaSalesRevenueSyncRepository.ts` | Course, SalesRevenueSyncLog; salesRevenueSync facade의 기본 PG adapter |
| `src/lib/data/teamUsers/legacyTeamUserRepository.ts` | TeamUser |
| `src/lib/data/prismaDriveImportHistoryRepository.ts` | DriveImportRun, DriveImportResult; 기존 facade의 기본 PG adapter |
| `src/lib/data/prismaDriveImportWriterRepository.ts` | Company/Course/OperationSession 조회 및 DriveImportRun/Result 쓰기; 기존 CLI의 암호화 PG 기본 adapter |
| `src/lib/googleCalendar/calendarEventLinkRepository.ts` | CalendarEventLink |
| `src/lib/googleCalendar/operationSessionTimestamps.ts` | OperationSession |
| `src/lib/instructors/notionInstructorSync.ts` | InstructorNote |

## API 경계 후속 검증 (2026-09-22)

- [요청 단위 저장소 계약](mongodb-api-boundaries.md): 명시 scope에서는 누락 서비스·중앙 Prisma getter·Calendar raw PG lock 진입이 실패한다. scope 밖에 미리 보관한 Prisma 객체 자체를 무효화하는 장치는 아니다.
- 로컬 MongoDB 8.0.30 replica set 합성 검증 묶음 30 pass / 0 fail / 0 skip. 이 중 TeamMember mock 검사 4개가 포함된다. 전체 회귀 814 pass / 12 skip이며 서로 합산하지 않는다. 운영 Mongo cluster 및 실제 PG query 대조·UI 확인은 미실행.
- 위 API 경계 단계 이후 별도 코치 접근 작업에서 export도 context 경계로 연결했다. 아래 후속 검증을 참고한다.
- 생산 selector·실데이터 복사·최종 동기화·복원·배포는 여전히 미완료.

## 코치 접근 후속 검증 (2026-09-22)
토큰 인증·본인조회·재발급·개인정보 내보내기를 명시 Mongo scope에서 실제handler로 검증했다. 기본PG 선택은 유지한다. 전체 회귀825pass15skip, Mongo8.0.30 묶음33pass0skip(mock4포함). [토큰조회](mongodb-coach-token-access.md), [재발급](mongodb-coach-token-rotation.md), [내보내기](mongodb-coach-export.md) 참고.

양backend 삭제코치 재발급404, UUIDcase정규화, CSV수식문자열화와no-store가 의도된보안보완이다. 실제OAuth/UI/PG query대조·운영Mongo검증/데이터복사/배포는 별도다. 다음은 코치 일정등록/예약/취소 경계다.

## 코치 일정·예약 후속 경계 (2026-09-22)
[범위와 보장](mongodb-coach-schedules.md), [실행 근거](../../.claude/plans/mongodb-coach-schedules/execution-manifest.md). 세 API의 직접 PG 호출은 PrismaCoachScheduleRepository adapter로 이동했으며 생산 기본은 PG다. Mongo active unique와 원자성은 확정·동기화 writer 통합을 대신하지 않는다.

## 코치 투입·평가 후속 경계 (2026-09-22)
[정책과 저장 경계](mongodb-coach-engagements.md), [실행 근거](../../.claude/plans/mongodb-coach-engagements/execution-manifest.md). 예약→재생성 취소와 재생성→예약 허용을 유지한다. 외부 두 sync의 guard/저장 경계와 물리삭제 관계 처리는 별도 필수 후속이다.

## 코치 시트 동기화 후속 경계 (2026-09-22)

[정책과 저장 경계](mongodb-coach-sheet-sync.md). contract/Samsung 서비스와 로그는 명시 Mongo context를 지원하고 PG 기본을 유지한다. source 주입, catalog→정렬 coach 잠금, 기존 단계별 commit 및 삼성 Cascade/SetNull을 검증한다. Notion/all은 Mongo scope에서 외부 읽기 전에 차단하는 미완료 gate다. 전체 생산 전환은 완료되지 않았다.

총괄 통합 회귀864pass18skip0fail 및 독립 검토 완료. 이름이 포함될 수 있는 `sourceEngagementId`/`sourceEngagementScheduleId` 평문 저장은 전체 개인정보 암호화 목표의 필수 보완 항목이다. 기존 operational 분류를 암호화 제외 승인으로 해석하지 않는다. Notion 저장 경계 다음에 암호화·검색/고유키·기존 데이터 변환의 일관성을 보완하며 운영 전환 전에 해결한다.

## Notion 코치 동기화 후속 경계 (2026-09-22)

[정책과 저장 경계](mongodb-coach-notion-sync.md). Notion/all의 기존 차단 gate를 명시 source/repository 주입 실행으로 전환한다. 기존 identity·deleted 매칭·regular overwrite와 duplicate 빈값 보충·행별 commit을 유지한다. 다음 필수 작업은 이름 포함 투입/슬롯 source ID 암호화이며, 나머지 미전환 runtime·운영 리허설·배포는 별도로 남는다.

## 투입·슬롯 원천 식별자 암호화 후속 (2026-09-23)

[적용 순서·복구·shadow 재복사](pii-source-engagement-ids.md). 이름이 포함될 수 있는 `sourceEngagementId`/`sourceEngagementScheduleId`를 PG·Mongo 공통 정책으로 암호화하고 HMAC companion unique로 원문 중복을 막는다. Mongo 시트 매칭은 HMAC 조회 후 복호화 값을 확인한다. Mongo read/operation store 준비는 이전 정책 문서가 남은 기존 namespace를 거부하며 자동 삭제·수리하지 않는다. 새 PG migration은 운영에 적용하지 않았다.

위 두 필드의 저장 평문 blocker는 코드·합성 검증 기준으로 해소했다. 운영 PG backfill·enforce, 새 namespace로의 실제 재복사·복원 리허설, 위 표의 미전환 기능(관리자·가져오기·캘린더·공지·활동 등)과 최종 전환은 그대로 남아 있다. 브라우저 초안 암호화도 별도 미완료다.

## 코치 태그 마스터·삭제 코치 관리 후속 (2026-09-23)

[경계와 영구삭제 결정](mongodb-coach-admin.md). 세 route는 저장소 호출로 바뀌었고 기본은 PG adapter다. Mongo 영구삭제는 결정권자 결정에 따라 기존 물리 삭제와 같은 Cascade/SetNull을 한 트랜잭션에서 재현한다. 개인정보 접근 기록을 쓰는 `recordAccess`와 export가 코치 잠금에 참여한다. 같은 fixture로 PG 기준과 비교 검증했다. 다른 코치 경로(메모·콘텐츠·관리 조회, coachMyPage, token backfill)와 나머지 기능군은 미전환이다.

## 관리자 운영 보정 API 후속 (2026-09-29)

현장 투입 여부·OM 배정 상태 보정의 두 GET/POST를 별도 repository로 연결했다. 원본 exact 조건·부분 갱신·재실행0을 보존하며 Mongo 후보 HMAC/원문 검증·감사 원자성을 검증한다. 최신 실행·독립 리뷰·통합 상태는 `.claude/plans/mongodb-operation-backfill/`을 따른다. `/admin/database` 호스트 전체는 당시 범위 밖이었고 이후 runtime 조립을 완료했다. legacy `scripts/backfill-onsite-required-y.ts`도 2026-10-01 기본 PG/명시 Mongo CLI 경계로 연결했다. 운영 보정 실행과 전체 이전은 미완료다.

## 과정명 복원 경계 후속 (2026-09-29)

기존 서비스·API의 정규화/원천 근거/계획 지문 재검증/전체 선택 적용을 별도 repository로 분리했다. 업무 모델·PG schema 변경 없이 내부 CourseNameRestoreGuard를 추가해 복원끼리의 disjoint 선택 경쟁을 처리한다. 일반893pass/42skip·Mongo360pass/0skip(mock4포함)·실PG 대조/SSI8pass·handler/factory8pass·typecheck/build 및 lint0error/기존7warning을 확인했다. 검사 묶음은 겹치므로 합산하지 않는다. 실제 구현·합성 검증·독립 리뷰·통합 상태는 `.claude/plans/mongodb-course-name-restore/`를 따른다. 운영 복원 실행이나 전체 Mongo 전환 완료가 아니다.

## 관리자 DB 조회·셀 편집 후속 (2026-09-29)

8표 조회·4표 허용 셀 편집을 adminDatabase 경계로 분리한다. 기본 PG·기존 DTO·파서·권한·허용 필드·오류를 보존하며 Member null 정렬/복합unique/감사, UUID·Decimal의 실제 PG 의미를 대조한다. 담당자 목록은 getStoredTeamMemberRepository의 teamMembers scope로 연결한다. 일반 getTeamMemberRepository의 Notion 정책은 이번 범위 밖이다. 실행·독립 수락·통합 상태는 `.claude/plans/mongodb-admin-database/`를 따른다. 관리자 백업/health와 실제 복구/운영 전환은 별도 미완료다.

관리자 DB 최종 일반895pass45skip·Mongo402pass0skip(mock4포함)·추가 native43pass·handler/factory12pass·실PG5pass. typecheck/build PASS, lint0error/기존7warning, 독립 V1–V10 PASS. 중복 묶음은 합산하지 않는다.

## 공지·첨부 저장 경계 후속 (2026-09-29)

[경계와 기존 한계](mongodb-announcements.md). 공지6handler/3조회page를 announcements 명시context/기본PG adapter로 분리한다. 최대 첨부 bytes·기존 삭제/수정 계약·감사 대조는 검증했고, 전체 회귀·독립 최종 수락은 `.claude/plans/mongodb-announcements/` 실행결과로판정한다. 전체전환/실데이터이전/복구리허설/운영전환은미완료다.

서비스 이전까지의 남은 기능군·전체 앱 연결·실제 복사/복원/전환 순서는 [잔여 작업](mongodb-cutover-remaining.md)을 따른다. 오래된 후속 단락의 당시 미완료 목록보다 위 표와 최신 실행 기록을 우선한다.

공지·첨부 최종 일반 898pass/48skip, Mongo 457pass/0skip(mock4포함), 실제 PG 6pass/native 30pass/실제 handler-page 13pass. typecheck/build PASS, lint 0error/기존7warning, 독립 V1–V11 PASS. 중복 묶음은 합산하지 않는다. 소유 합성 자원 정리 완료, 원격 통합은 `.claude/plans/mongodb-announcements/integration-review.md`를 따른다.

## 활동 조회 후속 (2026-09-29)

관리자 활동·피드·사용 통계 세 GET를 activityReads 명시 context/기본 PG 경계로 분리한다. 기존 권한·필터·집계·legacy/대상 이름·오류를 유지하며 검증/독립 수락/통합은 `.claude/plans/mongodb-activity-reads/`를 따른다. 감사 쓰기·보존 정책·전체 앱 선택과 실제 운영 이전은 별도다.

활동 조회 최종 일반901pass51skip, Mongo497pass0skip(mock4포함), PG6/native30/실handler10, typecheck/build PASS, lint0error/기존7warning, 독립 V1–V8 PASS. 중복 검사 합산 금지. 소유 합성 자원 정리 완료, 통합은 `.claude/plans/mongodb-activity-reads/integration-review.md`를 따른다.

## 매출 동기화 후속 (2026-09-29)

a52f191 기반 명시 저장/source/notifier와 실제 GET/POST 경계 구현. 최초 snapshot pending·원천 순서·다중 딜·금액 반올림·partial 차단·별도 best-effort 로그를 원본 PG와 대조한다. 최신 검증/실패/독립 수락·정리·원격 통합 상태는 `.claude/plans/mongodb-sales-revenue-sync/`를 따른다. 전체 생산 연결·실제 데이터 이전/dev→main은 미완료다.

매출 최종 실행: 일반910pass57skip/전체Mongo577pass0skip(mock4포함), PG5pass로각backend45상황×3단계대조. native28/handler17/source4는중복합산하지않는다. type/buildPASS, lint0error기존7warning. 독립리뷰지적의deadline/동일목표/복수표시명검증을보완했다. 정리·독립최종수락·원격상태는해당handoff/integration-review를따른다.

## OM 전체 배정 후속 (2026-09-30)

명시 omAssignment로 기존 정확한 생성 배치·10분 확인 토큰·권한·전체 수동값 교체/취소를 보존했다. 요청/회차/변경감사는 한 transaction이며 기존 과정명 복원 guard를 공유해 역의존 경쟁을 보호한다. 일반917 pass/64 skip, 전체Mongo684 pass/0 skip(기존mock4 포함), PG56, native보완25/handler보완20/UI5는 중복 합산하지 않는다. typecheck/build PASS, lint 기존7warning 및 후속 검증 파일lint0. 상세 실패 보완·독립 수락·정리·원격 SHA는 `.claude/plans/mongodb-om-assignment/`을 따른다. 기본PG 유지, 실제 Calendar·Slack·운영 개인정보·복사/복원/최종전환 완료가 아니다. 다음 신규 기능 전에 최신dev307f52f의 만족도/Calendar 변경을 별도 통합 검증한다.

## 공동 개발 변경 정합 (2026-09-30)

최신 dev307f52f의 만족도 강사평균 저장과 Calendar 누락 복구를 보존하고 명시 Mongo `operations.getOperationCreatedAt`을 연결했다. exact operationId, soft-delete 포함, 없음 null, metadata projection을 유지한다. 만족도 실제 POST/감사와 두 필드·빈값·동일 overall skip을 합성 검증한다. 최종 실행·독립 수락·원격 통합은 `.claude/plans/mongodb-dev-alignment/` 기준이다. 이 메서드 추가는 Calendar 저장/잠금 전체 전환이나 실제 Google 연동 검증이 아니다.

브라우저 임시저장 암호화는 후속 과제이며 이번 Mongo 이전의 선행조건에서 제외한다. 현재 기능·권한·개인정보 암호화, 활성 CLI/예약/배포 경로 검증은 유지한다. 실제 독립 A/B 백업·각각 복원·전환 후 신규 쓰기 보존 절차는 [백업 및 전환 계획](mongodb-backup-cutover-plan.md)을 따르며 실제 백업 확인 증거는 0건이다.

## 2026-09-30 가져오기 운영 반영

총괄75125c9 기준 명시 importPromotion과 commit 후 importPromotionCalendar 경계를 구현했다. 기본PG·workspace권한·차단행 보존·지문/업무키 연결·삭제표시복원·source 연결을 유지한다. Company/Course 자연키 insert 경합은 정확한 오류 키로만 재시도한다. 원본 PG 허용 동시 일정과 Mongo 실제 네 경합의 전체 summary/행/참조/감사를 비교했고 일반 Mongo 생성 감사의 nullable 누락과 고아 source 승격을 보완했다.

일반922pass/71skip, PG54, Mongo49파일의 최종 중복제거833pass(개별 저장60/API22는 부분집합), type/build 통과, lint0error/기존7warning. 최초 전체 TAP823 성공 뒤 wrapper exit1을 보존하고 영향13파일369 및 최종부모참조보완2파일82 결과로 해당 파일을 교체했다. 단일 최종소스 전체명령 PASS가 아니다. 소유합성PG/Mongo정리완료, 독립 코드/회귀수락 및 원격 통합 증거는 `../../.claude/plans/mongodb-import-promotion/`을 따른다.

다음은 Calendar 저장·잠금·실제 backfill의 명시 연결이다. 실제Sheets/Notion·Drive·활동쓰기/보존·backup/health·CLI·전체앱조립·A/B백업/복원/최종전환은남아있고 생산기본PG·실백업증거0을유지한다.

## 2026-09-30 Calendar 명시 경계

위의 다음 Calendar 작업은 구현·합성 검증·독립 수락을 마쳤다. 일반954/77skip, PG5/0skip, 전체Mongo963/0skip(기존mock4 포함), type/build 통과·lint기존7. 단언 강화 후 adjacent12는 전체의 부분집합이며 단일 최종 테스트소스 전체명령이라고 표현하지 않는다. 제품 코드의 동일 hash와 소유 합성 정리를 확인했다. 실행/원격통합은 `../../.claude/plans/mongodb-calendar-boundary/` 기준이다. 다음 후보는 Drive 저장 이력 조회→기존 결과 페이지이며 dry-run CLI의 이력 쓰기까지 완료한 것은 아니다. 실제 원천·전체 앱 조립·운영 이전은 미완료다.

## 2026-09-30 Drive 저장 이력 조회

두 async 조회와 기존 결과 페이지의 명시 driveImportHistory/teamMembers 경계를 구현했다. 일반957/83skip, 실제PG gate1·parity1(내부55/55/48), page7/8/8, native+scope79/0skip, Calendar인접24/0skip, type/build PASS·lint기존7이다. 서로 중복 합산하지 않으며 이번 전체 Mongo 재실행이라고 표현하지 않는다. 소유 합성 자원 정리 완료, 독립 정합·원격통합은 `../../.claude/plans/mongodb-drive-import-history/` 기록을 따른다. [동작·한계](mongodb-drive-import-history.md).

다음 후보는 Sheets tabs/import→기존 staging이며 실제 원천 접근 없이 명시 합성 source 경계를 검증한다. Drive CLI writer·전체앱조립·backup/health·실제A/B백업복원전환은 남아 있다. snapshot companyName/courseName의 현행 비암호화 분류는 제외 승인이 아니며 전체 전환의 보안 검토 차단 항목이다. 운영 collation도 아직 대조하지 않았다.

## 2026-09-30 Sheets 원천→staging 명시 경계

Drive 통합8b4d954 기준 두 POST·source/context4파일을 연결했다. 원본80파일 동결, 실제PG/현재PG/native3backend 전체tuple45/45/45와 동시 중복 두schedule, 실제 guard/audit·PII·transaction 실패의미를 확인했다. 일반971/86skip, HTTP/handler30 및 최종handler16, native16, Calendar24, PGgate1/parity1, type/build통과·lint기존7. 중복합산 금지, 전체Mongo 재실행 아님. 독립수락·소유정리·원격SHA는 `../../.claude/plans/mongodb-google-sheets-import/` 기준이다.

다음 작은 후보는 Notion 가져오기 API→기존staging이다. 실제원천/OAuth·Drive CLI writer·전체앱/작업조립·backup/health·snapshot 민감문자열정책·운영collation·실A/B백업복원전환은 남았다. 생산기본PG와 실백업증거0, dev→main 미충족 상태를 유지한다.

## 2026-09-30 Notion 원천→staging 명시 경계

Sheets 통합093f585 기준 제품3파일의 최소 경계를 구현·검증했다. 실제HTTP46, actualhandler15, native17, 원본/currentPG/native parity root1(각47ledger·전체ID집합), 일반1017/89skip, type/buildPASS, lint기존7. 중복합산하지 않으며 전체Mongo 과거묶음 재실행이 아니다. 독립 검증 공백3건을 보완·재실행·수락했고 소유PG/Mongo를 정리했다. 원격통합은 `.claude/plans/mongodb-notion-import/integration-review.md`를 따른다.

다음 후보는 Drive CLI writer다. 전체앱/예약작업 조립·backup/health·snapshot민감문자열정책·운영collation·실A/B백업복원복사전환은 남았다. 기본PG·실백업증거0·dev→main 미충족 상태 유지. 실원천/OAuth/UI 검증은 이번 합성 성공으로 대체하지 않는다.

## 2026-09-30 Drive CLI 이력 쓰기 명시 경계

기준 3c72e69에서 기존 CLI를 source/repository/workflow로 분리했다. 원본 migration prefix17 정상·18 ID default 실패·current45 guard 거부를 별도로 관찰하고, 현재 PG는 암호화 wrapper를 사용하는 adapter로 연결했다. native는 다섯 모델의 기존 상태 선검증, snapshot join/정렬/limit, 개별 쓰기·부분 이력·재시도·기존 reader DTO를 보존한다. 기본 PG이며 생산 선택은 바꾸지 않았다.

일반1034 PASS/93 opt-in skip/0fail, source HTTP12(root+11), native45, CLI6와 scope11(일반의 부분집합), 원본 gate1 및 최종 parity1(3backend×2TZ 각각22 ledger)을 확인했다. typecheck/build 통과, lint 오류0/기존경고7. 묶음은 중복 합산하지 않으며 전체 역사 Mongo 재실행이 아니다. 독립 리뷰·실패 보완·hash 재사용·합성 자원 정리·원격 통합은 `../../.claude/plans/mongodb-drive-import-writer/`를 따른다.

다음 작은 후보는 health 명시 조회 경계다. 관리자 백업·활성 CLI/예약/배포·전체 앱 조립·snapshot 개인정보 분류·운영 collation/시간대·실원천·독립 A/B 백업/각 복원/복사/최종 전환은 미완료다. 실제 백업 증거0, 생산 기본PG, dev→main 조건 미충족을 유지한다.

## 2026-09-30 Health 연결 경계

health 연결 경계 구현·검증 완료. 기본PG SELECT1과 production HTTP200/503·응답 유지. 명시 databaseHealth만 Mongo borrowed client의 ping1/5초 CSOT를 사용한다. scope 누락은 fallback하지 않는다. 모든 환경의 공개 실패를 고정해 개발 오류 원문 노출을 제거한다. 빈/미생성 DB ping 성공과 유효 형식 다른 키 통과는 연결 확인의 정상 의미이며 readiness를 보증하지 않는다.

일반1045PASS/95 opt-in skip/0FAIL(health scope root+10개는 부분집합), actualMongo9PASS/0skip(root+8), originalPG gate1PASS/0skip(6사례×원본/current 12관찰), typecheck-final/build PASS, lint 오류0·기존경고7. 서로 다른 단위를 합산하지 않는다. 전체 역사 Mongo 묶음을 새로 실행한 것은 아니다. 빌드 후 제품6파일 hash 동일, 기존 정책·의존9파일 baseline 동일. 마지막 worker 변경은 this:pg.Client 타입 표기뿐이며 이후 typecheck-final 통과. 실행·실패보완·독립리뷰·통합 근거는 `.claude/plans/mongodb-health-boundary/`를 따른다.

다음은 관리자 백업 경계다. 전체 Next 서버·실배포·실원천/운영 데이터 검증은 미실행이다. schema/decryption/replica 쓰기/readiness/백업복구/cutover를 검증하지 않는다. 관리자 백업·활성CLI/예약/전체앱 조립·snapshot민감문자열분류·운영collation/TZ·실A/B백업/복원/복사/전환은 별도 미완료다. 브라우저 임시저장 보호는 기존 후속범위다. 기본PG·실백업증거0·dev→main 조건 미충족·자동화PAUSED를 유지한다.

## 2026-09-30 관리자 백업 경계

관리자 backup POST를 기본PG/명시adminBackup repository로 분리했다. 기존 secret 또는 실제 PII admin guard, withActivity, 파일명·headers·exportedAt/counts/data와11개모델전체행·보관metadata6필드최근20개를 유지한다. 승인 응답의 복호화 개인정보와 저장상태 암호화를 구분하며 Mongo companion은최상위에서만제거해사용자JSON키를보존한다. Mongo단일snapshot·누적2만행/32MiB/60초는명시검증범위의보호한계이며초과시전체reject한다. PG에새한도는없다. 저장소실패는cause없는ADMIN_BACKUP_READ_FAILED이며인증오류/withActivity500감사는기존제어흐름을유지한다.

일반1061PASS/97 opt-in skip/0FAIL, scope16PASS(일반의부분집합), 실제Mongo15PASS/0skip(root+14), 실제PG frozen original/current ×UTC/Asia-Seoul 각11사례=44관찰/root1PASS/0skip. typecheck-final/build-final PASS, lint-final 오류0/기존경고7. 중복합산하지않는다. 전체과거Mongo묶음을새로돌린것은아니며변경없는privacy/auth/activity/codec/schema/package/loader15파일hash로기존검증을재사용한다. 일반검사후변경은PG opt-in runner경고허용목록과digest2파일뿐이며actualPG·최종type/lint로재검증했다. 근거는 `.claude/plans/mongodb-admin-backup/`를따른다.

다음은activity:prune CLI의명시저장소경계다. 이 API는기존코치JSON다운로드이며전체35모델/원천archive row/복구이미지를제공하지않는다. 실제Next서버오류페이지·운영데이터·실원천·운영collation·실제A/B백업/각복원/복사/최종전환은미검증이다. Mongo snapshot은원본PG Promise.all에없던일관성보완이며원본과같은동시결과로주장하지않는다. driver read15초+제한된cleanup 검증을HTTP응답전체15초보장으로해석하지않는다. 기본PG·실백업증거0·dev→main조건미충족·자동화PAUSED를유지한다. 전체앱/활성CLI/예약/배포구성·snapshot개인정보분류·운영collation/TZ·운영이전은별도잔여범위다.


## 2026-09-30 활동 기록 정리 경계

activity:prune CLI를 기본 PG와 명시 activityPrune repository로 분리했다. PG SQL·10초 트랜잭션·30/365일·모델별1000개·합계 출력 후 종료 순서를 유지한다. Mongo는 트랜잭션마다 서버 시각을 한 번 읽고 두 삭제를 원자적으로 수행한다. 기존 API 자동 정리도 같은 helper로 연결했으며 전체4초/개별1500ms·시간당 한 배치·best-effort를 보존했다. 생산 기본은 PG다.

일반1082 PASS/99 opt-in skip, command21 PASS(일반 부분집합), 실제Mongo12 PASS, 인접API12 PASS, frozen original/current 실제PG root1 PASS/36worker 관찰. 최종type/build/lint 통과(기존경고7). 중복 합산과 전체 역사Mongo 재실행 주장은 하지 않는다. 독립 getMore P1/출력검증 P2를 보완했고 최종 실행 증거를 수락받았다. 합성 자원 정리와 실패·한계·원격 통합 근거는 `.claude/plans/mongodb-activity-prune/`를 따른다.

이번 단위 종료 후 새 기능은 시작하지 않고 운영 전 필요한 결정·외부 조치를 같은 폴더 operational-decisions.md에 정리했다. 코치 공개 조회 scope 연결, 전체 앱·활성CLI/예약/배포 조립, snapshot 개인정보 분류·운영collation/TZ 및 실제 A/B 백업·각 복원·복사·최종 전환이 남아 있다. main/dev·운영 설정은 변경하지 않았고 자동화PAUSED 인계를 유지한다.

## 2026-09-30 코치 공개 페이지 명시 경계

기존 `getCoachRepository()`가 명시 `coach` context를 우선하도록 연결했다. scope 밖에서는 기존 `DATABASE_URL` guard와 Prisma adapter를 그대로 사용하고, 활성 scope에 `coach`가 없으면 PG fallback 없이 실패한다. `/coaches`, 코치 상세·일정·투입, 강사 위키 목록·상세, 운영 상세의 실제 7개 page와 auth guard를 실제 `MongoCoachRepository`로 실행했다. UI leaf와 비-coach repository·holiday·collaboration IO만 합성했다.

신규 actual Mongo 검증 12 PASS/0 skip, 기존 native coach 저장소 1 PASS, 일반1083 PASS/100 opt-in skip/0 FAIL, typecheck/build PASS, lint 오류0·기존경고7이다. 일정의 factory 동기 오류와 dashboard/holiday 비동기 오류, 상세 notFound 후 후속0, 위키 목록 마지막 동명이름·상세 첫 일치, 운영 옵션 trim/dedupe/한국어 정렬을 별도 판정했다. 조회 중 Mongo write 0, 동시 namespace 혼합0, 저장 fixture 평문0, PG·실외부 접근0을 확인했다. 실제 운영 데이터·전체 Next 서버·생산 backend 전환은 검증하지 않았다.

Google Drive(A)와 OneDrive(B)는 백업 **후보**만 확정했다. 실제 계정·용량·보존·암호화·독립 삭제/복구 권한, 각 업로드 무결성, 키 회수와 격리 복원은 미검증이므로 실제 백업 증거는 0건이다. 전체 앱·활성 CLI/예약/배포 조립, snapshot 개인정보 분류, 운영 collation/TZ, 실데이터 복사·각 복원·최종 동기화/전환이 남아 있다. 생산 기본 PG, main/dev 불변, 자동화 PAUSED를 유지한다.

## 2026-09-30 Drive 결과 snapshot 이름 암호화

`DriveImportResult.companyName`, `courseName`을 개인정보 정책의 128번째·129번째 필드로 추가했다. PostgreSQL에는 nullable non-unique HMAC companion과 인덱스를 추가하고, 기존 `C` 정렬 의미는 bounded 복호화 후 UTF-8 byte 비교로 유지한다. Mongo runtime 계약·validator·비고유 HMAC 인덱스와 35모델 export/import codec도 같은 정책을 사용한다. 동일 이름 중복은 허용하며 무작위 암호문 unique를 사용하지 않는다.

새 합성 PostgreSQL에서 legacy plaintext, schema 전 실패/rollback, 평문·암호문 혼재, dry-run/apply/retry, companion 부분 복구, 잘못된 암호화/HMAC 키의 apply 전 거부·저장 불변, exact equality, 중복 허용, 음수·fraction·비정상 limit과 `C` byte 정렬, enforce 평문 거부를 확인했다. 기존 source ID의 205행 부분 commit·재실행 검사도 최신 migration과 함께 다시 통과했다. 새 MongoDB 8.0.30 replica set에서 history/runtime 79 PASS로 암호문·HMAC·변조·키 불일치·validator/index·정렬·32MiB 경계와 이전 정책 평문 문서의 무수정 거부를 확인했다. 35모델 codec/export/import 관련 65 PASS, 일반1084 PASS/101 opt-in skip/0 fail, typecheck/build PASS, lint0error/기존7warning이다. 검사 묶음은 중복 합산하지 않는다.

운영 migration/backfill/enforce, 기존 shadow 변환·삭제, 실제 데이터·원천·키·배포에는 접근하지 않았다. 이전 shadow는 자동 수리하지 않고 새 run ID/namespace 재복사가 기본이다. 적용·복구 순서는 [별도 절차](pii-drive-import-result-names.md)를 따른다. 실제 운영 collation/TZ, 전체 앱·활성 CLI/예약/배포 조립, A/B 백업과 각 복원·실데이터 복사·최종 전환, dev→main 조건은 아직 미완료다.

## PostgreSQL 정렬·시간대 사전 점검 (2026-09-30)

`scripts/check-postgres-runtime-contract.ts`는 앱과 같은 UTC 세션의 시스템 카탈로그와 고정 합성 문자열만 읽는 preflight다. 연결 시작부터 read-only를 강제하고 UTF8·UTC·UTF-8 byte 정렬·collation version 일치를 각각 판정한다. 합성 PostgreSQL 17/18 C locale에서는 compatible/0, PostgreSQL 18 ICU `ko-KR`에서는 byte ordering 불일치만 blocked/2였고 사용자 테이블은 모두 0개였다. 실제 운영 실행은 하지 않았으므로 운영 collation/TZ 확인 완료로 표시하지 않는다. 절차와 판정은 [사전 점검 문서](postgres-runtime-contract-preflight.md)를 따른다. 다음은 이 결과를 전제로 하는 전체 앱·활성 작업의 Mongo runtime 조립이며 실제 A/B 백업·각 복원·복사·최종 전환과 dev→main은 계속 미완료다.

## 내부 운영 runtime 조립 (2026-09-30)

health·관리자 코치 JSON export·request/private audit·activity prune를 동일 client/database/namespace의 명시 shadow scope로 조립했다. 빈 namespace만 준비하고 기존 namespace는 쓰기 없이 전체 readiness를 확인한다. scope 전체 잠금으로 요청 중 다른 runtime 중첩 전환을 막고 서로 다른 최상위 작업의 namespace는 격리한다. 실제 MongoDB 8.0.30 합성 검증과 세부 한계는 [운영 runtime 문서](mongodb-operational-runtime.md)를 따른다. 생산 selector·전체 Next 요청·활성 CLI/예약 작업·실백업/복원/복사/최종 전환은 계속 미완료다.

## 활동 조회 runtime 조립 (2026-09-30)

관리자 활동 목록·이용 현황·비공개 활동 피드의 `activityReads`를 명시 shadow runtime으로 조립했다. 실제 세 GET은 기존 정책대로 요청 감사를 쓰지 않으며, 준비된 namespace 재실행과 다른 모델만 있는 부분 namespace에서 mutation 0을 확인한다. 상세 검증과 범위는 [활동 조회 runtime 문서](mongodb-activity-read-runtime.md)를 따른다. `/changes`의 메모·리뷰 쓰기, production selector·전체 Next/활성 작업·운영 이전은 미완료다.

## 공지·첨부 runtime 조립 (2026-10-01)

공지·첨부와 request audit를 같은 client/database/namespace의 등록 shadow runtime으로 조립했다. 실제 API·페이지에서 multipart·첨부·소프트 삭제·업무/요청 감사 계약을 검증하고 기존·부분 namespace는 mutation 없이 실패하거나 연다. 상세 범위는 [공지 runtime 문서](mongodb-announcement-runtime.md)를 따른다. production selector·전체 Next/활성 작업·운영 이전은 미완료다.

## 변경 내역 runtime 조립 (2026-10-01)

`/changes`의 활동 조회·콘텐츠 피드·코치 메모 수정·투입 평가 수정과 request audit를 같은 client/database/namespace의 등록 shadow runtime으로 조립했다. 실제 네 API handler에서 응답과 업무/요청 감사 연결, 암호화 저장, 부분 준비·재실행 불변, 등록 scope 분해·혼합 차단을 확인했다. 상세 범위는 [변경 내역 runtime 문서](mongodb-changes-runtime.md)를 따른다. 브라우저 전체 흐름, production selector·전체 Next/활성 작업·운영 이전은 미완료다.

## 코치 관리자 runtime 조립 (2026-10-01)

코치 관리자 페이지·마스터·삭제 코치 API와 request audit를 같은 client/database/namespace의 등록 shadow runtime으로 조립했다. 복원·기존 영구삭제·업무/요청 감사·암호화 저장과 부분 준비·중첩 전환 차단을 확인했다. 상세 범위는 [코치 관리자 runtime 문서](mongodb-coach-admin-runtime.md)를 따른다. 브라우저 전체 흐름, production selector·전체 Next/활성 작업·운영 이전은 미완료다.

## 관리자 DB runtime 조립 (2026-10-01)

관리자 DB 페이지·셀 API의 adminDatabase·teamMembers·requestActivity를 같은 client/database/namespace의 등록 shadow runtime으로 조립했다. 실제 페이지·PATCH, 업무/요청 감사·rollback·준비 불변과 자원 소유권을 확인했다. 상세 범위는 [관리자 DB runtime 문서](mongodb-admin-database-runtime.md)를 따른다. 브라우저 전체 흐름, production selector·운영 이전은 미완료다.

## 관리자 유지보수 runtime 조립 (2026-10-01)

과정 관리·삭제 운영·onsite/OM 보정과 request audit를 같은 등록 shadow runtime으로 조립했다. 실제 삭제→복원→보정 흐름과 감사·암호화·준비 불변을 확인했다. 상세 범위는 [관리자 유지보수 runtime 문서](mongodb-admin-maintenance-runtime.md)를 따른다. production selector·운영 이전은 미완료다.

## 사용자 관리 runtime 조립 (2026-10-01)

관리자 사용자 목록·등록·팀·역할 변경, 토큰 조회와 request audit를 같은 등록 shadow runtime으로 조립했다. 실제 권한·생성·정규화 중복·수정·최소 조회 응답·삭제 차단·감사·암호화 저장과 준비 불변·scope 차단을 확인했다. 상세 범위는 [사용자 관리 runtime 문서](mongodb-user-admin-runtime.md)를 따른다. production selector·운영 이전은 미완료다.

## 코치 포털 runtime 조립 (2026-10-01)

코치 토큰 본인 조회·월 일정 조회/저장과 request audit를 같은 등록 shadow runtime으로 조립했다. 실제 API의 토큰·일정·감사·암호화 저장과 준비 중단 불변·scope 혼입 차단을 확인했다. 상세 범위는 [코치 포털 runtime 문서](mongodb-coach-portal-runtime.md)를 따른다. production selector·운영 이전은 미완료다.

## 활동 정리 CLI runtime 연결 (2026-10-01)

기본 PostgreSQL CLI를 보존하면서 exact `--backend=mongodb-shadow` 선택만 준비된 operational runtime에 연결했다. 환경 누락·미준비 namespace는 mutation과 PG fallback 없이 실패한다. 상세 범위는 [활동 정리 CLI 문서](mongodb-activity-prune-cli-runtime.md)를 따른다. 운영 예약·배포 설정은 미변경이다.

## 현장 투입 보정 CLI runtime 연결 (2026-10-01)

legacy raw SQL `db:backfill:onsite-required-y`를 기존 operationBackfill repository command로 교체했다. 기본 PG와 dry-run/`--apply`·대상 의미를 유지하고 exact Mongo selector만 준비된 admin maintenance shadow에 연결한다. 상세 범위는 [현장 투입 보정 CLI 문서](mongodb-onsite-backfill-cli-runtime.md)를 따른다. 운영 실행·예약·배포 설정은 미변경이다.

## 팀 명칭 보정 CLI runtime 연결 (2026-10-01)

legacy raw SQL `db:backfill:team-user-team-labels`를 TeamUser count/조건부 rename으로 교체했다. 기본 PG와 두 exact 라벨·dry-run/`--apply`를 유지하고 local file 선택은 거부한다. Mongo는 명시 prepared user-admin shadow에서 team만 갱신하며 PII 암호문·companion을 보존한다. 상세 범위는 [팀 명칭 보정 CLI 문서](mongodb-team-label-backfill-cli.md)를 따른다. 운영 실행·배포 설정은 미변경이다.

## 코치 운영 매칭 CLI runtime 연결 (2026-10-01)

`db:diagnose:coach-operation-matches`와 `db:backfill:coach-operation-matches`를 기본 encrypted PostgreSQL/명시 Mongo shadow 저장소 경계로 교체했다. 기존 매칭 엔진·진단 표·dry-run/`--apply`를 유지하고 이미 연결된 투입 비덮어쓰기, 재실행 0, catalog guard 최초 경합 재시도, PII 암호문 불변과 부분 namespace 무수정 거부를 확인했다. 상세 범위는 [코치 운영 매칭 CLI 문서](mongodb-coach-operation-match-cli.md)를 따른다. 운영 실행·배포 설정은 미변경이다.

## 코치 아카이브 서비스 백필 CLI runtime 연결 (2026-10-01)

legacy raw SQL `db:backfill:coach-archive-service-data`를 기본 encrypted PostgreSQL/명시 Mongo shadow repository로 교체했다. 최신 completed archive의 코치 운영 필드와 접속 로그를 단일 transaction으로 복원하고, 개인정보 암호화·재실행·후반 실패 전체 rollback·최초 upsert 경합 재시도·부분 namespace 무수정 거부를 확인했다. 상세 범위는 [코치 아카이브 서비스 백필 문서](mongodb-coach-archive-service-backfill.md)를 따른다. 운영 실행·배포 설정은 미변경이다.

## 중복 회사 병합 CLI runtime 연결 (2026-10-01)

legacy raw Prisma `db:merge:duplicate-company`를 기본 encrypted PostgreSQL/명시 Mongo shadow repository로 교체했다. source 회사는 보존하고 기존 병합 의미에 따라 중복 과정·라벨만 물리 삭제하며, 회차와 비중복 catalog 행은 target으로 이동한다. apply gate·단일 transaction·재실행·후반 실패 rollback과 공유 catalog guard를 확인했다. 상세 범위는 [중복 회사 병합 문서](mongodb-duplicate-company-merge.md)를 따른다. 운영 실행·배포 설정은 미변경이다.

## 강사노트 파일 가져오기 CLI runtime 연결 (2026-10-01)

암호화 스키마에서 중단되던 legacy raw pg `db:import:instructor-notes`를 기본 encrypted PostgreSQL/명시 Mongo shadow repository로 교체했다. 암호화 원천 복호화·PII 제거, Notion NO 우선/구형 이름 병합, 기존값 보존·recruitAvoid OR, counts-only 출력, apply gate와 전체 transaction rollback을 확인했다. Mongo 신규 생성 guard는 dry-run에서 쓰지 않으며 기존 Notion writer와 동시 경합도 검증했다. 상세 범위는 [강사노트 가져오기 문서](mongodb-instructor-note-import-cli.md)를 따른다. 실제 `.local` 원천·운영 실행·배포 설정은 미변경이다.

## 코치 데이터 검증 CLI runtime 연결 (2026-10-01)

legacy raw pg `db:verify:coach-data`를 기본 encrypted PostgreSQL/명시 prepared Mongo shadow 읽기 repository로 교체했다. 서비스 건수와 최근 import/아카이브를 한 snapshot에서 읽고 target 및 선택적 coach-db source의 read-only를 강제한다. 식별자·개인정보·원문 오류는 출력하지 않는다. 상세 범위는 [코치 데이터 검증 문서](mongodb-coach-data-verification-cli.md)를 따른다. 실제 원천·운영 DB·배포 설정은 미변경이다.

## 코치 DB 아카이브 CLI runtime 연결 (2026-10-01)

legacy raw pg `db:archive:coach-db`를 read-only PostgreSQL source와 기본 encrypted PostgreSQL/명시 prepared Mongo target 경계로 교체한다. source 단일 snapshot, rowKey/rowData 암호화·HMAC, dry-run 무쓰기, apply 전체 transaction과 중복 키 실패를 확인한다. 상세 범위는 [코치 DB 아카이브 CLI 문서](mongodb-coach-db-archive-cli.md)를 따른다. 실제 운영 아카이브·복원·실데이터 복사·배포 설정은 미변경이다.

## 코치 DB 가져오기 CLI runtime 연결 (2026-10-01)

legacy raw pg `db:import:coach`를 read-only PostgreSQL source와 기본 encrypted PostgreSQL/명시 prepared Mongo target 경계로 교체한다. source 9개 테이블의 단일 snapshot, dry-run 무쓰기, apply 전체 transaction, HMAC 기반 재실행, 수동 필드·기존 태그 보존, 누락 부모 오류 집계와 후반 실패 rollback을 확인한다. 상세 범위는 [코치 DB 가져오기 CLI 문서](mongodb-coach-db-import-cli.md)를 따른다. 실제 운영 import·외부 동기화·복원·실데이터 복사·배포 설정은 미변경이다.

## 팀원 파일 가져오기 CLI runtime 연결 (2026-10-01)

legacy raw pg `db:import:team-members`를 기본 encrypted PostgreSQL/명시 prepared Mongo shadow repository로 교체한다. 암호화 원천, 기존 역할·팀·이름 정규화와 입력 그룹별 비활성화, nullable 팀 legacy 중복 갱신, counts-only dry-run, apply gate와 전체 transaction rollback·재실행을 검증한다. Mongo 동시 import는 전용 guard로 직렬화하며 정상 CLI는 namespace를 준비·수리하지 않는다. 상세 범위는 [팀원 가져오기 문서](mongodb-team-member-import-cli.md)를 따른다. 실제 `.local` 원천·운영 실행·배포 설정은 미변경이다.

## 팀 단위 원천 승격 CLI runtime 연결 (2026-10-01)

legacy raw pg `db:promote-source-only`를 기본 encrypted PostgreSQL/명시 prepared Mongo shadow repository로 교체한다. 기존 팀 전체·복수 import run, 비차단 오류·지문 연결·Member 역할 명단·필드 변환을 유지하고 dry-run/apply 집계, 중복 지문, 전체 transaction rollback·재실행을 검증한다. 웹의 단일 run 승격은 변경하지 않는다. 상세 범위는 [팀 단위 원천 승격 문서](mongodb-source-only-promotion-cli.md)를 따른다. 운영 실행·배포 설정은 미변경이다.

## 운영 JSON 가져오기 CLI runtime 연결 (2026-10-01)

legacy raw pg `db:import:operations`를 기본 encrypted PostgreSQL/명시 prepared Mongo shadow repository로 교체한다. 기존 JSON 정규화·operationId/업무키 매칭·회사/과정/운영 갱신·가져오기 실행/원천 행을 유지하고 dry-run/apply, 같은 파일 중복, 암호화 저장, 전체 transaction rollback·재실행을 검증한다. 상세 범위는 [운영 JSON 가져오기 문서](mongodb-operation-import-cli.md)를 따른다. 운영 실행·배포 설정은 미변경이다.

## 만족도 CSV 드라이런 CLI runtime 연결 (2026-10-01)

보관된 수동 점검 도구 `satisfaction:dry-run`의 raw pg 조회를 기존 OperationRepository 기반 기본 encrypted PostgreSQL/명시 prepared Mongo shadow 읽기 경계로 교체한다. 기존 CSV 정규화·매칭·표시 의미, read-only와 오류 비노출을 유지하고 실제 두 저장소의 동일 결과와 저장 불변을 검증한다. 상세 범위는 [만족도 CSV 드라이런 문서](mongodb-satisfaction-dry-run-cli.md)를 따른다. 기능 재활성화·운영 CSV·Google 접근·배포 설정은 미변경이다.

## 운영 목록·상세·신규 화면 runtime 조립 (2026-10-01)

운영 목록·상세·신규 작성 page의 `operations`, `teamUsers`, `teamMembers`, `instructorNote`, `coach`, `omRequests`와 borrowed 맞춤 도구를 같은 명시 shadow scope로 조립한다. 실제 세 page를 MongoDB 8.0.30에서 실행해 PG fallback 없음, 조회 중 저장 불변, 부분 namespace 무수정 거부를 확인한다. 상세 범위는 [운영 화면 runtime 문서](mongodb-operation-pages-runtime.md)를 따른다. 운영 생성·수정·삭제 API와 Calendar/request audit, production selector, 실데이터 이전·복원·최종 전환은 미완료다.

## 운영 쓰기 API runtime 조립 (2026-10-01)

운영 생성·회차 추가·순서 변경·삭제 API를 Calendar 반영·request audit와 같은 명시 shadow scope로 조립한다. 실제 네 API를 MongoDB 8.0.30과 합성 Calendar remote에서 실행해 업무 저장·soft-delete·mapping·감사, Calendar 생성·삭제 실패 복구, legacy namespace 무수정 거부와 PG/비합성 외부 접근 0을 확인한다. local JSON의 기존 404·PG 무접근도 유지한다. 상세 범위는 [운영 쓰기 runtime 문서](mongodb-operation-write-runtime.md)를 따른다. 실제 Google, production selector, 실데이터 이전·복원·최종 전환은 미완료다.

## 운영 상세 보조 API runtime 검증 (2026-10-01)

검증된 운영 쓰기 runtime을 Drive 후보·폴더 조회, 선택 항목 적용, 원천 토론 새로고침 API까지 확장 검증한다. 외부 원천 미설정 상태의 명시 결과, Calendar-aware 적용, 요청 감사와 비합성 fetch 0을 실제 handler에서 확인한다. 상세 범위는 [운영 상세 보조 API 문서](mongodb-operation-detail-actions-runtime.md)를 따른다. 실제 Google Drive·Slack·메일, production selector와 운영 이전은 미완료다.

## 공통 개요 화면 runtime 조립 (2026-10-01)

대시보드·내 페이지·회사 위키·자료실 page의 `operations`, `teamMembers`, `teamUsers`, `omRequests`를 같은 명시 shadow scope로 조립한다. 실제 네 page를 MongoDB 8.0.30에서 실행해 PG fallback 없음, 조회 중 저장 불변, 부분 namespace 무수정 거부와 scope 혼입 차단을 확인한다. 상세 범위는 [공통 개요 화면 runtime 문서](mongodb-overview-pages-runtime.md)를 따른다. 실제 외부 원천, production selector, 실데이터 이전·복원·최종 전환은 미완료다.

## OM 요청 화면 runtime 검증 (2026-10-01)

기존 운영 화면 runtime의 `operations`, `teamUsers`, `teamMembers`, `instructorNote`, `omRequests`, borrowed `omCustomTools` 조립을 OM 요청 등록·관리·상세·수정·완료 page에도 재사용한다. 실제 다섯 page에서 권한·후보·초기값, PG fallback 없음, 조회 저장 불변, legacy 부분 namespace 무수정 거부를 확인한다. 상세 범위는 [OM 요청 화면 runtime 문서](mongodb-om-request-pages-runtime.md)를 따른다. 쓰기·배정 handler의 한 runtime 조립, production selector와 운영 이전은 미완료다.

## OM 요청 쓰기 runtime 조립 (2026-10-01)

OM 요청 생성·수정·삭제, 전체 배정 미리보기·확정, Calendar-aware operations·같은 namespace의 persistence/lock, request audit와 명시 effect port를 같은 shadow scope로 조립한다. 실제 API handler의 운영 자동 연결·Calendar 이벤트/매핑·맞춤 도구·합성 알림, 삭제 전 저장 평문 비노출, effect 실패 격리, PG fallback 없음, legacy 부분 namespace 무수정 거부를 확인한다. 상세 범위는 [OM 요청 쓰기 runtime 문서](mongodb-om-request-write-runtime.md)를 따른다. 실제 Slack·Google Calendar, production selector와 운영 이전은 미완료다.


## 강의 후속 알림 예약 runtime 조립 (2026-10-01)

`/api/reminders/lecture-followup`의 operations·teamUsers·requestActivity, Slack port와 Mongo HMAC 원자 선점 로그를 같은 등록 shadow scope로 조립한다. 실제 GET/POST에서 관리자·bearer 권한, D+1/D+7 묶음, 동시 요청 중 하나만 발송, 완료 후 재실행 중복 차단, 대상별 발송 실패, 완료 기록 실패, 요청 감사, 암호화 저장과 비공개 오류 비노출을 확인한다. [상세 범위와 한계](mongodb-lecture-followup-runtime.md)를 따른다. 외부 Slack과 단일 transaction인 exactly-once, 실제 Slack, Coolify 예약 설정, production selector와 운영 이전은 미완료다.

## 코치 동기화 예약 작업 runtime 조립 (2026-10-01)

Notion·계약·일정·`/sync/all` API의 저장 repository, 합성 source, 실행 로그와 요청 감사를 같은 등록 shadow scope로 조립한다. 실제 `/sync/all` bearer POST에서 세 원천의 단일 실행, 완료 로그·요청 감사, PG/비합성 외부 접근 0, 준비 재실행과 부분 namespace 무수정 거부를 확인한다. [상세 범위와 한계](mongodb-sync-jobs-runtime.md)를 따른다. 실제 원천·Coolify 예약·production selector와 운영 이전은 미완료다.

## 강사 Notion 동기화 runtime 조립 (2026-10-01)

강사 Notion 저장·합성 source·request audit를 같은 등록 shadow scope로 조립했다. 실제 handler, 준비/부분 namespace 불변, PG·외부 접근 0과 scope 차단을 확인했다. [상세 범위](mongodb-instructor-sync-runtime.md). 실제 원천·예약·production selector·운영 이전은 미완료다.

## 매출 동기화 runtime 조립 (2026-10-01)

매출 저장·합성 Salesmap source·실패 알림 port·request audit를 같은 등록 shadow scope로 조립했다. 실제 bearer POST, 동기화/요청 감사, 준비 재실행과 부분 namespace 불변, PG·외부 접근 0, 네 포트의 분해·혼입 차단을 확인했다. [상세 범위](mongodb-sales-sync-runtime.md). 실제 원천·알림·예약·production selector·운영 금액 반영과 운영 이전은 미완료다.

## 만족도 runtime 조립 (2026-10-01)

관리자 만족도 미리보기·자동 반영·수동 연결과 회차별 반영 API의 operations·합성 시트 source·request audit를 같은 등록 shadow scope로 조립했다. 실제 네 handler의 권한·매칭·기존 값 보존·감사, 준비 재실행과 부분 namespace 불변, PG·외부 접근 0, 세 포트의 분해·혼입 차단을 확인했다. [상세 범위](mongodb-satisfaction-runtime.md). 실제 Google Sheets·운영 만족도 반영·production selector와 운영 이전은 미완료다.

## 원천 읽기 상태 runtime 조립 (2026-10-01)

원천 상태 API의 operationSourceReader와 request audit를 같은 등록 shadow scope로 조립했다. 실제 handler의 네 원천 병렬 상태·개수 응답과 감사, 준비 재실행과 부분 namespace 불변, PG·외부 접근 0, 두 포트의 분해·혼입 차단을 확인했다. [상세 범위](mongodb-source-read-status-runtime.md). 실제 외부 원천·production selector와 운영 이전은 미완료다.

## Hubbot runtime 조립 (2026-10-01)

Hubbot POST의 합성 responder와 request audit를 같은 등록 shadow scope로 조립했다. 기존 질문·history 계약, 감사 비본문 저장, 준비·부분 namespace 불변과 PG·외부 접근 0을 확인했다. [상세 범위](mongodb-hubbot-runtime.md). 실제 Anthropic·Google·Notion·production selector와 운영 이전은 미완료다.

## 원천 읽기 상태 기능군 selector (2026-10-01)

`/api/source-reads/status`에 첫 기능군 composition selector를 연결했다. 기본은 기존 PostgreSQL이고 정확한 `mongodb-shadow` 선택에서만 URI·database·namespace·암호화 키를 선검증한 뒤 준비된 runtime을 연다. request audit와 source reader는 같은 scope를 사용하며 실패 시 PostgreSQL로 fallback하지 않는다. [상세 범위](mongodb-source-read-status-composition.md). 다른 기능군 selector와 생산 배포 설정, 실데이터 이전·복원·최종 전환은 미완료다.
