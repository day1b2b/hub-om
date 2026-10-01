import type { ActivityPruneRepository } from "./activityPruneRepository";
import type { AdminBackupRepository } from "./adminBackupRepository";
import type { DatabaseHealthRepository } from "./databaseHealthRepository";
import type { GoogleSheetsImportSource } from "./googleSheetsImportSource";
import type { NotionImportSource } from "./notionImportSource";
import type { DriveImportSource } from "./driveImportSource";
import type { DriveImportWriterRepository } from "./driveImportWriterRepository";
import type { DriveImportHistoryRepository } from "./driveImportHistoryRepository";
import type { CalendarPersistence, CalendarLockPort } from "../googleCalendar/calendarPersistence";
import type { OmAssignmentRepository } from "./omRequest/omAssignmentContract";
import type { OmAssignmentCalendar, OmAssignmentNotifier } from "./omRequest/omAssignmentEffects";
import type { OperationRepository } from "./operationRepository";
import type { OmRequestRepository, OmCustomToolsRepository, OmRequestNotifier } from "./omRequest/omRequestRepository";
import type { SalesRevenueSyncRepository, SalesRevenueSource, SalesRevenueNotifier } from "./salesRevenueSyncRepository";
import type { InstructorNotionSource, InstructorNotionSyncRepository } from "./instructorNotionSyncRepository";
import type { ActivityReadRepository } from "./activityReads/activityReadRepository";
import type { AnnouncementRepository } from "./announcements/announcementRepository";
import type { AdminDatabaseRepository } from "./adminDatabaseRepository";
import type { TeamMemberRepository } from "./teamMemberRepository";
import type { CourseNameRestoreRepository } from "./courseNameRestoreRepository";
import type { OperationBackfillRepository } from "./operationBackfillRepository";
import type { DeletedOperationRepository } from "./deletedOperationRepository";
import type { CourseAdminRepository } from "./courseAdminRepository";
import type { CoachTokenBackfillRepository } from "./coachTokenBackfillRepository";
import type { CoachManagerMyPageRepository } from "./coachManagerMyPageRepository";
import type { CoachContentRepository } from "./coachContentRepository";
import type { CoachRepository } from "./coachRepository";
import type { CoachNotionSyncRepository, CoachNotionSource } from "./coachNotionSyncRepository";
import type { CoachSyncLogRepository } from "./coachSyncLogRepository";
import type { CoachSheetSyncRepository, CoachSheetSource } from "./coachSheetSyncRepository";
import type { CoachEngagementRepository } from "./coachEngagementRepository";
import type { CoachScheduleRepository } from "./coachScheduleRepository";
import type { CoachExportRepository } from "./coachExportRepository";
import type { CoachTokenRepository } from "./coachTokenRepository";
import type { CoachTokenRotationRepository } from "./coachTokenRotationRepository";
import { AsyncLocalStorage } from "node:async_hooks";
import type { CoachManagementRepository } from "./coachManagementRepository";
import type { CoachAdminRepository } from "./coachAdminRepository";
import type { TeamUserRepository } from "./teamUsers/teamUserRepositoryContract";
import type { InstructorNoteRepository } from "./instructorNoteRepository";
import type { CoachPrivateRepository } from "./coachPrivateRepository";
import type { ActivityContext } from "../activity/context";
import type { ImportPromotionRepository, SourceOnlyPromotionRepository } from "./importPromotionContract";
import type { ImportPromotionCalendar } from "./importPromotionEffects";
import type { ImportRepository } from "./importRepository";
import type { ImportStagingRepository } from "./importStagingWriter";
import type { CoachOperationMatchRepository } from "./coachOperationMatchRepository";
import type { CoachArchiveServiceBackfillRepository } from "./coachArchiveServiceBackfillRepository";
import type { DuplicateCompanyMergeRepository } from "./duplicateCompanyMergeRepository";
import type { InstructorNoteImportRepository } from "./instructorNoteImportRepository";
import type { CoachDataVerificationRepository } from "./coachDataVerificationRepository";
import type { CoachDbArchiveRepository } from "./coachDbArchiveRepository";
import type { CoachDbImportRepository } from "./coachDbImportRepository";
import type { TeamMemberImportRepository } from "./teamMemberImportRepository";
import type { OperationImportRepository } from "./operationImportRepository";
import type { LectureFollowUpNotifier, LectureFollowUpSentLog } from "../reminders/lectureFollowUpReminder";

export interface RequestActivityRepository {
  recordRequest(context: ActivityContext, status: number, durationMs: number): Promise<void>;
}
export interface CoachPrivateAccessLogRepository {
  recordAccess(coachId: string, accessedByEmail: string, context: string): Promise<void>;
}
export interface DataRepositories {
  lectureFollowUpNotifier: LectureFollowUpNotifier;
  lectureFollowUpSentLog: LectureFollowUpSentLog;
  operationImport: OperationImportRepository;
  sourceOnlyPromotion: SourceOnlyPromotionRepository;
  teamMemberImport: TeamMemberImportRepository;
  coachDbImport: CoachDbImportRepository;
  coachDbArchive: CoachDbArchiveRepository;
  activityPrune: ActivityPruneRepository;
  adminBackup: AdminBackupRepository;
  databaseHealth: DatabaseHealthRepository;
  driveImportWriter: DriveImportWriterRepository;
  driveImportSource: DriveImportSource;
  notionImportSource: NotionImportSource;
  googleSheetsImportSource: GoogleSheetsImportSource;
  driveImportHistory: DriveImportHistoryRepository;
  calendarPersistence: CalendarPersistence;
  calendarLock: CalendarLockPort;
  importPromotion: ImportPromotionRepository;
  importPromotionCalendar: ImportPromotionCalendar;
  imports: ImportRepository & ImportStagingRepository;
  omAssignment: OmAssignmentRepository;
  omAssignmentCalendar: OmAssignmentCalendar;
  omAssignmentNotifier: OmAssignmentNotifier;
  omRequests: OmRequestRepository;
  operations: OperationRepository;
  omCustomTools: OmCustomToolsRepository;
  omRequestNotifier: OmRequestNotifier;
  salesRevenueSync: SalesRevenueSyncRepository;
  salesRevenueSource: SalesRevenueSource;
  salesRevenueNotifier: SalesRevenueNotifier;
  instructorNotionSync: InstructorNotionSyncRepository;
  instructorNotionSource: InstructorNotionSource;
  activityReads: ActivityReadRepository;
  announcements: AnnouncementRepository;
  adminDatabase: AdminDatabaseRepository;
  teamMembers: TeamMemberRepository;
  courseNameRestore: CourseNameRestoreRepository;
  operationBackfill: OperationBackfillRepository;
  deletedOperations: DeletedOperationRepository;
  courseAdmin: CourseAdminRepository;
  coachTokenBackfill: CoachTokenBackfillRepository;
  coachManagerMyPage: CoachManagerMyPageRepository;
  coachContent: CoachContentRepository;
  coach: CoachRepository;
  coachNotionSync: CoachNotionSyncRepository;
  coachNotionSource: CoachNotionSource;
  coachSyncLog: CoachSyncLogRepository;
  coachSheetSync: CoachSheetSyncRepository;
  coachSheetSource: CoachSheetSource;
  coachEngagement: CoachEngagementRepository;
  coachSchedule: CoachScheduleRepository;
  coachExport: CoachExportRepository;
  coachToken: CoachTokenRepository;
  coachTokenRotation: CoachTokenRotationRepository;
  coachManagement: CoachManagementRepository;
  coachAdmin: CoachAdminRepository;
  teamUsers: TeamUserRepository;
  instructorNote: InstructorNoteRepository;
  coachPrivate: CoachPrivateRepository;
  coachPrivateAccessLog: CoachPrivateAccessLogRepository;
  coachOperationMatch: CoachOperationMatchRepository;
  coachArchiveServiceBackfill: CoachArchiveServiceBackfillRepository;
  duplicateCompanyMerge: DuplicateCompanyMergeRepository;
  instructorNoteImport: InstructorNoteImportRepository;
  coachDataVerification: CoachDataVerificationRepository;
  requestActivity: RequestActivityRepository;
}

const globalForRepositories = globalThis as unknown as {
  hubOmDataRepositories?: AsyncLocalStorage<Readonly<Partial<DataRepositories>>>;
  hubOmRegisteredRepositoryScopes?: WeakMap<object, Readonly<Partial<DataRepositories>>>;
  hubOmLockedRepositoryScope?: AsyncLocalStorage<Readonly<Partial<DataRepositories>>>;
};
const repositoryContext = globalForRepositories.hubOmDataRepositories ??= new AsyncLocalStorage<Readonly<Partial<DataRepositories>>>();

/** Internal, explicit shadow/test boundary. No HTTP header, cookie or environment selects it.
 * Overrides select storage only; they never grant authentication or authorization.
 */
export function runWithDataRepositories<T>(repositories: Partial<DataRepositories>, work: () => T): T {
  const locked = lockedRepositoryScope.getStore();
  if (locked && Object.entries(locked).some(([name, item]) => repositories[name as keyof DataRepositories] !== item)) {
    throw new Error("CALENDAR_SCOPE_MISMATCH");
  }
  assertRegisteredRepositoryScope(repositories);
  return repositoryContext.run(Object.freeze({ ...repositories }), work);
}

/** Absent scope keeps the existing production backend. Missing scoped services fail closed. */
export function getDataRepositoryOverride<K extends keyof DataRepositories>(name: K): DataRepositories[K] | undefined {
  const repositories = repositoryContext.getStore();
  if (!repositories) return undefined;
  const repository = repositories[name];
  if (!repository) throw new Error(`DATA_REPOSITORY_NOT_CONFIGURED: ${name}`);
  return repository;
}

export function assertDefaultDatabaseAccess(): void {
  if (repositoryContext.getStore()) throw new Error("DEFAULT_DATABASE_ACCESS_BLOCKED");
}

// Registered Calendar runtimes require their complete, immutable composition.
// This checks object references before work (including request audit) can start.
// Existing unregistered test scopes and the default backend retain their behavior.
const registeredScopes = globalForRepositories.hubOmRegisteredRepositoryScopes ??= new WeakMap<object, Readonly<Partial<DataRepositories>>>();
export function registerDataRepositoryScope(repositories: Readonly<Partial<DataRepositories>>): void {
  const expected = Object.freeze({ ...repositories });
  for (const value of Object.values(expected)) {
    const prior = registeredScopes.get(value);
    if (prior && Object.entries(prior).some(([name, item]) => expected[name as keyof DataRepositories] !== item)) {
      throw new Error("CALENDAR_SCOPE_MISMATCH");
    }
  }
  for (const value of Object.values(expected)) registeredScopes.set(value, expected);
}
function assertRegisteredRepositoryScope(repositories: Partial<DataRepositories>): void {
  for (const value of Object.values(repositories)) {
    if (!value) continue;
    const expected = registeredScopes.get(value);
    if (expected && Object.entries(expected).some(([name, item]) => repositories[name as keyof DataRepositories] !== item)) {
      throw new Error("CALENDAR_SCOPE_MISMATCH");
    }
  }
}

const lockedRepositoryScope = globalForRepositories.hubOmLockedRepositoryScope ??= new AsyncLocalStorage<Readonly<Partial<DataRepositories>>>();
/** A held Calendar lease cannot be carried into another repository scope. */
export function runWithLockedRepositoryScope<T>(work: () => T): T {
  const current = repositoryContext.getStore();
  return current ? lockedRepositoryScope.run(current, work) : work();
}
