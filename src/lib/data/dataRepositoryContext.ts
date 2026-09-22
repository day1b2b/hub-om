import type { CoachSyncLogRepository } from "./coachSyncLogRepository";
import type { CoachSheetSyncRepository, CoachSheetSource } from "./coachSheetSyncRepository";
import type { CoachEngagementRepository } from "./coachEngagementRepository";
import type { CoachScheduleRepository } from "./coachScheduleRepository";
import type { CoachExportRepository } from "./coachExportRepository";
import type { CoachTokenRepository } from "./coachTokenRepository";
import type { CoachTokenRotationRepository } from "./coachTokenRotationRepository";
import { AsyncLocalStorage } from "node:async_hooks";
import type { CoachManagementRepository } from "./coachManagementRepository";
import type { TeamUserRepository } from "./teamUsers/teamUserRepositoryContract";
import type { InstructorNoteRepository } from "./instructorNoteRepository";
import type { CoachPrivateRepository } from "./coachPrivateRepository";
import type { ActivityContext } from "../activity/context";

export interface RequestActivityRepository {
  recordRequest(context: ActivityContext, status: number, durationMs: number): Promise<void>;
}
export interface CoachPrivateAccessLogRepository {
  recordAccess(coachId: string, accessedByEmail: string, context: string): Promise<void>;
}
export interface DataRepositories {
  coachSyncLog: CoachSyncLogRepository;
  coachSheetSync: CoachSheetSyncRepository;
  coachSheetSource: CoachSheetSource;
  coachEngagement: CoachEngagementRepository;
  coachSchedule: CoachScheduleRepository;
  coachExport: CoachExportRepository;
  coachToken: CoachTokenRepository;
  coachTokenRotation: CoachTokenRotationRepository;
  coachManagement: CoachManagementRepository;
  teamUsers: TeamUserRepository;
  instructorNote: InstructorNoteRepository;
  coachPrivate: CoachPrivateRepository;
  coachPrivateAccessLog: CoachPrivateAccessLogRepository;
  requestActivity: RequestActivityRepository;
}

const globalForRepositories = globalThis as unknown as {
  hubOmDataRepositories?: AsyncLocalStorage<Readonly<Partial<DataRepositories>>>;
};
const repositoryContext = globalForRepositories.hubOmDataRepositories ??= new AsyncLocalStorage<Readonly<Partial<DataRepositories>>>();

/** Internal, explicit shadow/test boundary. No HTTP header, cookie or environment selects it.
 * Overrides select storage only; they never grant authentication or authorization.
 */
export function runWithDataRepositories<T>(repositories: Partial<DataRepositories>, work: () => T): T {
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
