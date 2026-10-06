import type { DataRepositories } from "./dataRepositoryContext";
import { registerDataRepositoryScope, runWithDataRepositories, runWithLockedRepositoryScope } from "./dataRepositoryContext";
import { ACTIVITY_READ_MODELS, MongoActivityReadRepository, prepareMongoActivityReadStore } from "./mongoActivityReadRepository";
import { COACH_CONTENT_MODELS, MongoCoachContentRepository, prepareMongoCoachContentStore } from "./mongoCoachContentRepository";
import { COACH_ENGAGEMENT_MODELS, MongoCoachEngagementRepository, prepareMongoCoachEngagementStore } from "./mongoCoachEngagementRepository";
import { MongoOperationStore, type MongoOperationOptions } from "./mongoOperationStore";
import { MongoRequestAuditRepository, prepareMongoRequestAuditStore, REQUEST_AUDIT_MODELS } from "./mongoRequestAuditRepository";
import { hasKnownMongoRuntimeCollections } from "./mongoRuntimeNamespace";

export const MONGO_CHANGES_RUNTIME_MODELS = [...new Set([
  ...ACTIVITY_READ_MODELS,
  ...COACH_CONTENT_MODELS,
  ...COACH_ENGAGEMENT_MODELS,
  ...REQUEST_AUDIT_MODELS,
])] as readonly string[];

type Options = MongoOperationOptions & { allowShadowWrites: true };
type ScopeKey = "activityReads" | "coachContent" | "coachEngagement" | "requestActivity";
export type MongoChangesRepositories = Readonly<Pick<DataRepositories, ScopeKey>>;

export interface MongoChangesRuntime {
  readonly repositories: MongoChangesRepositories;
  run<T>(work: () => T): T;
}

function runtime(repositories: MongoChangesRepositories): MongoChangesRuntime {
  registerDataRepositoryScope(repositories);
  return Object.freeze({
    repositories,
    run<T>(work: () => T): T {
      return runWithDataRepositories(repositories, () => runWithLockedRepositoryScope(work));
    },
  });
}

/** Opens one borrowed-client changes scope without preparing or repairing collections. */
export async function openMongoChangesRuntime(options: Options): Promise<MongoChangesRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    const [activityReads, coachContent, coachEngagement, requestActivity] = await Promise.all([
      MongoActivityReadRepository.open(options),
      MongoCoachContentRepository.open(options),
      MongoCoachEngagementRepository.open(options),
      MongoRequestAuditRepository.open(options),
    ]);
    return runtime(Object.freeze({ activityReads, coachContent, coachEngagement, requestActivity }));
  } catch { throw new Error("MONGO_CHANGES_RUNTIME_FAILED"); }
}

/** Prepares only an empty shadow namespace. Existing state receives a read-only readiness check. */
export async function prepareMongoChangesRuntime(options: Options): Promise<MongoChangesRuntime> {
  try {
    if (options.allowShadowWrites !== true) throw new Error("gate");
    new MongoOperationStore(options, MONGO_CHANGES_RUNTIME_MODELS);
    if (!await hasKnownMongoRuntimeCollections(options)) {
      await prepareMongoRequestAuditStore(options);
      await prepareMongoCoachEngagementStore(options);
      await prepareMongoCoachContentStore(options);
      await prepareMongoActivityReadStore(options);
    }
    return await openMongoChangesRuntime(options);
  } catch { throw new Error("MONGO_CHANGES_RUNTIME_FAILED"); }
}
