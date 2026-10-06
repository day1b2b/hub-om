import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { openMongoCalendarRuntime, prepareMongoCalendarRuntimeStore, type MongoCalendarRepositories } from "./mongoCalendarRuntime";
import type { MongoCalendarOptions } from "./mongoCalendarOperationLock";
import { CALENDAR_PERSISTENCE_MODELS } from "./mongoCalendarPersistence";
import { IMPORT_PROMOTION_MODELS } from "./mongoImportPromotionRepository";
import { MongoOmAssignmentRepository, OM_ASSIGNMENT_MODELS, prepareMongoOmAssignmentStore } from "./mongoOmAssignmentRepository";
import { MongoOmRequestRepository, OM_REQUEST_MODELS, prepareMongoOmRequestStore } from "./mongoOmRequestRepository";
import { MongoOperationStore, OPERATION_MODELS } from "./mongoOperationStore";
import { REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { TEAM_READ_MODELS } from "./mongoReadStore";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MONGO_TEAM_USER_MODELS } from "./teamUsers/mongoTeamUserRepository";
import type { OmAssignmentCalendar, OmAssignmentNotifier } from "./omRequest/omAssignmentEffects";
import type { OmCustomToolsRepository, OmRequestNotifier } from "./omRequest/omRequestRepository";

type CalendarScopeKey = keyof MongoCalendarRepositories;
type ScopeKey = CalendarScopeKey | "omAssignment" | "omAssignmentCalendar" | "omAssignmentNotifier" |
  "omCustomTools" | "omRequestNotifier" | "omRequests";
type Options = MongoCalendarOptions & { omAssignmentCalendar: OmAssignmentCalendar;
  omAssignmentNotifier: OmAssignmentNotifier; omCustomTools: OmCustomToolsRepository; omRequestNotifier: OmRequestNotifier };
export type MongoOmRequestWriteRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;
export const MONGO_OM_REQUEST_WRITE_MODELS = [...new Set([
  ...OPERATION_MODELS, ...OM_REQUEST_MODELS, ...OM_ASSIGNMENT_MODELS, ...REQUEST_AUDIT_MODELS, ...MONGO_TEAM_USER_MODELS,
  ...CALENDAR_PERSISTENCE_MODELS, ...IMPORT_PROMOTION_MODELS, ...TEAM_READ_MODELS,
])] as readonly string[];

export interface MongoOmRequestWriteRuntime {
  readonly repositories: MongoOmRequestWriteRepositories;
  run<T>(work: () => T): T;
}

/** Prepares only a completely empty synthetic/shadow namespace. */
export async function prepareMongoOmRequestWriteRuntime(options: Options & { processSequenceHighWater: number }): Promise<MongoOmRequestWriteRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_OM_REQUEST_WRITE_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoCalendarRuntimeStore(options);
      await prepareMongoOmRequestStore(options);
      await prepareMongoOmAssignmentStore(options);
    }
    return await openMongoOmRequestWriteRuntime(options);
  } catch { throw new Error("MONGO_OM_REQUEST_WRITE_RUNTIME_FAILED"); }
}

/** Opens prepared Mongo repositories and explicit synthetic/external effect ports as one locked scope. */
export async function openMongoOmRequestWriteRuntime(options: Options): Promise<MongoOmRequestWriteRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_OM_REQUEST_WRITE_MODELS);
    const [calendar, omAssignment, omRequests] = await Promise.all([
      openMongoCalendarRuntime({ ...options, reflectOperations: true }),
      MongoOmAssignmentRepository.open(options), MongoOmRequestRepository.open(options),
    ]);
    const omAssignmentCalendar: OmAssignmentCalendar = Object.freeze({ reflectOperationUpdated: (operation: Parameters<OmAssignmentCalendar["reflectOperationUpdated"]>[0]) => options.omAssignmentCalendar.reflectOperationUpdated(operation) });
    const omAssignmentNotifier: OmAssignmentNotifier = Object.freeze({ notifyAssigned: (input: Parameters<OmAssignmentNotifier["notifyAssigned"]>[0]) => options.omAssignmentNotifier.notifyAssigned(input) });
    const omCustomTools: OmCustomToolsRepository = Object.freeze({ list: () => options.omCustomTools.list(), add: (names: string[]) => options.omCustomTools.add(names) });
    const omRequestNotifier: OmRequestNotifier = Object.freeze({ notifyCreated: (input: Parameters<OmRequestNotifier["notifyCreated"]>[0]) => options.omRequestNotifier.notifyCreated(input) });
    const repositories: MongoOmRequestWriteRepositories = Object.freeze({ ...calendar.repositories, omAssignment,
      omAssignmentCalendar, omAssignmentNotifier, omCustomTools, omRequestNotifier, omRequests });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_OM_REQUEST_WRITE_RUNTIME_FAILED"); }
}
