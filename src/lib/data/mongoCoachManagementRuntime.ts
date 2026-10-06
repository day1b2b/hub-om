import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { COACH_MANAGEMENT_MODELS, MongoCoachManagementRepository, prepareMongoCoachManagementStore } from "./mongoCoachManagementRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

export const MONGO_COACH_MANAGEMENT_RUNTIME_MODELS = [...new Set([
  ...COACH_MANAGEMENT_MODELS, ...REQUEST_AUDIT_MODELS
])] as readonly string[];
type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoCoachManagementRepositories = Readonly<Pick<DataRepositories, "coachManagement" | "requestActivity">>;
export interface MongoCoachManagementRuntime { readonly repositories: MongoCoachManagementRepositories; run<T>(work: () => T): T }

export async function openMongoCoachManagementRuntime(options: Options): Promise<MongoCoachManagementRuntime> {
  try {
    const [coachManagement, requestActivity] = await Promise.all([
      MongoCoachManagementRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const repositories: MongoCoachManagementRepositories = Object.freeze({ coachManagement, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_COACH_MANAGEMENT_RUNTIME_FAILED"); }
}

/** Prepares only an empty shadow namespace; existing state is never repaired. */
export async function prepareMongoCoachManagementRuntime(options: Options): Promise<MongoCoachManagementRuntime> {
  try {
    new MongoOperationStore(options, MONGO_COACH_MANAGEMENT_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoCoachManagementStore(options);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoCoachManagementRuntime(options);
  } catch { throw new Error("MONGO_COACH_MANAGEMENT_RUNTIME_FAILED"); }
}
