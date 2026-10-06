import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { ADMIN_DATABASE_MODELS, MongoAdminDatabaseRepository, prepareMongoAdminDatabaseStore } from "./mongoAdminDatabaseRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { prepareMongoReadStore, TEAM_READ_MODELS } from "./mongoReadStore";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MongoTeamMemberRepository } from "./mongoTeamMemberRepository";

export const MONGO_ADMIN_DATABASE_RUNTIME_MODELS = [...new Set([
  ...ADMIN_DATABASE_MODELS,
  ...TEAM_READ_MODELS,
  ...REQUEST_AUDIT_MODELS,
])] as readonly string[];

type Options = MongoOperationOptions & { allowShadowWrites: true };
type ScopeKey = "adminDatabase" | "teamMembers" | "requestActivity";
export type MongoAdminDatabaseRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;

export interface MongoAdminDatabaseRuntime {
  readonly repositories: MongoAdminDatabaseRepositories;
  run<T>(work: () => T): T;
}

function runtime(repositories: MongoAdminDatabaseRepositories): MongoAdminDatabaseRuntime {
  registerDataRepositoryScope(repositories);
  return Object.freeze({
    repositories,
    run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    },
  });
}

/** Opens one borrowed-client admin-database scope without preparing or repairing collections. */
export async function openMongoAdminDatabaseRuntime(options: Options): Promise<MongoAdminDatabaseRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    const [adminDatabase, teamMembers, requestActivity] = await Promise.all([
      MongoAdminDatabaseRepository.open(options),
      MongoTeamMemberRepository.open(options),
      MongoRequestAuditRepository.open(options),
    ]);
    return runtime(Object.freeze({ adminDatabase, teamMembers, requestActivity }));
  } catch { throw new Error("MONGO_ADMIN_DATABASE_RUNTIME_FAILED"); }
}

/** Prepares only an empty shadow namespace. Existing state receives a read-only readiness check. */
export async function prepareMongoAdminDatabaseRuntime(options: Options): Promise<MongoAdminDatabaseRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_ADMIN_DATABASE_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoRequestAuditStore(options);
      await prepareMongoAdminDatabaseStore(options);
      await prepareMongoReadStore(options, TEAM_READ_MODELS);
    }
    return await openMongoAdminDatabaseRuntime(options);
  } catch { throw new Error("MONGO_ADMIN_DATABASE_RUNTIME_FAILED"); }
}
