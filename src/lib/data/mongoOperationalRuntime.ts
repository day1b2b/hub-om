import type { MongoOperationOptions } from "./mongoOperationStore";
import { MongoOperationStore } from "./mongoOperationStore";
import { MongoDatabaseHealthRepository } from "./mongoDatabaseHealthRepository";
import { ADMIN_BACKUP_READ_MODELS, MongoAdminBackupRepository, prepareMongoAdminBackupStore } from "./mongoAdminBackupRepository";
import { ACTIVITY_PRUNE_MODELS, MongoActivityPruneRepository, prepareMongoActivityPruneStore } from "./mongoActivityPruneRepository";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope, type DataRepositories } from "./dataRepositoryContext";
import { mongoRuntimeContracts } from "./mongoRuntimeCodec";

export const MONGO_OPERATIONAL_RUNTIME_MODELS = [...new Set([
  ...ADMIN_BACKUP_READ_MODELS,
  ...REQUEST_AUDIT_MODELS,
  ...ACTIVITY_PRUNE_MODELS,
])] as readonly string[];
const KNOWN_INTERNAL_COLLECTIONS = [
  "__creation", "__counter", "__teamUserWriteGuard", "CalendarOperationLease",
  "CoachCatalogGuard", "CoachSchedulingGuard", "CourseNameRestoreGuard",
] as const;

export type MongoOperationalRepositories = Readonly<Pick<DataRepositories,
  "activityPrune" | "adminBackup" | "databaseHealth" | "requestActivity" | "coachPrivateAccessLog"
>>;

type PrepareOptions = MongoOperationOptions & { allowShadowWrites: true };

export interface MongoOperationalRuntime {
  readonly repositories: MongoOperationalRepositories;
  run<T>(work: () => T): T;
}

function runtime(repositories: MongoOperationalRepositories): MongoOperationalRuntime {
  registerDataRepositoryScope(repositories);
  return Object.freeze({
    repositories,
    run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    },
  });
}

/** Opens one borrowed-client operational scope. It never prepares or repairs collections. */
export async function openMongoOperationalRuntime(options: PrepareOptions): Promise<MongoOperationalRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    // Constructor validates database, namespace and the complete model set before any IO.
    new MongoOperationStore(options, MONGO_OPERATIONAL_RUNTIME_MODELS);
    const audit = await MongoRequestAuditRepository.open(options);
    const repositories = Object.freeze({
      activityPrune: await MongoActivityPruneRepository.open(options),
      adminBackup: await MongoAdminBackupRepository.open(options),
      databaseHealth: new MongoDatabaseHealthRepository(options.client, options.databaseName),
      requestActivity: audit,
      coachPrivateAccessLog: audit,
    }) satisfies MongoOperationalRepositories;
    return runtime(repositories);
  } catch {
    throw new Error("MONGO_OPERATIONAL_RUNTIME_FAILED");
  }
}

/**
 * Prepares only a completely empty namespace. A non-empty namespace is read-only checked by
 * openMongoOperationalRuntime; partial or old-policy state fails without repair or deletion.
 * The caller owns the client and the whole synthetic namespace lifecycle.
 */
export async function prepareMongoOperationalRuntime(options: PrepareOptions): Promise<MongoOperationalRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    const store = new MongoOperationStore(options, MONGO_OPERATIONAL_RUNTIME_MODELS);
    const ownedNames = new Set([
      ...Object.keys(mongoRuntimeContracts).map(model => `${options.namespace}_${model}`),
      ...KNOWN_INTERNAL_COLLECTIONS.map(name => `${options.namespace}_${name}`),
    ]);
    const cursor = store.db.listCollections({}, { nameOnly: true, timeoutMS: 5000 });
    let existing = false;
    try {
      for await (const collection of cursor) {
        if (ownedNames.has(collection.name)) { existing = true; break; }
      }
    } finally { await cursor.close({ timeoutMS: 5000 }); }

    if (!existing) {
      // Request audit creates the shared Coach/Activity collections and scheduling guard first.
      // The backup and prune preparers then validate those exact definitions without repair.
      await prepareMongoRequestAuditStore(options);
      await prepareMongoAdminBackupStore(options);
      await prepareMongoActivityPruneStore(options);
    }
    return await openMongoOperationalRuntime(options);
  } catch {
    throw new Error("MONGO_OPERATIONAL_RUNTIME_FAILED");
  }
}
