# MongoDB 전환 범위와 남은 PostgreSQL 의존성

최초 전체 경로 조사: `7ebb24f` 이후 코치 투입·평가 경계, 2026-09-22. 이후 시트·Notion 작업의 변경 경계를 표와 후속 기록에 누적 반영했다. `src`의 테스트 외 소스에서 실제 연결 생성·Prisma delegate 호출·raw SQL·repository factory와 간접 호출을 읽어 구분했다. 이 문서는 코드 경로 조사이며 운영 DB 접속이나 운영 데이터 검증 결과가 아니다. 아래 진행 상태는 이 기준 시점의 기록이다.

**35개 모델의 복사/codec 지원은 앱 전체 전환 완료를 의미하지 않는다. 생산 factory와 직접 API는 여전히 PostgreSQL을 사용한다.** 기존 Mongo 구현은 별도 shadow DB/namespace에서 직접 여는 병렬 검증용이다. 환경변수 이름만 바꾸거나 기존 factory 몇 개를 바꾸는 것으로 아래 직접·간접 경로가 함께 전환되지 않는다.

## 이미 구현한 병렬 경로와 이번 작업

| 기능 | Mongo 구현 상태 | 생산 연결 상태 |
| --- | --- | --- |
| 운영 목록·상세·생성·수정·soft-delete·과정 검색·요약 | `MongoOperationRepository` 구현·합성 검증. Company/Course/CourseIdLabel/OperationSession/OperationSourceRecord/TeamUser/ActivityChange 사용 | `operationRepositoryFactory.ts`는 명시 operations context 우선, 밖에서는 `CalendarReflectingOperationRepository(new PrismaOperationRepository())` 유지. Mongo 감사 쓰기가 전역 활동 기록을 대체하지 않음 |
| 코치 공개 조회 6개·개인정보 조회 2개 | `MongoCoachRepository`, `MongoCoachPrivateRepository` 구현·합성 검증. 분야/커리큘럼/일정/예약/archive 관계 포함 | 공개 coach factory는 Prisma 고정. private factory는 명시 context 주입 지원, 기본은 Prisma. 토큰 인증은 명시 context 지원, 기본 PG 유지 |
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
| 가져오기·staging·승격·Drive 기록 | `lib/data/prismaImportRepository.ts`, `importStagingWriter.ts`, `importPromotionService.ts`, `lib/driveImports/driveImportResults.ts`; `api/admin/imports/{upload,google-sheets/import,notion/import}`; `app/admin/imports/**` | DataImportRun, OperationSourceRecord, Company, Course, OperationSession, DriveImportRun, DriveImportResult | staging 오류 보존·승격·중복 식별·일괄 원자성·관리 페이지. 외부 소스 읽기 자체와 PG 적재 구분 |
| 매출 동기화의 생산 연결 | `lib/data/prismaSalesRevenueSyncRepository.ts`와 기본 Salesmap/알림 adapter | Course, SalesRevenueSyncLog | 명시 Mongo 경계는 구현. 전체 생산 구성·실제 원천/운영 금액 반영은 별도 |
| Google Calendar | `lib/data/calendarReflectingOperationRepository.ts` → calendar 모듈; `lib/googleCalendar/calendarEventLinkRepository.ts`, `operationSessionTimestamps.ts`, `calendarOperationLock.ts` | CalendarEventLink, OperationSession; 별도 `pg.Pool`, advisory lock | 이벤트 연결·역동기화·시각 갱신·프로세스 간 잠금. Mongo operation CRUD만으로 외부 캘린더 부작용을 대체하지 않음 |
| 활동 요청·변경 이력·활동 피드 | `lib/activity/request.ts`, `database.ts`, `retention.ts`, `presentation.ts`; `api/activity-feed`, `api/admin/activity`, `/usage` | ActivityRequest, ActivityChange 및 이름 해석에 쓰이는 업무 모델; `set_config`, PG trigger, SQL DELETE | 조회 세 GET는 명시 activityReads context/기본PG 경계로 연결했다. 전역 요청 연결·트리거 귀속·보존 작업의 실제 운영 연결은 별도다. MongoOperation의 ActivityChange 기록은 이 전체를 대체하지 않음 |
| 관리자 DB·백업·건강 확인 | `lib/admin/databaseDashboard.ts`, `api/admin/database/cell`, `api/admin/backup`, `api/health` | 여러 업무 모델 및 archive snapshot raw SQL; `SELECT 1` | 8표 조회/4표 셀 수정과 페이지 담당자 명단은 명시 context로 연결. 백업 범위·health의 DB 판정·복구 절차는 미전환. PG health를 그대로 두면 Mongo 상태를 확인하지 못함 |

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
| `src/app/api/health/route.ts` | 중앙 연결·raw SQL 또는 동적 delegate: 본문 기능군 참조 |
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
| `src/lib/data/importPromotionService.ts` | Company, Course, OperationSession, DataImportRun, OperationSourceRecord |
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
| `src/lib/driveImports/driveImportResults.ts` | DriveImportRun, DriveImportResult |
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

현장 투입 여부·OM 배정 상태 보정의 두 GET/POST를 별도 repository로 연결했다. 원본 exact 조건·부분 갱신·재실행0을 보존하며 Mongo 후보 HMAC/원문 검증·감사 원자성을 검증한다. 최신 실행·독립 리뷰·통합 상태는 `.claude/plans/mongodb-operation-backfill/`을 따른다. `/admin/database` 호스트 전체 및 legacy PG CLI `scripts/backfill-onsite-required-y.ts`는 이번 범위 밖이다. 운영 보정 실행과 전체 이전은 미완료다.

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
