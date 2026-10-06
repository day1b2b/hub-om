import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { COACH_ENGAGEMENT_MODELS, MongoCoachEngagementRepository, prepareMongoCoachEngagementStore } from "./mongoCoachEngagementRepository";
import { COACH_SCHEDULE_MODELS, MongoCoachScheduleRepository, prepareMongoCoachScheduleStore } from "./mongoCoachScheduleRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

export const MONGO_COACH_OPERATIONS_RUNTIME_MODELS = [...new Set([
  ...COACH_ENGAGEMENT_MODELS, ...COACH_SCHEDULE_MODELS, ...REQUEST_AUDIT_MODELS
])] as readonly string[];
type Options = MongoOperationOptions & { allowShadowWrites: true };
export type MongoCoachOperationsRepositories = Readonly<Pick<DataRepositories, "coachEngagement" | "coachSchedule" | "requestActivity">>;
export interface MongoCoachOperationsRuntime { readonly repositories: MongoCoachOperationsRepositories; run<T>(work: () => T): T }

export async function openMongoCoachOperationsRuntime(options: Options): Promise<MongoCoachOperationsRuntime> {
  try {
    const [coachEngagement, coachSchedule, requestActivity] = await Promise.all([
      MongoCoachEngagementRepository.open(options), MongoCoachScheduleRepository.open(options), MongoRequestAuditRepository.open(options)
    ]);
    const repositories: MongoCoachOperationsRepositories = Object.freeze({ coachEngagement, coachSchedule, requestActivity });
    registerDataRepositoryScope(repositories);
    return Object.freeze({ repositories, run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    } });
  } catch { throw new Error("MONGO_COACH_OPERATIONS_RUNTIME_FAILED"); }
}

/** Prepares only an empty shadow namespace; existing state is never repaired. */
export async function prepareMongoCoachOperationsRuntime(options: Options): Promise<MongoCoachOperationsRuntime> {
  try {
    new MongoOperationStore(options, MONGO_COACH_OPERATIONS_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoCoachEngagementStore(options);
      await prepareMongoCoachScheduleStore(options);
      await prepareMongoRequestAuditStore(options);
    }
    return await openMongoCoachOperationsRuntime(options);
  } catch { throw new Error("MONGO_COACH_OPERATIONS_RUNTIME_FAILED"); }
}
