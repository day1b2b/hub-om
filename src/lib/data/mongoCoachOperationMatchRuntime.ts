import type { MongoOperationOptions } from "./mongoOperationStore";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { COACH_OPERATION_MATCH_MODELS, MongoCoachOperationMatchRepository, prepareMongoCoachOperationMatchStore } from "./mongoCoachOperationMatchRepository";

type Options = MongoOperationOptions & { allowShadowWrites: true };

export async function openMongoCoachOperationMatchRuntime(options: Options) {
  try {
    const repositories = Object.freeze({ coachOperationMatch: await MongoCoachOperationMatchRepository.open(options) });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T { return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work)); } });
  } catch { throw new Error("MONGO_COACH_OPERATION_MATCH_RUNTIME_FAILED"); }
}

export async function prepareMongoCoachOperationMatchRuntime(options: Options) {
  try {
    if (!await hasKnownMongoRuntimeCollections(options)) await prepareMongoCoachOperationMatchStore(options);
    return await openMongoCoachOperationMatchRuntime(options);
  } catch { throw new Error("MONGO_COACH_OPERATION_MATCH_RUNTIME_FAILED"); }
}

export { COACH_OPERATION_MATCH_MODELS as MONGO_COACH_OPERATION_MATCH_RUNTIME_MODELS };
