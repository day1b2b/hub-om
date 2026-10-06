import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { COACH_EXPORT_MODELS, MongoCoachExportRepository, prepareMongoCoachExportStore } from "./mongoCoachExportRepository";
import { COACH_TOKEN_ROTATION_MODELS, MongoCoachTokenRotationRepository, prepareMongoCoachTokenRotationStore } from "./mongoCoachTokenRotationRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

export const MONGO_COACH_ACCESS_RUNTIME_MODELS = [...new Set([...COACH_EXPORT_MODELS, ...COACH_TOKEN_ROTATION_MODELS, ...REQUEST_AUDIT_MODELS])] as readonly string[];
type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoCoachAccessRepositories = Readonly<Pick<DataRepositories, "coachExport" | "coachTokenRotation" | "requestActivity">>;
export interface MongoCoachAccessRuntime { readonly repositories: MongoCoachAccessRepositories; run<T>(work: () => T): T }
export async function openMongoCoachAccessRuntime(options: Options): Promise<MongoCoachAccessRuntime> {
  try {
    const [coachExport, coachTokenRotation, requestActivity] = await Promise.all([
      MongoCoachExportRepository.open(options), MongoCoachTokenRotationRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const repositories: MongoCoachAccessRepositories = Object.freeze({ coachExport, coachTokenRotation, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } });
  } catch { throw new Error("MONGO_COACH_ACCESS_RUNTIME_FAILED"); }
}
export async function prepareMongoCoachAccessRuntime(options: Options): Promise<MongoCoachAccessRuntime> {
  try {
    new MongoOperationStore(options, MONGO_COACH_ACCESS_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoRequestAuditStore(options);
      await prepareMongoCoachExportStore(options);
      await prepareMongoCoachTokenRotationStore(options);
    }
    return await openMongoCoachAccessRuntime(options);
  } catch { throw new Error("MONGO_COACH_ACCESS_RUNTIME_FAILED"); }
}
