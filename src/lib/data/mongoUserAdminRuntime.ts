import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MONGO_TEAM_USER_MODELS, MongoTeamUserRepository, prepareMongoTeamUserStore } from "./teamUsers/mongoTeamUserRepository";

export const MONGO_USER_ADMIN_RUNTIME_MODELS = [...new Set([
  ...MONGO_TEAM_USER_MODELS,
  ...REQUEST_AUDIT_MODELS,
])] as readonly string[];

type Options = MongoOperationOptions & { allowShadowWrites: true };
type ScopeKey = "teamUsers" | "requestActivity";
export type MongoUserAdminRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;

export interface MongoUserAdminRuntime {
  readonly repositories: MongoUserAdminRepositories;
  run<T>(work: () => T): T;
}

function runtime(repositories: MongoUserAdminRepositories): MongoUserAdminRuntime {
  registerDataRepositoryScope(repositories);
  return Object.freeze({
    repositories,
    run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    },
  });
}

/** Opens one borrowed-client user-admin scope without preparing or repairing collections. */
export async function openMongoUserAdminRuntime(options: Options): Promise<MongoUserAdminRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    const [teamUsers, requestActivity] = await Promise.all([
      MongoTeamUserRepository.open(options),
      MongoRequestAuditRepository.open(options),
    ]);
    return runtime(Object.freeze({ teamUsers, requestActivity }));
  } catch { throw new Error("MONGO_USER_ADMIN_RUNTIME_FAILED"); }
}

/** Prepares only an empty shadow namespace. Existing state receives a read-only readiness check. */
export async function prepareMongoUserAdminRuntime(options: Options): Promise<MongoUserAdminRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_USER_ADMIN_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoRequestAuditStore(options);
      await prepareMongoTeamUserStore(options);
    }
    return await openMongoUserAdminRuntime(options);
  } catch { throw new Error("MONGO_USER_ADMIN_RUNTIME_FAILED"); }
}
