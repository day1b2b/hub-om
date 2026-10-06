import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { COACH_ADMIN_MODELS, MongoCoachAdminRepository, prepareMongoCoachAdminStore } from "./mongoCoachAdminRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

export const MONGO_COACH_ADMIN_RUNTIME_MODELS = [...new Set([
  ...COACH_ADMIN_MODELS,
  ...REQUEST_AUDIT_MODELS,
])] as readonly string[];

type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoCoachAdminRepositories = Readonly<Pick<DataRepositories, "coachAdmin" | "requestActivity">>;

export interface MongoCoachAdminRuntime {
  readonly repositories: MongoCoachAdminRepositories;
  run<T>(work: () => T): T;
}

function runtime(repositories: MongoCoachAdminRepositories): MongoCoachAdminRuntime {
  registerDataRepositoryScope(repositories);
  return Object.freeze({
    repositories,
    run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    },
  });
}

/** Opens one borrowed-client coach-admin scope without preparing or repairing collections. */
export async function openMongoCoachAdminRuntime(options: Options): Promise<MongoCoachAdminRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    const [coachAdmin, requestActivity] = await Promise.all([
      MongoCoachAdminRepository.open(options),
      MongoRequestAuditRepository.open(options),
    ]);
    return runtime(Object.freeze({ coachAdmin, requestActivity }));
  } catch { throw new Error("MONGO_COACH_ADMIN_RUNTIME_FAILED"); }
}

/** Prepares only an empty shadow namespace. Existing state receives a read-only readiness check. */
export async function prepareMongoCoachAdminRuntime(options: Options): Promise<MongoCoachAdminRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_COACH_ADMIN_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoRequestAuditStore(options);
      await prepareMongoCoachAdminStore(options);
    }
    return await openMongoCoachAdminRuntime(options);
  } catch { throw new Error("MONGO_COACH_ADMIN_RUNTIME_FAILED"); }
}
