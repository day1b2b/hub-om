import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { COURSE_ADMIN_MODELS, MongoCourseAdminRepository, prepareMongoCourseAdminStore } from "./mongoCourseAdminRepository";
import { DELETED_OPERATION_MODELS, MongoDeletedOperationRepository, prepareMongoDeletedOperationStore } from "./mongoDeletedOperationRepository";
import { OPERATION_BACKFILL_MODELS, MongoOperationBackfillRepository, prepareMongoOperationBackfillStore } from "./mongoOperationBackfillRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

export const MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS = [...new Set([
  ...COURSE_ADMIN_MODELS,
  ...DELETED_OPERATION_MODELS,
  ...OPERATION_BACKFILL_MODELS,
  ...REQUEST_AUDIT_MODELS,
])] as readonly string[];

type Options = MongoOperationOptions & { allowShadowWrites: true };
type ScopeKey = "courseAdmin" | "deletedOperations" | "operationBackfill" | "requestActivity";
export type MongoAdminMaintenanceRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;

export interface MongoAdminMaintenanceRuntime {
  readonly repositories: MongoAdminMaintenanceRepositories;
  run<T>(work: () => T): T;
}

function runtime(repositories: MongoAdminMaintenanceRepositories): MongoAdminMaintenanceRuntime {
  registerDataRepositoryScope(repositories);
  return Object.freeze({ repositories, run<T>(work: () => T): T {
    return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
  } });
}

export async function openMongoAdminMaintenanceRuntime(options: Options): Promise<MongoAdminMaintenanceRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    const [courseAdmin, deletedOperations, operationBackfill, requestActivity] = await Promise.all([
      MongoCourseAdminRepository.open(options), MongoDeletedOperationRepository.open(options),
      MongoOperationBackfillRepository.open(options), MongoRequestAuditRepository.open(options),
    ]);
    return runtime(Object.freeze({ courseAdmin, deletedOperations, operationBackfill, requestActivity }));
  } catch { throw new Error("MONGO_ADMIN_MAINTENANCE_RUNTIME_FAILED"); }
}

export async function prepareMongoAdminMaintenanceRuntime(options: Options): Promise<MongoAdminMaintenanceRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_ADMIN_MAINTENANCE_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoRequestAuditStore(options);
      await prepareMongoCourseAdminStore(options);
      await prepareMongoDeletedOperationStore(options);
      await prepareMongoOperationBackfillStore(options);
    }
    return await openMongoAdminMaintenanceRuntime(options);
  } catch { throw new Error("MONGO_ADMIN_MAINTENANCE_RUNTIME_FAILED"); }
}
