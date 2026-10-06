import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { ANNOUNCEMENT_MODELS, MongoAnnouncementRepository, prepareMongoAnnouncementStore } from "./mongoAnnouncementRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

export const MONGO_ANNOUNCEMENT_RUNTIME_MODELS = [...new Set([
  ...ANNOUNCEMENT_MODELS,
  ...REQUEST_AUDIT_MODELS,
])] as readonly string[];

type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoAnnouncementRepositories = Readonly<Pick<DataRepositories, "announcements" | "requestActivity">>;

export interface MongoAnnouncementRuntime {
  readonly repositories: MongoAnnouncementRepositories;
  run<T>(work: () => T): T;
}

function runtime(repositories: MongoAnnouncementRepositories): MongoAnnouncementRuntime {
  registerDataRepositoryScope(repositories);
  return Object.freeze({
    repositories,
    run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    },
  });
}

/** Opens one borrowed-client announcement scope without preparing or repairing collections. */
export async function openMongoAnnouncementRuntime(options: Options): Promise<MongoAnnouncementRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    const [announcements, requestActivity] = await Promise.all([
      MongoAnnouncementRepository.open(options),
      MongoRequestAuditRepository.open(options),
    ]);
    return runtime(Object.freeze({ announcements, requestActivity }));
  } catch { throw new Error("MONGO_ANNOUNCEMENT_RUNTIME_FAILED"); }
}

/** Prepares only an empty shadow namespace. Existing state receives a read-only readiness check. */
export async function prepareMongoAnnouncementRuntime(options: Options): Promise<MongoAnnouncementRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_ANNOUNCEMENT_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoRequestAuditStore(options);
      await prepareMongoAnnouncementStore(options);
    }
    return await openMongoAnnouncementRuntime(options);
  } catch { throw new Error("MONGO_ANNOUNCEMENT_RUNTIME_FAILED"); }
}
