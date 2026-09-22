# MongoDB 전환 범위와 남은 PostgreSQL 의존성

확인 기준: `7ebb24f` 이후 코치 투입·평가 경계 작업 트리, 2026-09-22. `src`의 테스트 외 소스에서 실제 연결 생성·Prisma delegate 호출·raw SQL·repository factory와 간접 호출을 읽어 구분했다. 이 문서는 코드 경로 조사이며 운영 DB 접속이나 운영 데이터 검증 결과가 아니다. 아래 진행 상태는 이 기준 시점의 기록이다.

**35개 모델의 복사/codec 지원은 앱 전체 전환 완료를 의미하지 않는다. 생산 factory와 직접 API는 여전히 PostgreSQL을 사용한다.** 기존 Mongo 구현은 별도 shadow DB/namespace에서 직접 여는 병렬 검증용이다. 환경변수 이름만 바꾸거나 기존 factory 몇 개를 바꾸는 것으로 아래 직접·간접 경로가 함께 전환되지 않는다.

## 이미 구현한 병렬 경로와 이번 작업

| 기능 | Mongo 구현 상태 | 생산 연결 상태 |
| --- | --- | --- |
| 운영 목록·상세·생성·수정·soft-delete·과정 검색·요약 | `MongoOperationRepository` 구현·합성 검증. Company/Course/CourseIdLabel/OperationSession/OperationSourceRecord/TeamUser/ActivityChange 사용 | `operationRepositoryFactory.ts`는 `CalendarReflectingOperationRepository(new PrismaOperationRepository())` 유지. Mongo 감사 쓰기가 전역 활동 기록을 대체하지 않음 |
| 코치 공개 조회 6개·개인정보 조회 2개 | `MongoCoachRepository`, `MongoCoachPrivateRepository` 구현·합성 검증. 분야/커리큘럼/일정/예약/archive 관계 포함 | 공개 coach factory는 Prisma 고정. private factory는 명시 context 주입 지원, 기본은 Prisma. 토큰 인증은 명시 context 지원, 기본 PG 유지 |
| Member/TeamUser 기반 명단 조회 | `MongoTeamMemberRepository` 구현·합성 검증 | TeamMember factory는 기존 local/Prisma/Notion fallback 유지 |
| InstructorNote 조회·쓰기 | shadow 구현과 Mongo8.0.30 실제 save handler 검증 완료 | factory는 명시 context 우선, 기본 local/Prisma 유지. Notion 직접 PG 경로 별도 |
| Coach CRUD | shadow 구현과 Mongo8.0.30 관리 API 경계 검증 완료. 업무/ActivityChange 실패 rollback 확인 | 두 관리 API는 repository 호출로 변경. 명시 context 외 기본 PG 유지. 일정/섭외/마스터·토큰·복원은 별도 |
| TeamUser 생성·팀/역할 수정 | shadow 구현과 Mongo8.0.30 합성 검증 완료. guard 중복 경쟁·감사 실패 rollback 확인. 물리삭제는 정책 충돌로 차단 | 기존 export 함수는 context 우선 facade. 기본 legacy PG/local 유지. 모든 writer의 guard 참여 필요 |
| 코치 월간 일정·예약 | `MongoCoachScheduleRepository` 및 실제handler 합성검증 경계. 월 교체/접근 로그/예약 선점·자기취소, active unique·transaction·암호화·감사 | 지정 3개 API는 context 우선/기본 Prisma. 투입·시트 writer와 coach guard 공유, Notion은 별도 |
| 코치 투입·평가 | `MongoCoachEngagementRepository`, 슬롯 교체·예약 자동취소·평가 이력 원자화와 공통 scheduling guard | 3개 API context 경계/기본 PG. contract/Samsung도 catalog→coach guard 참여, Notion은 미완료 gate |
| 전체 모델 암호화 snapshot export/import | 35개 모델 codec·일관된 PG 읽기 snapshot·사본 대조·참조 검증 지원 | 운영 서비스 선택·실시간 변경 동기화·최종 freeze/cutover·복구 승인은 별도 |

## 남은 기능군별 실제 경로

경로는 저장소 상대 경로다. 모델에는 직접 delegate 및 관계/보조 저장소를 통한 의존성을 함께 적었다.

| 기능군 | 실제 PostgreSQL 진입점·연결 경로 | 모델·PG 기능 | 남은 전환 범위 |
| --- | --- | --- | --- |
| 공통 연결·암호화 | `src/lib/data/prisma.ts` → `PrismaPg` → `withPrivacyDatabase` → `withActivityDatabase` | 전 모델; SQL transaction·Prisma 확장 | 생산 선택과 오류·암복호화·transaction 계약 전환. 타입 이름 제거 작업과 구분 |
| 운영·과정의 별도 관리자 기능 | `api/admin/courses/lookup`, `api/admin/courses/[courseId]`, `api/admin/deleted-operations`, `api/admin/onsite-required-backfill`, `api/admin/om-assignment-status-backfill`, `lib/data/courseNameRestore.ts` | Company, Course, OperationSession, OperationSourceRecord, 활동 감사 | 기본 OperationRepository 외 직접 수정/복원/일괄 작업·경합·감사 검증 |
| OM 접수·배정·권한 | `lib/data/omRequest/omRequestLocalRepository.ts`, `omRequestAssignment.ts`, `lib/auth/omRequestAssignmentAccess.ts` → `listTeamUsers()` | OmRequest, OperationSession, TeamUser, ActivityChange | 이름에 Local이 있어도 운영에서는 PG. 접수·배정 원자성·중복/사람 수정 정책·명단 기반 권한 동등성 필요 |
| 팀 사용자 관리 | `lib/data/teamUsers/teamUserRepository.ts` → 기본 `legacyTeamUserRepository.ts` → TeamUser delegate | TeamUser; local JSON은 개발 분기 | 명단/권한 호출부는 facade를 유지하며 context 주입 검증. 생산 선택과 전체 writer 일치 필요. Member 조회는 별도 |
| 코치 CRUD·태그 마스터 | `api/coaches`, `api/coaches/[id]`, `api/coaches/[id]/regenerate-token`, `api/master/fields`, `api/master/curriculums`, `api/admin/deleted-coaches` | Coach, CoachPrivateProfile, CoachField/Curriculum, 두 Master | 두 CRUD API는 context/기본 Prisma adapter로 연결. 토큰 재발급도 context 경계 연결. 마스터 API·삭제 복원 경로 미전환 |
| 코치 인증·본인 페이지·개인정보 열람 | `lib/coaches/coachTokenAuth.ts`, `lib/data/coachMyPage.ts`, `coachPrivateAccess.ts`, `coachAccessTokenBackfill.ts`, `api/coach/me`, `api/coaches/export` | Coach, CoachPrivateProfile, CoachPrivateAccessLog, CoachdbArchiveRow, 예약·섭외 | 토큰 lookup/본인 API/export는 명시context 연결 및 합성검증. 기본PG이며 manager coachMyPage·backfill은 별도 미전환 |
| 가용 일정·예약·섭외 | `api/coaches/[id]/schedules`, `/reservations`, `/engagements`, `api/coach/schedule/[yearMonth]`, `api/engagements/[id]`, `/review`; `lib/coaches/engagementApi.ts`, `reservationAutoCancel.ts` | CoachSchedule, CoachScheduleAccessLog, CoachDayReservation, CoachEngagement, CoachEngagementSchedule, Coach | 월일정 GET/PUT·예약 POST/DELETE·매니저일정 GET은 context 경계. 수동 섭외확정/자동취소/평가는 context 경계 및 일정·예약 공통 guard. contract/Samsung 동기화·삭제 관계 transaction은 별도 시트 경계에서 구현. Notion은 남음 |
| 코치 메모·콘텐츠·관리 조회 | `lib/coaches/contentEntries.ts`, `api/coaches/[id]/notes`, `api/admin/content-entries`, `api/admin/schedule-registration/[yearMonth]`, `api/schedules/[yearMonth]/status`, `app/coaches/admin/page.tsx` | CoachContentEntry, CoachEngagement, CoachScheduleAccessLog, Coach | 메모 생성·관리·검토·등록 현황 및 직접 페이지 조회 |
| 코치 외부 동기화 | `lib/coaches/notionCoachSync.ts`, `samsungScheduleSync.ts`, `contractSheetSync.ts`, `syncLog.ts` | Coach, PrivateProfile, Field/Curriculum/Master, Engagement/Schedule, CoachSyncLog | contract/Samsung 및 로그는 명시 Mongo context, 합성 source와 실제 handler 검증. Notion/all은 scope에서 외부 읽기 전 차단하며 기본 PG 유지 |
| 강사 위키·노션 동기화 | `lib/data/prismaInstructorNoteRepository.ts`, `lib/instructors/notionInstructorSync.ts` | InstructorNote | 실제 save route의 명시 context 검증 완료. 기본 factory와 직접 Notion upsert는 여전히 PG |
| 가져오기·staging·승격·Drive 기록 | `lib/data/prismaImportRepository.ts`, `importStagingWriter.ts`, `importPromotionService.ts`, `lib/driveImports/driveImportResults.ts`; `api/admin/imports/{upload,google-sheets/import,notion/import}`; `app/admin/imports/**` | DataImportRun, OperationSourceRecord, Company, Course, OperationSession, DriveImportRun, DriveImportResult | staging 오류 보존·승격·중복 식별·일괄 원자성·관리 페이지. 외부 소스 읽기 자체와 PG 적재 구분 |
| 매출 동기화 | `lib/data/salesRevenueSync.ts` | Course, SalesRevenueSyncLog | 금액/동기화 전후 값·감사·재시도, 실제 운영 쓰기 승인 별도 |
| Google Calendar | `lib/data/calendarReflectingOperationRepository.ts` → calendar 모듈; `lib/googleCalendar/calendarEventLinkRepository.ts`, `operationSessionTimestamps.ts`, `calendarOperationLock.ts` | CalendarEventLink, OperationSession; 별도 `pg.Pool`, advisory lock | 이벤트 연결·역동기화·시각 갱신·프로세스 간 잠금. Mongo operation CRUD만으로 외부 캘린더 부작용을 대체하지 않음 |
| 공지·첨부 | `app/announcements/**`, `api/announcements/**` | Announcement, AnnouncementAttachment | 목록/상세/수정/삭제/첨부 byte 저장·다운로드·권한·암복호화 |
| 활동 요청·변경 이력·활동 피드 | `lib/activity/request.ts`, `database.ts`, `retention.ts`, `presentation.ts`; `api/activity-feed`, `api/admin/activity`, `/usage` | ActivityRequest, ActivityChange 및 이름 해석에 쓰이는 업무 모델; `set_config`, PG trigger, SQL DELETE | 전역 middleware·트리거 귀속·보존기간 정리·관리 조회 전환. MongoOperation의 ActivityChange 기록은 이 전체를 대체하지 않음 |
| 관리자 DB·백업·건강 확인 | `lib/admin/databaseDashboard.ts`, `api/admin/database/cell`, `api/admin/backup`, `api/health` | 여러 업무 모델 및 archive snapshot raw SQL; `SELECT 1` | 관리 화면/셀 수정/백업 범위·health의 DB 판정·복구 절차. PG health를 그대로 두면 Mongo 상태를 확인하지 못함 |

## 간접 의존성과 오탐 제외

- `withActivity`는 명시 context에서 Mongo 요청 로그·retention을 사용하고, context가 없을 때 기존 PG 경로를 유지한다. Mongo 기록 실패 시 PG로 재시도하지 않는다. 최초 조사 시점 `src/app`의 테스트 외 `withActivity` 사용 파일은 72개였다. 이는 전환 완료율이나 독립 DB 연결 수가 아니다.
- OM 배정 권한은 `omRequestAssignmentAccess.ts` → `teamUserRepository.ts` → PG TeamUser를 읽는다. 인증 화면만 정상이라고 실제 배정 권한까지 Mongo로 바뀐 것은 아니다.
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
| `src/app/announcements/[id]/edit/page.tsx` | Announcement |
| `src/app/announcements/[id]/page.tsx` | Announcement |
| `src/app/announcements/page.tsx` | Announcement |
| `src/app/api/activity-feed/route.ts` | ActivityRequest, ActivityChange |
| `src/app/api/admin/activity/route.ts` | Coach, CoachContentEntry, ActivityRequest, ActivityChange |
| `src/app/api/admin/activity/usage/route.ts` | ActivityRequest, ActivityChange |
| `src/app/api/admin/backup/route.ts` | Coach, CoachPrivateProfile, CoachFieldMaster, CoachCurriculumMaster, CoachField, CoachCurriculum, CoachSchedule, CoachScheduleAccessLog, CoachEngagement, CoachEngagementSchedule, CoachImportRun |
| `src/app/api/admin/content-entries/route.ts` | Coach, CoachContentEntry, CoachEngagement |
| `src/app/api/admin/courses/[courseId]/route.ts` | Course, OperationSession |
| `src/app/api/admin/courses/lookup/route.ts` | Company, Course |
| `src/app/api/admin/database/cell/route.ts` | Company, Course, OperationSession, Member |
| `src/app/api/admin/deleted-coaches/route.ts` | Coach |
| `src/app/api/admin/deleted-operations/route.ts` | Company, Course, OperationSession |
| `src/app/api/admin/om-assignment-status-backfill/route.ts` | OperationSession |
| `src/app/api/admin/onsite-required-backfill/route.ts` | OperationSession |
| `src/app/api/admin/schedule-registration/[yearMonth]/route.ts` | Coach, CoachScheduleAccessLog |
| `src/app/api/announcements/[id]/attachments/[attachmentId]/route.ts` | AnnouncementAttachment |
| `src/app/api/announcements/[id]/route.ts` | Announcement |
| `src/app/api/announcements/route.ts` | Announcement |
| `src/app/api/coaches/[id]/notes/route.ts` | CoachContentEntry |
| `src/app/api/health/route.ts` | 중앙 연결·raw SQL 또는 동적 delegate: 본문 기능군 참조 |
| `src/app/api/master/curriculums/route.ts` | CoachCurriculumMaster |
| `src/app/api/master/fields/route.ts` | CoachFieldMaster |
| `src/app/api/schedules/[yearMonth]/status/route.ts` | Coach, CoachScheduleAccessLog |
| `src/app/coaches/admin/page.tsx` | Coach |
| `src/lib/activity/request.ts` | ActivityRequest |
| `src/lib/admin/databaseDashboard.ts` | Company, Course, OperationSession, DriveImportRun, DriveImportResult, Member, DataImportRun, OperationSourceRecord |
| `src/lib/coaches/contentEntries.ts` | CoachContentEntry |
| `src/lib/data/prismaCoachSheetSyncRepository.ts` | Coach, CoachPrivateProfile, CoachEngagement, CoachEngagementSchedule, CoachDayReservation; catalog→coach locks |
| `src/lib/coaches/notionCoachSync.ts` | Coach, CoachPrivateProfile, CoachFieldMaster, CoachCurriculumMaster, CoachField, CoachCurriculum |
| `src/lib/data/coachSyncLogRepositoryFactory.ts` | CoachSyncLog PG default adapter |
| `src/lib/data/coachAccessTokenBackfill.ts` | Coach, CoachdbArchiveRow |
| `src/lib/data/coachMyPage.ts` | Coach, CoachDayReservation, CoachEngagement, CoachEngagementSchedule |
| `src/lib/data/coachPrivateAccess.ts` | CoachPrivateAccessLog |
| `src/lib/data/courseNameRestore.ts` | Company, Course, OperationSession |
| `src/lib/data/importPromotionService.ts` | Company, Course, OperationSession, DataImportRun, OperationSourceRecord |
| `src/lib/data/importStagingWriter.ts` | DataImportRun, OperationSourceRecord |
| `src/lib/data/omRequest/omRequestAssignment.ts` | OperationSession, OmRequest, ActivityChange |
| `src/lib/data/omRequest/omRequestLocalRepository.ts` | OmRequest |
| `src/lib/data/prismaCoachTokenRepository.ts` | Coach, CoachdbArchiveRow |
| `src/lib/data/prismaCoachTokenRotationRepository.ts` | Coach |
| `src/lib/data/prismaCoachExportRepository.ts` | Coach, CoachPrivateAccessLog |
| `src/lib/data/prismaCoachManagementRepository.ts` | Coach, CoachPrivateProfile, CoachFieldMaster, CoachCurriculumMaster, CoachField, CoachCurriculum |
| `src/lib/data/prismaCoachPrivateRepository.ts` | CoachPrivateProfile, CoachEngagement |
| `src/lib/data/prismaCoachEngagementRepository.ts` | Coach, CoachEngagement, CoachEngagementSchedule, CoachDayReservation, CoachContentEntry; 공통 coach advisory lock |
| `src/lib/data/prismaCoachScheduleRepository.ts` | CoachSchedule, CoachScheduleAccessLog, CoachDayReservation, CoachEngagement, CoachEngagementSchedule, Coach; 예약/일정 advisory transaction lock |
| `src/lib/data/prismaCoachRepository.ts` | Coach, CoachSchedule, CoachDayReservation, CoachEngagement, CoachEngagementSchedule, CoachdbArchiveRow |
| `src/lib/data/prismaImportRepository.ts` | Company, Course, DataImportRun |
| `src/lib/data/prismaInstructorNoteRepository.ts` | InstructorNote |
| `src/lib/data/prismaOperationRepository.ts` | Company, Course, CourseIdLabel, OperationSession |
| `src/lib/data/prismaTeamMemberRepository.ts` | Member, TeamUser |
| `src/lib/data/salesRevenueSync.ts` | Course, SalesRevenueSyncLog |
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
