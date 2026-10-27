import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { COACH_EVALUATION_REPOSITORY_MODELS, MongoCoachEvaluationRepository } from "./mongoCoachEvaluationRepository";
import { prepareMongoCoachSchedulingGuard } from "./mongoCoachSchedulingGuard";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { prepareMongoReadStore } from "./mongoReadStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";
import { MONGO_TEAM_USER_MODELS, MongoTeamUserRepository, prepareMongoTeamUserStore } from "./teamUsers/mongoTeamUserRepository";

export const MONGO_COACH_EVALUATION_RUNTIME_MODELS = [...new Set([
  ...COACH_EVALUATION_REPOSITORY_MODELS, ...MONGO_TEAM_USER_MODELS, ...REQUEST_AUDIT_MODELS
])] as readonly string[];
type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoCoachEvaluationRepositories = Readonly<Pick<DataRepositories, "coachEvaluation" | "teamUsers" | "requestActivity">>;
export interface MongoCoachEvaluationRuntime { readonly repositories: MongoCoachEvaluationRepositories; run<T>(work: () => T): T }

/** Opens prepared storage only; request handling never creates or repairs collections. */
export async function openMongoCoachEvaluationRuntime(options: Options): Promise<MongoCoachEvaluationRuntime> {
  try {
    const [coachEvaluation, teamUsers, requestActivity] = await Promise.all([
      MongoCoachEvaluationRepository.open(options), MongoTeamUserRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const repositories: MongoCoachEvaluationRepositories = Object.freeze({ coachEvaluation, teamUsers, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_COACH_EVALUATION_RUNTIME_FAILED"); }
}

/** Test/bootstrap boundary. Prepares only an empty shadow namespace; existing state is never repaired. */
export async function prepareMongoCoachEvaluationRuntime(options: Options): Promise<MongoCoachEvaluationRuntime> {
  try {
    const store = new MongoOperationStore(options, MONGO_COACH_EVALUATION_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoReadStore(options, COACH_EVALUATION_REPOSITORY_MODELS);
      await prepareMongoCoachSchedulingGuard(store, options.allowShadowWrites);
      await prepareMongoTeamUserStore(options);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoCoachEvaluationRuntime(options);
  } catch { throw new Error("MONGO_COACH_EVALUATION_RUNTIME_FAILED"); }
}
